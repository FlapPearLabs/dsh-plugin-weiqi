import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent, type TurnEndReason, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/**
 * Phase-A executable proof for the R2.4 cooperative-yield seam.
 *
 * This file is copied unchanged into the pinned upstream DSH tree by the
 * workflow, so it exercises the real AgentLoop implementation rather than a
 * reimplementation or a mocked inbox.
 */

type TraceEntry = {
  event: string
  turn?: number
  step?: number
  texts?: string[]
  detail?: unknown
}

const liveContexts: Context[] = []

afterEach(async () => {
  await Promise.all(liveContexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function message(text: string, source: UserMessage['source'] = { kind: 'plugin', plugin: 'cooperative-yield-spike' }): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source,
  })
}

function textOf(input: UserMessage): string {
  return input.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function textsOf(inputs: readonly UserMessage[]): string[] {
  return inputs.map(textOf)
}

function recordedTexts(agent: Agent, candidates: readonly string[]): string[] {
  const wanted = new Set(candidates)
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> => event.type === 'user/message')
    .map(event => event.data.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(''))
    .filter(text => wanted.has(text))
}

function turnReasons(agent: Agent): TurnEndReason[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'turn/end' }> => event.type === 'turn/end')
    .map(event => event.data.reason)
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
    description: 'deterministic continuation fixture',
    parameters: { text: { type: 'string', required: true } },
    execute: async ({ text }) => [{ type: 'text', text }],
  }))
  liveContexts.push(ctx)
  return ctx
}

function observe(ctx: Context, agent: Agent, trace: TraceEntry[]): void {
  ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject === agent) trace.push({ event: 'status:' + status })
  })
  ctx.on('agent/inbox/claimed', ({ agent: subject, message, turn }) => {
    if (subject === agent) trace.push({ event: 'inbox/claimed', turn, texts: [textOf(message)] })
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
    } else if (event.type === 'agent/inbox/spliced') {
      trace.push({
        event: 'agent/inbox/spliced',
        detail: {
          target: event.data.target,
          inserted: event.data.inserted.map(textOf),
          removedCount: event.data.removedCount,
          outcome: event.data.outcome,
        },
      })
    }
  })
}

function assertUniquePending(agent: Agent): void {
  const ids = agent.inbox.nextStep.map(item => item.id)
  expect(new Set(ids).size).toBe(ids.length)
}

function report(label: string, trace: TraceEntry[]): void {
  // This is intentionally emitted by the executed fixture. GitHub Actions
  // captures it in the job log and in spike-trace.log.
  console.log('DSH_SPIKE_TRACE ' + label + ' ' + JSON.stringify(trace))
}

function installStepFourFixture(
  ctx: Context,
  agent: Agent,
  trace: TraceEntry[],
  mode: 'cooperative' | 'reject-only' | 'deferred-cancel',
): {
  readonly a: UserMessage
  readonly b: UserMessage
  readonly c: UserMessage
  readonly resume: UserMessage
  readonly deferredCancelDone: Promise<void>
} {
  const a = message('A')
  const b = message('B')
  const c = message('C')
  const resume = message('companion-resume', { kind: 'plugin', plugin: 'companion' })
  const deferredCancel = Promise.withResolvers<void>()
  let injectedBoundaryBatch = false
  let yielded = false

  // Step 3 completes normally. Its turn-stopping boundary is deliberately
  // used to stage exactly [A, B] for the proposed step 4, without relying on
  // tool-result shape.
  ctx.on('agent/turn-stopping', ({ agent: subject, turn }) => {
    if (subject !== agent || turn !== 1 || injectedBoundaryBatch) return
    injectedBoundaryBatch = true
    agent.inject(a)
    agent.inject(b)
    trace.push({ event: 'turn-stopping/stage-A-B', turn, texts: textsOf(agent.inbox.nextStep) })
  })

  ctx.on('agent/pre-step', async ({ agent: subject, messages, turn, step }, next) => {
    if (subject !== agent) return next()
    trace.push({ event: 'agent/pre-step', turn, step, texts: textsOf(messages) })
    if (turn !== 1 || step !== 4 || yielded) return next()

    yielded = true
    expect(textsOf(messages)).toEqual(['A', 'B'])

    // C arrives after claim and before restore, exactly as the Phase-A gate
    // requires. It therefore tests the restored batch's position relative to
    // later next-step input.
    agent.inject(c)
    trace.push({ event: 'arrival/C-after-claim', turn, step, texts: textsOf(agent.inbox.nextStep) })

    agent.inbox.splice('next-step', 0, 0, messages)
    const restored = textsOf(agent.inbox.nextStep)
    trace.push({ event: 'restore/splice', turn, step, texts: restored })
    expect(restored).toEqual(['A', 'B', 'C'])
    assertUniquePending(agent)

    if (mode === 'cooperative') {
      agent.cancel(
        { kind: 'hook', reason: 'companion-focus-yield' },
        { keepInbox: true },
      )
      trace.push({ event: 'cancel/in-pre-step', turn, step, texts: textsOf(agent.inbox.nextStep) })
    } else if (mode === 'deferred-cancel') {
      setTimeout(() => {
        trace.push({ event: 'cancel/deferred-timer' })
        agent.cancel(
          { kind: 'hook', reason: 'companion-focus-yield-deferred' },
          { keepInbox: true },
        )
        deferredCancel.resolve()
      }, 0)
      trace.push({ event: 'cancel/deferred-scheduled', turn, step })
    } else {
      trace.push({ event: 'cancel/omitted', turn, step })
    }

    return { kind: 'reject' }
  })

  return { a, b, c, resume, deferredCancelDone: deferredCancel.promise }
}

describe('R2.4 cooperative-yield Phase-A gate', () => {
  it('A. proposed sequence restores the claimed batch, cancels in the guard, idles, and resumes in order', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'step-1' }),
      toolCallResponse('c2', 'echo', { text: 'step-2' }),
      textResponse('step-3-complete'),
      textResponse('resumed'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('cooperative-yield-main'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const { a, b, c, resume } = installStepFourFixture(ctx, agent, trace, 'cooperative')

    try {
      agent.followup(message('start', { kind: 'user' }))
      await agent.whenIdle()

      const firstTurnSteps = agent.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'step/start' }> => event.type === 'step/start')
        .map(event => [event.data.turn, event.data.step])

      expect(firstTurnSteps).toEqual([[1, 1], [1, 2], [1, 3]])
      expect(adapter.requests).toHaveLength(3)
      expect(turnReasons(agent)).toEqual([
        { kind: 'aborted', reason: { kind: 'hook', reason: 'companion-focus-yield' } },
      ])
      expect(agent.status).toBe('idle')
      expect(textsOf(agent.inbox.nextStep)).toEqual(['A', 'B', 'C'])
      expect(agent.inbox.nextTurn).toEqual([])
      assertUniquePending(agent)
      expect(recordedTexts(agent, ['A', 'B', 'C'])).toEqual([])

      // An explicit plugin-sourced resume wakes the lane after the Runtime
      // has switched focus back. It must consume the restored batch in the
      // stored order before the later C and the resume message.
      agent.steer(resume)
      await agent.whenIdle()

      expect(adapter.requests).toHaveLength(4)
      expect(recordedTexts(agent, ['A', 'B', 'C', 'companion-resume']))
        .toEqual(['A', 'B', 'C', 'companion-resume'])
      for (const text of ['A', 'B', 'C']) {
        expect(recordedTexts(agent, [text])).toEqual([text])
      }
      expect(agent.inbox.hasPending).toBe(false)
      expect(turnReasons(agent)).toEqual([
        { kind: 'aborted', reason: { kind: 'hook', reason: 'companion-focus-yield' } },
        { kind: 'completed' },
      ])
      report('proposed-cooperative-yield', trace)
    } finally {
      report('proposed-cooperative-yield-final', trace)
    }
  })

  it('B. reject-only negative control records whether the pinned driver restarts before an external resume', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'step-1' }),
      toolCallResponse('c2', 'echo', { text: 'step-2' }),
      textResponse('step-3-complete'),
      textResponse('same-driver-replacement'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('cooperative-yield-reject-only'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const { resume } = installStepFourFixture(ctx, agent, trace, 'reject-only')

    try {
      agent.followup(message('start', { kind: 'user' }))
      await agent.whenIdle()

      const started = agent.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'step/start' }> => event.type === 'step/start')
        .map(event => [event.data.turn, event.data.step])
      expect(started).toEqual([[1, 1], [1, 2], [1, 3]])
      expect(adapter.requests).toHaveLength(3)
      expect(turnReasons(agent)).toEqual([{ kind: 'blocked' }])
      expect(agent.status).toBe('idle')
      expect(textsOf(agent.inbox.nextStep)).toEqual(['A', 'B', 'C'])
      expect(recordedTexts(agent, ['A', 'B', 'C'])).toEqual([])

      agent.steer(resume)
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(4)
      expect(recordedTexts(agent, ['A', 'B', 'C', 'companion-resume']))
        .toEqual(['A', 'B', 'C', 'companion-resume'])
      report('reject-only-negative-control', trace)
    } finally {
      report('reject-only-negative-control-final', trace)
    }
  })

  it('C. deferred timer cancellation records whether cancellation races after reject on this pinned driver', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'step-1' }),
      toolCallResponse('c2', 'echo', { text: 'step-2' }),
      textResponse('step-3-complete'),
      textResponse('resumed-after-deferred-cancel'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('cooperative-yield-deferred-cancel'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const { deferredCancelDone, resume } = installStepFourFixture(ctx, agent, trace, 'deferred-cancel')

    try {
      agent.followup(message('start', { kind: 'user' }))
      await agent.whenIdle()
      await deferredCancelDone

      const started = agent.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'step/start' }> => event.type === 'step/start')
        .map(event => [event.data.turn, event.data.step])
      expect(started).toEqual([[1, 1], [1, 2], [1, 3]])
      expect(adapter.requests).toHaveLength(3)
      expect(turnReasons(agent)).toEqual([{ kind: 'blocked' }])
      expect(agent.status).toBe('idle')
      expect(textsOf(agent.inbox.nextStep)).toEqual(['A', 'B', 'C'])
      expect(trace.some(entry => entry.event === 'cancel/deferred-timer')).toBe(true)

      agent.steer(resume)
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(4)
      expect(recordedTexts(agent, ['A', 'B', 'C', 'companion-resume']))
        .toEqual(['A', 'B', 'C', 'companion-resume'])
      report('deferred-cancel-negative-control', trace)
    } finally {
      report('deferred-cancel-negative-control-final', trace)
    }
  })
})
