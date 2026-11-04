import type {
  BoardSize,
  GameConfig,
  Player,
  Point,
} from '../../src/contracts/rules.js'

export function uiGameConfig(
  boardSize: BoardSize = 9,
  gameId = `ui-game-${boardSize}`,
): GameConfig {
  return {
    gameId,
    boardSize,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: { user: 'black', deepseek: 'white' },
  }
}

export const BOARD_SIZES: readonly BoardSize[] = [9, 13, 19]

export function center(boardSize: BoardSize): Point {
  const mid = Math.floor(boardSize / 2)
  return { x: mid, y: mid }
}

export function keys(points: readonly Point[]): string[] {
  return points.map(point => `${point.x},${point.y}`).sort()
}

export function otherPlayer(player: Player): Player {
  return player === 'user' ? 'deepseek' : 'user'
}
