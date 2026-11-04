import { describe, expect, it } from 'vitest'
import type { GoTurnBudget } from '../../src/contracts/budget.js'
import {
  GoTurnBudgetExhaustedError,
  type GoTurnEnforcement,
} from '../../src/budget/enforcement.js'
import { BENCHMARK_FIXTURES, CANDIDATE_BUDGET, SPEC_38_CLASSES, getBenchmarkFixture } from './fixtures.js'
import {
  CognitionBenchmarkBypassError,
  buildBenchmarkRecord,
  runFixture,
  summarizeVariation,
} from './harness.js'

function monotonicClock(): { clock: () => number } {
  let now = 0
  return {
    clock: () => {
      now += 3
      return now
    },
  }
}

function runThree(fixtureName: string) {
  const fixture = getBenchmarkFixture(fixtureName)
  return Promise.all(
    [0, 1, 2].map(() => runFixture(fixture, { clock: monotonicClock().clock })),
  )
}

describe('Spec §38 scripted cognition benchmark (WAVE-C-T10)', () => {
  it('covers exactly the eight §38 fixture classes without collapsing categories', () => {
    expect(BENCHMARK_FIXTURES.map(fixture => fixture.class)).toEqual([...SPEC_38_CLASSES])
    expect(new Set(BENCHMARK_FIXTURES.map(fixture => fixture.name)).size).toBe(
      BENCHMARK_FIXTURES.length,
    )
  })

  it('runs every fixture through the real tool, enforcement, boost and cap path', async () => {
    for (const fixture of BENCHMARK_FIXTURES) {
      const metrics = await runFixture(fixture, { clock: monotonicClock().clock })

      expect(metrics.committedAction).toBe(
        fixture.expectedFinalAction.kind === 'play' ? 'play' : 'pass',
      )
      expect(metrics.illegalAttempts).toBe(fixture.expectedIllegalAttempts)
      expect(metrics.modelSteps).toBe(fixture.steps.length)
      expect(metrics.requestCaps).toEqual(fixture.steps.map(() => CANDIDATE_BUDGET.perRequestMaxTokens))
      expect(metrics.oversizedProposalsClamped).toBe(fixture.steps.length)
      expect(metrics.turnTokens).toBe(metrics.inputTokens + metrics.outputTokens)
      expect(metrics.remainingTurnTokens).toBe(
        CANDIDATE_BUDGET.maxTurnTokens - metrics.turnTokens,
      )
    }
  })

  it('produces identical structural metrics across repeated runs', async () => {
    for (const fixture of BENCHMARK_FIXTURES) {
      const runs = await runThree(fixture.name)
      const variation = summarizeVariation(runs)

      expect(variation.identicalStructuralMetrics).toBe(true)
      expect(new Set(runs.map(run => JSON.stringify(run))).size).toBe(1)
      expect(variation.latencyMs.range).toBe(0)
    }
  })

  it('accounts the bounded deep-think boost as one extra model step', async () => {
    const metrics = await runFixture(getBenchmarkFixture('large-group-pressure'), {
      clock: monotonicClock().clock,
    })

    expect(metrics.deepThinkRequests).toBe(1)
    expect(metrics.deepThinkBoostConsumed).toBe(1)
    expect(metrics.modelSteps).toBe(CANDIDATE_BUDGET.maxModelSteps + 1)
  })

  it('records the ko recapture as a rejected illegal attempt and still commits a legal move', async () => {
    const metrics = await runFixture(getBenchmarkFixture('ko-immediate-recapture'), {
      clock: monotonicClock().clock,
    })

    expect(metrics.illegalAttempts).toBe(1)
    expect(metrics.illegalAttemptReasons).toEqual(['go.play superko'])
    expect(metrics.finalMove).toBe('play (6,6)')
  })

  it('clamps an oversized request proposal to the per-request hard cap', async () => {
    const metrics = await runFixture(getBenchmarkFixture('opening-spread'), {
      clock: monotonicClock().clock,
    })

    expect(metrics.requestCaps.length).toBeGreaterThan(0)
    expect(metrics.requestCaps.every(cap => cap === CANDIDATE_BUDGET.perRequestMaxTokens)).toBe(true)
    expect(metrics.oversizedProposalsClamped).toBe(metrics.modelSteps)
  })

  it('fails when a tool execution bypasses enforcement accounting', async () => {
    const budget = CANDIDATE_BUDGET
    const bypass = (limits: GoTurnBudget): GoTurnEnforcement => ({
      requestTokenCap: async (_payload, next) => next(),
      remainingTurnTokens: () => limits.maxTurnTokens,
      snapshot: () => ({
        limits,
        modelSteps: 0,
        inspectCalls: 0,
        tryMoves: 0,
        deepThinkRequests: 0,
        deepThinkBoost: { pendingModelSteps: 0, grantedModelSteps: 0, consumedModelSteps: 0 },
        turnTokens: 0,
        committedAction: undefined,
        gameTerminal: false,
      }),
      beginModelStep: () => ({ index: 1, complete: () => {} }),
      beginInspect: () => {},
      beginTryMove: () => {},
      beginDeepThink: () => ({ granted: true, modelSteps: 1 }),
      recordCommittedAction: () => {},
    })

    await expect(
      runFixture(getBenchmarkFixture('simple-capture-single-stone'), {
        createEnforcement: bypass,
      }),
    ).rejects.toBeInstanceOf(CognitionBenchmarkBypassError)
  })

  it('fails closed when the turn budget is smaller than the scripted plan', async () => {
    await expect(
      runFixture(getBenchmarkFixture('opening-spread'), { budget: { maxModelSteps: 1 } }),
    ).rejects.toBeInstanceOf(GoTurnBudgetExhaustedError)

    await expect(
      runFixture(getBenchmarkFixture('opening-spread'), { budget: { maxInspectCalls: 0 } }),
    ).rejects.toBeInstanceOf(GoTurnBudgetExhaustedError)
  })

  it('emits a record with every class and three runs per fixture, labelled scripted', async () => {
    const record = await buildBenchmarkRecord({
      runs: 3,
      clock: monotonicClock().clock,
      now: () => new Date('2026-11-04T00:00:00.000Z'),
      budget: CANDIDATE_BUDGET,
    })

    expect(record.classes.map(entry => entry.class)).toEqual([...SPEC_38_CLASSES])
    expect(record.runsPerFixture).toBe(3)
    for (const entry of record.classes) {
      expect(entry.fixtures.length).toBe(1)
      for (const fixtureRecord of entry.fixtures) {
        expect(fixtureRecord.runs).toHaveLength(3)
        expect(fixtureRecord.variation.identicalStructuralMetrics).toBe(true)
      }
    }
    expect(record.model.isDeepSeek).toBe(false)
    expect(record.model.kind).toBe('scripted-deterministic')
    expect(record.budgetUnderTest.status).toBe('candidate-not-applied')
  })
})
