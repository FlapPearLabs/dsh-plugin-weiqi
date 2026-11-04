/**
 * Engine-independent Go rules boundary (Spec §26, §30).
 *
 * `GoRulesPort` is the sole application-facing authoritative game-mutation
 * boundary. `resign` is a terminal action of this boundary; it does not create
 * a second board-rules authority. Engine-specific behavior (pinned Tenuki)
 * stays behind the port.
 *
 * Implementations reject rule violations through the result unions and must
 * leave the authoritative state unchanged; an unknown `gameId` is a
 * programming error and may throw.
 */

export type BoardSize = 9 | 13 | 19

export type Player = 'user' | 'deepseek'

export type StoneColor = 'black' | 'white'

/** Zero-based intersection coordinate; (0, 0) is the top-left corner. */
export type Point = {
  readonly x: number
  readonly y: number
}

/** Color ownership is fixed at game creation; no implicit mapping. */
export type PlayerColors =
  | { readonly user: 'black'; readonly deepseek: 'white' }
  | { readonly user: 'white'; readonly deepseek: 'black' }

/** Explicit rules configuration; engine defaults are never relied on (§27). */
export type GameRules = {
  readonly boardSize: BoardSize
  readonly scoring: 'area'
  readonly koRule: 'positional-superko'
  readonly komi: 7.5
}

export type GameConfig = GameRules & {
  readonly gameId: string
  readonly colors: PlayerColors
}

export type GameStatus = 'playing' | 'over'

export type BoardStone = {
  readonly point: Point
  readonly color: StoneColor
}

export type LastMove =
  | {
      readonly type: 'play'
      readonly by: Player
      readonly point: Point
      readonly moveNumber: number
    }
  | {
      readonly type: 'pass'
      readonly by: Player
      readonly moveNumber: number
    }

export type GameOutcome = {
  readonly winner: Player
  readonly loser: Player
  readonly reason: 'resignation' | 'score'
}

/** Immutable authoritative snapshot of one game. */
export type GameState = GameRules & {
  readonly gameId: string
  readonly colors: PlayerColors
  readonly status: GameStatus
  readonly toPlay: Player
  readonly moveNumber: number
  readonly consecutivePasses: number
  /** Stones captured by that player. */
  readonly captures: Readonly<Record<Player, number>>
  readonly stones: readonly BoardStone[]
  readonly lastMove: LastMove | null
  readonly outcome: GameOutcome | null
}

export type MoveRejectionReason =
  | 'game-over'
  | 'out-of-turn'
  | 'out-of-board'
  | 'occupied'
  | 'suicide'
  | 'ko'
  | 'superko'

export type AcceptedMove = {
  readonly ok: true
  readonly state: GameState
  /** Stones removed from the board by this move; empty for a pass. */
  readonly captured: readonly BoardStone[]
}

export type RejectedMove = {
  readonly ok: false
  readonly reason: MoveRejectionReason
  /** The unchanged authoritative state. */
  readonly state: GameState
}

export type MoveResult = AcceptedMove | RejectedMove

export type ResignedOutcome = GameOutcome & {
  readonly reason: 'resignation'
}

export type ResignResult =
  | {
      readonly ok: true
      readonly state: GameState
      readonly outcome: ResignedOutcome
    }
  | {
      readonly ok: false
      readonly reason: 'game-over'
      readonly state: GameState
    }

/** Perception support only: no life/death, influence or territory judgment (§29). */
export type GroupInfo = {
  readonly point: Point
  readonly color: StoneColor
  readonly stones: readonly Point[]
  readonly liberties: readonly Point[]
}

export type ScoreBreakdown = {
  readonly stones: number
  readonly territory: number
  readonly komi: number
  readonly total: number
}

export type ScoreResult = {
  readonly scoring: 'area'
  readonly komi: 7.5
  readonly black: ScoreBreakdown
  readonly white: ScoreBreakdown
  readonly winner: Player
  /** Absolute difference between the two totals. */
  readonly margin: number
}

export type SettlementConfirmation = {
  /** Points both players agree are dead; empty means none. */
  readonly deadStones: readonly Point[]
  readonly agreed: boolean
}

export type SettlementRejectionReason = 'game-over' | 'not-two-passes' | 'disagreement'

export type SettlementResult =
  | {
      readonly settled: true
      readonly score: ScoreResult
      readonly state: GameState
    }
  | {
      readonly settled: false
      readonly reason: SettlementRejectionReason
      readonly state: GameState
    }

export const GO_RULES_PORT_METHODS = [
  'createGame',
  'play',
  'pass',
  'resign',
  'getState',
  'inspectGroup',
  'score',
  'settle',
] as const

export type GoRulesPortMethod = (typeof GO_RULES_PORT_METHODS)[number]

export interface GoRulesPort {
  createGame(config: GameConfig): GameState

  play(gameId: string, by: Player, point: Point): MoveResult

  pass(gameId: string, by: Player): MoveResult

  resign(gameId: string, by: Player): ResignResult

  getState(gameId: string): GameState

  inspectGroup(gameId: string, point: Point): GroupInfo | null

  score(gameId: string): ScoreResult

  settle(gameId: string, confirmation: SettlementConfirmation): SettlementResult
}
