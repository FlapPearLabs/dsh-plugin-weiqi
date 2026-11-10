import { describe, expect, it } from 'vitest'
import { BenchmarkBudgetGate } from './budget-gate.js'
import {
  buildCalibrationDataset,
  deriveCalibrationRecommendation,
  distribution,
  renderCalibrationReport,
  requestUsageOf,
  summarizeCalibration,
  toRequestRecord,
  type CalibrationDataset,
  type CalibrationObservation,
  type CalibrationRequestRecord,
  type CalibrationTurnRecord,
} from './live-calibration.js'

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

function gateSnapshot(): ReturnType<BenchmarkBudgetGate['snapshot']> {
  const gate = new BenchmarkBudgetGate({}, undefined, 'scripted')
  return gate.snapshot()
}

function datasetWith(
  observations: readonly (CalibrationObservation & { readonly id: string })[],
  overrides: Partial<{ readonly steps: Readonly<Record<string, number>>; readonly outcome: CalibrationTurnRecord['outcome'] }> = {},
): CalibrationDataset {
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
      outcome: overrides.outcome ?? 'completed',
      error: null,
      latencyMs: turnRequests.reduce((total, request) => total + request.latencyMs, 0),
      modelSteps: overrides.steps?.[turnId] ?? turnRequests.length,
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
    }
  })

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
      gate: gateSnapshot(),
    },
    turns,
    requests,
  })
}

describe('live calibration statistics', () => {
  it('computes nearest-rank percentiles and per-turn sums from raw request rows', () => {
    const dataset = datasetWith(OBSERVATIONS)
    const summary = summarizeCalibration(dataset)

    expect(distribution([])).toMatchObject({ count: 0, mean: 0, p95: 0 })
    expect(distribution([350, 90, 200])).toMatchObject({
      count: 3,
      sum: 640,
      mean: 640 / 3,
      min: 90,
      p50: 200,
      p95: 350,
      max: 350,
    })

    expect(summary.requests.count).toBe(3)
    expect(summary.perTurn.count).toBe(2)
    expect(summary.perTurn.inputTokens).toMatchObject({ sum: 640, mean: 320, p50: 290, p95: 350 })
    expect(summary.perTurn.outputTokens).toMatchObject({ sum: 160, mean: 80, p50: 60, p95: 100 })
    expect(summary.perTurn.totalTokens).toMatchObject({ sum: 800, mean: 400, p95: 450 })
    expect(summary.perTurn.requests).toMatchObject({ sum: 3, mean: 1.5, p95: 2 })
    expect(summary.session).toMatchObject({
      requests: 3,
      inputTokens: 640,
      outputTokens: 160,
      cacheReadTokens: 60,
      totalTokens: 800,
    })
    expect(summary.reportedModels).toEqual(['stub-model'])
  })

  it('keeps every turn total equal to the sum of its own request rows', () => {
    const dataset = datasetWith(OBSERVATIONS)
    const t01 = dataset.turns.find(turn => turn.id === 'T01')
    expect(t01?.usage).toMatchObject({ inputTokens: 290, outputTokens: 60, cacheReadTokens: 10, totalTokens: 350 })
    expect(dataset.requests.map(request => request.id)).toEqual(['T01-S1', 'T01-S2', 'T02-S1'])
    expect(dataset.requests[0]?.usage).toMatchObject({ inputTokens: 90, outputTokens: 20, totalTokens: 110 })
  })

  it('refuses a turn whose recorded total does not match its requests', () => {
    const dataset = datasetWith(OBSERVATIONS)
    expect(() => buildCalibrationDataset({
      generatedAt: dataset.generatedAt,
      endpoint: dataset.endpoint,
      model: dataset.model,
      priceSchedule: dataset.priceSchedule,
      turnBudget: dataset.turnBudget,
      caps: dataset.caps,
      session: dataset.session,
      turns: dataset.turns.map(turn => ({ ...turn, usage: { ...turn.usage, inputTokens: 999 } })),
      requests: dataset.requests,
    })).toThrow(/does not match its 2 request record\(s\)/)
  })

  it('derives the same token candidates the formula documents', () => {
    const dataset = datasetWith(OBSERVATIONS)
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    expect(recommendation).toMatchObject({
      perRequestMaxTokens: 512,
      maxTurnTokens: 1024,
      maxModelSteps: 3,
      maxInspectCalls: 4,
      maxTryMoves: 3,
    })
    expect(recommendation.basis).toMatchObject({
      maxOutputTokensPerRequest: 100,
      maxTurnTotalTokens: 450,
      maxModelStepsObserved: 2,
      requestTokenCeiling: 1024,
      completedTurns: 2,
      safetyFactor: 1.5,
    })
    expect(recommendation.warnings.join('\n')).toContain('completed turns')
  })

  it('doubles the request cap and warns when an output was censored by max_tokens', () => {
    const censored = OBSERVATIONS.map(observation => observation.id === 'T02-S1'
      ? {
        ...observation,
        finishReason: 'length',
        usage: { ...observation.usage, outputTokens: 1024 },
        rawUsage: { ...(observation.rawUsage as Record<string, unknown>), completion_tokens: 1024 },
      }
      : observation)
    const dataset = datasetWith(censored)
    const summary = summarizeCalibration(dataset)
    const recommendation = deriveCalibrationRecommendation(dataset, summary)

    expect(recommendation.perRequestMaxTokens).toBe(2048)
    expect(recommendation.warnings.join('\n')).toContain('censored')
  })

  it('renders every raw request row and every turn total into the report', () => {
    const dataset = datasetWith(OBSERVATIONS)
    const summary = summarizeCalibration(dataset)
    const report = renderCalibrationReport(
      dataset,
      summary,
      deriveCalibrationRecommendation(dataset, summary),
    )

    for (const request of dataset.requests) {
      expect(report).toContain(request.id)
      const rawPrompt = request.rawUsage?.prompt_tokens
      const rawCompletion = request.rawUsage?.completion_tokens
      expect(report).toContain(`| ${rawPrompt} | ${rawCompletion} |`)
    }
    for (const turn of dataset.turns) {
      expect(report).toContain(`| ${turn.id} | ${turn.fixture} | ${turn.class} | completed `)
      expect(report).toContain(`| ${turn.usage.totalTokens} |`)
    }
    expect(report).toContain('2026-11-06T00:00:00.000Z')
    expect(report).toContain('http://127.0.0.1:9/v1/chat/completions')
    expect(report).toContain('stub-model')
    expect(report).toContain('Turn enforcement during measurement: maxModelSteps 6')
    expect(report).toContain('Suggested `GoTurnBudget` values (NOT applied)')
  })
})
