import type { GoTurnBudget } from '../../src/contracts/budget.js'
import type {
  BenchmarkBudgetGateSnapshot,
  BenchmarkPriceSchedule,
} from './budget-gate.js'

/**
 * Owner-approved round envelope for the C-T10 live calibration. The smoke run
 * and the full 24-turn run are separate processes with separate gates, so the
 * two caps are kept separate and their sum stays inside the approved total.
 */
export const C_T10_ROUND_BUDGET_CNY = 6.66
export const C_T10_SMOKE_BUDGET_CNY = 0.5
export const C_T10_FULL_BUDGET_CNY = 6.16

/**
 * WAVE-C-T10 live calibration records.
 *
 * The benchmark harness already aggregates one turn into `BenchmarkRunMetrics`.
 * Calibration needs one level lower: the provider's `usage` object for every
 * single request, kept verbatim, so each mean / P95 in the report can be traced
 * back to a wire response. This module owns those records, the distributions
 * computed from them, the derived `GoTurnBudget` recommendation, and the
 * Markdown rendering.
 *
 * Everything here is pure: the paid runner only collects observations and
 * writes the raw JSON; the report can be re-rendered from that JSON without
 * spending another token.
 */

export type CalibrationUsage = Readonly<{
  /** Uncached input tokens (the unit the turn budget charges). */
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  /** `inputTokens + outputTokens`; cache reads are reported separately. */
  readonly totalTokens: number
}>

export type RawUsage = Readonly<Record<string, unknown>>

export type CalibrationRequestRecord = Readonly<{
  readonly id: string
  readonly turnId: string
  readonly fixture: string
  readonly class: string
  readonly run: number
  /** 1-based model step inside this turn. */
  readonly step: number
  /** 1-based request index across the whole calibration session. */
  readonly requestIndex: number
  readonly endpoint: string
  readonly configuredModel: string
  readonly reportedModel: string | null
  readonly wireFormat: 'sse' | 'json'
  readonly httpStatus: number
  /** `max_tokens` the wire request carried after the C-S01 cap. */
  readonly requestedMaxTokens: number | null
  readonly startedAtMs: number
  readonly finishedAtMs: number
  readonly latencyMs: number
  readonly finishReason: string | null
  /** The provider's own usage object, verbatim; null when it sent none. */
  readonly rawUsage: RawUsage | null
  readonly usage: CalibrationUsage
}>

export type CalibrationTurnOutcome = 'completed' | 'budget_stop' | 'failed'

export type CalibrationTurnRecord = Readonly<{
  readonly id: string
  readonly fixture: string
  readonly class: string
  readonly run: number
  readonly outcome: CalibrationTurnOutcome
  readonly error: string | null
  readonly latencyMs: number
  readonly modelSteps: number
  readonly inspectCalls: number
  readonly tryMoveCalls: number
  readonly deepThinkRequests: number
  readonly committedAction: string | null
  readonly finalMove: string
  readonly requests: number
  /** Adapter retries recorded for this turn; null when no stats could be read. */
  readonly retryAttempts: number | null
  readonly failureKinds: readonly string[]
  readonly stopGate: string | null
  readonly usage: CalibrationUsage
}>

export type CalibrationCaps = Readonly<{
  readonly maxRequests: number
  readonly maxInputTokensPerRequest: number
  readonly maxOutputTokensPerRequest: number
  readonly maxEstimatedCostCny: number
  readonly usdToCnyRate: number
}>

export type CalibrationDataset = Readonly<{
  readonly schema: 'c-t10-live-calibration'
  readonly version: 1
  readonly ticket: 'WAVE-C-T10'
  readonly generatedAt: string
  readonly endpoint: string
  readonly model: string
  readonly providerMode: 'live'
  readonly priceSchedule: BenchmarkPriceSchedule
  readonly caps: CalibrationCaps
  /**
   * The turn budget enforced during this measurement. It is deliberately wider
   * than the candidate under calibration: a run capped at the candidate would
   * stop after the first prompt and measure the cap instead of the model. The
   * candidate is derived from the completed turns and rendered below.
   */
  readonly turnBudget: GoTurnBudget
  readonly session: Readonly<{
    readonly startedAt: string
    readonly finishedAt: string
    readonly wallMs: number
    readonly gate: BenchmarkBudgetGateSnapshot
  }>
  readonly turns: readonly CalibrationTurnRecord[]
  readonly requests: readonly CalibrationRequestRecord[]
}>

/** One completed HTTP request, before it is given its session index/id. */
export type CalibrationObservation = Readonly<{
  readonly turnId: string
  readonly fixture: string
  readonly class: string
  readonly run: number
  readonly step: number
  readonly endpoint: string
  readonly configuredModel: string
  readonly reportedModel: string | null
  readonly wireFormat: 'sse' | 'json'
  readonly httpStatus: number
  readonly requestedMaxTokens: number | null
  readonly startedAtMs: number
  readonly finishedAtMs: number
  readonly latencyMs: number
  readonly finishReason: string | null
  readonly rawUsage: unknown
  readonly usage: Readonly<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  }>
}>

export function emptyUsage(): CalibrationUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }
}

export function sumUsage(usages: readonly CalibrationUsage[]): CalibrationUsage {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  for (const usage of usages) {
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    cacheReadTokens += usage.cacheReadTokens
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens,
  }
}

export function usageFromProviderUsage(usage: CalibrationObservation['usage']): CalibrationUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    totalTokens: usage.inputTokens + usage.outputTokens,
  }
}

function rawUsageOf(value: unknown): RawUsage | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.freeze({ ...(value as Record<string, unknown>) })
    : null
}

/** Turn an observer record into the persisted request record. */
export function toRequestRecord(
  observation: CalibrationObservation,
  requestIndex: number,
): CalibrationRequestRecord {
  const usage = usageFromProviderUsage(observation.usage)
  return Object.freeze({
    id: `${observation.turnId}-S${observation.step}`,
    turnId: observation.turnId,
    fixture: observation.fixture,
    class: observation.class,
    run: observation.run,
    step: observation.step,
    requestIndex,
    endpoint: observation.endpoint,
    configuredModel: observation.configuredModel,
    reportedModel: observation.reportedModel,
    wireFormat: observation.wireFormat,
    httpStatus: observation.httpStatus,
    requestedMaxTokens: observation.requestedMaxTokens,
    startedAtMs: observation.startedAtMs,
    finishedAtMs: observation.finishedAtMs,
    latencyMs: observation.latencyMs,
    finishReason: observation.finishReason,
    rawUsage: rawUsageOf(observation.rawUsage),
    usage,
  })
}

export function requestUsageOf(requests: readonly CalibrationRequestRecord[]): CalibrationUsage {
  return sumUsage(requests.map(request => request.usage))
}

/**
 * Assemble and validate the dataset. The validation is deliberately strict:
 * a request whose turn is missing, a duplicate id, or a turn total that does
 * not equal the sum of its requests would make the report untraceable.
 */
export function buildCalibrationDataset(args: Readonly<{
  generatedAt: string
  endpoint: string
  model: string
  priceSchedule: BenchmarkPriceSchedule
  caps: CalibrationCaps
  turnBudget: GoTurnBudget
  session: CalibrationDataset['session']
  turns: readonly CalibrationTurnRecord[]
  requests: readonly CalibrationRequestRecord[]
}>): CalibrationDataset {
  const turnIds = new Set<string>()
  for (const turn of args.turns) {
    if (turnIds.has(turn.id)) throw new Error(`duplicate calibration turn id ${turn.id}`)
    turnIds.add(turn.id)
  }
  const requestIds = new Set<string>()
  for (const request of args.requests) {
    if (requestIds.has(request.id)) throw new Error(`duplicate calibration request id ${request.id}`)
    requestIds.add(request.id)
    if (!turnIds.has(request.turnId)) {
      throw new Error(`calibration request ${request.id} names unknown turn ${request.turnId}`)
    }
  }
  for (const turn of args.turns) {
    const requests = args.requests.filter(request => request.turnId === turn.id)
    const expected = requestUsageOf(requests)
    if (
      expected.inputTokens !== turn.usage.inputTokens
      || expected.outputTokens !== turn.usage.outputTokens
      || expected.cacheReadTokens !== turn.usage.cacheReadTokens
      || expected.totalTokens !== turn.usage.totalTokens
    ) {
      throw new Error(
        `calibration turn ${turn.id} usage does not match its ${requests.length} request record(s)`,
      )
    }
    if (turn.requests !== requests.length) {
      throw new Error(
        `calibration turn ${turn.id} says ${turn.requests} request(s), recorded ${requests.length}`,
      )
    }
  }

  return Object.freeze({
    schema: 'c-t10-live-calibration' as const,
    version: 1 as const,
    ticket: 'WAVE-C-T10' as const,
    generatedAt: args.generatedAt,
    endpoint: args.endpoint,
    model: args.model,
    providerMode: 'live' as const,
    priceSchedule: args.priceSchedule,
    caps: args.caps,
    turnBudget: Object.freeze({ ...args.turnBudget }),
    session: args.session,
    turns: Object.freeze([...args.turns]),
    requests: Object.freeze([...args.requests]),
  })
}

export type Distribution = Readonly<{
  readonly count: number
  readonly sum: number
  readonly mean: number
  readonly min: number
  readonly p50: number
  readonly p95: number
  readonly max: number
}>

/**
 * Nearest-rank percentile: P95 of n samples is the
 * `ceil(0.95 * n)`-th smallest value. With 24 turns that is the 23rd order
 * statistic, not an interpolated value, so each number names a real sample.
 */
export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { count: 0, sum: 0, mean: 0, min: 0, p50: 0, p95: 0, max: 0 }
  }
  const sorted = [...values].sort((left, right) => left - right)
  const sum = sorted.reduce((total, value) => total + value, 0)
  const at = (percentile: number): number => {
    const rank = Math.max(1, Math.ceil(percentile * sorted.length))
    return sorted[rank - 1] ?? sorted[sorted.length - 1] ?? 0
  }
  return {
    count: sorted.length,
    sum,
    mean: sum / sorted.length,
    min: sorted[0] ?? 0,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

export type CalibrationSummary = Readonly<{
  readonly turns: number
  readonly completedTurns: number
  readonly failedTurns: number
  readonly budgetStops: number
  readonly requests: Readonly<{
    readonly count: number
    readonly inputTokens: Distribution
    readonly outputTokens: Distribution
    readonly totalTokens: Distribution
    readonly cacheReadTokens: Distribution
    readonly latencyMs: Distribution
  }>
  readonly perTurn: Readonly<{
    readonly count: number
    readonly inputTokens: Distribution
    readonly outputTokens: Distribution
    readonly totalTokens: Distribution
    readonly cacheReadTokens: Distribution
    readonly latencyMs: Distribution
    readonly requests: Distribution
  }>
  readonly session: Readonly<{
    readonly requests: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly totalTokens: number
    readonly wallMs: number
    readonly estimatedCostUsd: number
    readonly estimatedCostCny: number
  }>
  readonly failures: readonly { readonly kind: string; readonly count: number }[]
  /** Failed-turn causes read back from `turns[].error`. */
  readonly failureCauses: readonly { readonly cause: FailureCause; readonly count: number }[]
  readonly retries: number
  /** Turns whose record carries no retry statistic (null, not zero). */
  readonly retriesUnknownTurns: number
  readonly finishReasons: readonly { readonly reason: string; readonly count: number }[]
  readonly reportedModels: readonly string[]
}>

function counts(values: readonly string[]): readonly { value: string; count: number }[] {
  const tally = new Map<string, number>()
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)
  return [...tally.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ value, count }))
}

export type FailureCause =
  | 'request-path retry'
  | `enforcement bypass: ${string}`
  | `budget exhausted: ${string}`
  | 'step exhausted'
  | 'network error'
  | 'other'

/**
 * Classify a failed turn from its recorded `error`. `failureKinds` on a failed
 * turn is only the coarse `run-failed` fallback, so the cause has to be read
 * back from the message the turn actually failed with.
 *
 * The enforcement-bypass prefix alone is not a verdict: after the per-turn
 * counter fix it also covers real request-path retries, token-cap overruns and
 * tool-accounting mismatches. Only the request-path retry sentence is read as a
 * retry; every other bypass keeps its `toolPath` so the report names the
 * counter that disagreed.
 *
 * A `Go turn budget exhausted: <counter> (n/n)` message names the counter that
 * ran out, so each one is reported instead of being collected under `other`.
 * The live driver's "did not commit ... within N model steps" message is a
 * step exhaustion too, but it does not name a budget counter.
 */
export function failureCauseOf(error: string | null | undefined): FailureCause {
  const text = error ?? ''
  if (/\d+ transport attempts for \d+ admitted requests/i.test(text)) return 'request-path retry'
  const bypass = /Cognition benchmark enforcement bypass:\s*([^:]+):/i.exec(text)
  if (bypass !== null) {
    const toolPath = bypass[1]?.trim()
    if (toolPath !== undefined && toolPath !== '') return `enforcement bypass: ${toolPath}`
  }
  const exhausted = /Go turn budget exhausted:\s*([A-Za-z][A-Za-z0-9]*)/i.exec(text)
  if (exhausted !== null) {
    const counter = exhausted[1]
    if (counter !== undefined) return `budget exhausted: ${counter}`
  }
  if (/did not commit a legal move within \d+ model steps/i.test(text)) return 'step exhausted'
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EPIPE|UND_ERR|NETWORK/i.test(text)) {
    return 'network error'
  }
  return 'other'
}

export function summarizeCalibration(dataset: CalibrationDataset): CalibrationSummary {
  const completed = dataset.turns.filter(turn => turn.outcome === 'completed')
  const completedIds = new Set(completed.map(turn => turn.id))
  const completedRequests = dataset.requests.filter(request => completedIds.has(request.turnId))
  const turnUsage = completed.map(turn => turn.usage)
  const allUsage = dataset.requests.map(request => request.usage)

  const failures = counts(dataset.turns.flatMap(turn => [...turn.failureKinds]))
  const failureCauses = counts(
    dataset.turns
      .filter(turn => turn.outcome === 'failed')
      .map(turn => failureCauseOf(turn.error)),
  ).map(entry => ({ cause: entry.value as FailureCause, count: entry.count }))
  const finishReasons = counts(
    dataset.requests.map(request => request.finishReason ?? 'unknown'),
  )
  const reportedModels = [...new Set(
    dataset.requests
      .map(request => request.reportedModel)
      .filter((model): model is string => model !== null && model !== ''),
  )].sort()

  return {
    turns: dataset.turns.length,
    completedTurns: completed.length,
    failedTurns: dataset.turns.filter(turn => turn.outcome === 'failed').length,
    budgetStops: dataset.turns.filter(turn => turn.outcome === 'budget_stop').length,
    requests: {
      count: dataset.requests.length,
      inputTokens: distribution(dataset.requests.map(request => request.usage.inputTokens)),
      outputTokens: distribution(dataset.requests.map(request => request.usage.outputTokens)),
      totalTokens: distribution(dataset.requests.map(request => request.usage.totalTokens)),
      cacheReadTokens: distribution(dataset.requests.map(request => request.usage.cacheReadTokens)),
      latencyMs: distribution(dataset.requests.map(request => request.latencyMs)),
    },
    perTurn: {
      count: completed.length,
      inputTokens: distribution(turnUsage.map(usage => usage.inputTokens)),
      outputTokens: distribution(turnUsage.map(usage => usage.outputTokens)),
      totalTokens: distribution(turnUsage.map(usage => usage.totalTokens)),
      cacheReadTokens: distribution(turnUsage.map(usage => usage.cacheReadTokens)),
      latencyMs: distribution(completed.map(turn => turn.latencyMs)),
      requests: distribution(completed.map(turn => turn.requests)),
    },
    session: {
      requests: dataset.requests.length,
      inputTokens: sumUsage(allUsage).inputTokens,
      outputTokens: sumUsage(allUsage).outputTokens,
      cacheReadTokens: sumUsage(allUsage).cacheReadTokens,
      totalTokens: sumUsage(allUsage).totalTokens,
      wallMs: dataset.session.wallMs,
      estimatedCostUsd: dataset.session.gate.estimatedCostUsd,
      estimatedCostCny: dataset.session.gate.estimatedCostCny,
    },
    failures: failures.map(entry => ({ kind: entry.value, count: entry.count })),
    failureCauses,
    retries: dataset.turns.reduce((total, turn) => total + (turn.retryAttempts ?? 0), 0),
    retriesUnknownTurns: dataset.turns.filter(turn => turn.retryAttempts === null).length,
    finishReasons: finishReasons.map(entry => ({ reason: entry.value, count: entry.count })),
    reportedModels,
  }
}

export type CalibrationRecommendation = Readonly<{
  readonly perRequestMaxTokens: number
  readonly maxTurnTokens: number
  readonly maxModelSteps: number
  readonly maxInspectCalls: number
  readonly maxTryMoves: number
  readonly basis: Readonly<{
    readonly maxOutputTokensPerRequest: number
    readonly maxTurnTotalTokens: number
    readonly maxModelStepsObserved: number
    /** Which turn(s) produced that maximum and how each number was read. */
    readonly maxModelStepsObservedBasis: string
    readonly maxInspectCallsObserved: number
    readonly maxTryMovesObserved: number
    readonly requestTokenCeiling: number
    readonly completedTurns: number
    readonly safetyFactor: number
    readonly perRequestFormula: string
    readonly perRequestSafetyFactor: number
    /** Ceilings that a failed turn actually exhausted, by counter. */
    readonly exhaustedCeilings: Readonly<Partial<Record<GoTurnBudgetCounterField, number>>>
  }>
  readonly warnings: readonly string[]
}>

/** The four counters `createGoTurnEnforcement` can exhaust. */
export type GoTurnBudgetCounterField =
  | 'maxModelSteps'
  | 'maxInspectCalls'
  | 'maxTryMoves'
  | 'maxTurnTokens'

export type ExhaustedCounter = Readonly<{
  readonly field: GoTurnBudgetCounterField
  readonly used: number
  readonly limit: number
}>

const COUNTER_FIELDS: readonly GoTurnBudgetCounterField[] = [
  'maxModelSteps',
  'maxInspectCalls',
  'maxTryMoves',
  'maxTurnTokens',
]

const BUDGET_EXHAUSTED_RE = /Go turn budget exhausted:\s*([A-Za-z][A-Za-z0-9]*)[^()]*\((\d+)\/(\d+)\)/i
const STEP_LIMIT_RE = /did not commit a legal move within (\d+) model steps/i

function isCounterField(value: string): value is GoTurnBudgetCounterField {
  return (COUNTER_FIELDS as readonly string[]).includes(value)
}

/**
 * Read the counters that failed turns exhausted, with the ceiling in force at
 * the time. The ceiling in the message wins over today's configured budget:
 * the run measured what it hit, not what the repository config says now.
 */
export function exhaustedCounters(
  turns: readonly CalibrationTurnRecord[],
): readonly ExhaustedCounter[] {
  const found = new Map<GoTurnBudgetCounterField, ExhaustedCounter>()
  const record = (field: GoTurnBudgetCounterField, used: number, limit: number): void => {
    const previous = found.get(field)
    if (previous === undefined || previous.limit < limit) {
      found.set(field, { field, used, limit })
    }
  }

  for (const turn of turns) {
    const text = turn.error ?? ''
    const budget = BUDGET_EXHAUSTED_RE.exec(text)
    if (budget !== null) {
      const field = budget[1]
      const used = Number(budget[2])
      const limit = Number(budget[3])
      if (
        field !== undefined
        && isCounterField(field)
        && Number.isFinite(used)
        && Number.isFinite(limit)
        && limit > 0
      ) {
        record(field, used, limit)
      }
    }
    const steps = STEP_LIMIT_RE.exec(text)
    if (steps !== null) {
      const limit = Number(steps[1])
      if (Number.isFinite(limit) && limit > 0) record('maxModelSteps', limit, limit)
    }
  }

  return [...found.values()]
}

function floorAtCeiling(value: number, ceiling: number | null): number {
  return ceiling === null ? value : Math.max(value, ceiling + 1)
}

function roundUpTo(value: number, unit: number): number {
  return Math.ceil(value / unit) * unit
}

function maxOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values)
}

/**
 * Model steps a turn actually walked, and where the number came from.
 *
 * Completed and budget-stopped turns carry the harness step counter. A failed
 * turn is persisted by the runner with `modelSteps: 0`, which is a placeholder
 * rather than a measurement. The adapter makes one request per model step, so
 * that turn's recorded request count is the step observation it leaves behind;
 * it is used as such instead of being read as zero, and the report names the
 * source.
 */
function observedSteps(
  turn: CalibrationTurnRecord,
): Readonly<{ steps: number; source: 'modelSteps' | 'requests' }> {
  return turn.modelSteps > 0
    ? { steps: turn.modelSteps, source: 'modelSteps' }
    : { steps: turn.requests, source: 'requests' }
}

/**
 * Derive candidate token caps from completed turns.
 *
 * - `perRequestMaxTokens`: 1.5x the largest observed output, rounded up to 64,
 *   floor 512. If any response hit its `max_tokens` ceiling (or finished with
 *   `length`), the observation is censored: double the ceiling and warn.
 * - `maxTurnTokens`: 1.5x the largest observed turn total (uncached input +
 *   output, the same unit `createGoTurnEnforcement` charges), rounded up to
 *   256, floor 1024. A ceiling floor is rounded to the same 256 grid.
 * - `maxModelSteps`: the largest step count any completed or failed turn
 *   walked. A failed turn records `modelSteps: 0`, so its request count (one
 *   request per model step) is used and named in the basis. One step of
 *   headroom is added when a step ceiling was exhausted or when that maximum
 *   came from a failed turn, because a failed turn never showed how many steps
 *   a committed move needed.
 * - counters: observed maximum plus one step of headroom, never below the
 *   structural candidate (3/4/3). A counter that any turn exhausted is
 *   censored: the candidate is floored at that ceiling + 1 and a warning asks
 *   for a re-measurement, because a completed turn that never hit the ceiling
 *   cannot show how far past it the turn needed to go.
 *
 * The 1.5 factor is the safety margin for the same position being read with
 * slightly different tool arguments; it is not a claim about the distribution.
 */
export function deriveCalibrationRecommendation(
  dataset: CalibrationDataset,
  summary: CalibrationSummary,
): CalibrationRecommendation {
  const completed = dataset.turns.filter(turn => turn.outcome === 'completed')
  const maxOutput = summary.requests.outputTokens.max
  const maxTurnTotal = summary.perTurn.totalTokens.max
  const stepObservations = dataset.turns
    .filter(turn => turn.outcome === 'completed' || turn.outcome === 'failed')
    .map(turn => ({ turn, ...observedSteps(turn) }))
  const maxSteps = maxOf(stepObservations.map(observation => observation.steps))
  const maxStepObservations = stepObservations
    .filter(observation => observation.steps === maxSteps)
  const stepObservationBasis = maxStepObservations.length === 0
    ? 'no turn recorded a step'
    : maxStepObservations
      .map(observation => (observation.source === 'modelSteps'
        ? `${observation.turn.id} reported ${observation.steps} model steps`
        : `${observation.turn.id} has no step record; its ${observation.steps} requests are one step each`))
      .join('; ')
  const maxInspect = maxOf(completed.map(turn => turn.inspectCalls))
  const maxTry = maxOf(completed.map(turn => turn.tryMoveCalls))
  const requestedMaxes = dataset.requests
    .map(request => request.requestedMaxTokens)
    .filter((value): value is number => value !== null)
  const requestCeiling = maxOf(requestedMaxes)

  const censored = dataset.requests.some(request =>
    request.finishReason === 'length'
    || (request.requestedMaxTokens !== null
      && request.usage.outputTokens >= request.requestedMaxTokens))
  const warnings: string[] = []
  let perRequestMaxTokens: number
  let perRequestFormula: string
  let perRequestSafetyFactor: number
  if (censored) {
    perRequestMaxTokens = roundUpTo(Math.max(requestCeiling * 2, maxOutput * 2), 64)
    perRequestFormula = 'max(max_request_ceiling × 2, max_output × 2), rounded up to 64'
    perRequestSafetyFactor = 2
    warnings.push(
      'At least one response hit its `max_tokens` ceiling or finished with '
      + '`length`; per-request output measurements are censored. The candidate '
      + 'doubles the observed ceiling and the run must be repeated with the '
      + 'higher cap before a production default is frozen.',
    )
  } else {
    perRequestMaxTokens = roundUpTo(Math.max(512, Math.ceil(maxOutput * 1.5)), 64)
    perRequestFormula = 'max(512, ceil(max_output × 1.5)), rounded up to 64'
    perRequestSafetyFactor = 1.5
  }

  const stepExhausted = dataset.turns.some(turn =>
    turn.outcome === 'failed'
    && (/(?:Go turn budget exhausted.*maxModelSteps|did not commit a legal move within \d+ model steps)/i
      .test(turn.error ?? '')))
  const exhausted = exhaustedCounters(dataset.turns)
  const ceilingOf = (field: GoTurnBudgetCounterField): number | null =>
    exhausted.find(counter => counter.field === field)?.limit ?? null
  const exhaustedCeilings: Partial<Record<GoTurnBudgetCounterField, number>> = {}
  for (const counter of exhausted) exhaustedCeilings[counter.field] = counter.limit
  const stepHeadroom = stepExhausted
    || maxStepObservations.some(observation => observation.turn.outcome === 'failed')
  const maxModelSteps = floorAtCeiling(
    Math.max(3, maxSteps + (stepHeadroom ? 1 : 0)),
    ceilingOf('maxModelSteps'),
  )
  for (const counter of exhausted) {
    warnings.push(
      `\`${counter.field}\` was exhausted at its ${counter.used}/${counter.limit} ceiling; `
      + 'the observed value is censored by that ceiling and the field must be '
      + 're-measured with a higher limit.',
    )
  }

  if (summary.failedTurns > 0) {
    warnings.push(
      `${summary.failedTurns} turn(s) failed; failed turns are excluded from the `
      + 'per-turn distributions but their requests remain in the session totals.',
    )
  }
  if (summary.budgetStops > 0) {
    warnings.push(`${summary.budgetStops} turn(s) stopped on the benchmark gate.`)
  }
  if (summary.retries > 0) {
    warnings.push(`${summary.retries} retry attempt(s) were recorded; the live adapter is single-attempt.`)
  }
  if (summary.reportedModels.some(model => model !== dataset.model)) {
    warnings.push(
      `The provider reported model ids ${summary.reportedModels.join(', ')} while `
      + `${dataset.model} was requested; the alias must be resolved before pricing `
      + 'the production path.',
    )
  }
  if (summary.completedTurns < 16) {
    warnings.push(
      `Only ${summary.completedTurns} completed turns; the P95 is a small-sample `
      + 'order statistic, not a tail estimate.',
    )
  }

  return {
    perRequestMaxTokens,
    maxTurnTokens: roundUpTo(
      floorAtCeiling(
        roundUpTo(Math.max(1_024, Math.ceil(maxTurnTotal * 1.5)), 256),
        ceilingOf('maxTurnTokens'),
      ),
      256,
    ),
    maxModelSteps,
    maxInspectCalls: floorAtCeiling(Math.max(4, maxInspect + 1), ceilingOf('maxInspectCalls')),
    maxTryMoves: floorAtCeiling(Math.max(3, maxTry + 1), ceilingOf('maxTryMoves')),
    basis: {
      maxOutputTokensPerRequest: maxOutput,
      maxTurnTotalTokens: maxTurnTotal,
      maxModelStepsObserved: maxSteps,
      maxModelStepsObservedBasis: stepObservationBasis,
      maxInspectCallsObserved: maxInspect,
      maxTryMovesObserved: maxTry,
      requestTokenCeiling: requestCeiling,
      completedTurns: summary.completedTurns,
      safetyFactor: 1.5,
      perRequestFormula,
      perRequestSafetyFactor,
      exhaustedCeilings,
    },
    warnings,
  }
}

function fixed(value: number, digits = 2): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits)
}

function dash(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function rawNumber(usage: RawUsage | null, field: string): number | null {
  const value = usage?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rawNestedNumber(usage: RawUsage | null, parent: string, field: string): number | null {
  const container = usage?.[parent]
  if (typeof container !== 'object' || container === null) return null
  return rawNumber(container as RawUsage, field)
}

/** This endpoint reports the cache-hit count nested; other providers use the flat field. */
function rawCacheHitTokens(usage: RawUsage | null): number | null {
  return rawNumber(usage, 'prompt_cache_hit_tokens')
    ?? rawNestedNumber(usage, 'prompt_tokens_details', 'cached_tokens')
}

export function formatRequestRow(request: CalibrationRequestRecord): string {
  const raw = request.rawUsage
  return [
    request.id,
    request.fixture,
    String(request.step),
    String(request.requestIndex),
    request.wireFormat,
    dash(request.requestedMaxTokens),
    dash(rawNumber(raw, 'prompt_tokens')),
    dash(rawNumber(raw, 'completion_tokens')),
    dash(rawCacheHitTokens(raw)),
    String(request.usage.inputTokens),
    String(request.usage.outputTokens),
    String(request.usage.cacheReadTokens),
    fixed(request.latencyMs, 1),
    dash(request.finishReason),
  ].join(' | ')
}

function distributionRow(label: string, value: Distribution, digits = 2): string {
  return `| ${label} | ${value.count} | ${fixed(value.mean, digits)} | ${fixed(value.p50, digits)} `
    + `| ${fixed(value.p95, digits)} | ${fixed(value.min, digits)} | ${fixed(value.max, digits)} |`
}

/**
 * Render the human-readable report. Deterministic: the same dataset always
 * produces the same bytes, so a re-render from the committed JSON can be
 * compared directly.
 */
export function renderCalibrationReport(
  dataset: CalibrationDataset,
  summary: CalibrationSummary,
  recommendation: CalibrationRecommendation,
): string {
  const lines: string[] = []
  lines.push('# C-T10 live calibration — real model token and latency record')
  lines.push('')
  lines.push('- Ticket: WAVE-C-T10 (Spec §22 budget, §38 cognition benchmark)')
  lines.push('- Status: **measured against the live endpoint** (no scripted stand-in)')
  lines.push(`- Generated at (UTC): ${dataset.generatedAt}`)
  lines.push(`- Endpoint: \`${dataset.endpoint}\``)
  lines.push(`- Model: \`${dataset.model}\``)
  lines.push('- Raw dataset: `docs/validation/C-T10-LIVE-CALIBRATION-RAW.json`')
  lines.push('- Runner: `tests/benchmark/run-live-calibration.sh full`')
  lines.push('- Report renderer: `C_T10_RENDER_REPORT=1 pnpm exec vitest run '
    + 'tests/benchmark/render-live-calibration.test.ts`')
  lines.push(`- Price schedule used for the spend gate (USD per million tokens): input `
    + `${dataset.priceSchedule.inputUsdPerMillionTokens}, output `
    + `${dataset.priceSchedule.outputUsdPerMillionTokens}, cache read `
    + `${dataset.priceSchedule.cacheReadUsdPerMillionTokens ?? dataset.priceSchedule.inputUsdPerMillionTokens}`)
  lines.push(`- Session gate: ${dataset.caps.maxRequests} requests, `
    + `${dataset.caps.maxInputTokensPerRequest} input tokens/request, `
    + `${dataset.caps.maxOutputTokensPerRequest} output tokens/request, `
    + `¥${dataset.caps.maxEstimatedCostCny} at ¥${dataset.caps.usdToCnyRate}/USD`)
  lines.push(`- Turn enforcement during measurement: maxModelSteps `
    + `${dataset.turnBudget.maxModelSteps} (+1 §23 boost), maxInspectCalls `
    + `${dataset.turnBudget.maxInspectCalls}, maxTryMoves ${dataset.turnBudget.maxTryMoves}, `
    + `perRequestMaxTokens ${dataset.turnBudget.perRequestMaxTokens}, maxTurnTokens `
    + `${dataset.turnBudget.maxTurnTokens}. These are measurement limits, not the `
    + 'candidate under calibration; the candidate is derived below.')
  lines.push('')
  lines.push('## What ran')
  lines.push('')
  lines.push('Each turn is one §38 fixture position and is one complete DeepSeek move')
  lines.push('decision: the harness builds the position on the real Tenuki `GoRulesPort`,')
  lines.push('registers the real eight `go.*` tools behind `GoCapabilityGuard`, drives')
  lines.push('`createGoTurnEnforcement` (C-T07/C-T08) and the `agent/request` cap (C-S01),')
  lines.push('and sends each model step through the real pinned `@deepseek-ai/dsh-llm`')
  lines.push('runtime to `LiveBenchmarkProvider` (single HTTP attempt, no retries).')
  lines.push('')
  lines.push('Per-request `usage` below is the provider\'s own object, recorded verbatim.')
  lines.push('The mapped input is `prompt_tokens - cached prompt tokens`, read from')
  lines.push('`prompt_tokens_details.cached_tokens` on this entry (or')
  lines.push('`prompt_cache_hit_tokens` elsewhere), and the mapped')
  lines.push('output is `completion_tokens`, matching the disjoint fields DSH charges; the')
  lines.push('turn budget charges mapped input + output, so cache reads are reported')
  lines.push('separately and are not folded into the turn total.')
  lines.push('')
  const dispatchedRequests = dataset.session.gate.requests
  const unsettledRequests = dataset.session.gate.unsettledRequests ?? 0
  const retryNote = summary.retriesUnknownTurns === 0
    ? ''
    : ` (${summary.retriesUnknownTurns} turn(s) recorded no retry statistic)`
  lines.push(`Requests: **${summary.requests.count} settled** of **${dispatchedRequests} dispatched** `
    + `(${unsettledRequests} unsettled, counted against the session cap) across `
    + `**${summary.turns}** turns `
    + `(${summary.completedTurns} completed, ${summary.failedTurns} failed, `
    + `${summary.budgetStops} budget stops), **${summary.retries}** retries${retryNote}.`)
  lines.push(`Wall clock: **${fixed(dataset.session.wallMs / 1000, 1)} s**. `
    + `Gate-estimated spend: **$${fixed(summary.session.estimatedCostUsd, 6)}** `
    + `(¥${fixed(summary.session.estimatedCostCny, 4)} at ¥${dataset.caps.usdToCnyRate}/USD).`)
  const unsettledUsd = dataset.session.gate.unsettledCostUsd ?? 0
  const unsettledCny = dataset.session.gate.unsettledCostCny ?? 0
  lines.push(`Unsettled reservations (dispatched without usage, counted against the cap): `
    + `**${dataset.session.gate.unsettledRequests ?? 0}** request(s), `
    + `$${fixed(unsettledUsd, 6)} (¥${fixed(unsettledCny, 4)}).`)
  lines.push('')
  lines.push('## Correction of the earlier BLOCKED record')
  lines.push('')
  lines.push('The earlier record at this path reported HTTP 402 and 429 from')
  lines.push('`https://opencode.ai/zen/v1/chat/completions`. That URL is the ordinary Zen')
  lines.push('entry, not the OpenCode Go entry this ticket configures. Those responses did')
  lines.push('not prove the Go subscription had no balance, and the earlier "actual spend')
  lines.push('¥0.00" claim cannot be asserted without a provider bill. This run used the')
  lines.push('official Go row for `deepseek-v4.1-flash`')
  lines.push('(`https://opencode.ai/inference/go/openai/v1/chat/completions`, official Go')
  lines.push('table captured 2026-11-06, SHA256')
  lines.push('`5483c3cacaf5e72fdfb22e7b5f126daf79b55c1930f4c946092f273af24992d8`).')
  lines.push('The spend figures below are gate estimates from the reported usage at the')
  lines.push('recorded assumptions; no invoice was consulted, so they are not a final bill.')
  lines.push('')
  lines.push('## Per-request raw usage')
  lines.push('')
  lines.push('Every row is one entry in `requests[]` of the raw dataset; the raw columns')
  lines.push('are copied from the provider response without transformation.')
  lines.push('')
  lines.push('| request | fixture | step | # | wire | req max | raw prompt | raw completion | raw cache hit | mapped input | mapped output | cache read | latency ms | finish |')
  lines.push('|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const request of dataset.requests) lines.push(`| ${formatRequestRow(request)} |`)
  lines.push('')
  lines.push('## Per-turn totals')
  lines.push('')
  lines.push('Turn totals are the sums of the request rows above. `input` excludes cache')
  lines.push('reads; `total` is `input + output`.')
  lines.push('')
  lines.push('| turn | fixture | class | outcome | requests | steps | input | output | cache read | total | latency ms | committed |')
  lines.push('|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const turn of dataset.turns) {
    lines.push(`| ${turn.id} | ${turn.fixture} | ${turn.class} | ${turn.outcome} `
      + `| ${turn.requests} | ${turn.modelSteps} | ${turn.usage.inputTokens} `
      + `| ${turn.usage.outputTokens} | ${turn.usage.cacheReadTokens} `
      + `| ${turn.usage.totalTokens} | ${fixed(turn.latencyMs, 1)} `
      + `| ${dash(turn.committedAction)} |`)
  }
  lines.push('')
  lines.push('## Distributions')
  lines.push('')
  lines.push('Percentiles are nearest-rank order statistics over the rows above.')
  lines.push('')
  lines.push('### Per completed turn (the unit a budget must cover)')
  lines.push('')
  lines.push('| metric | n | mean | p50 | p95 | min | max |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|')
  lines.push(distributionRow('input tokens', summary.perTurn.inputTokens))
  lines.push(distributionRow('output tokens', summary.perTurn.outputTokens))
  lines.push(distributionRow('total tokens', summary.perTurn.totalTokens))
  lines.push(distributionRow('cache-read tokens', summary.perTurn.cacheReadTokens))
  lines.push(distributionRow('latency ms', summary.perTurn.latencyMs, 1))
  lines.push(distributionRow('requests', summary.perTurn.requests, 2))
  lines.push('')
  lines.push('### Per request')
  lines.push('')
  lines.push('| metric | n | mean | p50 | p95 | min | max |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|')
  lines.push(distributionRow('input tokens', summary.requests.inputTokens))
  lines.push(distributionRow('output tokens', summary.requests.outputTokens))
  lines.push(distributionRow('total tokens', summary.requests.totalTokens))
  lines.push(distributionRow('cache-read tokens', summary.requests.cacheReadTokens))
  lines.push(distributionRow('latency ms', summary.requests.latencyMs, 1))
  lines.push('')
  lines.push('### Failures, retries and finish reasons')
  lines.push('')
  lines.push(`- Failed turns: ${summary.failedTurns}`)
  lines.push(`- Budget stops: ${summary.budgetStops}`)
  lines.push(`- Retry attempts: ${summary.retries}`
    + (summary.retriesUnknownTurns === 0
      ? ''
      : ` (${summary.retriesUnknownTurns} turn(s) recorded no retry statistic)`))
  lines.push(`- Failure kinds: ${summary.failures.length === 0
    ? 'none'
    : summary.failures.map(entry => `${entry.kind} × ${entry.count}`).join(', ')}`)
  lines.push(`- Failed turn causes (from \`error\`): ${summary.failureCauses.length === 0
    ? 'none'
    : summary.failureCauses.map(entry => `${entry.cause} × ${entry.count}`).join(', ')}`)
  lines.push(`- Finish reasons: ${summary.finishReasons.map(entry => `${entry.reason} × ${entry.count}`).join(', ')}`)
  lines.push(`- Reported model ids: ${summary.reportedModels.length === 0
    ? 'none'
    : summary.reportedModels.map(model => `\`${model}\``).join(', ')}`)
  lines.push('')
  lines.push('## Suggested `GoTurnBudget` values (NOT applied)')
  lines.push('')
  lines.push('The recommendation is derived from the completed turns above. Production')
  lines.push('defaults in `src/` were not changed by this ticket; the candidate must pass')
  lines.push('independent review before it is frozen.')
  lines.push('')
  lines.push('| field | observed basis | formula | candidate |')
  lines.push('|---|---|---|---:|')
  const exhaustedNote = (field: GoTurnBudgetCounterField): string => {
    const ceiling = recommendation.basis.exhaustedCeilings[field]
    return ceiling === undefined ? '' : `, at least the exhausted ceiling ${ceiling} + 1`
  }
  lines.push(`| \`perRequestMaxTokens\` | largest output ${recommendation.basis.maxOutputTokensPerRequest} tokens/request; request ceiling ${recommendation.basis.requestTokenCeiling} | ${recommendation.basis.perRequestFormula} | ${recommendation.perRequestMaxTokens} |`)
  lines.push(`| \`maxTurnTokens\` | largest turn total ${recommendation.basis.maxTurnTotalTokens} tokens | max(1024, ceil(max_turn_total × 1.5)), rounded up to 256${exhaustedNote('maxTurnTokens')} | ${recommendation.maxTurnTokens} |`)
  lines.push(`| \`maxModelSteps\` | largest observed ${recommendation.basis.maxModelStepsObserved} steps (${recommendation.basis.maxModelStepsObservedBasis}) | max(3, observed + headroom), headroom 1 for a step exhaustion or a failed-turn maximum${exhaustedNote('maxModelSteps')} | ${recommendation.maxModelSteps} |`)
  lines.push(`| \`maxInspectCalls\` | largest ${recommendation.basis.maxInspectCallsObserved} | max(4, observed + 1)${exhaustedNote('maxInspectCalls')} | ${recommendation.maxInspectCalls} |`)
  lines.push(`| \`maxTryMoves\` | largest ${recommendation.basis.maxTryMovesObserved} | max(3, observed + 1)${exhaustedNote('maxTryMoves')} | ${recommendation.maxTryMoves} |`)
  lines.push('')
  lines.push(`Safety margin: **${recommendation.basis.perRequestSafetyFactor}×** on `
    + `\`perRequestMaxTokens\` and **${recommendation.basis.safetyFactor}×** on \`maxTurnTokens\`. It`)
  lines.push('covers the same position being inspected with slightly different arguments;')
  lines.push('it is not a probability claim about the tail.')
  lines.push('')
  if (recommendation.warnings.length > 0) {
    lines.push('### Warnings')
    lines.push('')
    for (const warning of recommendation.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }
  lines.push('## Caveats')
  lines.push('')
  lines.push('- This run used the official OpenCode Go chat-completions entry')
  lines.push('  (`https://opencode.ai/inference/go/openai/v1`), not the ordinary Zen entry.')
  lines.push('  Token counts are the endpoint\'s counts; if production calls the official')
  lines.push('  DeepSeek API directly, prices and cache behaviour must be converted from')
  lines.push('  the official price page before freezing a cost model.')
  lines.push('- The price schedule is a conservative accounting assumption taken from the')
  lines.push('  `/models` listing observed on 2026-11-06 (input $0.30/M, output $1.20/M,')
  lines.push('  cache read $0.006/M). It is not an official Go/DeepSeek quote and not the')
  lines.push('  final bill.')
  lines.push('- The smoke and full caps are separate processes: smoke ¥0.5, full ¥6.16,')
  lines.push('  together inside the approved ¥6.66 round envelope. A released reservation')
  lines.push('  stays in the session snapshot as unsettled spend instead of becoming zero.')
  lines.push('- The per-request output ceiling was the C-S01 clamp in force during the run.')
  lines.push('  Any response that reached it is censored; see the warnings above.')
  lines.push('- The sample is 8 fixed §38 positions × 3 runs. It measures this harness\'s')
  lines.push('  prompt and tool surface, not the full distribution of production games.')
  lines.push('- The benchmark gate\'s price schedule is a conservative accounting input,')
  lines.push('  not a quote. Estimated spend is derived from reported usage at those prices.')
  lines.push('- No API key, authorization header or environment file content is recorded in')
  lines.push('  this report or the raw dataset.')
  lines.push('')
  return `${lines.join('\n')}\n`
}
