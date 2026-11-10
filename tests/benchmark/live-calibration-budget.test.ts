import { describe, expect, it } from 'vitest'
import {
  C_T10_FULL_BUDGET_CNY,
  C_T10_ROUND_BUDGET_CNY,
  C_T10_SMOKE_BUDGET_CNY,
} from './live-calibration.js'

describe('C-T10 live calibration round budget', () => {
  it('keeps the smoke and full caps inside the approved ¥6.66 round envelope', () => {
    expect(C_T10_ROUND_BUDGET_CNY).toBe(6.66)
    expect(C_T10_SMOKE_BUDGET_CNY).toBe(0.5)
    expect(C_T10_FULL_BUDGET_CNY).toBe(6.16)
    expect(C_T10_SMOKE_BUDGET_CNY + C_T10_FULL_BUDGET_CNY)
      .toBeLessThanOrEqual(C_T10_ROUND_BUDGET_CNY)
  })
})
