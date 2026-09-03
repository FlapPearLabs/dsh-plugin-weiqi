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
 * WAVE-D-S01 executable probe: `ctx.systemPrompt.context` native behavior on
 * pinned DSH (commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e, 0.1.1-rc.2).
 *
 * This file is copied unchanged into the pinned upstream DSH tree by the
 * gate workflow, so it exercises the real AgentLoop implementation rather
 * than a reimplementation. It owns NO Bridge, NO GameNotice/WorkSnapshot
 * production code, and NO DSH patch. Providers read a plain O(1) holder
 * variable. The probe separately records that changed rendered values remain
 * together in durable model-facing history, which fails Spec §39.6's
 * latest-only delivery requirement even though the provider callback itself
 * is an O(1) read.
 */

const SNAPSHOT_SOURCE = '@deepseek-ai/dsh-system-prompt'
const WORK_CONTEXT_NAME = 'companion-go:work-snapshot'
const GO_CONTEXT_NAME = 'companion-go:game-notice'

type TraceEntry = {
  event: string
  turn?: number
  step?: number
  detail?: unknown
}

/** O(1) Runtime-held latest values; `undefined` means "nothing to project". */
type SnapshotHolder = {
  work: string | undefined
  go: string | undefined
}

type ProviderStats = {
  evaluations: number
  assembledForThisAgent: boolean[]
  disposerIsFunction: boolean
}

const liveContexts: Context[] = []

afterEach(async () => {
  await Promise.all(liveContexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function harness(adapter: MockAdapter): Promise<Context> {
  const build = async(): Promise<Context> => {
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
  return build()
}

function observe(ctx: Context, agent: Agent, trace: TraceEntry[]): void {
  ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject === agent) trace.push({ event: 'status:' + status })
  })
  ctx.on('agent/request', async ({ agent: subject, turn, step }, next) => {
    if (subject === agent) trace.push({ event: 'agent/request', turn, step })
    return next()
  })
  ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'turn/start') {
      trace.push({ event: 'turn/start', turn: event.data.turn })
    } else if (event.type === 'turn/end') {
      trace.push({ event: 'turn/end', turn: event.data.turn, detail: event.data.reason })
    } else if (event.type === 'step/start' || event.type === 'step/end') {
      trace.push({ event: event.type, turn: event.data.turn, step: event.data.step })
    } else if (event.type === 'user/message') {
      trace.push({
        event: 'user/message',
        detail: {
          text: textOf(event.data)?.slice(0, 80),
          source: event.data.source,
        },
      })
    }
  })
}

function watchChangeEvents(ctx: Context, changes: string[]): void {
  ctx.on('system-prompt/change', () => {
    changes.push('system-prompt/change')
  })
}

/**
 * Register one agent-scoped dynamic context provider through the agent's own
 * scoped context. The provider only reads the O(1) holder — it never touches
 * Session history, inbox, or any rescan surface.
 */
function registerSnapshotProvider(
  agent: Agent,
  holder: SnapshotHolder,
  lane: 'work' | 'go',
  trace: TraceEntry[],
): ProviderStats {
  const stats: ProviderStats = {
    evaluations: 0,
    assembledForThisAgent: [],
    disposerIsFunction: false,
  }
  const name = lane === 'work' ? WORK_CONTEXT_NAME : GO_CONTEXT_NAME
  const marker = lane === 'work' ? 'WORK_SNAPSHOT=' : 'GO_SNAPSHOT='
  const value = (): string | undefined => lane === 'work' ? holder.work : holder.go
  const disposer = agent.ctx.systemPrompt.context({
    name,
    order: 10,
    text: (assembleCtx) => {
      stats.evaluations += 1
      const isThisAgent = assembleCtx.agent === agent
      stats.assembledForThisAgent.push(isThisAgent)
      trace.push({
        event: 'provider/evaluated',
        detail: { name, isThisAgent, holderValue: value() ?? null },
      })
      const current = value()
      return current === undefined ? '' : marker + current
    },
  })
  stats.disposerIsFunction = typeof disposer === 'function'
  trace.push({ event: 'provider/registered', detail: { name, disposerIsFunction: stats.disposerIsFunction } })
  return stats
}

function textOf(input: UserMessage): string | undefined {
  const [block] = input.content
  return input.content.length === 1 && block?.type === 'text' ? block.text : undefined
}

type SnapshotSource = { kind: string; plugin?: string; form?: string; sections?: { name?: string; text?: string }[] }

/**
 * The durable user-role projection messages owned by the system-prompt
 * source. The rendered text is prefixed with a fixed DSH header
 * ("Current runtime context. This snapshot supersedes earlier
 * runtime-context snapshots."), so exact values are read from the message's
 * `sections` attribution instead of from raw text prefixes.
 */
function durableSnapshots(agent: Agent, marker: string): { text: string; source: SnapshotSource }[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> => event.type === 'user/message')
    .map(event => ({ text: textOf(event.data), source: event.data.source as SnapshotSource }))
    .filter((entry): entry is { text: string; source: SnapshotSource } =>
      entry.text !== undefined && entry.text.includes(marker))
}

/** Section-attributed snapshot value, e.g. `WORK_SNAPSHOT=A0`. */
function snapshotValues(agent: Agent, marker: string): string[] {
  return durableSnapshots(agent, marker).map(entry => {
    const section = entry.source.sections?.find(section => section.text?.includes(marker))
    if (section?.text) return section.text
    return entry.text
  })
}

/**
 * How many distinct model-facing messages contain the marker. Counted per
 * message (not per JSON substring): a durable snapshot message legitimately
 * carries the value in both its rendered text and its `sections`
 * attribution, which would double-count a raw regex over serialized JSON.
 */
function requestMarkerCount(request: { messages?: { content?: unknown }[] }, marker: string): number {
  return (request.messages ?? []).filter(message => JSON.stringify(message).includes(marker)).length
}

function messageText(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function report(label: string, trace: TraceEntry[]): void {
  // Intentionally emitted by the executed fixture; GitHub Actions captures it
  // in the job log and the uploaded trace artifact.
  console.log('DSH_SPIKE_TRACE ' + label + ' ' + JSON.stringify(trace))
}

async function settle(ms = 25): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('WAVE-D-S01 ctx.systemPrompt.context pinned behavior', () => {
  it('A. registers agent-scoped, evaluates per pre-step, and materializes the initial snapshot with the first natural request', async () => {
    const adapter = new MockAdapter([textResponse('ack-1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-initial'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    const changes: string[] = []
    observe(ctx, agent, trace)
    watchChangeEvents(ctx, changes)
    const holder: SnapshotHolder = { work: 'A0', go: undefined }
    const stats = registerSnapshotProvider(agent, holder, 'work', trace)

    try {
      expect(agent.status).toBe('idle')
      expect(adapter.requests).toHaveLength(0)

      agent.followup(messageText('start'))
      await agent.whenIdle()

      // Q2/Q3: registration returned a disposer; the provider is evaluated
      // during the natural request's prompt assembly (before the model call).
      expect(stats.disposerIsFunction).toBe(true)
      expect(stats.evaluations).toBeGreaterThanOrEqual(1)
      expect(stats.assembledForThisAgent.every(Boolean)).toBe(true)
      expect(adapter.requests).toHaveLength(1)

      // Q1: the materialized snapshot is a durable user-role message owned by
      // the system-prompt source, appended exactly once, inside the step.
      const snapshots = durableSnapshots(agent, 'WORK_SNAPSHOT=')
      expect(snapshotValues(agent, 'WORK_SNAPSHOT=')).toEqual(['WORK_SNAPSHOT=A0'])
      expect(snapshots[0].source.kind).toBe('plugin')
      expect(snapshots[0].source.plugin).toBe(SNAPSHOT_SOURCE)
      expect(snapshots[0].source.form).toBe('snapshot')

      // The model-facing request actually contains the newest value.
      expect(requestMarkerCount(adapter.requests[0], 'WORK_SNAPSHOT=A0')).toBe(1)

      // Registration (not provider evaluation) emits the registry change
      // notification; evaluation of a provider during assembly emits none.
      expect(changes.length).toBeGreaterThanOrEqual(1)

      report('A-initial-materialization', trace)
    } finally {
      report('A-initial-materialization-final', trace)
    }
  })

  it('B. Runtime A→B update wakes nothing but accumulates both values in the next model-facing request', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-latest-value'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    const changes: string[] = []
    observe(ctx, agent, trace)
    watchChangeEvents(ctx, changes)
    const holder: SnapshotHolder = { work: 'A0', go: undefined }
    registerSnapshotProvider(agent, holder, 'work', trace)

    try {
      agent.followup(messageText('start'))
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      expect(agent.status).toBe('idle')
      const turnCountAfterFirst = agent.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'turn/start' }> => event.type === 'turn/start')
        .length
      const changeCountAfterRegistration = changes.length

      // Runtime updates the O(1) held value: a plain assignment through the
      // holder — no registry API, no DSH call, no inbox touch.
      holder.work = 'B1'
      await settle()
      await settle()

      // Q7: no Bridge-only evaluation wake.
      expect(agent.status).toBe('idle')
      expect(adapter.requests).toHaveLength(1)
      expect(agent.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'turn/start' }> => event.type === 'turn/start')
        .length).toBe(turnCountAfterFirst)
      expect(changes.length).toBe(changeCountAfterRegistration)

      // The next natural request observes the newest value, but the pinned
      // durable path also retains the superseded A0 snapshot on the same
      // model-facing surface. Fixed supersession prose does not remove A0.
      agent.followup(messageText('next'))
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(2)
      expect(snapshotValues(agent, 'WORK_SNAPSHOT='))
        .toEqual(['WORK_SNAPSHOT=A0', 'WORK_SNAPSHOT=B1'])
      expect(requestMarkerCount(adapter.requests[1], 'WORK_SNAPSHOT=B1')).toBe(1)
      // Exact contradictory evidence for Spec §39.6 latest-only delivery:
      // request 2 contains both the old and new rendered snapshots.
      expect(requestMarkerCount(adapter.requests[1], 'WORK_SNAPSHOT=A0')).toBe(1)
      expect(requestMarkerCount(adapter.requests[1], 'WORK_SNAPSHOT=B1')).toBe(1)

      report('B-changed-value-accumulation', trace)
    } finally {
      report('B-changed-value-accumulation-final', trace)
    }
  })

  it('C. unchanged value re-evaluates the provider but adds no prompt material', async () => {
    const adapter = new MockAdapter([textResponse('ack-1'), textResponse('ack-2'), textResponse('ack-3')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01-unchanged'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: SnapshotHolder = { work: 'A0', go: undefined }
    const stats = registerSnapshotProvider(agent, holder, 'work', trace)

    try {
      agent.followup(messageText('start'))
      await agent.whenIdle()
      agent.followup(messageText('second'))
      await agent.whenIdle()
      agent.followup(messageText('third'))
      await agent.whenIdle()

      // Three natural requests, one unchanged snapshot value.
      expect(adapter.requests).toHaveLength(3)
      // Q6: the provider is evaluated per eligible prompt assembly...
      expect(stats.evaluations).toBeGreaterThanOrEqual(3)
      // ...but the durable projection materialized exactly once.
      expect(snapshotValues(agent, 'WORK_SNAPSHOT='))
        .toEqual(['WORK_SNAPSHOT=A0'])
      // Q8: the model-facing conversation of each later request contains the
      // snapshot exactly once — no accumulating duplicates.
      for (const request of adapter.requests) {
        expect(requestMarkerCount(request, 'WORK_SNAPSHOT=A0')).toBe(1)
      }

      report('C-unchanged-no-growth', trace)
    } finally {
      report('C-unchanged-no-growth-final', trace)
    }
  })

  it('D. agent-scoped providers stay isolated between agents and never leak to unregistered agents', async () => {
    const adapter = new MockAdapter([
      textResponse('work-ack'),
      textResponse('go-ack'),
      textResponse('bare-ack'),
    ])
    const ctx = await harness(adapter)
    const work = ctx.agentLoop.create(SessionId('d-s01-work-lane'), { provider: 'mock', model: 'mock' })
    const go = ctx.agentLoop.create(SessionId('d-s01-go-lane'), { provider: 'mock', model: 'mock' })
    const bare = ctx.agentLoop.create(SessionId('d-s01-bare-lane'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, work, trace)
    observe(ctx, go, trace)
    observe(ctx, bare, trace)
    const holder: SnapshotHolder = { work: 'W0', go: 'G0' }
    registerSnapshotProvider(work, holder, 'work', trace)
    registerSnapshotProvider(go, holder, 'go', trace)

    try {
      work.followup(messageText('work-start'))
      await work.whenIdle()
      go.followup(messageText('go-start'))
      await go.whenIdle()
      bare.followup(messageText('bare-start'))
      await bare.whenIdle()

      // Q9: each scoped provider contributes only to its own agent's assembly.
      expect(snapshotValues(work, 'WORK_SNAPSHOT=')).toEqual(['WORK_SNAPSHOT=W0'])
      expect(durableSnapshots(work, 'GO_SNAPSHOT=')).toEqual([])
      expect(snapshotValues(go, 'GO_SNAPSHOT=')).toEqual(['GO_SNAPSHOT=G0'])
      expect(durableSnapshots(go, 'WORK_SNAPSHOT=')).toEqual([])
      // An agent with no provider sees no runtime-context projection at all.
      expect(durableSnapshots(bare, 'WORK_SNAPSHOT=')).toEqual([])
      expect(durableSnapshots(bare, 'GO_SNAPSHOT=')).toEqual([])

      // Model-facing inputs confirm the same isolation.
      expect(requestMarkerCount(adapter.requests[0], 'WORK_SNAPSHOT=W0')).toBe(1)
      expect(requestMarkerCount(adapter.requests[0], 'GO_SNAPSHOT=')).toBe(0)
      expect(requestMarkerCount(adapter.requests[1], 'GO_SNAPSHOT=G0')).toBe(1)
      expect(requestMarkerCount(adapter.requests[1], 'WORK_SNAPSHOT=')).toBe(0)
      expect(requestMarkerCount(adapter.requests[2], 'WORK_SNAPSHOT=')).toBe(0)
      expect(requestMarkerCount(adapter.requests[2], 'GO_SNAPSHOT=')).toBe(0)

      report('D-scope-isolation', trace)
    } finally {
      report('D-scope-isolation-final', trace)
    }
  })
})
