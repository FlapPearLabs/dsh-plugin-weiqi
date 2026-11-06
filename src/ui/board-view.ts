import type {
  BoardSize,
  GameOutcome,
  GameState,
  Player,
  Point,
  StoneColor,
} from '../contracts/rules.js'

export type BoardViewStone = {
  readonly key: string
  readonly point: Point
  readonly color: StoneColor
}

export type BoardViewLastMove = {
  readonly point: Point
  readonly by: Player
}

export type BoardViewModel = {
  readonly gameId: string
  readonly boardSize: BoardSize
  readonly komi: number
  readonly intersections: number
  readonly stones: readonly BoardViewStone[]
  readonly lastMove: BoardViewLastMove | null
  readonly lastMoveWasPass: boolean
  readonly toPlay: Player
  readonly toPlayColor: StoneColor
  readonly moveNumber: number
  readonly captures: { readonly user: number; readonly deepseek: number }
  readonly totalCaptures: number
  readonly status: 'playing' | 'over'
  readonly result: GameOutcome | null
  readonly canPlay: boolean
}

export function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

function copyPoint(point: Point): Point {
  return Object.freeze({ x: point.x, y: point.y })
}

function colorOf(colors: GameState['colors'], player: Player): StoneColor {
  return player === 'user' ? colors.user : colors.deepseek
}

function copyOutcome(outcome: GameOutcome): GameOutcome {
  return Object.freeze({ winner: outcome.winner, loser: outcome.loser, reason: outcome.reason })
}

export function buildBoardView(state: GameState): BoardViewModel {
  const stones = state.stones.map(stone =>
    Object.freeze({
      key: pointKey(stone.point),
      point: copyPoint(stone.point),
      color: stone.color,
    }),
  )
  const lastMove: BoardViewLastMove | null =
    state.lastMove !== null && state.lastMove.type === 'play'
      ? Object.freeze({ point: copyPoint(state.lastMove.point), by: state.lastMove.by })
      : null

  return Object.freeze({
    gameId: state.gameId,
    boardSize: state.boardSize,
    komi: state.komi,
    intersections: state.boardSize * state.boardSize,
    stones: Object.freeze(stones),
    lastMove,
    lastMoveWasPass: state.lastMove !== null && state.lastMove.type === 'pass',
    toPlay: state.toPlay,
    toPlayColor: colorOf(state.colors, state.toPlay),
    moveNumber: state.moveNumber,
    captures: Object.freeze({ user: state.captures.user, deepseek: state.captures.deepseek }),
    totalCaptures: state.captures.user + state.captures.deepseek,
    status: state.status,
    result: state.outcome === null ? null : copyOutcome(state.outcome),
    canPlay: state.status === 'playing',
  })
}
