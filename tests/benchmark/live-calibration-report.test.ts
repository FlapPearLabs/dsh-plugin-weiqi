import { describe, expect, it } from 'vitest'
import {
  BenchmarkBudgetGate,
  type BenchmarkBudgetGateSnapshot,
} from './budget-gate.js'
import {
  buildCalibrationDataset,
  deriveCalibrationRecommendation,
  failureCauseOf,
  formatRequestRow,
  renderCalibrationReport,
  requestUsageOf,
  summarizeCalibration,
  toRequestRecord,
  type CalibrationDataset,
  type CalibrationObservation,
  type CalibrationRequestRecord,
  type CalibrationTurnRecord,
} from './live-calibration.js'

/**
 * Report-derivation regressions from the C-T10 correction record.
 *
 * Each assertion here corresponds to a defect that made the rendered report
 * disagree with the recorded data: step exhaustion never detected, every
 * failed turn tallied as `run-failed`, a hard-coded 1.5× formula beside a ×2
 * candidate, a headline that counted settled rows only, and a cache-hit column
 * that ignored `prompt_tokens_details.cached_tokens`.
 */

const PRICING = {
  inputUsdPerMillionTokens: 0.3,
  outputUsdPerMillionTokens: 1.2,
  cacheReadUsdPerMillionTokens: 0.006,
}

const TURN_BUDGET = {
  maxModelSteps: 6,
  maxInspectCalls: 8,
  maxTryMoves: 6,
  perRequestMaxTokens: 4_000,
  maxTurnTokens: 64_000,
} as const

const OBSERVATIONS: readonly (CalibrationObservation & { readonly id: string })[] = [
  {
    id: 'T01-S1',
    turnId: 'T01',
    fixture: 'opening-spread',
    class: 'opening',
    run: 1,
    step: 1,
    endpoint: 'http://127.0.0.1:9/v1/chat/completions',
    configuredModel: 'stub-model',
    reportedModel: 'stub-model',
    wireFormat: 'sse',
    httpStatus: 200,
    requestedMaxTokens: 1024,
    startedAtMs: 0,
    finishedAtMs: 10,
    latencyMs: 10,
    finishReason: 'tool_calls',
    rawUsage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 10 },
    usage: { inputTokens: 90, outputTokens: 20, cacheReadTokens: 10 },
  },
  {
    id: 'T01-S2',
    turnId: 'T01',
    fixture: 'opening-spread',
    class: 'opening',
    run: 1,
    step: 2,
    endpoint: 'http://127.0.0.1:9/v1/chat/completions',
    configuredModel: 'stub-model',
    reportedModel: 'stub-model',
    wireFormat: 'sse',
    httpStatus: 200,
    requestedMaxTokens: 1024,
    startedAtMs: 20,
    finishedAtMs: 40,
    latencyMs: 20,
    finishReason: 'tool_calls',
    rawUsage: { prompt_tokens: 200, completion_tokens: 40 },
    usage: { inputTokens: 200, outputTokens: 40 },
  },
  {
    id: 'T02-S1',
    turnId: 'T02',
    fixture: 'ko-immediate-recapture',
    class: 'ko',
    run: 1,
    step: 1,
    endpoint: 'http://127.0.0.1:9/v1/chat/completions',
    configuredModel: 'stub-model',
    reportedModel: 'stub-model',
    wireFormat: 'sse',
    httpStatus: 200,
    requestedMaxTokens: 1024,
    startedAtMs: 50,
    finishedAtMs: 80,
    latencyMs: 30,
    finishReason: 'stop',
    rawUsage: { prompt_tokens: 400, completion_tokens: 100, prompt_cache_hit_tokens: 50 },
    usage: { inputTokens: 350, outputTokens: 100, cacheReadTokens: 50 },
  },
]

function datasetWith(
  options: Readonly<{
    observations?: readonly (CalibrationObservation & { readonly id: string })[]
    steps?: Readonly<Record<string, number>>
    turns?: Readonly<Record<string, Partial<CalibrationTurnRecord>>>
    gate?: Partial<BenchmarkBudgetGateSnapshot>
  }> = {},
): CalibrationDataset {
  const observations = options.observations ?? OBSERVATIONS
  const requests: CalibrationRequestRecord[] = observations.map((observation, index) =>
    toRequestRecord(observation, index + 1))
  const turnIds = [...new Set(observations.map(observation => observation.turnId))]
  const turns: CalibrationTurnRecord[] = turnIds.map(turnId => {
    const first = observations.find(observation => observation.turnId === turnId)
    if (first === undefined) throw new Error(`missing observation for ${turnId}`)
    const turnRequests = requests.filter(request => request.turnId === turnId)
    return {
      id: turnId,
      fixture: first.fixture,
      class: first.class,
      run: first.run,
      outcome: 'completed',
      error: null,
      latencyMs: turnRequests.reduce((total, request) => total + request.latencyMs, 0),
      modelSteps: options.steps?.[turnId] ?? turnRequests.length,
      inspectCalls: 1,
      tryMoveCalls: 0,
      deepThinkRequests: 0,
      committedAction: 'play',
      finalMove: 'play (2,4)',
      requests: turnRequests.length,
      retryAttempts: 0,
      failureKinds: [],
      stopGate: null,
      usage: requestUsageOf(turnRequests),
      ...options.turns?.[turnId],
    }
  })

  const baselineGate = new BenchmarkBudgetGate({}, undefined, 'scripted').snapshot()
  return buildCalibrationDataset({
    generatedAt: '2026-11-06T00:00:00.000Z',
    endpoint: 'http://127.0.0.1:9/v1/chat/completions',
    model: 'stub-model',
    priceSchedule: PRICING,
    turnBudget: TURN_BUDGET,
    caps: {
      maxRequests: 120,
      maxInputTokensPerRequest: 8000,
      maxOutputTokensPerRequest: 4000,
      maxEstimatedCostCny: 6.5,
      usdToCnyRate: 7.1,
    },
    session: {
      startedAt: '2026-11-06T00:00:00.000Z',
      finishedAt: '2026-11-06T00:00:01.000Z',
      wallMs: 1000,
      gate: { ...baselineGate, ...options.gate },
    },
    turns,
    requests,
  })
}

function render(dataset: CalibrationDataset): string {
  const summary = summarizeCalibration(dataset)
  return renderCalibrationReport(dataset, summary, deriveCalibrationRecommendation(dataset, summary))
}

/** One observation row per model step, one step per request. */
function stepObservations(
  turnId: string,
  count: number,
): readonly (CalibrationObservation & { readonly id: string })[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${turnId}-S${String(index + 1)}`,
    turnId,
    fixture: 'opening-spread',
    class: 'opening',
    run: 1,
    step: index + 1,
    endpoint: 'http://127.0.0.1:9/v1/chat/completions',
    configuredModel: 'stub-model',
    reportedModel: 'stub-model',
    wireFormat: 'sse' as const,
    httpStatus: 200,
    requestedMaxTokens: 1024,
    startedAtMs: index * 10,
    finishedAtMs: index * 10 + 5,
    latencyMs: 5,
    finishReason: 'tool_calls',
    rawUsage: { prompt_tokens: 100, completion_tokens: 20 },
    usage: { inputTokens: 100, outputTokens: 20 },
  }))
}

function perRequestRow(report: string): string {
  const row = report
    .split('\n')
    .find(line => line.startsWith('| `perRequestMaxTokens`'))
  if (row === undefined) throw new Error('perRequestMaxTokens row is missing from the report')
  return row
}

describe('live calibration report derivation', () => {
  it('detects step exhaustion from the recorded maxModelSteps error', () => {
    const dataset = datasetWith({
      steps: { T01: 5 },
      turns: {
        T02: { outcome: 'failed', error: 'Go turn budget exhausted: maxModelSteps (6/6)' },
      },
    })
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    expect(recommendation.basis.maxModelStepsObserved).toBe(5)
    expect(recommendation.maxModelSteps).toBe(7)
    expect(recommendation.warnings.join('\n')).toContain('`maxModelSteps` was exhausted')
    expect(recommendation.warnings.join('\n')).toContain('censored')
  })

  it('classifies failed turns from their recorded error instead of one run-failed label', () => {
    expect(failureCauseOf(
      'Cognition benchmark enforcement bypass: request_path: adapter made 8 transport '
      + 'attempts for 3 admitted requests; retries are forbidden',
    )).toBe('request-path retry')
    expect(failureCauseOf(
      'Cognition benchmark enforcement bypass: agent/request: token cap 16000 exceeds '
      + 'perRequestMaxTokens 8192',
    )).toBe('enforcement bypass: agent/request')
    expect(failureCauseOf(
      'Cognition benchmark enforcement bypass: go.inspect_*: inspectCalls did not advance by one',
    )).toBe('enforcement bypass: go.inspect_*')
    expect(failureCauseOf('Go turn budget exhausted: maxModelSteps (6/6)')).toBe('budget exhausted: maxModelSteps')
    expect(failureCauseOf('Go turn budget exhausted: maxTryMoves (6/6)')).toBe('budget exhausted: maxTryMoves')
    expect(failureCauseOf('Go turn budget exhausted: maxInspectCalls (8/8)')).toBe('budget exhausted: maxInspectCalls')
    expect(failureCauseOf('Go turn budget exhausted: maxTurnTokens (128000/128000)'))
      .toBe('budget exhausted: maxTurnTokens')
    expect(failureCauseOf(
      'Benchmark provider call failed: {"kind":"error","failure":{"message":"live benchmark '
      + 'provider transport failed (ECONNRESET: Client network socket disconnected)","code":"NETWORK"}}',
    )).toBe('network error')
    expect(failureCauseOf('Go tool call rejected: illegal move')).toBe('other')
    expect(failureCauseOf(null)).toBe('other')

    const dataset = datasetWith({
      turns: {
        T01: {
          outcome: 'failed',
          error: 'Cognition benchmark enforcement bypass: request_path: adapter made 8 '
            + 'transport attempts for 3 admitted requests; retries are forbidden',
        },
        T02: {
          outcome: 'failed',
          error: 'live benchmark provider transport failed (UND_ERR_CONNECT_TIMEOUT: connect timed out)',
        },
      },
    })
    const summary = summarizeCalibration(dataset)
    expect(summary.failureCauses).toEqual([
      { cause: 'network error', count: 1 },
      { cause: 'request-path retry', count: 1 },
    ])

    const report = render(dataset)
    expect(report).toContain('request-path retry × 1')
    expect(report).toContain('network error × 1')
  })

  it('says in the headline when a turn carries no retry statistic', () => {
    const report = render(datasetWith({
      turns: {
        T02: { outcome: 'failed', retryAttempts: null, error: 'Go tool call rejected: illegal move' },
      },
    }))
    const headline = report.split('\n').find(line => line.startsWith('Requests: '))
    expect(headline).toBeDefined()
    expect(headline).toContain('0** retries (1 turn(s) recorded no retry statistic)')
  })

  it('detects step exhaustion from the live no-commit message as well', () => {
    const dataset = datasetWith({
      steps: { T01: 5 },
      turns: {
        T02: {
          outcome: 'failed',
          error: 'Live benchmark fixture ko-immediate-recapture did not commit a legal '
            + 'move within 6 model steps',
        },
      },
    })
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    expect(failureCauseOf(dataset.turns[1]?.error)).toBe('step exhausted')
    expect(recommendation.basis.maxModelStepsObserved).toBe(5)
    expect(recommendation.maxModelSteps).toBe(7)
    expect(recommendation.warnings.join('\n')).toContain('`maxModelSteps` was exhausted')
    expect(recommendation.warnings.join('\n')).toContain('censored')
  })

  it('floors each counter candidate at the ceiling an exhausted turn hit', () => {
    const recommendation = (turns: Readonly<Record<string, Partial<CalibrationTurnRecord>>>) => {
      const dataset = datasetWith({ turns })
      const summary = summarizeCalibration(dataset)
      return deriveCalibrationRecommendation(dataset, summary)
    }

    const tryMoves = recommendation({
      T01: { tryMoveCalls: 4 },
      T02: {
        outcome: 'failed',
        tryMoveCalls: 6,
        error: 'Go turn budget exhausted: maxTryMoves (6/6)',
      },
    })
    expect(tryMoves.basis.maxTryMovesObserved).toBe(4)
    expect(tryMoves.maxTryMoves).toBeGreaterThanOrEqual(7)
    expect(tryMoves.warnings.join('\n')).toContain('`maxTryMoves` was exhausted')
    expect(tryMoves.warnings.join('\n')).toContain('censored')

    const inspectCalls = recommendation({
      T01: { inspectCalls: 3 },
      T02: {
        outcome: 'failed',
        inspectCalls: 8,
        error: 'Go turn budget exhausted: maxInspectCalls (8/8)',
      },
    })
    expect(inspectCalls.basis.maxInspectCallsObserved).toBe(3)
    expect(inspectCalls.maxInspectCalls).toBeGreaterThanOrEqual(9)
    expect(inspectCalls.warnings.join('\n')).toContain('`maxInspectCalls` was exhausted')

    const turnTokens = recommendation({
      T02: {
        outcome: 'failed',
        error: 'Go turn budget exhausted: maxTurnTokens (64000/64000)',
      },
    })
    expect(turnTokens.maxTurnTokens).toBeGreaterThanOrEqual(64_001)
    expect(turnTokens.warnings.join('\n')).toContain('`maxTurnTokens` was exhausted')
  })

  it('counts the steps a failed turn walked from its recorded requests', () => {
    // A failed turn is persisted with `modelSteps: 0` — a placeholder, not a
    // measurement — so its request count is the only step observation it
    // leaves behind. Round 3's T13 walked 7 requests and failed.
    const dataset = datasetWith({
      observations: [...stepObservations('T01', 5), ...stepObservations('T02', 7)],
      steps: { T01: 5 },
      turns: {
        T02: {
          outcome: 'failed',
          modelSteps: 0,
          error: 'Go turn budget exhausted: maxTryMoves (6/6)',
        },
      },
    })
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    expect(recommendation.basis.maxModelStepsObserved).toBe(7)
    expect(recommendation.maxModelSteps).toBeGreaterThanOrEqual(8)
    expect(recommendation.basis.maxModelStepsObservedBasis).toContain('T02')
    expect(recommendation.basis.maxModelStepsObservedBasis).toContain('requests')

    const row = render(dataset)
      .split('\n')
      .find(line => line.startsWith('| `maxModelSteps`'))
    expect(row).toBeDefined()
    expect(row).toContain('largest observed 7 steps')
    expect(row).toContain('7 requests')
  })

  it('keeps every other candidate on its own formula when only maxTryMoves is exhausted', () => {
    const dataset = datasetWith({
      steps: { T01: 2 },
      turns: {
        T01: { inspectCalls: 3, tryMoveCalls: 4 },
        T02: {
          outcome: 'failed',
          tryMoveCalls: 6,
          error: 'Go turn budget exhausted: maxTryMoves (6/6)',
        },
      },
    })
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    expect(recommendation.basis.exhaustedCeilings).toEqual({ maxTryMoves: 6 })
    // the exhausted counter: max(3, 4 + 1) floored at 6 + 1
    expect(recommendation.maxTryMoves).toBe(7)
    // every other field keeps its own formula; a shared ceiling would show here
    expect(recommendation.maxModelSteps).toBe(3)
    expect(recommendation.maxInspectCalls).toBe(4)
    expect(recommendation.maxTurnTokens).toBe(1024)
    expect(recommendation.perRequestMaxTokens).toBe(512)
  })

  it('rounds a maxTurnTokens floor raised to the exhausted ceiling up to 256', () => {
    const dataset = datasetWith({
      turns: {
        T02: {
          outcome: 'failed',
          error: 'Go turn budget exhausted: maxTurnTokens (64000/64000)',
        },
      },
    })
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    // 1024 from the formula, floored at 64000 + 1, then rounded to the 256 grid.
    expect(recommendation.maxTurnTokens).toBe(64_256)
    expect(recommendation.maxTurnTokens % 256).toBe(0)
  })

  it('does not read an unrelated failure as step exhaustion', () => {
    const error = 'Benchmark provider call failed: live benchmark provider transport '
      + 'failed (ECONNRESET: Client network socket disconnected)'
    expect(failureCauseOf(error)).toBe('network error')
    const dataset = datasetWith({
      steps: { T01: 5 },
      turns: { T02: { outcome: 'failed', error } },
    })
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    expect(recommendation.basis.maxModelStepsObserved).toBe(5)
    expect(recommendation.basis.maxModelStepsObservedBasis).toBe('T01 reported 5 model steps')
    expect(recommendation.maxModelSteps).toBe(5)
    expect(recommendation.warnings.join('\n')).not.toContain('was exhausted')

    const row = render(dataset)
      .split('\n')
      .find(line => line.startsWith('| `maxModelSteps`'))
    expect(row).toBeDefined()
    expect(row).toContain('largest observed 5 steps (T01 reported 5 model steps)')
    expect(row).not.toContain('exhausted ceiling')
  })

  it('prints the per-request formula branch the recommendation actually used', () => {
    const uncensoredRow = perRequestRow(render(datasetWith()))
    expect(uncensoredRow).toContain('× 1.5')
    expect(uncensoredRow).not.toContain('× 2')

    const censoredObservations = OBSERVATIONS.map(observation => observation.id === 'T02-S1'
      ? {
        ...observation,
        finishReason: 'length',
        usage: { ...observation.usage, outputTokens: 1024 },
        rawUsage: { ...(observation.rawUsage as Record<string, unknown>), completion_tokens: 1024 },
      }
      : observation)
    const censoredReport = render(datasetWith({ observations: censoredObservations }))
    const censoredRow = perRequestRow(censoredReport)
    expect(censoredRow).toContain('× 2')
    expect(censoredRow).not.toContain('× 1.5')
    expect(censoredReport).toContain('**2×** on `perRequestMaxTokens`')
    expect(censoredReport).toContain('**1.5×** on `maxTurnTokens`')
  })

  it('splits dispatched, settled and unsettled requests in the headline', () => {
    const report = render(datasetWith({ gate: { requests: 4, unsettledRequests: 1 } }))

    expect(report).toContain('**3 settled**')
    expect(report).toContain('**4 dispatched**')
    expect(report).toContain('(1 unsettled')
  })

  it('reads the raw cache-hit count from either provider field', () => {
    const base = OBSERVATIONS[0]
    if (base === undefined) throw new Error('missing base observation')

    const nested = toRequestRecord({
      ...base,
      rawUsage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 10 },
      },
    }, 1)
    expect(formatRequestRow(nested)).toContain('| 100 | 20 | 10 |')

    const flat = toRequestRecord({
      ...base,
      rawUsage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 7 },
    }, 1)
    expect(formatRequestRow(flat)).toContain('| 100 | 20 | 7 |')
  })
})
