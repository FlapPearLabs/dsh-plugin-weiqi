/** One executable Go tool: metadata for the model plus the bound implementation. */
import type { GoTurnEnforcement } from '../../budget/enforcement.js'
import type { GameNotice } from '../../contracts/bridge.js'
import type {
  BoardStone,
  GameState,
  GoRulesPort,
  GroupInfo,
  MoveRejectionReason,
  Point,
  ResignedOutcome,
} from '../../contracts/rules.js'
import type { GoToolPath } from '../../preset/go-preset.js'

export type { GoToolPath }

/**
 * Latest-value sink for authoritative game facts (Spec §11).
 *
 * Structurally the `BridgeRuntime.updateGame` member, so a composition root can
 * pass the bridge runtime directly and tests can pass an in-memory collector.
 */
export type GameNoticeSink = {
  updateGame(notice: GameNotice, sequence: number): unknown
}

/** Per-turn execution context every tool runs against. */
export type GoToolRuntime = {
  readonly port: GoRulesPort
  readonly enforcement: GoTurnEnforcement
  /**
   * Build the objective GameNotice for an authoritative state and publish it
   * when the runtime owns a sink. The notice is returned either way.
   */
  readonly publishGameNotice: (state: GameState) => GameNotice
}

/** JSON-schema description of one tool's arguments, as sent to the model. */
export type GoToolParameters = {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
  readonly additionalProperties: false
}

export type GoToolDefinition = {
  readonly name: GoToolPath
  readonly description: string
  readonly parameters: GoToolParameters
  readonly run: (args: unknown, runtime: GoToolRuntime) => unknown
}

/** One tool bound into a guard; `registeredPaths` is derived from these. */
export type GoToolRegistry = {
  readonly registeredPaths: readonly GoToolPath[]
  invoke(toolPath: string, args?: unknown): unknown
}

export type GoStateResult = {
  readonly ok: true
  readonly state: GameState
}

export type GoInspectGroupResult = {
  readonly ok: true
  readonly group: GroupInfo | null
}

/**
 * Local perception of one board region: which intersections hold stones, which
 * are empty, and which empty ones are liberties of a region stone.
 */
export type GoRegionObservation = {
  readonly center: Point
  readonly radius: number
  readonly stones: readonly BoardStone[]
  readonly emptyPoints: readonly Point[]
  readonly liberties: readonly Point[]
}

export type GoInspectRegionResult = {
  readonly ok: true
  readonly region: GoRegionObservation
}

/** `local-board` marks legality as a local board observation, not an engine ruling. */
export type GoMoveBasis = 'local-board'

export type GoTryMoveResult = {
  readonly ok: true
  readonly point: Point
  readonly basis: GoMoveBasis
  readonly legal: boolean
  readonly captures: readonly BoardStone[]
  readonly localLiberties: readonly Point[]
  readonly reason?: MoveRejectionReason
}

export type GoPlayResult =
  | {
      readonly ok: true
      readonly state: GameState
      readonly captured: readonly BoardStone[]
      readonly notice: GameNotice
    }
  | {
      readonly ok: false
      readonly reason: MoveRejectionReason
      readonly state: GameState
    }

export type GoPassResult =
  | {
      readonly ok: true
      readonly state: GameState
      readonly notice: GameNotice
    }
  | {
      readonly ok: false
      readonly reason: MoveRejectionReason
      readonly state: GameState
    }

export type GoResignResult =
  | {
      readonly ok: true
      readonly state: GameState
      readonly outcome: ResignedOutcome
      readonly notice: GameNotice
    }
  | {
      readonly ok: false
      readonly reason: 'game-over'
      readonly state: GameState
    }

/**
 * The §23 deep-think boost granted by one request: exactly one additional
 * model step for this turn, with the per-request token cap and the overall
 * turn ceiling unchanged. A second request in the same turn is rejected.
 */
export type GoDeepThinkResult = {
  readonly ok: true
  readonly requested: true
  readonly applied: true
}

/** Local board observation behind `go.try_move`. */
export type GoLocalMoveObservation = {
  readonly legal: boolean
  readonly captures: readonly BoardStone[]
  readonly localLiberties: readonly Point[]
  readonly reason?: MoveRejectionReason
}
