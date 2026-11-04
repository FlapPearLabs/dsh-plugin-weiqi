import {
  GO_TURN_BUDGET_FIELDS,
  type GoTurnBudget,
  type GoTurnBudgetField,
} from '../contracts/budget.js'

export type GoTurnBudgetConfigIssue =
  | { readonly reason: 'not-an-object' }
  | {
      readonly field: GoTurnBudgetField
      readonly reason: 'missing' | 'not-positive-integer'
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
 * There are no implicit defaults: every Spec §22 field must be supplied as a
 * positive integer, otherwise all problems are reported at once. Values passed
 * here are test configuration until BL-BUD-06 / WAVE-C-T10 derives production
 * numbers from the §38 benchmark; this loader never claims calibration.
 * Unrelated keys are ignored so a wider configuration object can be injected.
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
    } else if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      issues.push({ field, reason: 'not-positive-integer' })
    } else {
      validated[field] = value
    }
  }

  if (issues.length > 0) {
    throw new GoTurnBudgetConfigError(issues)
  }

  return validated as GoTurnBudget
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatMessage(issues: readonly GoTurnBudgetConfigIssue[]): string {
  if (issues.some(issue => issue.reason === 'not-an-object')) {
    return 'Invalid GoTurnBudget config: expected an object'
  }

  const missing = issues.flatMap(issue => (issue.reason === 'missing' ? [issue.field] : []))
  const invalid = issues.flatMap(issue =>
    issue.reason === 'not-positive-integer' ? [issue.field] : [],
  )
  const details: string[] = []
  if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`)
  if (invalid.length > 0) details.push(`not a positive integer: ${invalid.join(', ')}`)
  return `Invalid GoTurnBudget config: ${details.join('; ')}`
}
