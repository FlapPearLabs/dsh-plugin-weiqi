import { describe, expect, it } from 'vitest'
import { GO_TURN_BUDGET_FIELDS, type GoTurnBudget } from '../contracts/budget.js'
import { GoTurnBudgetConfigError, loadGoTurnBudget } from './config.js'

/**
 * TEST FIXTURE ONLY. These numbers are injected by the test and are NOT
 * production calibration; BL-BUD-06 / WAVE-C-T10 owns benchmark-derived values.
 */
const NON_PRODUCTION_FIXTURE = {
  maxModelSteps: 3,
  maxInspectCalls: 7,
  maxTryMoves: 2,
  perRequestMaxTokens: 1024,
  maxTurnTokens: 4096,
} as const satisfies GoTurnBudget

function captureError(source: unknown): GoTurnBudgetConfigError {
  try {
    loadGoTurnBudget(source)
  } catch (error) {
    if (!(error instanceof GoTurnBudgetConfigError)) throw error
    return error
  }
  throw new Error('expected loadGoTurnBudget to reject the source')
}

describe('loadGoTurnBudget', () => {
  it('loads only the explicitly injected fixture values', () => {
    const budget = loadGoTurnBudget(NON_PRODUCTION_FIXTURE)

    expect(budget).toEqual(NON_PRODUCTION_FIXTURE)
    expect(Object.keys(budget)).toEqual([...GO_TURN_BUDGET_FIELDS])
  })

  it('keeps two injections independent instead of sharing implicit defaults', () => {
    const second: GoTurnBudget = {
      maxModelSteps: 11,
      maxInspectCalls: 13,
      maxTryMoves: 17,
      perRequestMaxTokens: 19,
      maxTurnTokens: 23,
    }

    expect(loadGoTurnBudget(NON_PRODUCTION_FIXTURE)).toEqual(NON_PRODUCTION_FIXTURE)
    expect(loadGoTurnBudget(second)).toEqual(second)
  })

  it('rejects a missing required field instead of filling a default', () => {
    const { maxTryMoves: _omitted, ...incomplete } = NON_PRODUCTION_FIXTURE
    const error = captureError(incomplete)

    expect(error.issues).toEqual([{ field: 'maxTryMoves', reason: 'missing' }])
    expect(error.message).toContain('maxTryMoves')
    expect(error.message).not.toContain('maxModelSteps')
  })

  it('rejects invalid field values', () => {
    const invalidValues: readonly unknown[] = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', true, null]

    for (const value of invalidValues) {
      const error = captureError({ ...NON_PRODUCTION_FIXTURE, maxInspectCalls: value })
      expect(error.issues).toEqual([{ field: 'maxInspectCalls', reason: 'not-positive-integer' }])
    }
  })

  it('rejects a non-object source', () => {
    for (const source of [undefined, null, 'budget', 42, [], () => NON_PRODUCTION_FIXTURE]) {
      const error = captureError(source)
      expect(error.issues).toEqual([{ reason: 'not-an-object' }])
      expect(error.message).toContain('expected an object')
    }
  })

  it('reports every problem in one error', () => {
    const { maxModelSteps: _omitted, ...incomplete } = NON_PRODUCTION_FIXTURE
    const error = captureError({ ...incomplete, maxTurnTokens: -5 })

    expect(error.issues).toEqual([
      { field: 'maxModelSteps', reason: 'missing' },
      { field: 'maxTurnTokens', reason: 'not-positive-integer' },
    ])
    expect(error.message).toContain('missing: maxModelSteps')
    expect(error.message).toContain('not a positive integer: maxTurnTokens')
  })

  it('ignores unrelated keys so wider configuration objects can be injected', () => {
    const budget = loadGoTurnBudget({ ...NON_PRODUCTION_FIXTURE, unrelated: 'ignored' })

    expect(budget).toEqual(NON_PRODUCTION_FIXTURE)
    expect(Object.keys(budget)).toEqual([...GO_TURN_BUDGET_FIELDS])
  })
})
