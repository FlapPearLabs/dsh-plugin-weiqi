import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
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
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import {
  RuntimeFocusOwner,
  bindPinnedDshFocusBoundary,
} from './plugin/runtime/focus-boundary.ts'
import { MockAdapter, toolCallResponse } from '../mock-adapter.ts'

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

function turnReasons(agent: Agent): TurnEndReason[] {
  return agent.session.events
    .filter((event): event is Extract<SessionEvent, { type: 'turn/end' }> => event.type === 'turn/end')
    .map(event => event.data.reason)
}

function eventIndex(trace: readonly TraceEntry[], event: string): number {
  const index = trace.findIndex(entry => entry.event === event)
  expect(index, `missing trace event: ${event}`).toBeGreaterThanOrEqual(0)
  return index
}

function report(trace: readonly TraceEntry[]): void {
  console.log('A_T03_SAFE_BOUNDARY_TRACE ' + JSON.stringify(trace))
}

describe('WAVE-A-T03 real pinned DSH safe-boundary integration', () => {
  it('commits step 3 and every tool result before serving focus, with no step 4 cognition', async () => {
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
    ]
    expect(continuationScript.length).toBeGreaterThan(20)

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
    let handoffServed = false

    // Registered before the production binding so the committed event appears
    // in the trace before the binding serves the eligible handoff.
    ctx.on('session/event', (session, event) => {
      if (session !== work.session) return
      if (event.type === 'step/start' || event.type === 'step/end') {
        trace.push({ event: event.type, turn: event.data.turn, step: event.data.step })
      } else if (event.type === 'turn/end') {
        trace.push({ event: 'turn/end', turn: event.data.turn, detail: event.data.reason })
      } else if (event.type === 'tool/call') {
        trace.push({
          event: 'tool/call:committed',
          turn: event.data.turn,
          step: event.data.step,
          detail: event.data.callId,
        })
      } else if (event.type === 'tool/result') {
        trace.push({
          event: 'tool/result:committed',
          turn: event.data.turn,
          step: event.data.step,
          detail: event.data.message.callId,
        })
      }
    })
    ctx.on('agent/error', ({ agent, turn, step, error }) => {
      if (agent === work) {
        trace.push({ event: 'agent/error', turn, step, detail: String(error) })
      }
    })

    bindPinnedDshFocusBoundary(ctx, owner, { work, go }, {
      onHandoff: (handoff) => {
        handoffServed = true
        trace.push({ event: 'safe-handoff:eligible', detail: handoff })
      },
    })

    // This observer sits inside the production llm/stream wrapper. It proves
    // llmRunning spans real model iteration and has settled before tool work.
    ctx.on('llm/stream', (request: GenerateOptions, next) => {
      if (request.sessionId !== work.session.id) return next()
      return (async function* () {
        const step = owner.executingStep?.step
        trace.push({
          event: `model:${step}:start`,
          step,
          detail: { llmRunning: owner.state.llmRunning },
        })
        try {
          yield* next()
        } finally {
          trace.push({ event: `model:${step}:complete`, step })
        }
      })()
    })

    ctx.tools.register(defineContentToolFixture({
      name: 'trace-tool',
      description: 'deterministic A-T03 continuation tool',
      parameters: { label: { type: 'string', required: true } },
      execute: async ({ label }) => {
        trace.push({
          event: `tool:${label}:start`,
          detail: { llmRunning: owner.state.llmRunning },
        })
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
        trace.push({ event: `tool:${label}:complete` })
        return [{ type: 'text', text: `completed:${label}` }]
      },
    }))

    // Test-only controlled stop: A-T03 production code has already served the
    // boundary. This prevents step 4 from opening without reproducing A-T04's
    // inbox restoration / blocked-idle / resume sequence.
    ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      if (agent !== work || turn !== 1 || step !== 4 || !handoffServed) return next()
      trace.push({ event: 'controlled-evidence-stop-before-step-4', turn, step })
      return { kind: 'reject' }
    })

    try {
      work.followup(createUserMessage({
        content: [{ type: 'text', text: 'begin 20+ continuation steps' }],
        source: { kind: 'user' },
      }))
      await work.whenIdle()

      const startedSteps = work.session.events
        .filter((event): event is Extract<SessionEvent, { type: 'step/start' }> =>
          event.type === 'step/start')
        .map(event => event.data.step)
      const stepThreeResults = work.session.events.filter(event =>
        event.type === 'tool/result' && event.data.turn === 1 && event.data.step === 3)
      const interruptedMessages = work.session.events.filter(event =>
        event.type === 'assistant/message' && event.data.interrupted === true)

      expect(startedSteps).toEqual([1, 2, 3])
      expect(adapter.requests).toHaveLength(3)
      expect(stepThreeResults).toHaveLength(3)
      expect(interruptedMessages).toEqual([])
      expect(turnReasons(work)).toEqual([{ kind: 'blocked' }])
      expect(go.session.events.some(event => event.type === 'step/start')).toBe(false)
      expect(owner.executingStep).toBeUndefined()
      expect(owner.state).toEqual({
        activeLane: 'go',
        llmRunning: false,
        pendingFocus: pending,
      })

      expect(eventIndex(trace, 'step/start')).toBeLessThan(eventIndex(trace, 'model:1:start'))
      expect(eventIndex(trace, 'model:3:start')).toBeLessThan(eventIndex(trace, 'model:3:complete'))
      expect(eventIndex(trace, 'model:3:complete')).toBeLessThan(eventIndex(trace, 'tool:step-3-a:start'))
      expect(eventIndex(trace, 'tool:step-3-a:complete')).toBeLessThan(eventIndex(trace, 'tool:step-3-b:start'))
      expect(eventIndex(trace, 'tool:step-3-b:complete')).toBeLessThan(eventIndex(trace, 'tool:step-3-c:start'))
      expect(eventIndex(trace, 'tool:step-3-c:complete')).toBeLessThan(
        trace.findLastIndex(entry => entry.event === 'step/end' && entry.step === 3),
      )
      const stepThreeEnd = trace.findLastIndex(entry => entry.event === 'step/end' && entry.step === 3)
      expect(stepThreeEnd).toBeGreaterThanOrEqual(0)
      expect(stepThreeEnd).toBeLessThan(eventIndex(trace, 'safe-handoff:eligible'))
      expect(eventIndex(trace, 'safe-handoff:eligible')).toBeLessThan(
        eventIndex(trace, 'controlled-evidence-stop-before-step-4'),
      )
      expect(trace.some(entry => entry.event === 'model:4:start')).toBe(false)

      expect(trace.find(entry => entry.event === 'model:3:start')?.detail)
        .toEqual({ llmRunning: true })
      for (const label of ['step-3-a', 'step-3-b', 'step-3-c']) {
        expect(trace.find(entry => entry.event === `tool:${label}:start`)?.detail)
          .toEqual({ llmRunning: false })
      }

      const productionSource = [
        readFileSync(new URL('./plugin/runtime/focus-boundary.ts', import.meta.url), 'utf8'),
        readFileSync(new URL('./plugin/index.ts', import.meta.url), 'utf8'),
      ].join('\n')
      expect(productionSource).not.toMatch(/agent\/pre-step|inbox\.splice|whenIdle\(|kind:\s*['"]reject/)
      expect(productionSource).not.toMatch(/queue|mailbox|event bus|epoch|lease|timer/i)

      report(trace)
    } finally {
      report(trace)
    }
  })
})
