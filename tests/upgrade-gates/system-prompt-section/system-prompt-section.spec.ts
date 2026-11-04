import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/**
 * Pre-A spike probe: dynamic system-prompt section + variable on pinned DSH
 * (commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e, 0.1.1-rc.2).
 *
 * This file is copied unchanged into the pinned upstream DSH tree by the gate
 * runner, so it exercises the real AgentLoop, not a reimplementation. It owns
 * no Bridge, no production code, and no DSH patch.
 *
 * The hypothesis: `agent.ctx.systemPrompt.section({ text: fn })` plus
 * `agent.ctx.systemPrompt.variable(...)` gives latest-only delivery with no
 * durable history growth and no driver wake, unlike `systemPrompt.context`
 * (durable snapshot accumulation) and `agent.inject` (append-only, waking).
 *
 * Pinned facts this probe depends on (read, not modified):
 * - `packages/core/agent-loop/src/agent.ts` `step()`: `renderPrompt(assembly)`
 *   builds the system string per step and `session.deriveMessages()` supplies
 *   model-visible history, so sections never enter the surface.
 * - `packages/core/agent-loop/src/agent.ts` `buildRequest()`: `request/header`
 *   is appended only when the canonical header (carrying `system`) differs.
 * - `packages/core/system-prompt/src/index.ts` `assemble()`: a function `text`
 *   is re-evaluated per assembly; `renderPrompt()` interpolates `{{name}}`
 *   strictly and never rescans substituted values.
 */

const SNAPSHOT_SECTION = 'companion-go:go-snapshot'
const SNAPSHOT_VARIABLE = 'go_snapshot'
const MARKER = 'GO_SNAPSHOT='

type TraceEntry = { event: string; detail?: unknown }

/** O(1) Runtime-held latest value; `undefined` means "nothing to project". */
type SnapshotHolder = { value: string | undefined }

type SectionStats = {
  evaluations: number
  disposerIsFunction: boolean
}

const liveContexts: Context[] = []

afterEach(async () => {
  await Promise.all(liveContexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'echo',
    description: 'deterministic continuation fixture',
    parameters: { text: { type: 'string', required: true } },
    execute: async ({ text }) => [{ type: 'text', text }],
  }))
  liveContexts.push(ctx)
  return ctx
}

/**
 * Register the proposed production shape on one agent's scope: a variable
 * provider is the only place the live value enters, and the section is a
 * static template. The section contributes nothing while the holder is empty,
 * so an undefined variable never reaches rendering.
 */
function registerSectionSnapshot(
  agent: Agent,
  holder: SnapshotHolder,
  trace: TraceEntry[],
): SectionStats {
  const stats: SectionStats = { evaluations: 0, disposerIsFunction: false }
  agent.ctx.systemPrompt.variable(SNAPSHOT_VARIABLE, () => holder.value)
  const disposer = agent.ctx.systemPrompt.section({
    name: SNAPSHOT_SECTION,
    order: 10,
    text: () => {
      stats.evaluations += 1
      trace.push({ event: 'section/evaluated', detail: { value: holder.value ?? null } })
      return holder.value === undefined ? '' : MARKER + '{{' + SNAPSHOT_VARIABLE + '}}'
    },
  })
  stats.disposerIsFunction = typeof disposer === 'function'
  trace.push({ event: 'section/registered', detail: { disposerIsFunction: stats.disposerIsFunction } })
  return stats
}

function messageText(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function textOf(input: UserMessage): string | undefined {
  const [block] = input.content
  return input.content.length === 1 && block?.type === 'text' ? block.text : undefined
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function headerReasons(agent: Agent): string[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'request/header' }> => event.type === 'request/header')
    .map(event => event.data.reason)
}

function countEvents(agent: Agent, type: SessionEvent['type']): number {
  return agent.session.events.filter(event => event.type === type).length
}

function userMessages(agent: Agent): { text: string | undefined; source: unknown }[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> => event.type === 'user/message')
    .map(event => ({ text: textOf(event.data), source: event.data.source }))
}

function recordedUsage(agent: Agent): unknown[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'assistant/message' }> => event.type === 'assistant/message')
    .map(event => event.data.usage)
}

function systems(adapter: MockAdapter): string[] {
  return adapter.requests.map(request => request.system ?? '')
}

function report(label: string, payload: unknown): void {
  console.log('DSH_SECTION_SPIKE ' + label + ' ' + JSON.stringify(payload))
}

function settle(ms = 25): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return index
  }
  return limit
}

describe('Pre-A spike: dynamic system section + variable on pinned DSH', () => {
  it('1. latest-only: A0 to B1 leaves only B1 in the next request system and nothing in history', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('section-latest-only'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    const holder: SnapshotHolder = { value: 'A0' }
    let changeEvents = 0
    ctx.on('system-prompt/change', () => { changeEvents += 1 })
    const stats = registerSectionSnapshot(agent, holder, trace)

    agent.followup(messageText('start'))
    await agent.whenIdle()

    expect(stats.disposerIsFunction).toBe(true)
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0].messages ?? []).toHaveLength(1)
    expect(systems(adapter)[0]).toContain('GO_SNAPSHOT=A0')
    expect(countOccurrences(systems(adapter)[0], 'GO_SNAPSHOT=')).toBe(1)

    holder.value = 'B1'
    await settle()
    await settle()
    expect(adapter.requests).toHaveLength(1)
    expect(agent.status).toBe('idle')

    agent.followup(messageText('next'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const next = systems(adapter)[1]
    expect(countOccurrences(next, 'GO_SNAPSHOT=B1')).toBe(1)
    expect(countOccurrences(next, 'GO_SNAPSHOT=A0')).toBe(0)
    expect(countOccurrences(next, 'GO_SNAPSHOT=')).toBe(1)

    const durable = userMessages(agent)
    expect(durable.map(message => message.text)).toEqual(['start', 'next'])
    expect(durable.every(message => (message.source as { kind?: string }).kind === 'user')).toBe(true)
    expect(durable.some(message => JSON.stringify(message).includes('GO_SNAPSHOT='))).toBe(false)
    expect(JSON.stringify(adapter.requests[1].messages)).not.toContain('GO_SNAPSHOT=')

    // One notification per registration (variable, section): value reads emit none.
    expect(changeEvents).toBe(2)
    expect(headerReasons(agent)).toEqual(['initial', 'change'])

    report('1-latest-only', {
      firstSystemHasA0: countOccurrences(systems(adapter)[0], 'GO_SNAPSHOT=A0'),
      secondSystemHasB1: countOccurrences(next, 'GO_SNAPSHOT=B1'),
      secondSystemHasA0: countOccurrences(next, 'GO_SNAPSHOT=A0'),
      durableUserMessages: durable.map(message => message.text),
      headerReasons: headerReasons(agent),
      changeEvents,
      trace,
    })
  })

  it('2. twenty snapshot updates wake nothing: zero additional requests, turns, steps, or headers', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('section-no-wake'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    const holder: SnapshotHolder = { value: 'v-00' }
    let changeEvents = 0
    ctx.on('system-prompt/change', () => { changeEvents += 1 })
    const stats = registerSectionSnapshot(agent, holder, trace)

    agent.followup(messageText('start'))
    await agent.whenIdle()

    const requestsAfterFirst = adapter.requests.length
    const turnsAfterFirst = countEvents(agent, 'turn/start')
    const stepsAfterFirst = countEvents(agent, 'step/start')
    const headersAfterFirst = headerReasons(agent).length
    const evaluationsAfterFirst = stats.evaluations

    for (let index = 1; index <= 20; index += 1) {
      holder.value = 'v-' + String(index).padStart(2, '0')
    }
    await settle()
    await settle()

    expect(adapter.requests).toHaveLength(requestsAfterFirst)
    expect(countEvents(agent, 'turn/start')).toBe(turnsAfterFirst)
    expect(countEvents(agent, 'step/start')).toBe(stepsAfterFirst)
    expect(headerReasons(agent)).toHaveLength(headersAfterFirst)
    expect(stats.evaluations).toBe(evaluationsAfterFirst)
    expect(changeEvents).toBe(2)
    expect(agent.status).toBe('idle')

    const requestsAfterUpdates = adapter.requests.length
    const turnsAfterUpdates = countEvents(agent, 'turn/start')
    const stepsAfterUpdates = countEvents(agent, 'step/start')
    const evaluationsAfterUpdates = stats.evaluations

    agent.followup(messageText('after-20'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    const next = systems(adapter)[1]
    expect(countOccurrences(next, 'GO_SNAPSHOT=v-20')).toBe(1)
    expect(countOccurrences(next, 'GO_SNAPSHOT=v-19')).toBe(0)
    expect(countOccurrences(next, 'GO_SNAPSHOT=')).toBe(1)

    report('2-twenty-updates-no-wake', {
      requestsAfterFirst,
      turnsAfterFirst,
      stepsAfterFirst,
      headersAfterFirst,
      evaluationsAfterFirst,
      requestsAfterUpdates,
      turnsAfterUpdates,
      stepsAfterUpdates,
      evaluationsAfterUpdates,
      finalSystemSnapshotCount: countOccurrences(next, 'GO_SNAPSHOT='),
    })
  })

  it('3. an unchanged value adds no request/header event across natural requests', async () => {
    const adapter = new MockAdapter([
      textResponse('a'),
      textResponse('b'),
      textResponse('c'),
      textResponse('d'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('section-unchanged-header'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    const holder: SnapshotHolder = { value: 'STABLE' }
    const stats = registerSectionSnapshot(agent, holder, trace)

    agent.followup(messageText('one'))
    await agent.whenIdle()
    agent.followup(messageText('two'))
    await agent.whenIdle()
    agent.followup(messageText('three'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(3)
    expect(stats.evaluations).toBeGreaterThanOrEqual(3)
    expect(headerReasons(agent)).toEqual(['initial'])
    const [first, second, third] = systems(adapter)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(userMessages(agent).map(message => message.text)).toEqual(['one', 'two', 'three'])

    holder.value = 'STABLE'
    await settle()
    expect(adapter.requests).toHaveLength(3)
    expect(headerReasons(agent)).toHaveLength(1)

    holder.value = 'CHANGED'
    agent.followup(messageText('four'))
    await agent.whenIdle()
    expect(headerReasons(agent)).toEqual(['initial', 'change'])
    expect(systems(adapter)[3]).toContain('GO_SNAPSHOT=CHANGED')

    report('3-unchanged-header', {
      headerReasons: headerReasons(agent),
      evaluations: stats.evaluations,
      systemsIdentical: second === first && third === first,
      durableUserMessages: userMessages(agent).map(message => message.text),
    })
  })

  it('4. double braces survive only through a variable value; raw section text is strict', async () => {
    const adapter = new MockAdapter([textResponse('ack-1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('section-braces'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    const braceValue = 'A0 {{x}} {{not a name}} {{}} trailing {{'
    const holder: SnapshotHolder = { value: braceValue }
    registerSectionSnapshot(agent, holder, trace)

    agent.followup(messageText('start'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    const system = systems(adapter)[0]
    expect(system).toContain(MARKER + braceValue)
    expect(countOccurrences(system, 'GO_SNAPSHOT=')).toBe(1)

    ctx.systemPrompt.section({ name: 'spike:raw-braces', order: 11, text: 'RAW {{x}}' })
    await expect(ctx.systemPrompt.assemble().then(assembly => renderPrompt(assembly)))
      .rejects.toThrow('unknown prompt variable "{{x}}"')

    report('4-double-braces', {
      rendered: countOccurrences(system, MARKER + braceValue),
      systemTail: system.slice(Math.max(0, system.indexOf(MARKER) - 40)).slice(0, 140),
    })
  })

  it('5. two agents keep their own sections; an unregistered agent sees neither', async () => {
    const adapter = new MockAdapter([textResponse('w'), textResponse('g'), textResponse('b')])
    const ctx = await harness(adapter)
    const work = ctx.agentLoop.create(SessionId('section-work-lane'), { provider: 'mock', model: 'mock' })
    const go = ctx.agentLoop.create(SessionId('section-go-lane'), { provider: 'mock', model: 'mock' })
    const bare = ctx.agentLoop.create(SessionId('section-bare-lane'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []

    work.ctx.systemPrompt.section({ name: 'spike:work', order: 10, text: 'WORK_ONLY=W0' })
    registerSectionSnapshot(go, { value: 'G0' }, trace)

    work.followup(messageText('work'))
    await work.whenIdle()
    go.followup(messageText('go'))
    await go.whenIdle()
    bare.followup(messageText('bare'))
    await bare.whenIdle()

    const [workSystem, goSystem, bareSystem] = systems(adapter)
    expect(countOccurrences(workSystem, 'WORK_ONLY=W0')).toBe(1)
    expect(countOccurrences(workSystem, 'GO_SNAPSHOT=')).toBe(0)
    expect(countOccurrences(goSystem, 'GO_SNAPSHOT=G0')).toBe(1)
    expect(countOccurrences(goSystem, 'WORK_ONLY=W0')).toBe(0)
    expect(countOccurrences(bareSystem, 'GO_SNAPSHOT=')).toBe(0)
    expect(countOccurrences(bareSystem, 'WORK_ONLY=W0')).toBe(0)

    report('5-agent-isolation', {
      work: { workMarker: countOccurrences(workSystem, 'WORK_ONLY=W0'), goMarker: countOccurrences(workSystem, 'GO_SNAPSHOT=') },
      go: { goMarker: countOccurrences(goSystem, 'GO_SNAPSHOT=G0'), workMarker: countOccurrences(goSystem, 'WORK_ONLY=W0') },
      bare: { goMarker: countOccurrences(bareSystem, 'GO_SNAPSHOT='), workMarker: countOccurrences(bareSystem, 'WORK_ONLY=W0') },
    })
  })

  it('6. a changed section rewrites the request prefix before every message (cache-invalidation shape)', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('section-prefix-cost'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    const holder: SnapshotHolder = { value: 'A0' }
    registerSectionSnapshot(agent, holder, trace)

    agent.followup(messageText('start'))
    await agent.whenIdle()
    holder.value = 'B1'
    agent.followup(messageText('next'))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const [before, after] = systems(adapter)
    expect(before).not.toBe(after)

    const prefix = commonPrefixLength(before, after)
    expect(prefix).toBeLessThan(before.length)
    expect(after).not.toContain('GO_SNAPSHOT=A0')
    const tailMessages = JSON.stringify(adapter.requests[1].messages ?? [])
    expect(tailMessages).not.toContain('GO_SNAPSHOT=A0')
    expect(headerReasons(agent)).toEqual(['initial', 'change'])

    report('6-prefix-cost-shape', {
      systemCharsBefore: before.length,
      systemCharsAfter: after.length,
      stablePrefixChars: prefix,
      invalidatedSystemChars: after.length - prefix,
      messageCharsAfter: tailMessages.length,
      recordedUsage: recordedUsage(agent),
    })
  })
})
