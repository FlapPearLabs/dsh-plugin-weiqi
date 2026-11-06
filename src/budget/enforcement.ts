import type { GoTurnBudget } from '../contracts/budget.js'
import { loadGoTurnBudget } from './config.js'
import { createGoRequestTokenCap, type GoRequestTokenCapListener } from './request-cap.js'

/** Model-visible actions that consume Go cognition (Spec §22.3, §24). */
export type GoTurnAnalysisAction = 'model_step' | 'inspect' | 'try_move' | 'deep_think'

/** Every gated Go turn action, including the authoritative action commit. */
export type GoTurnAction = GoTurnAnalysisAction | 'commit'

/** The authoritative actions that end a Go turn's analysis loop (Spec §24). */
export type GoTurnCommit = 'play' | 'pass' | 'resign'

/** The counted `go.*` executions of Spec §22.3. */
export type GoToolKind = 'inspect' | 'try_move'

/** The Spec §22 budget field a denial belongs to. */
export type GoTurnBudgetCounter =
  | 'maxModelSteps'
  | 'maxInspectCalls'
  | 'maxTryMoves'
  | 'maxTurnTokens'

/** Raised when the next actual execution would exceed its Spec §22 cap. */
export class GoTurnBudgetExhaustedError extends Error {
  readonly counter: GoTurnBudgetCounter
  readonly limit: number
  readonly used: number

  constructor(counter: GoTurnBudgetCounter, limit: number, used: number) {
    super(`Go turn budget exhausted: ${counter} (${used}/${limit})`)
    this.name = 'GoTurnBudgetExhaustedError'
    this.counter = counter
    this.limit = limit
    this.used = used
  }
}

/** Raised when an action is attempted after the turn's authoritative action. */
export class GoTurnAnalysisEndedError extends Error {
  readonly action: GoTurnAction
  readonly committedAction: GoTurnCommit
  readonly gameTerminal: boolean

  constructor(action: GoTurnAction, committedAction: GoTurnCommit, gameTerminal: boolean) {
    super(
      `Go turn analysis already ended by committed ${committedAction}; ${action} is not permitted`,
    )
    this.name = 'GoTurnAnalysisEndedError'
    this.action = action
    this.committedAction = committedAction
    this.gameTerminal = gameTerminal
  }
}

/** Raised when the single §23 deep-think boost was already requested this turn. */
export class GoDeepThinkAlreadyRequestedError extends Error {
  constructor() {
    super('Go deep-think boost was already requested in this turn')
    this.name = 'GoDeepThinkAlreadyRequestedError'
  }
}

/** Raised when a reported model-step usage cannot be accounted safely. */
export type GoTurnUsageIssue = 'not-a-non-negative-integer' | 'already-recorded'

export class GoTurnUsageError extends Error {
  readonly reason: GoTurnUsageIssue

  constructor(reason: GoTurnUsageIssue) {
    super(
      reason === 'already-recorded'
        ? 'Go model-step usage was already recorded with a different token count'
        : 'Go model-step usage tokens must be a non-negative integer',
    )
    this.name = 'GoTurnUsageError'
    this.reason = reason
  }
}

/** Token usage one model step reports once its request completes. */
export type GoModelStepUsage = Readonly<{
  tokens: number
}>

/**
 * One admitted model step. Completing it charges turn tokens exactly once, so
 * an aggregated or repeated report cannot spend the turn budget twice.
 */
export type GoModelStep = Readonly<{
  readonly index: number
  complete: (usage: GoModelStepUsage) => void
}>

/** The bounded §23 boost: exactly one additional model step, consumed at most once. */
export type GoDeepThinkBoost = Readonly<{
  /** Additional model steps granted but not yet used (0 or 1). */
  pendingModelSteps: number
  /** Additional model steps granted by deep-think in this turn (0 or 1). */
  grantedModelSteps: number
  /** Additional model steps already used (0 or 1). */
  consumedModelSteps: number
}>

/** The single grant one `go.request_deep_think` returns. */
export type GoDeepThinkGrant = Readonly<{
  readonly granted: true
  readonly modelSteps: 1
}>

/** Read-only view of the turn's enforced limits and consumed budget. */
export type GoTurnBudgetSnapshot = Readonly<{
  limits: Readonly<GoTurnBudget>
  modelSteps: number
  inspectCalls: number
  tryMoves: number
  deepThinkRequests: number
  deepThinkBoost: GoDeepThinkBoost
  turnTokens: number
  committedAction: GoTurnCommit | undefined
  gameTerminal: boolean
}>

/**
 * Per-turn enforcement of Spec §22.1-22.4 and §24. One instance belongs to one
 * Go turn; it owns no timer, queue, or cross-lane state.
 */
export type GoTurnEnforcement = Readonly<{
  /** Register on the Go agent's `agent/request` waterfall (C-S01 seam). */
  readonly requestTokenCap: GoRequestTokenCapListener
  /** Turn tokens still available before §22.4 exhaustion (never negative). */
  remainingTurnTokens: () => number
  snapshot: () => GoTurnBudgetSnapshot
  beginModelStep: () => GoModelStep
  beginInspect: () => void
  beginTryMove: () => void
  beginDeepThink: () => GoDeepThinkGrant
  recordCommittedAction: (action: GoTurnCommit) => void
}>

/**
 * Create the Spec §22 enforcement boundary for one Go turn.
 *
 * Every actual execution must pass through `beginModelStep`, `beginInspect`,
 * `beginTryMove`, or `beginDeepThink`; charging happens before the execution so
 * no outer wrapper can hide multiple calls.
 *
 * §23 boost: `beginDeepThink` grants exactly one additional model step for the
 * turn, consumed by the first model step that would otherwise exceed
 * `maxModelSteps`. It never raises `perRequestMaxTokens` or `maxTurnTokens`, so
 * a boosted request stays capped and the overall turn ceiling is unchanged;
 * one boost per turn means no unlimited mode.
 */
export function createGoTurnEnforcement(budget: GoTurnBudget): GoTurnEnforcement {
  const limits: Readonly<GoTurnBudget> = Object.freeze({ ...loadGoTurnBudget(budget) })

  /**
   * The §23 boost size. A structural increment, not a calibrated token amount:
   * production numbers stay owned by BL-BUD-06 / WAVE-C-T10.
   */
  const DEEP_THINK_BOOST_MODEL_STEPS = 1

  let modelSteps = 0
  let inspectCalls = 0
  let tryMoves = 0
  let deepThinkRequests = 0
  let boostGrantedModelSteps = 0
  let boostPendingModelSteps = 0
  let boostConsumedModelSteps = 0
  let turnTokens = 0
  let committedAction: GoTurnCommit | undefined
  let gameTerminal = false

  function remainingTurnTokens(): number {
    return Math.max(0, limits.maxTurnTokens - turnTokens)
  }

  const requestTokenCap = createGoRequestTokenCap(limits.perRequestMaxTokens, remainingTurnTokens)

  function assertAnalysisOpen(action: GoTurnAction): void {
    if (committedAction === undefined) return
    throw new GoTurnAnalysisEndedError(action, committedAction, gameTerminal)
  }

  function assertBelow(counter: GoTurnBudgetCounter, limit: number, used: number): void {
    if (used < limit) return
    throw new GoTurnBudgetExhaustedError(counter, limit, used)
  }

  function beginModelStep(): GoModelStep {
    assertAnalysisOpen('model_step')
    // A granted boost raises the turn's model-step ceiling by exactly one; the
    // step that needs it consumes it, so the boost can never be reused.
    assertBelow(
      'maxModelSteps',
      limits.maxModelSteps + boostGrantedModelSteps,
      modelSteps,
    )
    assertBelow('maxTurnTokens', limits.maxTurnTokens, turnTokens)

    if (boostPendingModelSteps > 0 && modelSteps >= limits.maxModelSteps) {
      boostPendingModelSteps -= 1
      boostConsumedModelSteps += 1
    }

    modelSteps += 1
    const index = modelSteps
    let recordedTokens: number | undefined

    return {
      index,
      complete(usage) {
        if (!Number.isInteger(usage.tokens) || usage.tokens < 0) {
          throw new GoTurnUsageError('not-a-non-negative-integer')
        }
        if (recordedTokens !== undefined) {
          if (recordedTokens === usage.tokens) return
          throw new GoTurnUsageError('already-recorded')
        }
        recordedTokens = usage.tokens
        turnTokens += usage.tokens
      },
    }
  }

  function beginInspect(): void {
    assertAnalysisOpen('inspect')
    assertBelow('maxInspectCalls', limits.maxInspectCalls, inspectCalls)
    assertBelow('maxTurnTokens', limits.maxTurnTokens, turnTokens)
    inspectCalls += 1
  }

  function beginTryMove(): void {
    assertAnalysisOpen('try_move')
    assertBelow('maxTryMoves', limits.maxTryMoves, tryMoves)
    assertBelow('maxTurnTokens', limits.maxTurnTokens, turnTokens)
    tryMoves += 1
  }

  function beginDeepThink(): GoDeepThinkGrant {
    assertAnalysisOpen('deep_think')
    // §22.4: once the turn budget is exhausted, no inspect/try/model step
    // (including a deep-think request) may start.
    assertBelow('maxTurnTokens', limits.maxTurnTokens, turnTokens)
    if (boostGrantedModelSteps > 0) throw new GoDeepThinkAlreadyRequestedError()

    boostGrantedModelSteps = DEEP_THINK_BOOST_MODEL_STEPS
    boostPendingModelSteps = DEEP_THINK_BOOST_MODEL_STEPS
    deepThinkRequests += 1
    return { granted: true, modelSteps: DEEP_THINK_BOOST_MODEL_STEPS }
  }

  function recordCommittedAction(action: GoTurnCommit): void {
    assertAnalysisOpen('commit')
    committedAction = action
    gameTerminal = action === 'resign'
  }

  function snapshot(): GoTurnBudgetSnapshot {
    return {
      limits,
      modelSteps,
      inspectCalls,
      tryMoves,
      deepThinkRequests,
      deepThinkBoost: {
        pendingModelSteps: boostPendingModelSteps,
        grantedModelSteps: boostGrantedModelSteps,
        consumedModelSteps: boostConsumedModelSteps,
      },
      turnTokens,
      committedAction,
      gameTerminal,
    }
  }

  return {
    requestTokenCap,
    remainingTurnTokens,
    snapshot,
    beginModelStep,
    beginInspect,
    beginTryMove,
    beginDeepThink,
    recordCommittedAction,
  }
}

/**
 * The single accounted call path for an actual `go.inspect_*` / `go.try_move`
 * execution: charge first, then execute. A failed execution keeps its charge
 * because the execution was attempted.
 */
export async function runAccountedGoTool<T>(
  enforcement: GoTurnEnforcement,
  kind: GoToolKind,
  execute: () => T | Promise<T>,
): Promise<T> {
  if (kind === 'inspect') enforcement.beginInspect()
  else enforcement.beginTryMove()
  return await execute()
}
