import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  CallId,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SessionId,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import {
  RuntimeFocusOwner,
  bindPinnedDshFocusBoundary,
} from './plugin/runtime/focus-boundary.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../mock-adapter.ts'

type TraceEntry = Readonly<{
  event: string
  turn?: number
  step?: number
  detail?: unknown
}>

const liveContexts: Context[] = []

afterEach(async () => {
  await Promise.all(liveContexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function multiToolResponse(
  calls: ReadonlyArray<Readonly<{ id: string; name: string; args: object }>>,
): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    const id = CallId(call.id)
    const args = JSON.stringify(call.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: args },
      {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id, name: call.name, arguments: args },
      },
    )
  })
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: calls.length * 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function eventIndex(trace: readonly TraceEntry[], event: string, step?: number): number {
  const index = trace.findIndex(entry =>
    entry.event === event && (step === undefined || entry.step === step))
  const suffix = step === undefined ? '' : ` at step ${step}`
  expect(index, `missing trace event: ${event}${suffix}`).toBeGreaterThanOrEqual(0)
  return index
}

function report(trace: readonly TraceEntry[]): void {
  console.log('A_T03_SAFE_BOUNDARY_TRACE ' + JSON.stringify(trace))
}

describe('WAVE-A-T03 real pinned DSH safe-boundary integration', () => {
  it('reports eligibility after committed step 3 while the active lane continues naturally', async () => {
    const continuationScript: StreamChunk[][] = [
      toolCallResponse('step-1', 'trace-tool', { label: 'step-1' }),
      toolCallResponse('step-2', 'trace-tool', { label: 'step-2' }),
      multiToolResponse([
        { id: 'step-3-a', name: 'trace-tool', args: { label: 'step-3-a' } },
        { id: 'step-3-b', name: 'trace-tool', args: { label: 'step-3-b' } },
        { id: 'step-3-c', name: 'trace-tool', args: { label: 'step-3-c' } },
      ]),
      ...Array.from({ length: 18 }, (_, index) =>
        toolCallResponse(`continuation-${index + 4}`, 'trace-tool', {
          label: `continuation-${index + 4}`,
        })),
      textResponse('natural completion after 20+ continuation steps'),
    ]
    expect(continuationScript.length).toBeGreaterThan(20)
    const expectedRequestCount = continuationScript.length

    const adapter = new MockAdapter(continuationScript)
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    liveContexts.push(ctx)

    const work = (await ctx.agents.create({
      sessionId: SessionId('a-t03-work'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })).agent
    const go = (await ctx.agents.create({
      sessionId: SessionId('a-t03-go'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })).agent
    const owner = new RuntimeFocusOwner('work')
    const pending = { target: 'go', origin: 'self_initiated' } as const
    const trace: TraceEntry[] = []
    let resolveWorkTurnEnd!: () => void
    const workTurnEnded = new Promise<void>((resolve) => {
      resolveWorkTurnEnd = resolve
    })

    // Registered before the production binding so the committed event appears
    // in the trace before the binding reports eligibility.
    ctx.on('session/event', (session, event) => {
      if (session !== work.session) return
      if (event.type === 'step/start' || event.type === 'step/end') {
        if (event.data.step <= 4) {
          trace.push({ event: event.type, turn: event.data.turn, step: event.data.step })
        }
      } else if (event.type === 'turn/end') {
        trace.push({ event: 'turn/end', turn: event.data.turn, detail: event.data.reason })
        resolveWorkTurnEnd()
      } else if (event.type === 'tool/call') {
        if (event.data.step <= 4) {
          trace.push({
            event: 'tool/call:committed',
            turn: event.data.turn,
            step: event.data.step,
            detail: event.data.callId,
          })
        }
      } else if (event.type === 'tool/result') {
        if (event.data.step <= 4) {
          trace.push({
            event: 'tool/result:committed',
            turn: event.data.turn,
            step: event.data.step,
            detail: event.data.message.callId,
          })
        }
      }
    })
    ctx.on('agent/error', ({ agent, turn, step, error }) => {
      if (agent === work) {
        trace.push({ event: 'agent/error', turn, step, detail: String(error) })
      }
    })

    bindPinnedDshFocusBoundary(ctx, owner, { work, go }, {
      onEligibility: (eligibility) => {
        const step = eligibility.boundary.kind === 'step-end'
          ? eligibility.boundary.step
          : undefined
        if (step !== 3) return
        trace.push({
          event: 'safe-handoff:eligible',
          step,
          detail: { eligibility, activeLane: owner.state.activeLane },
        })
      },
    })

    // This observer sits inside the production llm/stream wrapper. It proves
    // llmRunning spans real model iteration and has settled before tool work.
    ctx.on('llm/stream', (request: GenerateOptions, next) => {
      if (request.sessionId !== work.session.id) return next()
      return (async function* () {
        const step = owner.executingStep?.step
        const shouldTrace = step !== undefined && step <= 4
        if (shouldTrace) {
          trace.push({
            event: `model:${step}:start`,
            step,
            detail: { llmRunning: owner.state.llmRunning },
          })
        }
        try {
          yield* next()
        } finally {
          if (shouldTrace) trace.push({ event: `model:${step}:complete`, step })
        }
      })()
    })

    ctx.tools.register(defineContentToolFixture({
      name: 'trace-tool',
      description: 'deterministic A-T03 continuation tool',
      parameters: { label: { type: 'string', required: true } },
      execute: async ({ label }) => {
        const shouldTrace = label.startsWith('step-') || label === 'continuation-4'
        if (shouldTrace) {
          trace.push({
            event: `tool:${label}:start`,
            detail: { llmRunning: owner.state.llmRunning },
          })
        }
        if (label === 'step-3-a') {
          const submitted = owner.submitFocusIntent(pending)
          trace.push({
            event: 'focus:pending-during-step-3-tools',
            detail: {
              disposition: submitted.disposition,
              activeLane: owner.state.activeLane,
              pendingFocus: owner.state.pendingFocus,
            },
          })
        }
        await Promise.resolve()
        if (shouldTrace) trace.push({ event: `tool:${label}:complete` })
        return [{ type: 'text', text: `completed:${label}` }]
      },
    }))

    try {
      work.followup(createUserMessage({
        content: [{ type: 'text', text: 'begin 20+ continuation steps' }],
        source: { kind: 'user' },
      }))
      await workTurnEnded

      const startedSteps = work.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'step/start' }> =>
          event.type === 'step/start')
        .map(event => event.data.step)
      const stepThreeResults = work.session.events.filter(event =>
        event.type === 'tool/result' && event.data.turn === 1 && event.data.step === 3)
      const interruptedMessages = work.session.events.filter(event =>
        event.type === 'assistant/message' && event.data.interrupted === true)
      trace.push({
        event: 'natural-continuation:completed',
        detail: {
          startedSteps: startedSteps.length,
          requests: adapter.requests.length,
          activeLane: owner.state.activeLane,
        },
      })

      expect(startedSteps).toEqual(
        Array.from({ length: expectedRequestCount }, (_, index) => index + 1),
      )
      expect(adapter.requests).toHaveLength(expectedRequestCount)
      expect(stepThreeResults).toHaveLength(3)
      expect(interruptedMessages).toEqual([])
      expect(go.session.events.some(event => event.type === 'step/start')).toBe(false)
      expect(owner.executingStep).toBeUndefined()
      expect(owner.state).toEqual({
        activeLane: 'work',
        llmRunning: false,
        pendingFocus: pending,
      })

      expect(eventIndex(trace, 'step/start', 3)).toBeLessThan(eventIndex(trace, 'model:3:start'))
      expect(eventIndex(trace, 'model:3:start')).toBeLessThan(eventIndex(trace, 'model:3:complete'))
      expect(eventIndex(trace, 'model:3:complete')).toBeLessThan(eventIndex(trace, 'tool:step-3-a:start'))
      expect(eventIndex(trace, 'tool:step-3-a:complete')).toBeLessThan(eventIndex(trace, 'tool:step-3-b:start'))
      expect(eventIndex(trace, 'tool:step-3-b:complete')).toBeLessThan(eventIndex(trace, 'tool:step-3-c:start'))
      const stepThreeResultIndices = trace
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.event === 'tool/result:committed' && entry.step === 3)
        .map(({ index }) => index)
      expect(stepThreeResultIndices).toHaveLength(3)
      expect(eventIndex(trace, 'tool:step-3-a:complete')).toBeLessThan(stepThreeResultIndices[0]!)
      expect(stepThreeResultIndices[0]!).toBeLessThan(eventIndex(trace, 'tool:step-3-b:start'))
      expect(eventIndex(trace, 'tool:step-3-b:complete')).toBeLessThan(stepThreeResultIndices[1]!)
      expect(stepThreeResultIndices[1]!).toBeLessThan(eventIndex(trace, 'tool:step-3-c:start'))
      expect(eventIndex(trace, 'tool:step-3-c:complete')).toBeLessThan(stepThreeResultIndices[2]!)

      const stepThreeEnd = eventIndex(trace, 'step/end', 3)
      const stepThreeEligibility = eventIndex(trace, 'safe-handoff:eligible', 3)
      expect(stepThreeResultIndices[2]!).toBeLessThan(stepThreeEnd)
      expect(stepThreeEnd).toBeLessThan(stepThreeEligibility)
      expect(trace[stepThreeEligibility]?.detail).toEqual({
        eligibility: {
          from: 'work',
          to: 'go',
          intent: pending,
          boundary: { kind: 'step-end', lane: 'work', turn: 1, step: 3 },
        },
        activeLane: 'work',
      })
      expect(eventIndex(trace, 'model:4:start')).toBeGreaterThan(stepThreeEligibility)

      expect(trace.find(entry => entry.event === 'model:3:start')?.detail)
        .toEqual({ llmRunning: true })
      for (const label of ['step-3-a', 'step-3-b', 'step-3-c']) {
        expect(trace.find(entry => entry.event === `tool:${label}:start`)?.detail)
          .toEqual({ llmRunning: false })
      }

      // A-T04 now exists in a separate binding. The A-T03 binding itself must
      // remain observation-only so this isolated regression still continues.
      const aT03BindingSource = bindPinnedDshFocusBoundary.toString()
      expect(aT03BindingSource)
        .not.toMatch(/agent\/pre-step|inbox\.splice|whenIdle\(|kind:\s*['"]reject/)
      expect(aT03BindingSource).not.toMatch(/\bactivateLane\s*\(/)
    } finally {
      report(trace)
    }
  })
})
