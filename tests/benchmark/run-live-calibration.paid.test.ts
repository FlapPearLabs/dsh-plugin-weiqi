import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { it } from 'vitest'
import type { GoTurnBudget } from '../../src/contracts/budget.js'
import { BenchmarkBudgetGate } from './budget-gate.js'
import { BENCHMARK_FIXTURES, type BenchmarkFixture } from './fixtures.js'
import { runFixture, type BenchmarkRunMetrics } from './harness.js'
import {
  buildCalibrationDataset,
  C_T10_FULL_BUDGET_CNY,
  C_T10_SMOKE_BUDGET_CNY,
  requestUsageOf,
  toRequestRecord,
  type CalibrationDataset,
  type CalibrationObservation,
  type CalibrationRequestRecord,
  type CalibrationTurnRecord,
} from './live-calibration.js'
import {
  BENCHMARK_LIVE_PROVIDER_ID,
  LiveBenchmarkProvider,
  loadLiveBenchmarkConfig,
  type LiveBenchmarkConfig,
  type LiveRequestObservation,
} from './live-provider.js'

/**
 * Paid live calibration runner (WAVE-C-T10).
 *
 * Disabled unless `C_T10_LIVE_CALIBRATION` is `smoke` or `full`; the ordinary
 * `tests/benchmark` run never touches the network. `smoke` runs one fixture
 * once (at most four requests) and prints the raw usage; `full` runs all eight
 * §38 fixtures three times and writes the raw dataset. Nothing is written to
 * `docs/` in smoke mode.
 */

const MODE = process.env.C_T10_LIVE_CALIBRATION
const ENABLED = MODE === 'smoke' || MODE === 'full'
const RAW_OUT = 'docs/validation/C-T10-LIVE-CALIBRATION-RAW.json'
const TEST_TIMEOUT_MS = 90 * 60 * 1_000
const USD_TO_CNY_RATE = 7.1
const APPROVED_MODEL = 'deepseek-v4.1-flash'

/**
 * The measurement must not be stopped by the candidate it is meant to replace.
 * The first real live prompt alone carried 4378 turn tokens, above the 4096
 * candidate turn ceiling, so the candidate aborted every turn at model step 2.
 * These limits finish a turn while the spend gate keeps the 8000-input /
 * 16000-output per-request caps and the ¥6.16 session cap in force. The
 * candidate values are derived afterwards and never applied here.
 */
const CALIBRATION_TURN_BUDGET: GoTurnBudget = {
  maxModelSteps: 10,
  maxInspectCalls: 8,
  maxTryMoves: 6,
  perRequestMaxTokens: 16_000,
  maxTurnTokens: 128_000,
}

type TurnContext = Readonly<{
  readonly id: string
  readonly fixture: BenchmarkFixture
  readonly run: number
}>

function turnRecordFromMetrics(
  context: TurnContext,
  metrics: BenchmarkRunMetrics,
  requests: readonly CalibrationRequestRecord[],
): CalibrationTurnRecord {
  return {
    id: context.id,
    fixture: context.fixture.name,
    class: context.fixture.class,
    run: context.run,
    outcome: metrics.outcome === 'completed' ? 'completed' : 'budget_stop',
    error: null,
    latencyMs: metrics.latencyMs,
    modelSteps: metrics.modelSteps,
    inspectCalls: metrics.inspectCalls,
    tryMoveCalls: metrics.tryMoveCalls,
    deepThinkRequests: metrics.deepThinkRequests,
    committedAction: metrics.committedAction,
    finalMove: metrics.finalMove,
    requests: requests.length,
    retryAttempts: metrics.requestPath.retryAttempts,
    failureKinds: metrics.requestPath.failures.map(failure => failure.kind),
    stopGate: metrics.budgetStop?.gate ?? null,
    usage: requestUsageOf(requests),
  }
}

function failedTurnRecord(
  context: TurnContext,
  error: unknown,
  requests: readonly CalibrationRequestRecord[],
): CalibrationTurnRecord {
  return {
    id: context.id,
    fixture: context.fixture.name,
    class: context.fixture.class,
    run: context.run,
    outcome: 'failed',
    error: error instanceof Error ? error.message : String(error),
    latencyMs: 0,
    modelSteps: 0,
    inspectCalls: 0,
    tryMoveCalls: 0,
    deepThinkRequests: 0,
    committedAction: null,
    finalMove: 'none',
    requests: requests.length,
    retryAttempts: null,
    failureKinds: ['run-failed'],
    stopGate: null,
    usage: requestUsageOf(requests),
  }
}

function observationOf(
  context: TurnContext,
  step: number,
  observation: LiveRequestObservation,
): CalibrationObservation {
  if (observation.usage === undefined) {
    throw new Error(
      `live request for ${context.id} produced no usage; refusing to record a calibration row`,
    )
  }
  return {
    turnId: context.id,
    fixture: context.fixture.name,
    class: context.fixture.class,
    run: context.run,
    step,
    endpoint: observation.endpoint,
    configuredModel: observation.configuredModel,
    reportedModel: observation.reportedModel,
    wireFormat: observation.wireFormat,
    httpStatus: observation.httpStatus,
    requestedMaxTokens: observation.requestedMaxTokens,
    startedAtMs: observation.startedAtMs,
    finishedAtMs: observation.finishedAtMs,
    latencyMs: observation.durationMs,
    finishReason: observation.finishReason,
    rawUsage: observation.rawUsage,
    usage: observation.usage,
  }
}

function assertNoModelDrift(
  observations: readonly CalibrationObservation[],
  config: LiveBenchmarkConfig,
): void {
  if (observations.length === 0) {
    throw new Error('live calibration produced no usage rows')
  }
  const drifted = observations.filter(entry => entry.reportedModel !== config.model)
  if (drifted.length > 0) {
    throw new Error(
      `model identity drift: configured ${config.model}, reported `
      + drifted.map(entry => String(entry.reportedModel)).join(', '),
    )
  }
}

function assertSmokeUsable(
  observations: readonly CalibrationObservation[],
  config: LiveBenchmarkConfig,
): void {
  if (config.model !== APPROVED_MODEL) {
    throw new Error(`smoke must use the approved model ${APPROVED_MODEL}, received ${config.model}`)
  }
  assertNoModelDrift(observations, config)
  for (const entry of observations) {
    if (entry.httpStatus !== 200) {
      throw new Error(`smoke received HTTP ${entry.httpStatus}`)
    }
    const raw = typeof entry.rawUsage === 'object' && entry.rawUsage !== null
      ? entry.rawUsage as Record<string, unknown>
      : null
    if (raw === null
      || typeof raw.prompt_tokens !== 'number'
      || typeof raw.completion_tokens !== 'number') {
      throw new Error('smoke usage is incomplete; refusing to enter full')
    }
    const ceiling = entry.requestedMaxTokens ?? Number.POSITIVE_INFINITY
    if (entry.finishReason === 'length' || entry.usage.outputTokens >= ceiling) {
      throw new Error(
        `smoke output was truncated at ${entry.usage.outputTokens}/${String(entry.requestedMaxTokens)} tokens`,
      )
    }
  }
}

it.runIf(ENABLED)('runs the live calibration and records every request usage', async () => {
  const mode = MODE === 'full' ? 'full' : 'smoke'
  const config = loadLiveBenchmarkConfig(process.env)
  const fixtures = mode === 'full' ? BENCHMARK_FIXTURES : BENCHMARK_FIXTURES.slice(0, 1)
  const runsPerFixture = mode === 'full' ? 3 : 1
  const gate = new BenchmarkBudgetGate(
    {
      maxRequests: mode === 'full' ? 120 : 4,
      maxInputTokensPerRequest: 8_000,
      maxOutputTokensPerRequest: 16_000,
      maxEstimatedCostCny: mode === 'full' ? C_T10_FULL_BUDGET_CNY : C_T10_SMOKE_BUDGET_CNY,
      usdToCnyRate: USD_TO_CNY_RATE,
    },
    config.pricing,
    'live',
  )

  const observations: CalibrationObservation[] = []
  const requestsForTurn = (turnId: string): CalibrationRequestRecord[] => observations
    .filter(entry => entry.turnId === turnId)
    .map((entry, index) => toRequestRecord(entry, index + 1))
  let active: TurnContext | null = null
  const provider = new LiveBenchmarkProvider(config, {
    observe: observation => {
      const context = active
      if (context === null) throw new Error('live observation arrived outside a calibration turn')
      const step = observations.filter(entry => entry.turnId === context.id).length + 1
      const entry = observationOf(context, step, observation)
      observations.push(entry)
      // Print on arrival so a later turn failure cannot erase the usage rows
      // that were already paid for.
      const record = toRequestRecord(entry, observations.length)
      console.log(
        `${record.id} ${record.fixture} step=${record.step} http=${record.httpStatus} `
        + `wire=${record.wireFormat} model=${String(record.reportedModel)} `
        + `requestedMaxTokens=${String(record.requestedMaxTokens)} `
        + `rawUsage=${JSON.stringify(record.rawUsage)} `
        + `mapped=${record.usage.inputTokens}/${record.usage.outputTokens} `
        + `latencyMs=${record.latencyMs.toFixed(1)} finish=${String(record.finishReason)}`,
      )
    },
  })

  const generatedAt = new Date().toISOString()
  const wallStart = performance.now()
  const turns: CalibrationTurnRecord[] = []
  let aborted = false
  let turnIndex = 0

  for (const fixture of fixtures) {
    for (let run = 1; run <= runsPerFixture; run += 1) {
      if (aborted) break
      turnIndex += 1
      const context: TurnContext = {
        id: `T${String(turnIndex).padStart(2, '0')}`,
        fixture,
        run,
      }
      active = context
      try {
        const metrics = await runFixture(fixture, {
          gate,
          providerId: BENCHMARK_LIVE_PROVIDER_ID,
          model: config.model,
          live: true,
          budget: CALIBRATION_TURN_BUDGET,
          createProvider: () => provider,
        })
        const requests = requestsForTurn(context.id)
        if (requests.length !== metrics.requestPath.llmRequests) {
          throw new Error(
            `${context.id} recorded ${requests.length} usage rows but the request path `
            + `dispatched ${metrics.requestPath.llmRequests}`,
          )
        }
        turns.push(turnRecordFromMetrics(context, metrics, requests))
        if (metrics.outcome === 'budget_stop') aborted = true
      } catch (error) {
        if (mode === 'smoke') throw error
        turns.push(failedTurnRecord(context, error, requestsForTurn(context.id)))
      } finally {
        active = null
      }
    }
    if (aborted) break
  }

  const wallMs = performance.now() - wallStart
  const requests = observations.map((entry, index) => toRequestRecord(entry, index + 1))
  if (!turns.some(turn => turn.outcome === 'completed')) {
    throw new Error('live calibration produced no completed turn')
  }

  const dataset: CalibrationDataset = buildCalibrationDataset({
    generatedAt,
    endpoint: `${config.baseUrl}/chat/completions`,
    model: config.model,
    priceSchedule: config.pricing,
    turnBudget: CALIBRATION_TURN_BUDGET,
    caps: {
      maxRequests: gate.config.maxRequests,
      maxInputTokensPerRequest: gate.config.maxInputTokensPerRequest,
      maxOutputTokensPerRequest: gate.config.maxOutputTokensPerRequest,
      maxEstimatedCostCny: gate.config.maxEstimatedCostCny,
      usdToCnyRate: gate.config.usdToCnyRate,
    },
    session: {
      startedAt: generatedAt,
      finishedAt: new Date().toISOString(),
      wallMs,
      gate: gate.snapshot(),
    },
    turns,
    requests,
  })

  const serialized = JSON.stringify(dataset)
  if (config.apiKey !== '' && serialized.includes(config.apiKey)) {
    throw new Error('refusing to write a calibration dataset containing the API key')
  }

  const completed = dataset.turns.filter(turn => turn.outcome === 'completed').length
  console.log(
    `live calibration ${mode}: requests=${dataset.requests.length} turns=${dataset.turns.length} `
    + `completed=${completed} failed=${dataset.turns.filter(turn => turn.outcome === 'failed').length} `
    + `wall=${(wallMs / 1000).toFixed(1)}s `
    + `costUsd=${dataset.session.gate.estimatedCostUsd} costCny=${dataset.session.gate.estimatedCostCny}`,
  )

  if (mode === 'smoke') {
    assertSmokeUsable(observations, config)
    return
  }

  assertNoModelDrift(observations, config)
  const out = resolve(process.cwd(), RAW_OUT)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')
  console.log(`live calibration raw dataset: ${RAW_OUT}`)
}, TEST_TIMEOUT_MS)
