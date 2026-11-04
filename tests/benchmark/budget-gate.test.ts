import { describe, expect, it } from 'vitest'
import { LlmError, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  BENCHMARK_GATE_DEFAULTS,
  BenchmarkBudgetGate,
  BenchmarkBudgetStopError,
  type BenchmarkBudgetStop,
} from './budget-gate.js'
import {
  BENCHMARK_FIXTURES,
  SPEC_38_CLASSES,
  getBenchmarkFixture,
  type BenchmarkFixture,
} from './fixtures.js'
import { ScriptedLlmProvider } from './fake-provider.js'
import { buildBenchmarkRecord, runFixture } from './harness.js'
import { BenchmarkProviderFailureError } from './llm-request-path.js'

function monotonicClock(): { clock: () => number } {
  let now = 0
  return {
    clock: () => {
      now += 3
      return now
    },
  }
}

function budgetStopOf(metrics: { budgetStop: BenchmarkBudgetStop | null }): BenchmarkBudgetStop {
  const stop = metrics.budgetStop
  if (stop === null) throw new Error('expected a recorded budget_stop')
  return stop
}

function searchAttemptFixture(): BenchmarkFixture {
  const base = getBenchmarkFixture('ambiguous-wide-board')
  return {
    ...base,
    name: 'search-attempt',
    steps: [
      {
        label: 'the model tries to escape the Go lane with a web search',
        calls: [{ tool: 'web_search', query: 'best move in this position' }],
      },
    ],
    expectedFinalAction: { kind: 'play', point: { x: 4, y: 4 } },
    expectedIllegalAttempts: 0,
  }
}

class AlwaysFailingProvider extends ScriptedLlmProvider {
  attempts = 0

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.attempts += 1
    throw new LlmError('benchmark provider rate limited', 'RATE_LIMIT', { status: 429 })
  }
}

describe('benchmark spend/request gates (WAVE-C-T10)', () => {
  it('exposes the agreed defaults', () => {
    expect(BENCHMARK_GATE_DEFAULTS).toEqual({
      maxRequests: 96,
      maxInputTokensPerRequest: 8_000,
      maxOutputTokensPerRequest: 4_000,
      maxEstimatedCostUsd: 1,
      allowRetries: false,
      allowSearchFetch: false,
    })
  })

  it('never trips on a normal run: every fixture completes under the defaults', async () => {
    const gate = new BenchmarkBudgetGate()
    for (const fixture of BENCHMARK_FIXTURES) {
      const metrics = await runFixture(fixture, { gate, clock: monotonicClock().clock })

      expect(metrics.outcome).toBe('completed')
      expect(metrics.budgetStop).toBeNull()
      expect(metrics.requestPath.llmRequests).toBe(fixture.steps.length)
    }

    const snapshot = gate.snapshot()
    const expectedRequests = BENCHMARK_FIXTURES.reduce((sum, fixture) => sum + fixture.steps.length, 0)
    expect(snapshot.requests).toBe(expectedRequests)
    expect(snapshot.estimatedCostUsd).toBeGreaterThan(0)
    expect(snapshot.estimatedCostUsd).toBeLessThan(BENCHMARK_GATE_DEFAULTS.maxEstimatedCostUsd)
    expect(snapshot.stops).toEqual([])
  })

  it('covers a full record (8 classes x 3 runs) within the 96-request default', async () => {
    const gate = new BenchmarkBudgetGate()
    const record = await buildBenchmarkRecord({ runs: 3, gate, clock: monotonicClock().clock })

    const maxSteps = Math.max(...BENCHMARK_FIXTURES.map(fixture => fixture.steps.length))
    expect(SPEC_38_CLASSES.length * 3 * maxSteps).toBeLessThanOrEqual(
      BENCHMARK_GATE_DEFAULTS.maxRequests,
    )
    expect(record.budgetGate.requests).toBeLessThanOrEqual(BENCHMARK_GATE_DEFAULTS.maxRequests)
    expect(record.budgetGate.stops).toEqual([])
    for (const entry of record.classes) {
      for (const fixtureRecord of entry.fixtures) {
        expect(fixtureRecord.runs.every(run => run.outcome === 'completed')).toBe(true)
      }
    }
  })

  it('stops before the next request when maxRequests is exhausted', async () => {
    const gate = new BenchmarkBudgetGate({ maxRequests: 1 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
    })
    const stop = budgetStopOf(metrics)

    expect(metrics.outcome).toBe('budget_stop')
    expect(stop.gate).toBe('max-requests')
    expect(stop.requestIndex).toBe(1)
    expect(stop.limit).toBe(1)
    expect(metrics.requestPath.llmRequests).toBe(1)
    expect(metrics.modelSteps).toBe(2)
    expect(metrics.committedAction).toBeNull()
    expect(metrics.finalMove).toBe('none')
  })

  it('stops before dispatch when the estimated request input exceeds the cap', async () => {
    const gate = new BenchmarkBudgetGate({ maxInputTokensPerRequest: 10 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
    })
    const stop = budgetStopOf(metrics)

    expect(stop.gate).toBe('request-input-tokens')
    expect(metrics.requestPath.llmRequests).toBe(0)
    expect(gate.snapshot().requests).toBe(0)
    expect(gate.snapshot().inputTokens).toBe(0)
  })

  it('clamps an oversized request proposal to the 4000-output gate', async () => {
    const gate = new BenchmarkBudgetGate({ maxOutputTokensPerRequest: 512 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
    })

    expect(metrics.outcome).toBe('completed')
    expect(metrics.requestCaps).toEqual([512, 512])
    expect(metrics.requestPath.llmRequests).toBe(2)
    expect(gate.snapshot().stops).toEqual([])
    expect(metrics.budgetStop).toBeNull()
  })

  it('stops after a provider that reports more output than the cap allowed', async () => {
    const gate = new BenchmarkBudgetGate({ maxOutputTokensPerRequest: 100 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
    })
    const stop = budgetStopOf(metrics)

    expect(stop.gate).toBe('request-output-tokens')
    expect(stop.observed).toBe(192)
    expect(stop.limit).toBe(100)
    expect(metrics.requestPath.llmRequests).toBe(1)
    expect(metrics.modelSteps).toBe(1)
    expect(metrics.committedAction).toBeNull()
  })

  it('stops before the first request when the projected cost cannot fit the budget', async () => {
    const gate = new BenchmarkBudgetGate({ maxEstimatedCostUsd: 0 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
    })
    const stop = budgetStopOf(metrics)

    expect(stop.gate).toBe('estimated-cost')
    expect(metrics.requestPath.llmRequests).toBe(0)
    expect(gate.snapshot().requests).toBe(0)
  })

  it('accumulates reported cost and stops before a request that would exceed the budget', () => {
    const gate = new BenchmarkBudgetGate(
      { maxEstimatedCostUsd: 0.5, maxInputTokensPerRequest: 1_000_000 },
      { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 0 },
    )

    const admitted = gate.beginRequest({
      step: 1,
      estimatedInputTokens: 200_000,
      proposedMaxTokens: 10,
      toolNames: ['go.state'],
    })
    expect(admitted.requestIndex).toBe(1)
    gate.completeRequest({ step: 1, usage: { inputTokens: 200_000, outputTokens: 0 } })
    expect(gate.snapshot().estimatedCostUsd).toBeCloseTo(0.2, 9)

    let caught: unknown
    try {
      gate.beginRequest({
        step: 2,
        estimatedInputTokens: 400_000,
        proposedMaxTokens: 10,
        toolNames: ['go.state'],
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BenchmarkBudgetStopError)
    expect((caught as BenchmarkBudgetStopError).stop.gate).toBe('estimated-cost')
    expect(gate.snapshot().requests).toBe(1)
  })

  it('stops when reported usage pushes cost over the budget after a request', () => {
    const gate = new BenchmarkBudgetGate(
      { maxEstimatedCostUsd: 0.5, maxInputTokensPerRequest: 1_000_000 },
      { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 0 },
    )
    gate.beginRequest({
      step: 1,
      estimatedInputTokens: 100_000,
      proposedMaxTokens: 10,
      toolNames: ['go.state'],
    })

    expect(() => gate.completeRequest({
      step: 1,
      usage: { inputTokens: 600_000, outputTokens: 0 },
    })).toThrow(BenchmarkBudgetStopError)
    expect(gate.snapshot().estimatedCostUsd).toBeCloseTo(0.6, 9)
  })

  it('refuses a repeated step request (no automatic retries)', () => {
    const gate = new BenchmarkBudgetGate()
    gate.beginTurn()
    gate.beginRequest({ step: 1, estimatedInputTokens: 10, proposedMaxTokens: 10, toolNames: [] })

    let caught: unknown
    try {
      gate.beginRequest({ step: 1, estimatedInputTokens: 10, proposedMaxTokens: 10, toolNames: [] })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BenchmarkBudgetStopError)
    expect((caught as BenchmarkBudgetStopError).stop.gate).toBe('retries-forbidden')
    expect(gate.snapshot().requests).toBe(1)

    gate.beginTurn()
    expect(() => gate.beginRequest({
      step: 1,
      estimatedInputTokens: 10,
      proposedMaxTokens: 10,
      toolNames: [],
    })).not.toThrow()
  })

  it('does not retry a failed provider call and surfaces the failure', async () => {
    let provider: AlwaysFailingProvider | undefined
    const gate = new BenchmarkBudgetGate()

    await expect(runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
      createProvider: (fixture, gameId) => {
        provider = new AlwaysFailingProvider(fixture, gameId)
        return provider
      },
    })).rejects.toBeInstanceOf(BenchmarkProviderFailureError)

    expect(provider?.attempts).toBe(1)
    expect(gate.snapshot().requests).toBe(1)
  })

  it('refuses a request that declares a search/fetch tool before dispatch', () => {
    const gate = new BenchmarkBudgetGate()

    let caught: unknown
    try {
      gate.beginRequest({
        step: 1,
        estimatedInputTokens: 10,
        proposedMaxTokens: 10,
        toolNames: ['go.state', 'web_search'],
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BenchmarkBudgetStopError)
    expect((caught as BenchmarkBudgetStopError).stop.gate).toBe('search-fetch-forbidden')
    expect(gate.snapshot().requests).toBe(0)
  })

  it('stops before executing a search/fetch tool call streamed by the model', async () => {
    const gate = new BenchmarkBudgetGate()
    const metrics = await runFixture(searchAttemptFixture(), {
      gate,
      clock: monotonicClock().clock,
    })
    const stop = budgetStopOf(metrics)

    expect(stop.gate).toBe('search-fetch-forbidden')
    expect(stop.detail).toContain('web_search')
    expect(metrics.requestPath.llmRequests).toBe(1)
    expect(metrics.modelSteps).toBe(1)
    expect(metrics.committedAction).toBeNull()
    expect(metrics.finalMove).toBe('none')
  })

  it('records budget_stop in the record instead of silently continuing', async () => {
    const gate = new BenchmarkBudgetGate({ maxRequests: 1 })
    const record = await buildBenchmarkRecord({
      runs: 1,
      gate,
      clock: monotonicClock().clock,
      now: () => new Date('2026-11-04T00:00:00.000Z'),
    })

    const runs = record.classes.flatMap(entry => entry.fixtures.flatMap(fixture => fixture.runs))
    expect(runs).toHaveLength(SPEC_38_CLASSES.length)
    expect(runs.every(run => run.outcome === 'budget_stop')).toBe(true)
    expect(runs.every(run => run.budgetStop?.gate === 'max-requests')).toBe(true)
    expect(record.budgetGate.requests).toBe(1)
    expect(record.budgetGate.stops).toHaveLength(SPEC_38_CLASSES.length)
    expect(record.model.requestPath).toBe('dsh-llm-runtime')
  })
})
