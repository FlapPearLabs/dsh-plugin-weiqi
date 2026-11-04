import { describe, expect, expectTypeOf, it } from 'vitest'
import { GO_TURN_BUDGET_FIELDS } from './budget.js'
import type { GoTurnBudget } from './index.js'

/**
 * TEST FIXTURE ONLY.
 *
 * These numbers are NOT production calibration and must never be presented as
 * production defaults. BL-BUD-06 / WAVE-C-T10 owns benchmark-derived
 * calibration of every GoTurnBudget numeric value (Spec §22).
 */
const NON_PRODUCTION_FIXTURE = {
  maxModelSteps: 3,
  maxInspectCalls: 7,
  maxTryMoves: 2,
  perRequestMaxTokens: 1024,
  maxTurnTokens: 4096,
} as const satisfies GoTurnBudget

describe('GoTurnBudget contract (Spec §22, BL-BUD-01)', () => {
  it('declares exactly the five Spec §22 fields', () => {
    // Teeth: removing or renaming any required field breaks this assertion.
    expectTypeOf<keyof GoTurnBudget>().toEqualTypeOf<
      'maxModelSteps' | 'maxInspectCalls' | 'maxTryMoves' | 'perRequestMaxTokens' | 'maxTurnTokens'
    >()

    expect(GO_TURN_BUDGET_FIELDS).toEqual([
      'maxModelSteps',
      'maxInspectCalls',
      'maxTryMoves',
      'perRequestMaxTokens',
      'maxTurnTokens',
    ])
    expectTypeOf<(typeof GO_TURN_BUDGET_FIELDS)[number]>().toEqualTypeOf<keyof GoTurnBudget>()
  })

  it('requires every field as a number, never optional or partial', () => {
    // Teeth: dropping `?`-free requiredness or changing a field's type breaks this.
    expectTypeOf<GoTurnBudget>().toEqualTypeOf<{
      maxModelSteps: number
      maxInspectCalls: number
      maxTryMoves: number
      perRequestMaxTokens: number
      maxTurnTokens: number
    }>()
  })

  it('keeps the per-request cap separate from the turn-level cap', () => {
    const budget: GoTurnBudget = { ...NON_PRODUCTION_FIXTURE }
    expect(budget.perRequestMaxTokens).toBe(1024)
    expect(budget.maxTurnTokens).toBe(4096)
    expect(budget.perRequestMaxTokens).not.toBe(budget.maxTurnTokens)
  })
})
