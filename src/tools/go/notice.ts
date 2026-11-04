/**
 * Objective GameNotice projection of one authoritative state (Spec §11, §32).
 *
 * Only facts the port reports are copied: no ranking, danger label, win rate or
 * recommendation ever enters the notice. `captures` is the total number of
 * stones captured in the game so far, the one number §11 defines.
 */
import type { GameNotice } from '../../contracts/bridge.js'
import type { BoardSize, GameState, Point } from '../../contracts/rules.js'

const COLUMNS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'

/** Go coordinate label such as `E5`; column I is skipped by convention. */
export function formatBoardPoint(point: Point, boardSize: BoardSize): string {
  const column = COLUMNS[point.x]
  if (column === undefined) {
    throw new RangeError(`point x=${point.x} is outside the board's column labels`)
  }
  return `${column}${boardSize - point.y}`
}

export function buildGameNotice(state: GameState): GameNotice {
  const notice: GameNotice = {
    gameId: state.gameId,
    moveNumber: state.moveNumber,
    toPlay: state.toPlay,
    captures: state.captures.user + state.captures.deepseek,
    status: state.status,
  }

  if (state.lastMove !== null) {
    notice.lastMove =
      state.lastMove.type === 'play'
        ? formatBoardPoint(state.lastMove.point, state.boardSize)
        : 'pass'
  }

  return notice
}
