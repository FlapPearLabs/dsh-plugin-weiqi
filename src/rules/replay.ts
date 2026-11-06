import type { GameState, GoRulesPort, PlayerColors } from '../contracts/rules.js'
import type { CanonicalGameRecord } from './canonical-record.js'
import { validateCanonicalGameRecord } from './canonical-record.js'

export type ReplayRequest = {
  readonly gameId: string
  readonly colors: PlayerColors
}

function copyColors(colors: PlayerColors): PlayerColors {
  return colors.user === 'black'
    ? { user: 'black', deepseek: 'white' }
    : { user: 'white', deepseek: 'black' }
}

/**
 * Rebuilds the authoritative game from the canonical log through GoRulesPort
 * (Spec §28). A resign action is delegated to the port, which owns terminal
 * status and the derived winner/reason; replay never mutates the board itself.
 */
export function replayCanonicalGame(
  port: GoRulesPort,
  record: CanonicalGameRecord,
  request: ReplayRequest,
): GameState {
  const canonical = validateCanonicalGameRecord(record)
  const { gameId } = request

  port.createGame({
    gameId,
    boardSize: canonical.boardSize,
    scoring: canonical.scoring,
    koRule: canonical.koRule,
    komi: canonical.komi,
    colors: copyColors(request.colors),
  })

  canonical.actions.forEach((action, index) => {
    if (action.type === 'play') {
      const result = port.play(gameId, action.by, {
        x: action.point.x,
        y: action.point.y,
      })
      if (!result.ok) {
        throw new Error(
          `canonical action ${index + 1} (play by ${action.by}) was rejected: ${result.reason}`,
        )
      }
      return
    }

    if (action.type === 'pass') {
      const result = port.pass(gameId, action.by)
      if (!result.ok) {
        throw new Error(
          `canonical action ${index + 1} (pass by ${action.by}) was rejected: ${result.reason}`,
        )
      }
      return
    }

    const result = port.resign(gameId, action.by)
    if (!result.ok) {
      throw new Error(
        `canonical action ${index + 1} (resign by ${action.by}) was rejected: ${result.reason}`,
      )
    }
  })

  if (canonical.settlement !== undefined) {
    const result = port.settle(gameId, {
      deadStones: canonical.settlement.deadStones.map(point => ({ x: point.x, y: point.y })),
      agreed: canonical.settlement.agreed,
    })
    if (!result.settled) {
      throw new Error(`canonical settlement was rejected: ${result.reason}`)
    }
  }

  return port.getState(gameId)
}
