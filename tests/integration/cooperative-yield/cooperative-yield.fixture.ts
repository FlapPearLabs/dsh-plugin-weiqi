import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  createUserMessage,
  type LlmCallConfig,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SessionId,
  type SessionEvent,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import {
  RuntimeFocusOwner,
  bindPinnedDshFocusBoundary,
} from './plugin/runtime/focus-boundary.ts'
import { bindPinnedDshCooperativeYield } from './plugin/runtime/focus-yield.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../mock-adapter.ts'

type TraceEntry = Readonly<{
  event: string
  turn?: number
  step?: number
  ids?: readonly UserMessage['id'][]
  detail?: unknown
}>

const liveContexts: Context[] = []

afterEach(async () => {
  await Promise.all(liveContexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function message(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'a-t04-integration' },
  })
}

function ids(messages: readonly UserMessage[]): readonly UserMessage['id'][] {
  return messages.map(item => item.id)
}

function reasons(agent: Agent): TurnEndReason[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'turn/end' }> =>
      event.type === 'turn/end')
    .map(event => event.data.reason)
}

function indexOf(trace: readonly TraceEntry[], event: string): number {
  const index = trace.findIndex(entry => entry.event === event)
  expect(index, `missing trace event ${event}`).toBeGreaterThanOrEqual(0)
  return index
}

function report(label: string, trace: readonly TraceEntry[]): void {
  console.log(`A_T04_COOPERATIVE_YIELD_TRACE ${label} ${JSON.stringify(trace)}`)
}

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
    description: 'deterministic A-T04 continuation tool',
    parameters: { text: { type: 'string', required: true } },
    execute: async ({ text }) => [{ type: 'text', text }],
  }))
  liveContexts.push(ctx)
  return ctx
}

async function pairedAgents(ctx: Context, prefix: string): Promise<Readonly<{
  work: Agent
  go: Agent
}>> {
  const work = (await ctx.agents.create({
    sessionId: SessionId(`${prefix}-work`),
    agentOptions: { provider: 'mock', model: 'mock' },
  })).agent
  const go = (await ctx.agents.create({
    sessionId: SessionId(`${prefix}-go`),
    agentOptions: { provider: 'mock', model: 'mock' },
  })).agent
  return { work, go }
}

function observeLifecycle(ctx: Context, work: Agent, trace: TraceEntry[]): void {
  ctx.on('agent/inbox/claimed', ({ agent, message: claimed, turn }) => {
    if (agent === work) trace.push({ event: 'inbox/claimed', turn, ids: [claimed.id] })
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (agent === work) trace.push({ event: `status:${status}` })
  })
  ctx.on('session/event', (session, event) => {
    if (session !== work.session) return
    if (event.type === 'step/start' || event.type === 'step/end') {
      trace.push({
        event: `${event.type}:${event.data.step}`,
        turn: event.data.turn,
        step: event.data.step,
      })
    } else if (event.type === 'tool/result') {
      trace.push({ event: `tool/result:${event.data.step}`, step: event.data.step })
    } else if (event.type === 'turn/end') {
      trace.push({ event: 'turn/end', turn: event.data.turn, detail: event.data.reason })
    } else if (event.type === 'agent/inbox/spliced') {
      trace.push({
        event: 'inbox/spliced',
        ids: ids(event.data.inserted),
        detail: { target: event.data.target, start: event.data.start },
      })
    }
  })
}

describe('WAVE-A-T04 real pinned DSH production integration', () => {
  it('restores [A,B,C], rejects continuation, settles, then switches Work to Go once', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('step-1', 'echo', { text: 'step-1' }),
      toolCallResponse('step-2', 'echo', { text: 'step-2' }),
      toolCallResponse('step-3', 'focus-and-stage', { text: 'step-3' }),
    ])
    const ctx = await harness(adapter)
    const { work, go } = await pairedAgents(ctx, 'a-t04-yield')
    const owner = new RuntimeFocusOwner('work')
    const pending = Object.freeze({ target: 'go', origin: 'self_initiated' } as const)
    const a = message('A')
    const b = message('B')
    const c = message('C')
    const trace: TraceEntry[] = []
    const switched = Promise.withResolvers<void>()
    let switchCount = 0
    let intercepted = false
    let claimedBatch: readonly UserMessage[] = []
    let projectedC: UserMessage | undefined

    observeLifecycle(ctx, work, trace)

    ctx.tools.register(defineContentToolFixture({
      name: 'focus-and-stage',
      description: 'submit focus and stage the claimed A-T04 batch during step 3',
      parameters: { text: { type: 'string', required: true } },
      execute: async ({ text }) => {
        const submission = owner.submitFocusIntent(pending)
        expect(submission.eligibility).toBeUndefined()
        trace.push({ event: 'focus:pending-during-step-3' })
        work.inject(a)
        work.inject(b)
        trace.push({ event: 'stage:A,B', ids: ids(work.inbox.nextStep) })
        return [{ type: 'text', text }]
      },
    }))

    // This wrapper runs after DSH claimed [A,B] but before the production guard
    // restores it. C therefore proves the splice placement relative to a later
    // message without modifying the canonical verified Spike fixture.
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent !== work || payload.turn !== 1 || payload.step !== 4) return next()
      intercepted = true
      claimedBatch = payload.messages
      trace.push({ event: 'pre-step:claimed', turn: payload.turn, step: payload.step, ids: ids(payload.messages) })
      expect(ids(payload.messages)).toEqual([a.id, b.id])
      work.inject(c)
      projectedC = work.inbox.nextStep[0]
      trace.push({ event: 'arrival:C', ids: ids(work.inbox.nextStep) })
      const decision = await next()
      trace.push({ event: `pre-step:${decision.kind}` })
      return decision
    })

    bindPinnedDshFocusBoundary(ctx, owner, { work, go }, {
      onEligibility: eligibility => trace.push({ event: 'eligibility', detail: eligibility }),
    })
    bindPinnedDshCooperativeYield(ctx, owner, { work, go }, {
      onBatchRestored: ({ claimed, restored }) => {
        trace.push({ event: 'restore:[A,B,C]', ids: ids(restored) })
        expect(claimed).toStrictEqual(claimedBatch)
        expect(ids(claimed)).toEqual([a.id, b.id])
        expect(restored).toHaveLength(3)
        expect(restored).toStrictEqual([...claimed, projectedC])
      },
      onSettleConfirmed: () => {
        trace.push({ event: 'whenIdle:confirmed' })
        expect(work.status).toBe('idle')
        expect(owner.state.activeLane).toBe('work')
      },
      onLaneSwitch: (transition) => {
        switchCount += 1
        trace.push({ event: 'activeLane:work->go', detail: transition })
        switched.resolve()
      },
    })

    try {
      work.followup(createUserMessage({
        content: [{ type: 'text', text: 'start' }],
        source: { kind: 'user' },
      }))
      await work.whenIdle()
      await switched.promise

      const steps = work.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'step/start' }> =>
          event.type === 'step/start')
        .map(event => event.data.step)
      const restored = work.inbox.nextStep

      expect(intercepted).toBe(true)
      expect(steps).toEqual([1, 2, 3])
      expect(adapter.requests).toHaveLength(3)
      expect(reasons(work)).toEqual([{ kind: 'blocked' }])
      expect(work.status).toBe('idle')
      expect(restored).toHaveLength(3)
      expect(restored).toStrictEqual([...claimedBatch, projectedC])
      expect(ids(restored)).toEqual([a.id, b.id, c.id])
      expect(new Set(ids(restored)).size).toBe(3)
      expect(owner.state).toEqual({
        activeLane: 'go',
        llmRunning: false,
        pendingFocus: pending,
        pausedLane: 'work',
      })
      expect(switchCount).toBe(1)
      expect(go.session.events.some(event => event.type === 'step/start')).toBe(false)

      expect(indexOf(trace, 'focus:pending-during-step-3'))
        .toBeLessThan(indexOf(trace, 'tool/result:3'))
      expect(indexOf(trace, 'tool/result:3')).toBeLessThan(indexOf(trace, 'step/end:3'))
      expect(indexOf(trace, 'step/end:3')).toBeLessThan(indexOf(trace, 'eligibility'))
      expect(indexOf(trace, 'eligibility')).toBeLessThan(indexOf(trace, 'pre-step:claimed'))
      expect(indexOf(trace, 'pre-step:claimed')).toBeLessThan(indexOf(trace, 'arrival:C'))
      expect(indexOf(trace, 'arrival:C')).toBeLessThan(indexOf(trace, 'restore:[A,B,C]'))
      expect(indexOf(trace, 'restore:[A,B,C]')).toBeLessThan(indexOf(trace, 'pre-step:reject'))
      expect(indexOf(trace, 'pre-step:reject')).toBeLessThan(indexOf(trace, 'turn/end'))
      expect(indexOf(trace, 'turn/end')).toBeLessThan(indexOf(trace, 'status:idle'))
      expect(indexOf(trace, 'status:idle')).toBeLessThan(indexOf(trace, 'whenIdle:confirmed'))
      expect(indexOf(trace, 'whenIdle:confirmed')).toBeLessThan(indexOf(trace, 'activeLane:work->go'))
    } finally {
      report('yield-main', trace)
    }
  })

  it('uses confirmed natural settle without splice/reject or pausedLane', async () => {
    const adapter = new MockAdapter([textResponse('natural-completion')])
    const ctx = await harness(adapter)
    const { work, go } = await pairedAgents(ctx, 'a-t04-natural')
    const owner = new RuntimeFocusOwner('work')
    const pending = Object.freeze({ target: 'go', origin: 'user_command' } as const)
    const trace: TraceEntry[] = []
    const switched = Promise.withResolvers<void>()
    let submitted = false
    let restoredCount = 0

    observeLifecycle(ctx, work, trace)
    bindPinnedDshFocusBoundary(ctx, owner, { work, go })
    ctx.on('agent/request', async ({ agent }, next): Promise<LlmCallConfig> => {
      if (agent === work && !submitted) {
        submitted = true
        const result = owner.submitFocusIntent(pending)
        trace.push({ event: 'pending:during-step', detail: result })
      }
      return next()
    })
    bindPinnedDshCooperativeYield(ctx, owner, { work, go }, {
      onBatchRestored: () => { restoredCount += 1 },
      onSettleConfirmed: ({ settle }) => {
        trace.push({ event: `whenIdle:${settle}` })
        expect(owner.state.activeLane).toBe('work')
      },
      onLaneSwitch: () => {
        trace.push({ event: 'activeLane:work->go' })
        switched.resolve()
      },
    })

    try {
      work.followup(createUserMessage({
        content: [{ type: 'text', text: 'complete naturally' }],
        source: { kind: 'user' },
      }))
      await work.whenIdle()
      await switched.promise

      expect(adapter.requests).toHaveLength(1)
      expect(reasons(work)).toEqual([{ kind: 'completed' }])
      expect(restoredCount).toBe(0)
      expect(trace.some(entry => entry.event === 'pre-step:reject')).toBe(false)
      expect(work.session.events.filter(event =>
        event.type === 'agent/inbox/spliced' && event.data.target === 'next-step')).toEqual([])
      expect(owner.state).toEqual({
        activeLane: 'go',
        llmRunning: false,
        pendingFocus: pending,
      })
      expect(indexOf(trace, 'step/end:1')).toBeLessThan(indexOf(trace, 'turn/end'))
      expect(indexOf(trace, 'turn/end')).toBeLessThan(indexOf(trace, 'status:idle'))
      expect(indexOf(trace, 'status:idle')).toBeLessThan(indexOf(trace, 'whenIdle:natural'))
      expect(indexOf(trace, 'whenIdle:natural')).toBeLessThan(indexOf(trace, 'activeLane:work->go'))
    } finally {
      report('natural-settle', trace)
    }
  })
})
