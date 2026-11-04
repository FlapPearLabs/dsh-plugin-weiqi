import type { LlmCallConfig, Message } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GoTurnBudget } from '../../src/contracts/budget.js'
import type { GameState, GoRulesPort, Point } from '../../src/contracts/rules.js'
import {
  createGoTurnEnforcement,
  type GoTurnEnforcement,
} from '../../src/budget/enforcement.js'
import { GoCapabilityGuard } from '../../src/runtime/go-capability-guard.js'
import { createTenukiGoRulesPort } from '../../src/rules/tenuki-adapter.js'
import { GO_TOOL_DEFINITIONS } from '../../src/tools/go/go-tools.js'
import { registerGoTools } from '../../src/tools/go/go-tool-registry.js'
import {
  BENCHMARK_FIXTURES,
  CANDIDATE_BUDGET,
  SPEC_38_CLASSES,
  benchmarkGameConfig,
  type BenchmarkFixture,
  type ScriptedToolCall,
  type Spec38FixtureClass,
} from './fixtures.js'
import {
  BENCHMARK_PROVIDER_ID,
  ScriptedLlmProvider,
} from './fake-provider.js'
import {
  BENCHMARK_GATE_DEFAULTS,
  BENCHMARK_PLACEHOLDER_PRICES,
  BenchmarkBudgetGate,
  BenchmarkBudgetStopError,
  estimateRequestInputTokens,
  type BenchmarkBudgetGateSnapshot,
  type BenchmarkBudgetStop,
  type BenchmarkGateConfig,
  type BenchmarkPriceSchedule,
} from './budget-gate.js'
import {
  openBenchmarkRequestPath,
  type BenchmarkRequestPathStats,
} from './llm-request-path.js'
import { SCRIPTED_MODEL_ID, SCRIPTED_PROPOSED_MAX_TOKENS } from './scripted-model.js'

/**
 * WAVE-C-T10 §38 harness.
 *
 * One run composes the production surfaces that already exist and never
 * re-implements them: the real Tenuki `GoRulesPort` (B-S01), the real `go.*`
 * registry behind `GoCapabilityGuard` (C-T01/C-T02), per-turn enforcement
 * (C-T07) with the bounded boost (C-T08), and the `agent/request` token cap
 * (C-S01). Model requests now leave through the real pinned `LlmRuntime`
 * (`prepareCall` → `llm/stream` → registered `LlmAdapter`), with a local
 * no-network provider standing in for DeepSeek.
 *
 * The AgentLoop step/turn lifecycle is the one stand-in: the concrete
 * `@deepseek-ai/dsh-agent-loop` package is not in this package's dependency
 * surface, so this harness assembles the same request contract itself. Every
 * benchmark-session spend/request gate is applied here, never in `src/`.
 */

export const REQUESTED_MODEL = SCRIPTED_MODEL_ID

const BENCHMARK_SYSTEM_PROMPT = [
  'You are the DeepSeek Go lane of a companion Go game.',
  'Read the position with go.inspect_*, probe with go.try_move, and commit exactly',
  'one authoritative go.play / go.pass / go.resign. Never search the web.',
].join(' ')

export class CognitionBenchmarkBypassError extends Error {
  readonly toolPath: string
  readonly counter: string

  constructor(toolPath: string, detail: string) {
    super(`Cognition benchmark enforcement bypass: ${toolPath}: ${detail}`)
    this.name = 'CognitionBenchmarkBypassError'
    this.toolPath = toolPath
    this.counter = detail
  }
}

export type BenchmarkRunMetrics = {
  readonly fixture: string
  readonly class: Spec38FixtureClass
  readonly outcome: 'completed' | 'budget_stop'
  readonly budgetStop: BenchmarkBudgetStop | null
  readonly latencyMs: number
  readonly stepLatenciesMs: readonly number[]
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly modelSteps: number
  readonly inspectCalls: number
  readonly tryMoveCalls: number
  readonly deepThinkRequests: number
  readonly deepThinkBoostConsumed: number
  readonly illegalAttempts: number
  readonly illegalAttemptReasons: readonly string[]
  readonly finalMove: string
  readonly committedAction: string | null
  readonly requestCaps: readonly number[]
  readonly oversizedProposalsClamped: number
  readonly turnTokens: number
  readonly remainingTurnTokens: number
  readonly requestPath: BenchmarkRequestPathStats
}

export type RunFixtureOptions = {
  readonly budget?: Partial<GoTurnBudget>
  readonly clock?: () => number
  /** Test-only seam used to prove that a bypass is detected. */
  readonly createEnforcement?: (budget: GoTurnBudget) => GoTurnEnforcement
  /** Shared benchmark-session gate; a fresh default gate is created when omitted. */
  readonly gate?: BenchmarkBudgetGate
  readonly gates?: Partial<BenchmarkGateConfig>
  readonly pricing?: BenchmarkPriceSchedule
  readonly createProvider?: (fixture: BenchmarkFixture, gameId: string) => ScriptedLlmProvider
}

type RecordingPort = {
  readonly port: GoRulesPort
  readonly committedMutations: string[]
}

function createRecordingPort(port: GoRulesPort): RecordingPort {
  const committedMutations: string[] = []
  const recording = new Proxy(port, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const result: unknown = (value as (...inner: unknown[]) => unknown).apply(target, args)
        if (
          (property === 'play' || property === 'pass' || property === 'resign')
          && typeof result === 'object'
          && result !== null
          && (result as { ok?: unknown }).ok === true
        ) {
          committedMutations.push(property)
        }
        return result
      }
    },
  })
  return { port: recording, committedMutations }
}

function playSetupStep(port: GoRulesPort, gameId: string, fixtureName: string, step: BenchmarkFixture['setup'][number]): void {
  const result = step.point === null
    ? port.pass(gameId, step.by)
    : port.play(gameId, step.by, step.point)

  if (!result.ok) {
    const point = step.point === null ? 'pass' : `(${step.point.x},${step.point.y})`
    throw new Error(
      `Benchmark fixture ${fixtureName} setup rejected ${step.by} ${point}: ${result.reason}`,
    )
  }
}

function formattedPoint(point: Point): string {
  return `(${point.x},${point.y})`
}

function finalMoveOf(action: BenchmarkFixture['expectedFinalAction']): string {
  return action.kind === 'pass' ? 'pass' : `play ${formattedPoint(action.point)}`
}

function isCommittedTool(tool: string): boolean {
  return tool === 'go.play' || tool === 'go.pass' || tool === 'go.resign'
}

type Snapshot = ReturnType<GoTurnEnforcement['snapshot']>

function assertAccounted(
  tool: string,
  before: Snapshot,
  after: Snapshot,
  result: unknown,
): void {
  switch (tool) {
    case 'go.inspect_group':
    case 'go.inspect_region':
      if (after.inspectCalls !== before.inspectCalls + 1) {
        throw new CognitionBenchmarkBypassError(tool, 'inspectCalls did not advance by one')
      }
      return
    case 'go.try_move':
      if (after.tryMoves !== before.tryMoves + 1) {
        throw new CognitionBenchmarkBypassError(tool, 'tryMoves did not advance by one')
      }
      return
    case 'go.request_deep_think':
      if (after.deepThinkRequests !== before.deepThinkRequests + 1) {
        throw new CognitionBenchmarkBypassError(
          tool,
          'deepThinkRequests did not advance by one',
        )
      }
      return
    case 'go.state':
      if (
        after.inspectCalls !== before.inspectCalls
        || after.tryMoves !== before.tryMoves
        || after.committedAction !== before.committedAction
      ) {
        throw new CognitionBenchmarkBypassError(tool, 'a read changed a gated counter')
      }
      return
    default: {
      if (!isCommittedTool(tool)) {
        throw new CognitionBenchmarkBypassError(tool, 'unknown tool reached the benchmark registry')
      }
      const accepted = typeof result === 'object'
        && result !== null
        && (result as { ok?: unknown }).ok === true
      if (!accepted) {
        if (after.committedAction !== before.committedAction) {
          throw new CognitionBenchmarkBypassError(tool, 'a rejected action committed the turn')
        }
        return
      }
      const expected = tool.slice('go.'.length)
      if (after.committedAction !== expected) {
        throw new CognitionBenchmarkBypassError(
          tool,
          `committedAction is ${String(after.committedAction)}, expected ${expected}`,
        )
      }
      return
    }
  }
}

function parseCallArguments(tool: string, rawArguments: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    throw new Error(`Benchmark tool call ${tool} carried non-JSON arguments: ${rawArguments}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Benchmark tool call ${tool} arguments must be a JSON object: ${rawArguments}`)
  }
  return parsed as Record<string, unknown>
}

function toolSchemas(): readonly { name: string; description: string; parameters: Record<string, unknown> }[] {
  return GO_TOOL_DEFINITIONS.map(definition => ({
    name: definition.name,
    description: definition.description,
    parameters: { ...definition.parameters },
  }))
}

export async function runFixture(
  fixture: BenchmarkFixture,
  options: RunFixtureOptions = {},
): Promise<BenchmarkRunMetrics> {
  const gameId = `benchmark-${fixture.name}`
  const basePort = createTenukiGoRulesPort()
  basePort.createGame(benchmarkGameConfig(gameId))
  for (const step of fixture.setup) playSetupStep(basePort, gameId, fixture.name, step)

  const position: GameState = basePort.getState(gameId)
  if (position.status !== 'playing' || position.toPlay !== 'deepseek') {
    throw new Error(
      `Benchmark fixture ${fixture.name} must hand DeepSeek a live position; got status=${position.status} toPlay=${position.toPlay}`,
    )
  }

  const { port, committedMutations } = createRecordingPort(basePort)
  const budget: GoTurnBudget = { ...CANDIDATE_BUDGET, ...options.budget }
  const enforcement = (options.createEnforcement ?? createGoTurnEnforcement)(budget)
  const registry = registerGoTools({ port, enforcement, guard: new GoCapabilityGuard() })
  const gate = options.gate ?? new BenchmarkBudgetGate(options.gates, options.pricing)
  gate.beginTurn()
  const provider = (options.createProvider ?? defaultProvider)(fixture, gameId)
  const path = await openBenchmarkRequestPath(provider)
  const clock = options.clock ?? (() => performance.now())
  const tools = toolSchemas()
  const messages: Message[] = [
    createUserMessage({
      content: [{ type: 'text', text: fixture.position }],
      source: { kind: 'user' },
    }),
  ]

  const startedAt = clock()
  const stepLatenciesMs: number[] = []
  const requestCaps: number[] = []
  const illegalAttemptReasons: string[] = []
  let inputTokens = 0
  let outputTokens = 0
  let oversizedProposalsClamped = 0
  let finalMove = 'none'
  let committed = false
  let stop: BenchmarkBudgetStop | null = null
  let requestPathStats: BenchmarkRequestPathStats

  try {
    for (let index = 0; index < provider.stepCount; index += 1) {
      const stepStart = clock()
      const modelStep = enforcement.beginModelStep()
      const resolvedRequest: LlmCallConfig = await enforcement.requestTokenCap(
        { turn: 1, step: modelStep.index },
        async () => ({
          provider: BENCHMARK_PROVIDER_ID,
          model: SCRIPTED_MODEL_ID,
          maxTokens: SCRIPTED_PROPOSED_MAX_TOKENS,
        }),
      )
      const proposedMaxTokens = resolvedRequest.maxTokens ?? 0
      const decision = gate.beginRequest({
        step: modelStep.index,
        estimatedInputTokens: estimateRequestInputTokens({
          system: BENCHMARK_SYSTEM_PROMPT,
          messages,
          tools,
        }),
        proposedMaxTokens,
        toolNames: tools.map(tool => tool.name),
      })
      requestCaps.push(decision.maxTokens)
      if (decision.maxTokens < SCRIPTED_PROPOSED_MAX_TOKENS) oversizedProposalsClamped += 1
      if (decision.maxTokens > budget.perRequestMaxTokens) {
        throw new CognitionBenchmarkBypassError(
          'agent/request',
          `token cap ${decision.maxTokens} exceeds perRequestMaxTokens ${budget.perRequestMaxTokens}`,
        )
      }

      const response = await path.request({
        fixture: fixture.name,
        step: modelStep.index,
        maxTokens: decision.maxTokens,
        system: BENCHMARK_SYSTEM_PROMPT,
        messages,
        tools,
      })
      inputTokens += response.usage.inputTokens
      outputTokens += response.usage.outputTokens
      modelStep.complete({ tokens: response.usage.inputTokens + response.usage.outputTokens })
      gate.completeRequest({ step: modelStep.index, usage: response.usage })

      const toolResults: { callId: (typeof response.toolCalls)[number]['id']; result: unknown; rejected: boolean }[] = []

      for (const call of response.toolCalls) {
        gate.assertToolCallAllowed(call.name, modelStep.index)
        const before = enforcement.snapshot()
        const args = parseCallArguments(call.name, call.rawArguments)
        const result = registry.invoke(call.name, args)
        const after = enforcement.snapshot()
        assertAccounted(call.name, before, after, result)

        const rejected = isCommittedTool(call.name)
          && (typeof result !== 'object' || result === null || (result as { ok?: unknown }).ok !== true)
        if (rejected) {
          const reason = (result as { reason?: unknown }).reason
          illegalAttemptReasons.push(`${call.name} ${String(reason)}`)
        }
        toolResults.push({ callId: call.id, result, rejected })

        if (after.committedAction !== before.committedAction) {
          committed = true
          finalMove = call.name === 'go.play'
            ? `play ${formattedPoint(args.point as Point)}`
            : call.name.slice('go.'.length)
          break
        }
      }

      messages.push(createAssistantMessage({
        content: response.toolCalls.map(call => ({
          type: 'tool-call' as const,
          id: call.id,
          name: call.name,
          arguments: call.rawArguments,
        })),
        source: { provider: BENCHMARK_PROVIDER_ID, model: SCRIPTED_MODEL_ID },
      }))
      for (const entry of toolResults) {
        messages.push(createToolResultMessage({
          callId: entry.callId,
          content: [{ type: 'text', text: JSON.stringify(entry.result) }],
          isError: entry.rejected,
        }))
      }

      stepLatenciesMs.push(clock() - stepStart)
      if (committed) break
    }
  } catch (error) {
    if (!(error instanceof BenchmarkBudgetStopError)) throw error
    stop = error.stop
  } finally {
    requestPathStats = path.stats()
    await path.dispose()
  }

  const latencyMs = clock() - startedAt
  const snapshot = enforcement.snapshot()

  if (stop === null) {
    const expectedCommitted = fixture.expectedFinalAction.kind === 'play' ? 'play' : 'pass'

    if (!committed || snapshot.committedAction !== expectedCommitted) {
      throw new Error(
        `Benchmark fixture ${fixture.name} did not commit ${expectedCommitted}; committedAction=${String(snapshot.committedAction)}`,
      )
    }
    if (finalMove !== finalMoveOf(fixture.expectedFinalAction)) {
      throw new Error(
        `Benchmark fixture ${fixture.name} final move ${finalMove} != expected ${finalMoveOf(fixture.expectedFinalAction)}`,
      )
    }
    if (committedMutations.length !== 1 || committedMutations[0] !== expectedCommitted) {
      throw new Error(
        `Benchmark fixture ${fixture.name} mutated the port ${JSON.stringify(committedMutations)}; expected exactly one ${expectedCommitted}`,
      )
    }

    const declaredInspects = fixture.steps.flatMap(step => step.calls).filter(
      call => call.tool === 'go.inspect_group' || call.tool === 'go.inspect_region',
    ).length
    const declaredTryMoves = fixture.steps.flatMap(step => step.calls).filter(
      call => call.tool === 'go.try_move',
    ).length
    const declaredDeepThink = fixture.steps.flatMap(step => step.calls).filter(
      call => call.tool === 'go.request_deep_think',
    ).length
    if (snapshot.inspectCalls !== declaredInspects) {
      throw new CognitionBenchmarkBypassError(
        'go.inspect_*',
        `enforcement counted ${snapshot.inspectCalls}, script issued ${declaredInspects}`,
      )
    }
    if (snapshot.tryMoves !== declaredTryMoves) {
      throw new CognitionBenchmarkBypassError(
        'go.try_move',
        `enforcement counted ${snapshot.tryMoves}, script issued ${declaredTryMoves}`,
      )
    }
    if (snapshot.deepThinkRequests !== declaredDeepThink) {
      throw new CognitionBenchmarkBypassError(
        'go.request_deep_think',
        `enforcement counted ${snapshot.deepThinkRequests}, script issued ${declaredDeepThink}`,
      )
    }
    if (snapshot.modelSteps !== provider.stepCount) {
      throw new CognitionBenchmarkBypassError(
        'model_step',
        `enforcement counted ${snapshot.modelSteps}, provider issued ${provider.stepCount}`,
      )
    }
    if (illegalAttemptReasons.length !== fixture.expectedIllegalAttempts) {
      throw new Error(
        `Benchmark fixture ${fixture.name} recorded ${illegalAttemptReasons.length} illegal attempts, expected ${fixture.expectedIllegalAttempts}`,
      )
    }
  }

  return Object.freeze({
    fixture: fixture.name,
    class: fixture.class,
    outcome: stop === null ? 'completed' : 'budget_stop',
    budgetStop: stop,
    latencyMs,
    stepLatenciesMs: Object.freeze(stepLatenciesMs),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    modelSteps: snapshot.modelSteps,
    inspectCalls: snapshot.inspectCalls,
    tryMoveCalls: snapshot.tryMoves,
    deepThinkRequests: snapshot.deepThinkRequests,
    deepThinkBoostConsumed: snapshot.deepThinkBoost.consumedModelSteps,
    illegalAttempts: illegalAttemptReasons.length,
    illegalAttemptReasons: Object.freeze(illegalAttemptReasons),
    finalMove,
    committedAction: snapshot.committedAction ?? null,
    requestCaps: Object.freeze(requestCaps),
    oversizedProposalsClamped,
    turnTokens: snapshot.turnTokens,
    remainingTurnTokens: enforcement.remainingTurnTokens(),
    requestPath: requestPathStats,
  })
}

function defaultProvider(fixture: BenchmarkFixture, gameId: string): ScriptedLlmProvider {
  return new ScriptedLlmProvider(fixture, gameId)
}

export type NumericVariation = {
  readonly min: number
  readonly max: number
  readonly mean: number
  readonly range: number
}

export type FixtureVariation = {
  readonly identicalStructuralMetrics: boolean
  readonly comparedFields: readonly string[]
  readonly latencyMs: NumericVariation
  readonly inputTokens: NumericVariation
  readonly outputTokens: NumericVariation
  readonly totalTokens: NumericVariation
  readonly modelSteps: NumericVariation
  readonly inspectCalls: NumericVariation
  readonly tryMoveCalls: NumericVariation
  readonly deepThinkRequests: NumericVariation
  readonly illegalAttempts: NumericVariation
}

const COMPARED_FIELDS = [
  'outcome',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'modelSteps',
  'inspectCalls',
  'tryMoveCalls',
  'deepThinkRequests',
  'illegalAttempts',
  'finalMove',
  'committedAction',
  'requestCaps',
  'turnTokens',
  'remainingTurnTokens',
  'requestPath',
] as const

function variationOf(values: readonly number[]): NumericVariation {
  if (values.length === 0) throw new Error('variation requires at least one run')
  const min = Math.min(...values)
  const max = Math.max(...values)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { min, max, mean, range: max - min }
}

function structuralFingerprint(run: BenchmarkRunMetrics): string {
  const comparable: Record<string, unknown> = {}
  for (const field of COMPARED_FIELDS) comparable[field] = run[field]
  return JSON.stringify(comparable)
}

export function summarizeVariation(runs: readonly BenchmarkRunMetrics[]): FixtureVariation {
  const first = runs[0]
  if (first === undefined) throw new Error('variation requires at least one run')
  const fingerprint = structuralFingerprint(first)
  return {
    identicalStructuralMetrics: runs.every(run => structuralFingerprint(run) === fingerprint),
    comparedFields: [...COMPARED_FIELDS],
    latencyMs: variationOf(runs.map(run => run.latencyMs)),
    inputTokens: variationOf(runs.map(run => run.inputTokens)),
    outputTokens: variationOf(runs.map(run => run.outputTokens)),
    totalTokens: variationOf(runs.map(run => run.totalTokens)),
    modelSteps: variationOf(runs.map(run => run.modelSteps)),
    inspectCalls: variationOf(runs.map(run => run.inspectCalls)),
    tryMoveCalls: variationOf(runs.map(run => run.tryMoveCalls)),
    deepThinkRequests: variationOf(runs.map(run => run.deepThinkRequests)),
    illegalAttempts: variationOf(runs.map(run => run.illegalAttempts)),
  }
}

export type FixtureRecord = {
  readonly fixture: string
  readonly class: Spec38FixtureClass
  readonly position: string
  readonly runs: readonly BenchmarkRunMetrics[]
  readonly variation: FixtureVariation
}

export type ClassRecord = {
  readonly class: Spec38FixtureClass
  readonly fixtures: readonly FixtureRecord[]
}

export type BenchmarkRecord = {
  readonly recordKind: 'cognition-benchmark'
  readonly specSection: '§38'
  readonly ticket: 'WAVE-C-T10'
  readonly generatedAt: string
  readonly model: {
    readonly kind: 'scripted-deterministic'
    readonly id: typeof SCRIPTED_MODEL_ID
    readonly provider: typeof BENCHMARK_PROVIDER_ID
    readonly requestPath: 'dsh-llm-runtime'
    readonly isDeepSeek: false
    readonly disclosure: string
  }
  readonly budgetUnderTest: GoTurnBudget & {
    readonly status: 'candidate-not-applied'
    readonly hardCaps: readonly string[]
    readonly note: string
  }
  readonly budgetGate: BenchmarkBudgetGateSnapshot
  readonly runsPerFixture: number
  readonly classes: readonly ClassRecord[]
}

export type BuildRecordOptions = {
  readonly runs?: number
  readonly clock?: () => number
  readonly now?: () => Date
  readonly budget?: GoTurnBudget
  readonly fixtures?: readonly BenchmarkFixture[]
  readonly gate?: BenchmarkBudgetGate
  readonly gates?: Partial<BenchmarkGateConfig>
  readonly pricing?: BenchmarkPriceSchedule
}

const HARD_CAPS = Object.freeze([
  'perRequestMaxTokens (Spec §22.1 absolute per-request hard cap, C-S01)',
  'maxTurnTokens (Spec §22.2 turn ceiling)',
  'maxModelSteps (Spec §22.2 per-turn model-step cap)',
  'maxInspectCalls (Spec §22.3 per-turn inspect cap)',
  'maxTryMoves (Spec §22.3 per-turn try_move cap)',
])

export async function buildBenchmarkRecord(
  options: BuildRecordOptions = {},
): Promise<BenchmarkRecord> {
  const runsPerFixture = options.runs ?? 3
  const now = options.now ?? (() => new Date())
  const fixtures = options.fixtures ?? BENCHMARK_FIXTURES
  const budget = options.budget ?? CANDIDATE_BUDGET
  const gate = options.gate ?? new BenchmarkBudgetGate(options.gates, options.pricing)

  const classes: ClassRecord[] = []
  for (const fixtureClass of SPEC_38_CLASSES) {
    const classFixtures = fixtures.filter(fixture => fixture.class === fixtureClass)
    const records: FixtureRecord[] = []
    for (const fixture of classFixtures) {
      const runs: BenchmarkRunMetrics[] = []
      for (let run = 0; run < runsPerFixture; run += 1) {
        runs.push(await runFixture(fixture, {
          budget,
          gate,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
        }))
      }
      records.push({
        fixture: fixture.name,
        class: fixture.class,
        position: fixture.position,
        runs,
        variation: summarizeVariation(runs),
      })
    }
    classes.push({ class: fixtureClass, fixtures: records })
  }

  return {
    recordKind: 'cognition-benchmark',
    specSection: '§38',
    ticket: 'WAVE-C-T10',
    generatedAt: now().toISOString(),
    model: {
      kind: 'scripted-deterministic',
      id: SCRIPTED_MODEL_ID,
      provider: BENCHMARK_PROVIDER_ID,
      requestPath: 'dsh-llm-runtime',
      isDeepSeek: false,
      disclosure:
        'Requests now leave through the real pinned @deepseek-ai/dsh-llm LlmRuntime '
        + '(provider registry, prepareCall, llm/stream waterfall, LlmAdapter.stream, '
        + 'BlockAssembler), with a local no-network provider standing in for DeepSeek. '
        + 'The dsh-agent-loop package is not installed in this repository, so the '
        + 'step/turn driver is a documented stand-in for it. Token counts and moves are '
        + 'scripted synthetic values, never DeepSeek usage; latency is local harness '
        + 'wall-clock. These numbers cannot calibrate production token caps; a real '
        + 'DeepSeek run still needs owner approval, credentials, and a real price schedule.',
    },
    budgetUnderTest: {
      ...budget,
      status: 'candidate-not-applied',
      hardCaps: HARD_CAPS,
      note:
        'Candidate values only. src/budget/ production defaults were not changed by this ticket; no production GoTurnBudget config exists yet.',
    },
    budgetGate: gate.snapshot(),
    runsPerFixture,
    classes,
  }
}

export { BENCHMARK_GATE_DEFAULTS, BENCHMARK_PLACEHOLDER_PRICES }
