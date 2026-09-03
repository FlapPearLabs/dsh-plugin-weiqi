import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/**
 * WAVE-D-S01 CONTINUATION — formal fallback seam validation.
 *
 * Candidate under test:
 *   `agent.ctx.systemPrompt.section(...)` with a dynamic text provider.
 *
 * This file is copied unchanged into the pinned upstream DSH tree by the gate
 * workflow, so it exercises the real AgentLoop + SystemPrompt implementations
 * rather than a reimplementation.
 *
 * It owns NO Bridge production code, NO GameNotice/WorkSnapshot production
 * code, NO DSH patch, NO queue/mailbox/event bus, NO timer/cooldown, NO
 * snapshot journal, NO transcript synchronization, and NO generalized delivery
 * mechanism. Providers read a plain O(1) holder variable.
 *
 * Why this seam differs from the already-FAILed `ctx.systemPrompt.context`:
 *   - `context()` contributions become a DURABLE user-role message appended to
 *     the session (they accumulate across changed values; that is the recorded
 *     D-S01 FAIL against Spec §39.6 latest-only delivery);
 *   - `section()` contributions are rendered into the SYSTEM prompt by
 *     `renderPrompt(assembly)` on every step and are never appended to session
 *     history.
 *
 * This probe establishes or falsifies that difference with executable evidence.
 */

const HARNESS_IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'
const WORK_SECTION_NAME = 'companion-go:work-lane-bridge'
const GO_SECTION_NAME = 'companion-go:go-lane-bridge'
const GAME_NOTICE_MARKER = 'GAME_NOTICE='
const WORK_SNAPSHOT_MARKER = 'WORK_SNAPSHOT='

type Lane = 'work' | 'go'

type TraceEntry = {
  event: string
  turn?: number
  step?: number
  detail?: unknown
}

/** O(1) Runtime-held latest values; `undefined` means "nothing to project". */
type BridgeHolder = {
  gameNotice: string | undefined
  workSnapshot: string | undefined
}

type SectionStats = {
  evaluations: number
  assembledForThisAgent: boolean[]
  disposerIsFunction: boolean
  rendered: string[]
}

type SectionHandle = {
  stats: SectionStats
  dispose: () => void
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
    }
  })
}

/**
 * Register one agent-scoped dynamic SYSTEM PROMPT SECTION through the agent's
 * own scoped context.
 *
 * Per Spec §39.6 the Work lane observes the latest GameNotice and the Go lane
 * observes the latest WorkSnapshot, so the lane/marker pairing is:
 *   work lane -> GAME_NOTICE=
 *   go  lane -> WORK_SNAPSHOT=
 *
 * The provider closes over ONE O(1) holder field. It never touches Session
 * history, the action log, the transcript, or game history.
 */
function registerBridgeSection(
  agent: Agent,
  holder: BridgeHolder,
  lane: Lane,
  trace: TraceEntry[],
): SectionHandle {
  const stats: SectionStats = {
    evaluations: 0,
    assembledForThisAgent: [],
    disposerIsFunction: false,
    rendered: [],
  }
  const name = lane === 'work' ? WORK_SECTION_NAME : GO_SECTION_NAME
  const marker = lane === 'work' ? GAME_NOTICE_MARKER : WORK_SNAPSHOT_MARKER
  const read = (): string | undefined => lane === 'work' ? holder.gameNotice : holder.workSnapshot

  const dispose = agent.ctx.systemPrompt.section({
    name,
    order: 20,
    text: (assembleCtx) => {
      stats.evaluations += 1
      const isThisAgent = assembleCtx.agent === agent
      stats.assembledForThisAgent.push(isThisAgent)
      const current = read()
      const rendered = current === undefined ? '' : marker + current
      stats.rendered.push(rendered)
      trace.push({
        event: 'section/evaluated',
        detail: { name, lane, isThisAgent, runtimeValue: current ?? null, rendered },
      })
      return rendered
    },
  })
  stats.disposerIsFunction = typeof dispose === 'function'
  trace.push({
    event: 'section/registered',
    detail: { name, lane, disposerIsFunction: stats.disposerIsFunction },
  })
  return { stats, dispose }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function occurrences(haystack: string | undefined, needle: string): number {
  if (haystack === undefined || needle.length === 0) return 0
  return haystack.split(needle).length - 1
}

/** Every `MARKER<value>` token present in one request's system prompt. */
function systemMarkerValues(request: GenerateOptions, marker: string): string[] {
  const text = request.system ?? ''
  return text.match(new RegExp(escapeRegExp(marker) + '[^\\s]*', 'g')) ?? []
}

/** Bridge marker occurrence count in the SYSTEM prompt of one request. */
function systemMarkerCount(request: GenerateOptions, marker: string): number {
  return occurrences(request.system, marker)
}

/**
 * Bridge marker occurrence count across the durable model MESSAGES of one
 * request. Counted per message, not per JSON substring: a durable snapshot can
 * legitimately carry a value in both its rendered text and its `sections`
 * attribution, which a raw regex over serialized JSON would double-count.
 */
function messageMarkerCount(request: GenerateOptions, marker: string): number {
  return (request.messages ?? []).filter(message => JSON.stringify(message).includes(marker)).length
}

function totalSystemMarkerCount(adapter: MockAdapter, marker: string): number {
  return adapter.requests.reduce((sum, request) => sum + systemMarkerCount(request, marker), 0)
}

function totalMessageMarkerCount(adapter: MockAdapter, marker: string): number {
  return adapter.requests.reduce((sum, request) => sum + messageMarkerCount(request, marker), 0)
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

function countEvents(agent: Agent, type: SessionEvent['type']): number {
  return agent.session.events.filter(event => event.type === type).length
}

/** The standard diagnostic bundle required by the acceptance contract. */
function diagnostics(
  ctx: Context,
  agent: Agent,
  adapter: MockAdapter,
  stats: SectionStats,
  marker: string,
): Record<string, unknown> {
  return {
    modelRequestCount: adapter.requests.length,
    requestHeaderCount: adapter.requests.length,
    turnStartCount: countEvents(agent, 'turn/start'),
    stepStartCount: countEvents(agent, 'step/start'),
    providerEvaluationCount: stats.evaluations,
    providerEvaluationsPerRequest: adapter.requests.length === 0
      ? 0
      : stats.evaluations / adapter.requests.length,
    perRequestBridgeSystemValues: adapter.requests.map(r => systemMarkerValues(r, marker)),
    bridgeOccurrencesInSystem: totalSystemMarkerCount(adapter, marker),
    bridgeOccurrencesInMessages: totalMessageMarkerCount(adapter, marker),
    sessionEventCount: agent.session.events.length,
    agentStatus: agent.status,
  }
}

describe('WAVE-D-S01 continuation: agent.ctx.systemPrompt.section formal acceptance gate', () => {
  it('1. registers agent-scoped, renders into the system prompt (not durable history), and keeps the real request path', async () => {
    const adapter = new MockAdapter([textResponse('ack-1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-work-1'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'A0', workSnapshot: undefined }
    const handle = registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('start'))
    await agent.whenIdle()

    expect(handle.stats.disposerIsFunction).toBe(true)
    expect(handle.stats.evaluations).toBeGreaterThanOrEqual(1)
    expect(handle.stats.assembledForThisAgent.every(Boolean)).toBe(true)

    // Acceptance 1: the contribution is agent-scoped. A second, unregistered
    // agent must never see it (checked in the same context, not a fresh one).
    const bare = ctx.agentLoop.create(SessionId('d-s01f-bare-1'), { provider: 'mock', model: 'mock' })
    agent.followup(messageText('again'))
    bare.followup(messageText('bare'))
    await agent.whenIdle()
    await bare.whenIdle()

    const workRequests = adapter.requests.filter(r => (r.system ?? '').includes(GAME_NOTICE_MARKER))
    const bareRequests = adapter.requests.filter(r => (r.system ?? '').includes('bare-start'))
    expect(workRequests.length).toBeGreaterThan(0)
    // The bare agent's own request carries the section marker only if it leaked.
    const bareSystem = adapter.requests[adapter.requests.length - 1].system ?? ''
    expect(bareSystem.includes(GAME_NOTICE_MARKER)).toBe(false)
    expect(bareRequests.length).toBe(0)

    // Acceptance 10: the request was produced by the real AgentLoop path --
    // the system prompt still contains the harness-owned identity section
    // registered by the real SystemPrompt service, and the derived history
    // carries the user message we submitted through `agent.followup`.
    expect(workRequests[0].system).toContain(HARNESS_IDENTITY)
    const lastWorkRequest = workRequests[workRequests.length - 1]
    const texts = (lastWorkRequest.messages ?? []).flatMap(message => {
      const content = (message as { content?: { type?: string; text?: string }[] }).content ?? []
      return content.filter(block => block.type === 'text').map(block => block.text ?? '')
    })
    expect(texts.some(text => text.includes('again'))).toBe(true)

    // Sections are NOT appended to durable model-facing history.
    expect(totalMessageMarkerCount(adapter, GAME_NOTICE_MARKER)).toBe(0)

    report('1-registration-scoping', [...trace, { event: 'diagnostics', detail: diagnostics(ctx, agent, adapter, handle.stats, GAME_NOTICE_MARKER) }])
  })

  it('2. provider reads only the Runtime-held latest value: exactly one evaluation per request regardless of history growth', async () => {
    const adapter = new MockAdapter([
      textResponse('r1'), textResponse('r2'), textResponse('r3'), textResponse('r4'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-o1'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'V1', workSnapshot: undefined }
    const handle = registerBridgeSection(agent, holder, 'work', trace)

    const perRequest: { evaluations: number; sessionEvents: number }[] = []
    for (let i = 1; i <= 4; i += 1) {
      const before = handle.stats.evaluations
      agent.followup(messageText('turn-' + i))
      await agent.whenIdle()
      perRequest.push({
        evaluations: handle.stats.evaluations - before,
        sessionEvents: agent.session.events.length,
      })
    }

    // O(1) with respect to history: the provider is evaluated a constant number
    // of times per request while session history grows monotonically. Any
    // per-history-entry scan inside the provider would show growth here.
    expect(perRequest.map(entry => entry.evaluations)).toEqual([1, 1, 1, 1])
    const eventCounts = perRequest.map(entry => entry.sessionEvents)
    for (let i = 1; i < eventCounts.length; i += 1) {
      expect(eventCounts[i]).toBeGreaterThan(eventCounts[i - 1])
    }
    expect(adapter.requests).toHaveLength(4)

    report('2-o1-runtime-read', [...trace, { event: 'perRequest', detail: perRequest }])
  })

  it('3. changing only the Runtime holder creates zero requests, zero steps, and zero status transitions', async () => {
    const adapter = new MockAdapter([textResponse('r1'), textResponse('r2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-wake'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'A0', workSnapshot: undefined }
    registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('start'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(agent.status).toBe('idle')
    const turns = countEvents(agent, 'turn/start')
    const steps = countEvents(agent, 'step/start')
    const traceLength = trace.length

    holder.gameNotice = 'B1'
    await settle()
    await settle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.status).toBe('idle')
    expect(countEvents(agent, 'turn/start')).toBe(turns)
    expect(countEvents(agent, 'step/start')).toBe(steps)
    expect(trace.length).toBe(traceLength)

    report('3-no-update-wake', trace)
  })

  it('4. A -> B -> C: the next natural request exposes only C, in the system prompt, with A and B absent everywhere', async () => {
    const adapter = new MockAdapter([textResponse('r1'), textResponse('r2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-abc'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'A', workSnapshot: undefined }
    const handle = registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('first'))
    await agent.whenIdle()
    expect(systemMarkerValues(adapter.requests[0], GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=A'])

    // Three Runtime-held values before the next natural request.
    holder.gameNotice = 'B'
    holder.gameNotice = 'C'
    await settle()

    agent.followup(messageText('second'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    const second = adapter.requests[1]

    // Latest-only: C present, A and B absent, in the SYSTEM prompt.
    expect(systemMarkerValues(second, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=C'])
    expect(systemMarkerCount(second, GAME_NOTICE_MARKER + 'A')).toBe(0)
    expect(systemMarkerCount(second, GAME_NOTICE_MARKER + 'B')).toBe(0)
    expect(systemMarkerCount(second, GAME_NOTICE_MARKER + 'C')).toBe(1)

    // ... and absent from the model messages as well.
    expect(messageMarkerCount(second, 'GAME_NOTICE=A')).toBe(0)
    expect(messageMarkerCount(second, 'GAME_NOTICE=B')).toBe(0)
    expect(messageMarkerCount(second, GAME_NOTICE_MARKER)).toBe(0)

    // Superseded values never reach the model-facing surface on any request.
    expect(totalMessageMarkerCount(adapter, GAME_NOTICE_MARKER)).toBe(0)

    report('4-abc-latest-only', [...trace, { event: 'diagnostics', detail: diagnostics(ctx, agent, adapter, handle.stats, GAME_NOTICE_MARKER) }])
  })

  it('5. unchanged C -> C -> C adds no request, no materialization, and no changed request-header record', async () => {
    const adapter = new MockAdapter([textResponse('r1'), textResponse('r2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-dedup'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'C', workSnapshot: undefined }
    const handle = registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('first'))
    await agent.whenIdle()
    expect(systemMarkerValues(adapter.requests[0], GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=C'])
    const evaluationsAfterFirst = handle.stats.evaluations
    const requestsAfterFirst = adapter.requests.length

    holder.gameNotice = 'C'
    holder.gameNotice = 'C'
    holder.gameNotice = 'C'
    await settle()

    expect(adapter.requests.length).toBe(requestsAfterFirst)
    expect(handle.stats.evaluations).toBe(evaluationsAfterFirst)
    expect(countEvents(agent, 'turn/start')).toBe(1)
    expect(countEvents(agent, 'step/start')).toBe(1)

    agent.followup(messageText('second'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    const second = adapter.requests[1]
    expect(systemMarkerCount(second, GAME_NOTICE_MARKER)).toBe(1)
    expect(systemMarkerValues(second, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=C'])

    report('5-unchanged-dedup', [...trace, { event: 'diagnostics', detail: diagnostics(ctx, agent, adapter, handle.stats, GAME_NOTICE_MARKER) }])
  })

  it('6. C -> D: the next natural request exposes only D as the current Bridge projection', async () => {
    const adapter = new MockAdapter([textResponse('r1'), textResponse('r2'), textResponse('r3')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-subsequent'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'C', workSnapshot: undefined }
    registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('first'))
    await agent.whenIdle()
    expect(systemMarkerValues(adapter.requests[0], GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=C'])

    holder.gameNotice = 'D'
    agent.followup(messageText('second'))
    await agent.whenIdle()

    const second = adapter.requests[1]
    expect(systemMarkerValues(second, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=D'])
    expect(systemMarkerCount(second, GAME_NOTICE_MARKER + 'C')).toBe(0)
    expect(messageMarkerCount(second, 'GAME_NOTICE=C')).toBe(0)

    report('6-subsequent-change', trace)
  })

  it('7. twenty Bridge updates while a request is active cause zero extra requests and zero extra steps; update #20 is current next', async () => {
    const updates: string[] = []
    let updatesApplied = 0
    const adapter = new MockAdapter([
      // The request is already built and in flight when the adapter is called.
      // Twenty holder updates happen at that exact point.
      () => {
        for (let i = 1; i <= 20; i += 1) {
          const value = 'RAPID-' + String(i).padStart(2, '0')
          holder.gameNotice = value
          updates.push(value)
          updatesApplied += 1
        }
        return textResponse('r1')
      },
      textResponse('r2'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-rapid'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'BASE', workSnapshot: undefined }
    registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('first'))
    await agent.whenIdle()

    expect(updatesApplied).toBe(20)
    expect(updates[19]).toBe('RAPID-20')
    // Zero extra model requests and zero extra steps caused solely by updates.
    expect(adapter.requests).toHaveLength(1)
    expect(countEvents(agent, 'turn/start')).toBe(1)
    expect(countEvents(agent, 'step/start')).toBe(1)
    expect(agent.status).toBe('idle')
    // The in-flight request still rendered the pre-update value.
    expect(systemMarkerValues(adapter.requests[0], GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=BASE'])

    agent.followup(messageText('second'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    const second = adapter.requests[1]
    expect(systemMarkerValues(second, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=RAPID-20'])
    // No superseded rapid update leaks into the system prompt or messages.
    for (let i = 1; i <= 19; i += 1) {
      const value = 'GAME_NOTICE=RAPID-' + String(i).padStart(2, '0')
      expect(systemMarkerCount(second, value)).toBe(0)
      expect(messageMarkerCount(second, value)).toBe(0)
    }
    expect(totalMessageMarkerCount(adapter, GAME_NOTICE_MARKER)).toBe(0)

    report('7-active-request-20-updates', [...trace, { event: 'updates', detail: { updates, turns: countEvents(agent, 'turn/start'), steps: countEvents(agent, 'step/start') } }])
  })

  it('8. one thousand holder updates stay bounded: zero per-update work and one latest projection on the next request', async () => {
    const adapter = new MockAdapter([textResponse('r1'), textResponse('r2')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-bounded'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'BOUND-0', workSnapshot: undefined }
    const handle = registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('first'))
    await agent.whenIdle()
    const baselineSystemLength = (adapter.requests[0].system ?? '').length
    const requestsBefore = adapter.requests.length
    const evaluationsBefore = handle.stats.evaluations
    const turnsBefore = countEvents(agent, 'turn/start')
    const stepsBefore = countEvents(agent, 'step/start')

    for (let i = 1; i <= 1000; i += 1) {
      holder.gameNotice = 'BOUND-' + i
    }

    expect(adapter.requests.length).toBe(requestsBefore)
    expect(handle.stats.evaluations).toBe(evaluationsBefore)
    expect(countEvents(agent, 'turn/start')).toBe(turnsBefore)
    expect(countEvents(agent, 'step/start')).toBe(stepsBefore)
    expect(agent.status).toBe('idle')

    agent.followup(messageText('second'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    const second = adapter.requests[1]
    expect(systemMarkerValues(second, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=BOUND-1000'])
    expect(systemMarkerCount(second, GAME_NOTICE_MARKER)).toBe(1)

    // Model-facing boundedness: 1000 updates did not grow the system prompt.
    // `BOUND-1000` is 4 characters longer than `BOUND-0`, so allow that delta
    // plus a small margin and nothing more.
    const grownSystemLength = (second.system ?? '').length
    expect(grownSystemLength - baselineSystemLength).toBeLessThanOrEqual(8)

    report('8-thousand-update-boundedness', [...trace, {
      event: 'boundedness',
      detail: { requestsBefore, requestsAfter: adapter.requests.length, baselineSystemLength, grownSystemLength },
    }])
  })

  it('9. cross-lane isolation: Work sees only GameNotice, Go sees only WorkSnapshot, an unregistered agent sees neither', async () => {
    const adapter = new MockAdapter([textResponse('work'), textResponse('go'), textResponse('bare')])
    const ctx = await harness(adapter)
    const work = ctx.agentLoop.create(SessionId('d-s01f-lane-work'), { provider: 'mock', model: 'mock' })
    const go = ctx.agentLoop.create(SessionId('d-s01f-lane-go'), { provider: 'mock', model: 'mock' })
    const bare = ctx.agentLoop.create(SessionId('d-s01f-lane-bare'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, work, trace)
    observe(ctx, go, trace)
    observe(ctx, bare, trace)
    const holder: BridgeHolder = { gameNotice: 'GN-9', workSnapshot: 'WS-9' }
    registerBridgeSection(work, holder, 'work', trace)
    registerBridgeSection(go, holder, 'go', trace)

    work.followup(messageText('work-start'))
    await work.whenIdle()
    go.followup(messageText('go-start'))
    await go.whenIdle()
    bare.followup(messageText('bare-start'))
    await bare.whenIdle()

    expect(adapter.requests).toHaveLength(3)
    const [workRequest, goRequest, bareRequest] = adapter.requests

    expect(systemMarkerValues(workRequest, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=GN-9'])
    expect(systemMarkerValues(workRequest, WORK_SNAPSHOT_MARKER)).toEqual([])

    expect(systemMarkerValues(goRequest, WORK_SNAPSHOT_MARKER)).toEqual(['WORK_SNAPSHOT=WS-9'])
    expect(systemMarkerValues(goRequest, GAME_NOTICE_MARKER)).toEqual([])

    expect(systemMarkerValues(bareRequest, GAME_NOTICE_MARKER)).toEqual([])
    expect(systemMarkerValues(bareRequest, WORK_SNAPSHOT_MARKER)).toEqual([])

    // No cross-agent leakage on any surface.
    expect(messageMarkerCount(workRequest, WORK_SNAPSHOT_MARKER)).toBe(0)
    expect(messageMarkerCount(goRequest, GAME_NOTICE_MARKER)).toBe(0)
    expect(messageMarkerCount(bareRequest, GAME_NOTICE_MARKER)).toBe(0)
    expect(messageMarkerCount(bareRequest, WORK_SNAPSHOT_MARKER)).toBe(0)

    report('9-cross-lane-isolation', trace)
  })

  it('11. production-like composition carries no `complete: true` section that suppresses the Bridge section', async () => {
    const adapter = new MockAdapter([textResponse('r1')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-precedence'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'PRECEDENCE', workSnapshot: undefined }
    registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('start'))
    await agent.whenIdle()

    const system = adapter.requests[0].system ?? ''
    // The harness-owned identity section AND the Bridge section are both
    // present: no complete section replaced the assembled section list.
    expect(system).toContain(HARNESS_IDENTITY)
    expect(system).toContain(GAME_NOTICE_MARKER + 'PRECEDENCE')

    report('11-precedence-positive', trace)

    // ---- Negative control: a complete section DOES suppress the Bridge.
    // This proves the gate would detect the hazard rather than pass silently.
    const controlAdapter = new MockAdapter([textResponse('r1')])
    const controlCtx = await harness(controlAdapter)
    const controlAgent = controlCtx.agentLoop.create(SessionId('d-s01f-precedence-neg'), { provider: 'mock', model: 'mock' })
    const controlTrace: TraceEntry[] = []
    observe(controlCtx, controlAgent, controlTrace)
    const controlHolder: BridgeHolder = { gameNotice: 'SUPPRESSED', workSnapshot: undefined }
    registerBridgeSection(controlAgent, controlHolder, 'work', controlTrace)
    controlAgent.ctx.systemPrompt.section({
      name: 'fixture:complete-override',
      order: 900,
      complete: true,
      text: 'COMPLETE_OVERRIDE_TEXT',
    })

    controlAgent.followup(messageText('start'))
    await controlAgent.whenIdle()

    const controlSystem = controlAdapter.requests[0].system ?? ''
    expect(controlSystem).toBe('COMPLETE_OVERRIDE_TEXT')
    expect(controlSystem).not.toContain(GAME_NOTICE_MARKER)
    expect(systemMarkerCount(controlAdapter.requests[0], GAME_NOTICE_MARKER)).toBe(0)

    report('11-precedence-negative-complete-suppression', controlTrace)
  })

  it('12. a later natural request after several historical requests renders only the current holder value', async () => {
    const adapter = new MockAdapter([
      textResponse('r1'), textResponse('r2'), textResponse('r3'), textResponse('r4'), textResponse('r5'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-resume'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'H1', workSnapshot: undefined }
    registerBridgeSection(agent, holder, 'work', trace)

    // Values are zero-padded to a fixed width so that no value is a prefix of
    // another (e.g. `H4` would otherwise match inside `H40`), which would make
    // the supersession assertion vacuous or falsely red.
    const pad = (n: number): string => 'H' + String(n).padStart(2, '0')
    for (let i = 1; i <= 4; i += 1) {
      holder.gameNotice = pad(i)
      agent.followup(messageText('turn-' + pad(i)))
      await agent.whenIdle()
    }
    expect(adapter.requests).toHaveLength(4)

    // Several historical request-header records now exist. A much later
    // natural request must still render only the CURRENT holder value.
    for (let i = 5; i <= 40; i += 1) holder.gameNotice = pad(i)
    agent.followup(messageText('later'))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(5)

    const later = adapter.requests[4]
    expect(systemMarkerValues(later, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=' + pad(40)])
    for (let i = 1; i <= 39; i += 1) {
      expect(systemMarkerCount(later, 'GAME_NOTICE=' + pad(i))).toBe(0)
    }
    // Historical request-header records never reintroduce old values as
    // model-facing messages.
    expect(totalMessageMarkerCount(adapter, GAME_NOTICE_MARKER)).toBe(0)

    report('12-later-natural-request', trace)
  })

  it('13. disposal: calling the returned disposer removes the contribution from later assemblies', async () => {
    const adapter = new MockAdapter([textResponse('r1'), textResponse('r2'), textResponse('r3')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('d-s01f-disposal'), { provider: 'mock', model: 'mock' })
    const trace: TraceEntry[] = []
    observe(ctx, agent, trace)
    const holder: BridgeHolder = { gameNotice: 'LIVE', workSnapshot: undefined }
    const handle = registerBridgeSection(agent, holder, 'work', trace)

    agent.followup(messageText('before'))
    await agent.whenIdle()
    expect(systemMarkerValues(adapter.requests[0], GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=LIVE'])

    // Actually exercise the disposer -- do not infer cleanup from its type.
    handle.dispose()
    await settle()
    const evaluationsAfterDispose = handle.stats.evaluations

    agent.followup(messageText('after'))
    await agent.whenIdle()
    const after = adapter.requests[1]
    expect(systemMarkerCount(after, GAME_NOTICE_MARKER)).toBe(0)
    expect(systemMarkerValues(after, GAME_NOTICE_MARKER)).toEqual([])
    expect(messageMarkerCount(after, GAME_NOTICE_MARKER)).toBe(0)
    // Disposal stops evaluation entirely; it is not merely hidden.
    expect(handle.stats.evaluations).toBe(evaluationsAfterDispose)
    // The rest of the system prompt survives disposal.
    expect(after.system).toContain(HARNESS_IDENTITY)

    report('13-disposal', [...trace, { event: 'diagnostics', detail: diagnostics(ctx, agent, adapter, handle.stats, GAME_NOTICE_MARKER) }])
  })

  it('NC. negative controls: the gate detects superseded material, and the `context` seam still FAILS latest-only', async () => {
    // NC-0: detector self-test -- the occurrence counter must flag a string
    // that carries two Bridge values. Without this the gate could pass by
    // measuring nothing.
    expect(occurrences('GAME_NOTICE=A GAME_NOTICE=B', GAME_NOTICE_MARKER)).toBe(2)
    expect(occurrences('GAME_NOTICE=A', GAME_NOTICE_MARKER)).toBe(1)
    expect(systemMarkerValues(
      { provider: 'mock', model: 'mock', messages: [], system: 'GAME_NOTICE=A\n\nGAME_NOTICE=B' },
      GAME_NOTICE_MARKER,
    )).toEqual(['GAME_NOTICE=A', 'GAME_NOTICE=B'])

    // NC-1: regression comparison. The already-FAILed `ctx.systemPrompt.context`
    // seam still accumulates superseded values in durable model messages, while
    // the `section` seam in the same harness does not. This proves the gate
    // distinguishes latest-only delivery from accumulation.
    const contextAdapter = new MockAdapter([textResponse('r1'), textResponse('r2')])
    const contextCtx = await harness(contextAdapter)
    const contextAgent = contextCtx.agentLoop.create(SessionId('d-s01f-nc-context'), { provider: 'mock', model: 'mock' })
    const contextTrace: TraceEntry[] = []
    observe(contextCtx, contextAgent, contextTrace)
    const contextHolder: BridgeHolder = { gameNotice: 'X1', workSnapshot: undefined }
    contextAgent.ctx.systemPrompt.context({
      name: 'companion-go:work-snapshot-context',
      order: 10,
      text: () => contextHolder.gameNotice === undefined ? '' : GAME_NOTICE_MARKER + contextHolder.gameNotice,
    })

    contextAgent.followup(messageText('first'))
    await contextAgent.whenIdle()
    contextHolder.gameNotice = 'X2'
    contextAgent.followup(messageText('second'))
    await contextAgent.whenIdle()

    const contextSecond = contextAdapter.requests[1]
    // The recorded D-S01 FAIL reproduces: both values are model-facing.
    expect(messageMarkerCount(contextSecond, 'GAME_NOTICE=X1')).toBe(1)
    expect(messageMarkerCount(contextSecond, 'GAME_NOTICE=X2')).toBe(1)
    expect(totalMessageMarkerCount(contextAdapter, GAME_NOTICE_MARKER)).toBeGreaterThanOrEqual(3)

    // NC-2: the section seam, on the identical A -> B sequence, keeps ZERO
    // durable occurrences and exactly one system occurrence.
    const sectionAdapter = new MockAdapter([textResponse('r1'), textResponse('r2')])
    const sectionCtx = await harness(sectionAdapter)
    const sectionAgent = sectionCtx.agentLoop.create(SessionId('d-s01f-nc-section'), { provider: 'mock', model: 'mock' })
    const sectionTrace: TraceEntry[] = []
    observe(sectionCtx, sectionAgent, sectionTrace)
    const sectionHolder: BridgeHolder = { gameNotice: 'X1', workSnapshot: undefined }
    registerBridgeSection(sectionAgent, sectionHolder, 'work', sectionTrace)

    sectionAgent.followup(messageText('first'))
    await sectionAgent.whenIdle()
    sectionHolder.gameNotice = 'X2'
    sectionAgent.followup(messageText('second'))
    await sectionAgent.whenIdle()

    const sectionSecond = sectionAdapter.requests[1]
    expect(messageMarkerCount(sectionSecond, 'GAME_NOTICE=X1')).toBe(0)
    expect(totalMessageMarkerCount(sectionAdapter, GAME_NOTICE_MARKER)).toBe(0)
    expect(systemMarkerValues(sectionSecond, GAME_NOTICE_MARKER)).toEqual(['GAME_NOTICE=X2'])

    report('NC-negative-controls', [...contextTrace, ...sectionTrace])
  })
})
