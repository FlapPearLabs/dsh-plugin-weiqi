import {
  GO_TURN_BUDGET_FIELDS,
  type GoTurnBudget,
  type GoTurnBudgetField,
} from '../contracts/budget.js'

export type GoTurnBudgetConfigIssue =
  | { readonly reason: 'not-an-object' }
  | {
      readonly field: GoTurnBudgetField
      readonly reason: 'missing' | 'not-positive-integer' | 'not-non-negative-integer'
    }

/**
 * Lowest legal value per field, as an integer lower bound.
 *
 * Spec §22 types every field as `number` and defines exhaustion (§22.4) as
 * "the cap is reached", so `0` is a legal "forbid this operation" configuration
 * for the tool counters and for both token caps (a 0 token cap is a "no
 * request" cap). `maxModelSteps: 0` is rejected because a turn with no model
 * step can never produce Go cognition at all, which is not a budget.
 *
 * This loader only enforces integer bounds; what a 0 cap means at runtime is
 * WAVE-C-T07's enforcement decision.
 */
const MINIMUM_BY_FIELD: Readonly<Record<GoTurnBudgetField, 0 | 1>> = {
  maxModelSteps: 1,
  maxInspectCalls: 0,
  maxTryMoves: 0,
  perRequestMaxTokens: 0,
  maxTurnTokens: 0,
}

export class GoTurnBudgetConfigError extends Error {
  readonly issues: readonly GoTurnBudgetConfigIssue[]

  constructor(issues: readonly GoTurnBudgetConfigIssue[]) {
    super(formatMessage(issues))
    this.name = 'GoTurnBudgetConfigError'
    this.issues = issues
  }
}

/**
 * Validate an explicitly injected GoTurnBudget configuration.
 *
 * There are no implicit defaults: every Spec §22 field must be supplied as an
 * integer satisfying its lower bound, otherwise all problems are reported at
 * once. Values passed here are test configuration until BL-BUD-06 /
 * WAVE-C-T10 derives production numbers from the §38 benchmark; this loader
 * never claims calibration. Unrelated keys are ignored so a wider
 * configuration object can be injected.
 */
export function loadGoTurnBudget(source: unknown): GoTurnBudget {
  if (!isRecord(source)) {
    throw new GoTurnBudgetConfigError([{ reason: 'not-an-object' }])
  }

  const issues: GoTurnBudgetConfigIssue[] = []
  const validated: Partial<Record<GoTurnBudgetField, number>> = {}

  for (const field of GO_TURN_BUDGET_FIELDS) {
    const value = source[field]
    if (value === undefined) {
      issues.push({ field, reason: 'missing' })
    } else if (typeof value !== 'number' || !Number.isInteger(value)) {
      issues.push({ field, reason: invalidReason(field) })
    } else if (value < MINIMUM_BY_FIELD[field]) {
      issues.push({ field, reason: invalidReason(field) })
    } else {
      validated[field] = value
    }
  }

  if (issues.length > 0) {
    throw new GoTurnBudgetConfigError(issues)
  }

  return validated as GoTurnBudget
}

function invalidReason(field: GoTurnBudgetField): 'not-positive-integer' | 'not-non-negative-integer' {
  return MINIMUM_BY_FIELD[field] === 1 ? 'not-positive-integer' : 'not-non-negative-integer'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatMessage(issues: readonly GoTurnBudgetConfigIssue[]): string {
  if (issues.some(issue => issue.reason === 'not-an-object')) {
    return 'Invalid GoTurnBudget config: expected an object'
  }

  const missing = issues.flatMap(issue => (issue.reason === 'missing' ? [issue.field] : []))
  const notPositive = issues.flatMap(issue =>
    issue.reason === 'not-positive-integer' ? [issue.field] : [],
  )
  const notNonNegative = issues.flatMap(issue =>
    issue.reason === 'not-non-negative-integer' ? [issue.field] : [],
  )
  const details: string[] = []
  if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`)
  if (notPositive.length > 0) details.push(`not a positive integer: ${notPositive.join(', ')}`)
  if (notNonNegative.length > 0) {
    details.push(`not a non-negative integer: ${notNonNegative.join(', ')}`)
  }
  return `Invalid GoTurnBudget config: ${details.join('; ')}`
}
