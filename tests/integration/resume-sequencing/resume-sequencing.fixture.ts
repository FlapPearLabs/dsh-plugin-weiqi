import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  createUserMessage,
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
import {
  bindPinnedDshLaneResume,
  emitLaneSwitched,
} from './plugin/runtime/focus-resume.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../mock-adapter.ts'

type TraceEntry = Readonly<{
  event: string
  turn?: number
  step?: number
  texts?: readonly string[]
  ids?: readonly UserMessage['id'][]
  detail?: unknown
}>

const liveContexts: Context[] = []

afterEach(async () => {
  await Promise.all(liveContexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function pluginMessage(text: string, plugin = 'a-t04-integration'): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin },
  })
}

function textsOf(inputs: readonly UserMessage[]): string[] {
  return inputs.map(item => item.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(''))
}

function reasons(agent: Agent): TurnEndReason[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'turn/end' }> =>
      event.type === 'turn/end')
    .map(event => event.data.reason)
}

function recordedEntries(agent: Agent, candidates: readonly string[]): Array<{
  text: string
  id: UserMessage['id']
}> {
  const wanted = new Set(candidates)
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> =>
      event.type === 'user/message')
    .map(event => ({ text: textsOf([event.data])[0]!, id: event.data.id }))
    .filter(entry => wanted.has(entry.text))
}

function indexOfSplice(
  trace: readonly TraceEntry[],
  texts: readonly string[],
): number {
  const index = trace
    .findIndex(entry => entry.event === 'inbox/spliced'
      && entry.texts?.length === texts.length
      && texts.every((text, i) => entry.texts?.[i] === text))
  expect(index, `missing splice event ${JSON.stringify(texts)}`).toBeGreaterThanOrEqual(0)
  return index
}

function indexOf(trace: readonly TraceEntry[], event: string): number {
  const index = trace.findIndex(entry => entry.event === event)
  expect(index, `missing trace event ${event}`).toBeGreaterThanOrEqual(0)
  return index
}

function lastIndexOf(trace: readonly TraceEntry[], event: string): number {
  const index = trace.findLastIndex(entry => entry.event === event)
  expect(index, `missing trace event ${event}`).toBeGreaterThanOrEqual(0)
  return index
}

function report(label: string, trace: readonly TraceEntry[]): void {
  console.log(`A_T07_RESUME_SEQUENCING_TRACE ${label} ${JSON.stringify(trace)}`)
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
    description: 'deterministic A-T07 continuation tool',
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

function bindProductionRuntime(
  ctx: Context,
  work: Agent,
  go: Agent,
  options: {
    onResumeAdmitted?: (event: Readonly<{
      lane: 'work' | 'go'
      syntheticResume: boolean
    }>) => void
  } = {},
): Readonly<{ owner: RuntimeFocusOwner }> {
  const owner = new RuntimeFocusOwner('work')
  bindPinnedDshFocusBoundary(ctx, owner, { work, go })
  bindPinnedDshCooperativeYield(ctx, owner, { work, go }, {
    onLaneSwitch: transition => emitLaneSwitched(ctx, transition),
  })
  bindPinnedDshLaneResume(ctx, owner, { work, go }, {
    onResumeAdmitted: options.onResumeAdmitted,
  })
  return { owner }
}

describe('WAVE-A-T07 real pinned DSH production integration', () => {
  it('resumes the paused Work lane with exactly one companion-resume and claims A,B,C,resume in order', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('step-1', 'echo', { text: 'step-1' }),
      toolCallResponse('step-2', 'echo', { text: 'step-2' }),
      toolCallResponse('step-3', 'focus-and-stage', { text: 'step-3' }),
      toolCallResponse('go-1', 'return-focus', { text: 'go-1' }),
      textResponse('resumed'),
    ])
    const ctx = await harness(adapter)
    const { work, go } = await pairedAgents(ctx, 'a-t07-resume')
    const a = pluginMessage('A')
    const b = pluginMessage('B')
    const c = pluginMessage('C')
    const returnIntent = Object.freeze({
      target: 'work',
      origin: 'self_initiated',
    } as const)
    const trace: TraceEntry[] = []
    const resumed = Promise.withResolvers<void>()
    const admitted: Array<Readonly<{ lane: string; syntheticResume: boolean }>> = []
    let staged = false
    let runtime: ReturnType<typeof bindProductionRuntime> | undefined

    ctx.on('agent/inbox/claimed', ({ agent, message: claimed, turn }) => {
      if (agent === work) {
        trace.push({ event: 'inbox/claimed', turn, texts: textsOf([claimed]) })
      }
    })
    ctx.on('agent/status', ({ agent, status }) => {
      if (agent === work) trace.push({ event: `status:${status}` })
    })
    ctx.on('session/event', (session, event) => {
      if (session !== work.session) return
      if (event.type === 'turn/end') {
        trace.push({ event: 'turn/end', turn: event.data.turn, detail: event.data.reason })
      } else if (event.type === 'agent/inbox/spliced') {
        trace.push({
          event: 'inbox/spliced',
          texts: textsOf(event.data.inserted),
          detail: { target: event.data.target, start: event.data.start },
        })
      }
    })

    ctx.tools.register(defineContentToolFixture({
      name: 'focus-and-stage',
      description: 'submit focus and stage the claimed A-T07 batch during step 3',
      parameters: { text: { type: 'string', required: true } },
      execute: async ({ text }) => {
        const submission = runtime!.owner.submitFocusIntent(
          Object.freeze({ target: 'go', origin: 'self_initiated' } as const),
        )
        expect(submission.eligibility).toBeUndefined()
        work.inject(a)
        work.inject(b)
        staged = true
        trace.push({ event: 'focus:pending,stage:A,B' })
        return [{ type: 'text', text }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'return-focus',
      description: 'submit the winning return focus intent during the Go step',
      parameters: { text: { type: 'string', required: true } },
      execute: async ({ text }) => {
        runtime!.owner.submitFocusIntent(returnIntent)
        trace.push({ event: 'go:return-focus-submitted' })
        return [{ type: 'text', text }]
      },
    }))

    // C arrives after the step-4 claim, before the production guard restores
    // the batch — the same adversarial placement the A-T04 fixture verifies.
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent !== work || payload.turn !== 1 || payload.step !== 4) return next()
      expect(textsOf(payload.messages)).toEqual(['A', 'B'])
      expect(staged).toBe(true)
      work.inject(c)
      trace.push({ event: 'arrival:C-after-claim' })
      const decision = await next()
      trace.push({ event: `pre-step:${decision.kind}` })
      return decision
    })

    runtime = bindProductionRuntime(ctx, work, go, {
      onResumeAdmitted: event => {
        admitted.push(event)
        expect(event.lane).toBe('work')
        expect(event.syntheticResume).toBe(true)
        trace.push({ event: 'resume:admitted' })
      },
    })
    ctx.on('agent/inbox/inserted', ({ agent, message: inserted }) => {
      if (agent === work && inserted.source.kind === 'plugin'
        && inserted.source.plugin === 'companion-go-resume') {
        trace.push({ event: 'resume:inserted', texts: textsOf([inserted]) })
        resumed.resolve()
      }
    })

    try {
      work.followup(createUserMessage({
        content: [{ type: 'text', text: 'start' }],
        source: { kind: 'user' },
      }))
      await work.whenIdle()
      go.followup(createUserMessage({
        content: [{ type: 'text', text: 'go task' }],
        source: { kind: 'user' },
      }))
      await go.whenIdle()
      await resumed.promise
      await work.whenIdle()

      // Turn 1: three steps, blocked by the cooperative-yield reject. Turn 2:
      // the resumed claim A,B,C,companion-resume completed. The Go turn ended
      // blocked: its step-2 proposal was cooperatively rejected by the return
      // intent (the cooperative-return path — admission precedes the new
      // pause marker, so Work's resume is not displaced).
      expect(reasons(work)).toEqual([
        { kind: 'blocked' },
        { kind: 'completed' },
      ])
      expect(reasons(go)).toEqual([{ kind: 'blocked' }])
      expect(work.inbox.hasPending).toBe(false)
      expect(go.inbox.hasPending).toBe(false)

      // Durable Work transcript: the preserved batch in stored order, then the
      // resume — each exactly once, original MessageIds preserved.
      const durable = recordedEntries(work, ['A', 'B', 'C', 'companion-resume'])
      expect(durable.map(entry => entry.text)).toEqual(['A', 'B', 'C', 'companion-resume'])
      expect(durable.map(entry => entry.id)).toEqual([a.id, b.id, c.id, durable[3]!.id])
      expect(new Set(durable.map(entry => entry.id)).size).toBe(4)
      // No Go transcript copied into Work.
      expect(recordedEntries(work, ['go task'])).toEqual([])

      expect(admitted).toEqual([{ lane: 'work', syntheticResume: true }])
      // Work resumed; Go is now the deliberately paused lane.
      expect(runtime!.owner.state).toEqual({
        activeLane: 'work',
        llmRunning: false,
        pendingFocus: returnIntent,
        pausedLane: 'go',
      })

      // Ordering: the preserved batch claims before the resume message at the
      // turn-2 boundary. (A,B were also claimed in turn 1 before the reject.)
      const claims = trace
        .filter(entry => entry.event === 'inbox/claimed')
        .map(entry => entry.texts?.[0])
      expect(claims.slice(-4)).toEqual(['A', 'B', 'C', 'companion-resume'])

      // The restore splice (the claimed [A,B] batch, placed ahead of C) is
      // the production guard's splice; the earlier next-step splices are the
      // turn-1 staging inserts.
      expect(indexOf(trace, 'arrival:C-after-claim'))
        .toBeLessThan(indexOfSplice(trace, ['A', 'B']))
      expect(indexOfSplice(trace, ['A', 'B']))
        .toBeLessThan(indexOf(trace, 'pre-step:reject'))
      expect(indexOf(trace, 'pre-step:reject'))
        .toBeLessThan(indexOf(trace, 'turn/end'))
      expect(indexOf(trace, 'turn/end'))
        .toBeLessThan(indexOf(trace, 'go:return-focus-submitted'))
      expect(indexOf(trace, 'go:return-focus-submitted'))
        .toBeLessThan(indexOf(trace, 'resume:admitted'))
      expect(indexOf(trace, 'resume:admitted'))
        .toBeLessThan(indexOf(trace, 'resume:inserted'))
      report('resume-sequencing', trace)
    } finally {
      report('resume-sequencing-final', trace)
    }
  })

  it('a user-command return carrying the user message suppresses the synthetic resume', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('step-1', 'echo', { text: 'step-1' }),
      toolCallResponse('step-2', 'echo', { text: 'step-2' }),
      toolCallResponse('step-3', 'focus-and-stage', { text: 'step-3' }),
      toolCallResponse('go-1', 'return-focus-user-command', { text: 'go-1' }),
      textResponse('user-driven'),
    ])
    const ctx = await harness(adapter)
    const { work, go } = await pairedAgents(ctx, 'a-t07-user-wake')
    const a = pluginMessage('A')
    const b = pluginMessage('B')
    const c = pluginMessage('C')
    const userWake = createUserMessage({
      content: [{ type: 'text', text: 'user says continue' }],
      source: { kind: 'user' },
    })
    const returnIntent = Object.freeze({
      target: 'work',
      origin: 'user_command',
      sourceMessage: { sourceSessionId: 'ui-session', message: userWake },
    } as const)
    const trace: TraceEntry[] = []
    const admitted = Promise.withResolvers<void>()
    let steerInsertions = 0
    let staged = false
    let runtime: ReturnType<typeof bindProductionRuntime> | undefined

    ctx.on('session/event', (session, event) => {
      if (session !== work.session) return
      if (event.type === 'turn/end') {
        trace.push({ event: 'turn/end', turn: event.data.turn, detail: event.data.reason })
      }
    })

    ctx.tools.register(defineContentToolFixture({
      name: 'focus-and-stage',
      description: 'submit focus and stage the claimed batch during step 3',
      parameters: { text: { type: 'string', required: true } },
      execute: async ({ text }) => {
        runtime!.owner.submitFocusIntent(
          Object.freeze({ target: 'go', origin: 'self_initiated' } as const),
        )
        work.inject(a)
        work.inject(b)
        staged = true
        trace.push({ event: 'focus:pending,stage:A,B' })
        return [{ type: 'text', text }]
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'return-focus-user-command',
      description: 'submit the user-command return intent during the Go step',
      parameters: { text: { type: 'string', required: true } },
      execute: async ({ text }) => {
        runtime!.owner.submitFocusIntent(returnIntent)
        trace.push({ event: 'go:user-command-return-submitted' })
        return [{ type: 'text', text }]
      },
    }))

    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent !== work || payload.turn !== 1 || payload.step !== 4) return next()
      expect(textsOf(payload.messages)).toEqual(['A', 'B'])
      expect(staged).toBe(true)
      work.inject(c)
      const decision = await next()
      trace.push({ event: `pre-step:${decision.kind}` })
      return decision
    })

    runtime = bindProductionRuntime(ctx, work, go, {
      onResumeAdmitted: event => {
        expect(event.lane).toBe('work')
        expect(event.syntheticResume).toBe(false)
        trace.push({ event: 'resume:admitted-without-synthetic' })
        admitted.resolve()
      },
    })
    ctx.on('agent/inbox/inserted', ({ agent, message: inserted }) => {
      if (agent !== work) return
      if (inserted.source.kind === 'plugin' && inserted.source.plugin === 'companion-go-resume') {
        steerInsertions += 1
      }
    })

    try {
      work.followup(createUserMessage({
        content: [{ type: 'text', text: 'start' }],
        source: { kind: 'user' },
      }))
      await work.whenIdle()
      go.followup(createUserMessage({
        content: [{ type: 'text', text: 'go task' }],
        source: { kind: 'user' },
      }))
      await go.whenIdle()
      // The switch admitted without a synthetic resume; the user's own
      // message is the real wake (delivered by the admission path seam).
      await admitted.promise
      work.followup(userWake)
      await work.whenIdle()

      expect(reasons(work)).toEqual([
        { kind: 'blocked' },
        { kind: 'completed' },
      ])
      expect(reasons(go)).toEqual([{ kind: 'blocked' }])
      expect(steerInsertions).toBe(0)
      expect(work.inbox.hasPending).toBe(false)
      expect(runtime!.owner.state.pausedLane).toBe('go')

      // The real user wake consumed the preserved batch in stored order; no
      // companion-resume message ever existed in the Work transcript.
      const durable = recordedEntries(work, ['A', 'B', 'C', 'companion-resume', 'user says continue'])
      expect(durable.map(entry => entry.text))
        .toEqual(['A', 'B', 'C', 'user says continue'])
      expect(durable.map(entry => entry.id)).toEqual([a.id, b.id, c.id, durable[3]!.id])
      report('user-wake-suppression', trace)
    } finally {
      report('user-wake-suppression-final', trace)
    }
  })

  it('a natural settle without cooperative yield never resumes either lane', async () => {
    const adapter = new MockAdapter([textResponse('natural-completion')])
    const ctx = await harness(adapter)
    const { work, go } = await pairedAgents(ctx, 'a-t07-natural')
    const trace: TraceEntry[] = []
    const admitted: unknown[] = []

    ctx.on('agent/status', ({ agent, status }) => {
      if (agent === work) trace.push({ event: `status:${status}` })
    })

    const runtime = bindProductionRuntime(ctx, work, go, {
      onResumeAdmitted: admitted.push as never,
    })

    try {
      work.followup(createUserMessage({
        content: [{ type: 'text', text: 'complete naturally' }],
        source: { kind: 'user' },
      }))
      await work.whenIdle()

      expect(reasons(work)).toEqual([{ kind: 'completed' }])
      expect(admitted).toEqual([])
      expect(work.inbox.hasPending).toBe(false)
      expect(runtime.owner.state).not.toHaveProperty('pausedLane')
      expect(go.session.events.some(event => event.type === 'user/message')).toBe(false)
      report('natural-settle-no-resume', trace)
    } finally {
      report('natural-settle-no-resume-final', trace)
    }
  })
})
