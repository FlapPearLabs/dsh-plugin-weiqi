/**
 * Per-turn Go cognition budget (verified Spec §22, BL-BUD-01).
 *
 * The five field names are frozen by the Spec; their numeric values are NOT.
 * Production values are benchmark-derived and owned by BL-BUD-06 / WAVE-C-T10,
 * so this module deliberately carries no defaults.
 */
export const GO_TURN_BUDGET_FIELDS = [
  'maxModelSteps',
  'maxInspectCalls',
  'maxTryMoves',
  'perRequestMaxTokens',
  'maxTurnTokens',
] as const satisfies readonly (keyof GoTurnBudget)[]

export type GoTurnBudgetField = (typeof GO_TURN_BUDGET_FIELDS)[number]

/**
 * Budget owned by one DeepSeek Go turn (Spec §22).
 *
 * Every field is required: a partial budget or an implicit fallback would let
 * an uncalibrated number decide the turn. Consumers receive explicit values
 * from the GoTurnBudget config loader, which never invents defaults.
 */
export type GoTurnBudget = {
  /** Model steps allowed in one Go turn (§22.2). */
  maxModelSteps: number
  /** `go.inspect_*` executions allowed in one Go turn (§22.3). */
  maxInspectCalls: number
  /** `go.try_move` executions allowed in one Go turn (§22.3). */
  maxTryMoves: number
  /** Hard cap on one Go model request (§22.1). */
  perRequestMaxTokens: number
  /** Turn-level token cap; new model steps are denied once exhausted (§22.2). */
  maxTurnTokens: number
}
