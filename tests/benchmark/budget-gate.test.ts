import { describe, expect, it } from 'vitest'
import { LlmError, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { GO_TOOL_DEFINITIONS } from '../../src/tools/go/go-tools.js'
import {
  BENCHMARK_GATE_DEFAULTS,
  BENCHMARK_PLACEHOLDER_PRICES,
  estimateRequestInputTokens,
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

/**
 * Fixed reference tokenizer used only by the estimate test. Its per-character
 * rates are the reviewer-measured ones (CJK 1.0, ASCII 0.35, JSON punctuation
 * 0.5), so an estimate built on higher weights can never fall below it.
 */
const REFERENCE_JSON_PUNCTUATION = new Set(['{', '}', '[', ']', '"', ',', ':', ';'])

function referenceTokens(text: string): number {
  let weighted = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    const cjk = (codePoint >= 0x2e80 && codePoint <= 0x2fff)
      || (codePoint >= 0x3000 && codePoint <= 0x303f)
      || (codePoint >= 0x3040 && codePoint <= 0x30ff)
      || (codePoint >= 0x3400 && codePoint <= 0x4dbf)
      || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xff00 && codePoint <= 0xffef)
      || (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
    const rate = cjk
      ? 1
      : REFERENCE_JSON_PUNCTUATION.has(character) ? 0.5 : 0.35
    weighted += character.length * rate
  }
  return Math.ceil(weighted)
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

class OversizedInputProvider extends ScriptedLlmProvider {
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'usage', usage: { inputTokens: 9_000, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('benchmark spend/request gates (WAVE-C-T10)', () => {
  it('exposes the agreed defaults', () => {
    expect(BENCHMARK_GATE_DEFAULTS).toEqual({
      maxRequests: 120,
      maxInputTokensPerRequest: 8_000,
      maxOutputTokensPerRequest: 4_000,
      maxEstimatedCostCny: 6.66,
      usdToCnyRate: 7.1,
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
    expect(snapshot.estimatedCostCny).toBeGreaterThan(0)
    expect(snapshot.estimatedCostCny).toBeLessThan(BENCHMARK_GATE_DEFAULTS.maxEstimatedCostCny)
    expect(snapshot.usdToCnyRate).toBe(BENCHMARK_GATE_DEFAULTS.usdToCnyRate)
    expect(snapshot.estimatedCostCny).toBeCloseTo(
      snapshot.estimatedCostUsd * BENCHMARK_GATE_DEFAULTS.usdToCnyRate,
      9,
    )
    expect(snapshot.stops).toEqual([])
  })

  it('covers a full record (8 classes x 3 runs x 4 steps) with headroom in the 120-request default', async () => {
    const gate = new BenchmarkBudgetGate()
    const record = await buildBenchmarkRecord({ runs: 3, gate, clock: monotonicClock().clock })

    const maxSteps = Math.max(...BENCHMARK_FIXTURES.map(fixture => fixture.steps.length))
    expect(SPEC_38_CLASSES.length * 3 * maxSteps).toBe(96)
    expect(BENCHMARK_GATE_DEFAULTS.maxRequests).toBe(120)
    expect(SPEC_38_CLASSES.length * 3 * maxSteps).toBeLessThan(
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

  it('records the triggering request usage before stopping on the reported output cap', async () => {
    const gate = new BenchmarkBudgetGate({ maxOutputTokensPerRequest: 100 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
    })
    const stop = budgetStopOf(metrics)
    const snapshot = gate.snapshot()

    expect(metrics.outcome).toBe('budget_stop')
    expect(stop.gate).toBe('request-output-tokens')
    expect(stop.observed).toBe(192)

    expect(snapshot.outputTokens).toBe(192)
    expect(snapshot.inputTokens).toBeGreaterThan(0)
    expect(snapshot.requests).toBe(1)
    expect(snapshot.estimatedCostUsd).toBeCloseTo(
      (snapshot.inputTokens * gate.pricing.inputUsdPerMillionTokens
        + 192 * gate.pricing.outputUsdPerMillionTokens) / 1_000_000,
      12,
    )
    expect(snapshot.stops.map(entry => entry.gate)).toEqual(['request-output-tokens'])
  })

  it('stops when the provider reports more input tokens than the per-request cap', async () => {
    const gate = new BenchmarkBudgetGate({ maxInputTokensPerRequest: 8_000 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
      createProvider: (fixture, gameId) => new OversizedInputProvider(fixture, gameId),
    })
    const stop = budgetStopOf(metrics)
    const snapshot = gate.snapshot()

    expect(metrics.outcome).toBe('budget_stop')
    expect(stop.gate).toBe('request-input-tokens')
    expect(stop.observed).toBe(9_000)
    expect(stop.limit).toBe(8_000)
    expect(snapshot.inputTokens).toBe(9_000)
    expect(snapshot.outputTokens).toBe(10)
    expect(snapshot.requests).toBe(1)
    expect(snapshot.stops.map(entry => entry.gate)).toEqual(['request-input-tokens'])
  })

  it('requires an explicit price schedule in live mode and never applies the placeholder', () => {
    expect(() => new BenchmarkBudgetGate({}, undefined, 'live')).toThrow(RangeError)
    expect(() => new BenchmarkBudgetGate({}, undefined, 'live')).toThrow(/price schedule/)

    const live = new BenchmarkBudgetGate(
      {},
      { inputUsdPerMillionTokens: 0.28, outputUsdPerMillionTokens: 0.42 },
      'live',
    )
    expect(live.mode).toBe('live')
    expect(live.pricingSource).toBe('explicit')
    expect(live.pricing).toEqual({
      inputUsdPerMillionTokens: 0.28,
      outputUsdPerMillionTokens: 0.42,
    })

    const scripted = new BenchmarkBudgetGate()
    expect(scripted.mode).toBe('scripted')
    expect(scripted.pricingSource).toBe('placeholder')
    expect(scripted.pricing).toEqual(BENCHMARK_PLACEHOLDER_PRICES)
  })

  it('fails before the first request when the harness asks for live mode without prices', async () => {
    await expect(
      runFixture(getBenchmarkFixture('opening-spread'), {
        gateMode: 'live',
        clock: monotonicClock().clock,
      }),
    ).rejects.toThrow(/price schedule/)
  })

  it('stops before the first request when the projected cost cannot fit the budget', async () => {
    const gate = new BenchmarkBudgetGate({ maxEstimatedCostCny: 0 })
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      gate,
      clock: monotonicClock().clock,
    })
    const stop = budgetStopOf(metrics)

    expect(stop.gate).toBe('estimated-cost')
    expect(stop.limit).toBe(0)
    expect(metrics.requestPath.llmRequests).toBe(0)
    expect(gate.snapshot().requests).toBe(0)
  })

  it('reserves the worst-case maxTokens cost before dispatch and settles by real usage', () => {
    const gate = new BenchmarkBudgetGate(
      { maxEstimatedCostCny: 0.5, usdToCnyRate: 1, maxInputTokensPerRequest: 1_000_000 },
      { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 1 },
    )

    const decision = gate.beginRequest({
      step: 1,
      estimatedInputTokens: 10,
      proposedMaxTokens: 1_000,
      toolNames: ['go.state'],
    })
    expect(decision.reservedCostUsd).toBeCloseTo(0.001, 12)
    expect(gate.snapshot().estimatedCostUsd).toBe(0)
    expect(gate.snapshot().reservedCostUsd).toBeCloseTo(0.001, 12)

    gate.completeRequest({ step: 1, usage: { inputTokens: 10, outputTokens: 50 } })
    expect(gate.snapshot().estimatedCostUsd).toBeCloseTo(0.00005, 12)
    expect(gate.snapshot().reservedCostUsd).toBe(0)
  })

  it('stops before dispatch when the reservation alone would exceed the budget', () => {
    const gate = new BenchmarkBudgetGate(
      { maxEstimatedCostCny: 0.001, usdToCnyRate: 1, maxInputTokensPerRequest: 1_000_000 },
      { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 1 },
    )

    let caught: unknown
    try {
      gate.beginRequest({
        step: 1,
        estimatedInputTokens: 10,
        proposedMaxTokens: 2_000,
        toolNames: ['go.state'],
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(BenchmarkBudgetStopError)
    expect((caught as BenchmarkBudgetStopError).stop.gate).toBe('estimated-cost')
    expect(gate.snapshot().requests).toBe(0)
    expect(gate.snapshot().reservedCostUsd).toBe(0)
  })

  it('accumulates reported cost and stops before a request that would exceed the budget', () => {
    const gate = new BenchmarkBudgetGate(
      { maxEstimatedCostCny: 0.5, usdToCnyRate: 1, maxInputTokensPerRequest: 1_000_000 },
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
      { maxEstimatedCostCny: 0.5, usdToCnyRate: 1, maxInputTokensPerRequest: 1_000_000 },
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

  it('stops on negative, NaN, and Infinity usage before it can corrupt the ledger', () => {
    const cases = [
      { label: 'negative input/output', usage: { inputTokens: -1e6, outputTokens: -1e6 } },
      { label: 'NaN input', usage: { inputTokens: Number.NaN, outputTokens: 10 } },
      { label: 'Infinity output', usage: { inputTokens: 10, outputTokens: Number.POSITIVE_INFINITY } },
      {
        label: 'negative cache read',
        usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: -1e6 },
      },
    ]

    for (const testCase of cases) {
      const gate = new BenchmarkBudgetGate()
      gate.beginRequest({
        step: 1,
        estimatedInputTokens: 10,
        proposedMaxTokens: 10,
        toolNames: [],
      })

      let caught: unknown
      try {
        gate.completeRequest({ step: 1, usage: testCase.usage })
      } catch (error) {
        caught = error
      }

      expect(caught, testCase.label).toBeInstanceOf(BenchmarkBudgetStopError)
      expect((caught as BenchmarkBudgetStopError).stop.gate, testCase.label).toBe('invalid-usage')

      const snapshot = gate.snapshot()
      expect(snapshot.estimatedCostUsd, testCase.label).toBe(0)
      expect(snapshot.inputTokens, testCase.label).toBe(0)
      expect(snapshot.outputTokens, testCase.label).toBe(0)
      expect(snapshot.cacheReadTokens, testCase.label).toBe(0)
      expect(snapshot.stops.map(entry => entry.gate), testCase.label).toEqual(['invalid-usage'])
      // A malformed response is a failed request: its worst-case reservation is
      // released so it cannot leak into the rest of the session.
      expect(snapshot.reservedCostUsd, testCase.label).toBe(0)
    }
  })

  it('estimates Chinese, mixed and dense-JSON input at or above the fixed reference usage', () => {
    // Fixed reference rates, deliberately the rates the reviewer measured:
    // CJK 1.0 token/char, ASCII 0.35 token/char, JSON punctuation 0.5. The
    // estimate must never fall below it, including chat-template overhead.
    const samples = [
      {
        label: 'pure Chinese 8000 chars',
        request: { system: '中'.repeat(8_000), messages: [], tools: [] },
      },
      {
        label: 'mixed Chinese and English',
        request: {
          system: '中'.repeat(4_000)
            + 'The model reads the position and commits exactly one move. '.repeat(142),
          messages: [],
          tools: [],
        },
      },
      {
        label: 'dense JSON tool schema',
        request: {
          system: 'You are the DeepSeek Go lane of a companion Go game.',
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: 'Read the position and commit one move.' }],
          }],
          tools: GO_TOOL_DEFINITIONS,
        },
      },
    ]

    for (const sample of samples) {
      const text = (sample.request.system ?? '')
        + JSON.stringify(sample.request.messages)
        + JSON.stringify(sample.request.tools)
      const estimate = estimateRequestInputTokens(sample.request)
      expect(estimate, sample.label).toBeGreaterThanOrEqual(referenceTokens(text))
    }
  })

  it('charges CJK, ASCII and JSON punctuation at or above the measured floors', () => {
    const cjk = estimateRequestInputTokens({ system: '中'.repeat(1_000), messages: [] })
    const ascii = estimateRequestInputTokens({ system: 'a'.repeat(1_000), messages: [] })
    const punctuation = estimateRequestInputTokens({ system: '{}[]",:;'.repeat(100), messages: [] })

    expect(cjk).toBeGreaterThanOrEqual(600)
    expect(ascii).toBeGreaterThanOrEqual(350)
    expect(punctuation).toBeGreaterThanOrEqual(350)
    // The weights are strictly above the floors, so a real tokenizer at the
    // reference rate cannot exceed the estimate.
    expect(cjk).toBeGreaterThan(1_000)
    expect(ascii).toBeGreaterThan(350)
  })

  it('stops an 8000-character Chinese request the flat 4-chars/token estimate admitted', () => {
    const system = '中'.repeat(8_000)
    const estimate = estimateRequestInputTokens({ system, messages: [], tools: [] })
    expect(estimate).toBeGreaterThan(8_000)

    const gate = new BenchmarkBudgetGate()
    expect(() => gate.beginRequest({
      step: 1,
      estimatedInputTokens: estimate,
      proposedMaxTokens: 10,
      toolNames: [],
    })).toThrow(BenchmarkBudgetStopError)

    expect(gate.snapshot().requests).toBe(0)
    expect(gate.snapshot().stops.map(entry => entry.gate)).toEqual(['request-input-tokens'])
  })

  it('releases a failed request reservation and never counts the same step twice', () => {
    const gate = new BenchmarkBudgetGate(
      {
        allowRetries: true,
        maxEstimatedCostCny: 10,
        usdToCnyRate: 1,
        maxInputTokensPerRequest: 1_000_000,
      },
      { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 1 },
    )
    const input = { step: 1, estimatedInputTokens: 10, proposedMaxTokens: 1_000, toolNames: [] }

    gate.beginRequest(input)
    expect(gate.snapshot().reservedCostUsd).toBeCloseTo(0.001, 12)

    expect(gate.releaseRequest(1)).toBe(true)
    expect(gate.snapshot().reservedCostUsd).toBe(0)
    expect(gate.releaseRequest(1)).toBe(false)

    gate.beginTurn()
    gate.beginRequest(input)
    expect(gate.snapshot().reservedCostUsd).toBeCloseTo(0.001, 12)

    // Re-entering the same step without an explicit release replaces the stale
    // reservation instead of stacking a second one.
    gate.beginTurn()
    gate.beginRequest(input)
    expect(gate.snapshot().reservedCostUsd).toBeCloseTo(0.001, 12)
    expect(gate.snapshot().requests).toBe(3)

    gate.completeRequest({ step: 1, usage: { inputTokens: 10, outputTokens: 50 } })
    expect(gate.snapshot().reservedCostUsd).toBe(0)
    expect(gate.snapshot().estimatedCostUsd).toBeCloseTo(0.00005, 12)
  })

  it('stops with a budget_stop when a request completes without a reservation', () => {
    const gate = new BenchmarkBudgetGate()

    let caught: unknown
    try {
      gate.completeRequest({ step: 9, usage: { inputTokens: 10, outputTokens: 10 } })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(BenchmarkBudgetStopError)
    expect((caught as BenchmarkBudgetStopError).stop.gate).toBe('missing-reservation')
    expect(gate.snapshot().stops.map(entry => entry.gate)).toEqual(['missing-reservation'])
  })

  it('caps spend in CNY using the recorded USD/CNY rate, before dispatch', () => {
    const gate = new BenchmarkBudgetGate(
      { maxEstimatedCostCny: 7.1, usdToCnyRate: 7.1, maxInputTokensPerRequest: 1_000_000 },
      { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 1_000 },
    )

    const decision = gate.beginRequest({
      step: 1,
      estimatedInputTokens: 10,
      proposedMaxTokens: 1_000,
      toolNames: [],
    })
    expect(decision.reservedCostUsd).toBeCloseTo(1, 12)
    expect(gate.snapshot().reservedCostCny).toBeCloseTo(7.1, 12)
    expect(gate.snapshot().maxEstimatedCostCny).toBe(7.1)
    expect(gate.snapshot().usdToCnyRate).toBe(7.1)

    let caught: unknown
    try {
      gate.beginRequest({
        step: 2,
        estimatedInputTokens: 10,
        proposedMaxTokens: 1_000,
        toolNames: [],
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(BenchmarkBudgetStopError)
    expect((caught as BenchmarkBudgetStopError).stop.gate).toBe('estimated-cost')
    expect((caught as BenchmarkBudgetStopError).stop.limit).toBe(7.1)
    expect(gate.snapshot().requests).toBe(1)
  })
})
