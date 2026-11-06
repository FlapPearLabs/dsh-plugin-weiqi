import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/**
 * WAVE-D-S01 executable probe: `agent.inject()` fallback behavior on pinned
 * DSH (commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e, 0.1.1-rc.2).
 *
 * This file is copied unchanged into the pinned upstream DSH tree by the
 * gate workflow, so it exercises the real AgentLoop / Inbox implementation.
 * It owns NO Bridge, NO production code, and NO DSH patch.
 *
 * The question under test is the frozen Spec §39.6 delivery requirement:
 * "the next natural request sees only the newest relevant snapshot".
 *
 * Every assertion records the OBSERVED pinned behavior. A passing suite means
 * the observed behavior is reproducibly established, not that the behavior
 * satisfies latest-only delivery.
 */

const PROBE_PLUGIN = 'companion-go:d-s01-inject-probe'
const SNAPSHOT_MARKER = 'WORK_SNAPSHOT='
const NOTICE_MARKER = 'GAME_NOTICE='

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

function snapshotMessage(value: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: SNAPSHOT_MARKER + value }],
    source: { kind: 'plugin', plugin: PROBE_PLUGIN },
  })
}

function noticeMessage(value: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: NOTICE_MARKER + value }],
    source: { kind: 'plugin', plugin: PROBE_PLUGIN },
  })
}

function promptMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function textOf(message: UserMessage): string | undefined {
  const [block] = message.content
  return message.content.length === 1 && block?.type === 'text' ? block.text : undefined
}

function countEvents(agent: Agent, type: SessionEvent['type']): number {
  return agent.session.events.filter(event => event.type === type).length
}

function durableTexts(agent: Agent, marker: string): string[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> => event.type === 'user/message')
    .map(event => textOf(event.data))
    .filter((text): text is string => text !== undefined && text.includes(marker))
}

function requestMarkerCount(request: { messages?: unknown[] }, marker: string): number {
  return (request.messages ?? []).filter(message => JSON.stringify(message).includes(marker)).length
}

function requestTexts(request: { messages?: { content?: { type?: string; text?: string }[] }[] }): string[] {
  return (request.messages ?? []).flatMap(message =>
    (message.content ?? [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string))
}

function report(label: string, payload: Record<string, unknown>): void {
  console.log('DSH_INJECT_PROBE ' + label + ' ' + JSON.stringify(payload))
}

describe('WAVE-D-S01 agent.inject pinned behavior', () => {
  it('A. exposes agent.inject on the public Agent; idle inject stages next-step context without waking', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-api'), { provider: 'mock', model: 'mock' })
    const staged = snapshotMessage('A0')
    const shape = {
      isFunction: typeof agent.inject === 'function',
      declaredArity: (agent.inject as unknown as { length: number }).length,
      inboxIsPublic: 'inbox' in agent,
      statusBefore: agent.status as string,
    }

    agent.inject(staged)

    const observed = {
      ...shape,
      statusAfterInject: agent.status as string,
      requestsAfterInject: adapter.requests.length,
      turnsAfterInject: countEvents(agent, 'turn/start'),
      stepsAfterInject: countEvents(agent, 'step/start'),
      durableUserMessagesAfterInject: countEvents(agent, 'user/message'),
      pendingNextStepIds: agent.inbox.nextStep.map(message => message.id),
      pendingNextTurnIds: agent.inbox.nextTurn.map(message => message.id),
      stagedMessageId: staged.id,
      lastDurableEventType: agent.session.events.at(-1)?.type,
    }

    expect(observed.isFunction).toBe(true)
    expect(observed.declaredArity).toBe(1)
    expect(observed.inboxIsPublic).toBe(true)
    expect(observed.statusBefore).toBe('idle')
    expect(observed.statusAfterInject).toBe('idle')
    expect(observed.requestsAfterInject).toBe(0)
    expect(observed.turnsAfterInject).toBe(0)
    expect(observed.stepsAfterInject).toBe(0)
    expect(observed.durableUserMessagesAfterInject).toBe(0)
    expect(observed.pendingNextStepIds).toEqual([staged.id])
    expect(observed.pendingNextTurnIds).toEqual([])
    expect(observed.lastDurableEventType).toBe('agent/inbox/spliced')

    report('A-api-and-idle-no-wake', observed)
  })

  it('B. the next natural request sees one idle-injected snapshot exactly once, without an extra step', async () => {
    const adapter = new MockAdapter([textResponse('ack-1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-initial'), { provider: 'mock', model: 'mock' })
    const injected = snapshotMessage('A0')

    agent.inject(injected)
    agent.followup(promptMessage('start'))
    await agent.whenIdle()

    const observed = {
      requests: adapter.requests.length,
      turns: countEvents(agent, 'turn/start'),
      steps: countEvents(agent, 'step/start'),
      durable: durableTexts(agent, SNAPSHOT_MARKER),
      requestOneMarkerCount: requestMarkerCount(adapter.requests[0], SNAPSHOT_MARKER + 'A0'),
      requestOneTexts: requestTexts(adapter.requests[0]),
    }

    expect(observed.requests).toBe(1)
    expect(observed.turns).toBe(1)
    expect(observed.steps).toBe(1)
    expect(observed.durable).toEqual([SNAPSHOT_MARKER + 'A0'])
    expect(observed.requestOneMarkerCount).toBe(1)
    expect(observed.requestOneTexts.indexOf(SNAPSHOT_MARKER + 'A0'))
      .toBeLessThan(observed.requestOneTexts.indexOf('start'))
    expect(observed.requestOneTexts).toContain('start')

    report('B-initial-injection-single-step', observed)
  })

  it('C. LATEST-ONLY CHECK: a later idle inject leaves the earlier snapshot in durable history, so the next request sees A0 and B1', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-latest-value'), { provider: 'mock', model: 'mock' })

    agent.inject(snapshotMessage('A0'))
    agent.followup(promptMessage('start'))
    await agent.whenIdle()

    agent.inject(snapshotMessage('B1'))
    agent.followup(promptMessage('next'))
    await agent.whenIdle()

    const observed = {
      requests: adapter.requests.length,
      turns: countEvents(agent, 'turn/start'),
      steps: countEvents(agent, 'step/start'),
      durable: durableTexts(agent, SNAPSHOT_MARKER),
      requestTwoA0Count: requestMarkerCount(adapter.requests[1], SNAPSHOT_MARKER + 'A0'),
      requestTwoB1Count: requestMarkerCount(adapter.requests[1], SNAPSHOT_MARKER + 'B1'),
      requestTwoTexts: requestTexts(adapter.requests[1]),
    }

    expect(observed.requests).toBe(2)
    expect(observed.turns).toBe(2)
    expect(observed.steps).toBe(2)
    expect(observed.durable).toEqual([SNAPSHOT_MARKER + 'A0', SNAPSHOT_MARKER + 'B1'])
    expect(observed.requestTwoA0Count).toBe(1)
    expect(observed.requestTwoB1Count).toBe(1)
    expect(observed.requestTwoTexts).toContain(SNAPSHOT_MARKER + 'A0')
    expect(observed.requestTwoTexts).toContain(SNAPSHOT_MARKER + 'B1')

    report('C-latest-only-fails-durable-accumulation', observed)
  })

  it('D. several idle injections before one request are not coalesced by value', async () => {
    const adapter = new MockAdapter([textResponse('ack-1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-multiple-pending'), { provider: 'mock', model: 'mock' })

    agent.inject(snapshotMessage('A0'))
    agent.inject(snapshotMessage('B1'))
    agent.followup(promptMessage('start'))
    await agent.whenIdle()

    const observed = {
      requests: adapter.requests.length,
      steps: countEvents(agent, 'step/start'),
      durable: durableTexts(agent, SNAPSHOT_MARKER),
      requestA0Count: requestMarkerCount(adapter.requests[0], SNAPSHOT_MARKER + 'A0'),
      requestB1Count: requestMarkerCount(adapter.requests[0], SNAPSHOT_MARKER + 'B1'),
    }

    expect(observed.requests).toBe(1)
    expect(observed.steps).toBe(1)
    expect(observed.durable).toEqual([SNAPSHOT_MARKER + 'A0', SNAPSHOT_MARKER + 'B1'])
    expect(observed.requestA0Count).toBe(1)
    expect(observed.requestB1Count).toBe(1)

    report('D-pending-injections-not-coalesced', observed)
  })

  it('E. an unchanged value injected repeatedly is materialized every time (no value-level dedup)', async () => {
    const adapter = new MockAdapter([textResponse('ack-1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-unchanged'), { provider: 'mock', model: 'mock' })

    agent.inject(snapshotMessage('A0'))
    agent.inject(snapshotMessage('A0'))
    agent.inject(snapshotMessage('A0'))
    agent.followup(promptMessage('start'))
    await agent.whenIdle()

    const observed = {
      requests: adapter.requests.length,
      durable: durableTexts(agent, SNAPSHOT_MARKER),
      requestA0Count: requestMarkerCount(adapter.requests[0], SNAPSHOT_MARKER + 'A0'),
    }

    expect(observed.requests).toBe(1)
    expect(observed.durable).toEqual([SNAPSHOT_MARKER + 'A0', SNAPSHOT_MARKER + 'A0', SNAPSHOT_MARKER + 'A0'])
    expect(observed.requestA0Count).toBe(3)

    report('E-unchanged-value-rematerialized', observed)
  })

  it('F. injecting during a running turn adds an extra model step in that same turn', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-mid-turn'), { provider: 'mock', model: 'mock' })
    let injected = false

    ctx.on('agent/request', async ({ agent: subject }, next) => {
      if (subject === agent && !injected) {
        injected = true
        agent.inject(noticeMessage('N1'))
      }
      return next()
    })

    agent.followup(promptMessage('start'))
    await agent.whenIdle()

    const observed = {
      requests: adapter.requests.length,
      turns: countEvents(agent, 'turn/start'),
      steps: countEvents(agent, 'step/start'),
      requestOneHasN1: requestMarkerCount(adapter.requests[0], NOTICE_MARKER + 'N1'),
      requestTwoHasN1: requestMarkerCount(adapter.requests[1], NOTICE_MARKER + 'N1'),
      durableNotices: durableTexts(agent, NOTICE_MARKER),
    }

    expect(observed.requests).toBe(2)
    expect(observed.turns).toBe(1)
    expect(observed.steps).toBe(2)
    expect(observed.requestOneHasN1).toBe(0)
    expect(observed.requestTwoHasN1).toBe(1)
    expect(observed.durableNotices).toEqual([NOTICE_MARKER + 'N1'])

    report('F-mid-turn-injection-extra-step', observed)
  })

  it('G. pending injection can be removed before claim, but a claimed snapshot stays durable', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-pending-replace'), { provider: 'mock', model: 'mock' })
    const a0 = snapshotMessage('A0')
    const b1 = snapshotMessage('B1')

    agent.inject(a0)
    const removedWhilePending = agent.inbox.remove(a0.id)
    agent.inject(b1)
    agent.followup(promptMessage('start'))
    await agent.whenIdle()

    const removedAfterClaim = agent.inbox.remove(b1.id)
    agent.followup(promptMessage('next'))
    await agent.whenIdle()

    const observed = {
      removedWhilePending,
      removedAfterClaim,
      requestOneA0Count: requestMarkerCount(adapter.requests[0], SNAPSHOT_MARKER + 'A0'),
      requestOneB1Count: requestMarkerCount(adapter.requests[0], SNAPSHOT_MARKER + 'B1'),
      requestTwoB1Count: requestMarkerCount(adapter.requests[1], SNAPSHOT_MARKER + 'B1'),
      durable: durableTexts(agent, SNAPSHOT_MARKER),
    }

    expect(observed.removedWhilePending).toBe(true)
    expect(observed.requestOneA0Count).toBe(0)
    expect(observed.requestOneB1Count).toBe(1)
    expect(observed.removedAfterClaim).toBe(false)
    expect(observed.durable).toEqual([SNAPSHOT_MARKER + 'B1'])
    expect(observed.requestTwoB1Count).toBe(1)

    report('G-pending-removal-vs-durable-history', observed)
  })

  it('H. D-T03 smoke shape: 20 rapid idle updates wake nothing, then all 20 land in the next natural request', async () => {
    const adapter = new MockAdapter([textResponse('ack-1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-inject-rapid-updates'), { provider: 'mock', model: 'mock' })

    for (let index = 1; index <= 20; index += 1) {
      agent.inject(noticeMessage('G' + index.toString().padStart(2, '0')))
    }

    const beforeNatural = {
      status: agent.status as string,
      requests: adapter.requests.length,
      turns: countEvents(agent, 'turn/start'),
      steps: countEvents(agent, 'step/start'),
      pending: agent.inbox.nextStep.length,
    }

    agent.followup(promptMessage('continue'))
    await agent.whenIdle()

    const observed = {
      beforeNatural,
      requestsAfter: adapter.requests.length,
      turnsAfter: countEvents(agent, 'turn/start'),
      stepsAfter: countEvents(agent, 'step/start'),
      durableNoticeCount: durableTexts(agent, NOTICE_MARKER).length,
      requestNoticeCount: requestMarkerCount(adapter.requests[0], NOTICE_MARKER),
      requestHasNewest: requestMarkerCount(adapter.requests[0], NOTICE_MARKER + 'G20'),
      requestHasOldest: requestMarkerCount(adapter.requests[0], NOTICE_MARKER + 'G01'),
    }

    expect(observed.beforeNatural.status).toBe('idle')
    expect(observed.beforeNatural.requests).toBe(0)
    expect(observed.beforeNatural.turns).toBe(0)
    expect(observed.beforeNatural.pending).toBe(20)
    expect(observed.requestsAfter).toBe(1)
    expect(observed.turnsAfter).toBe(1)
    expect(observed.stepsAfter).toBe(1)
    expect(observed.durableNoticeCount).toBe(20)
    expect(observed.requestNoticeCount).toBe(20)
    expect(observed.requestHasNewest).toBe(1)
    expect(observed.requestHasOldest).toBe(1)

    report('H-dt03-smoke-zero-wake-but-unbounded-delivery', observed)
  })
})
