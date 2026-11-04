import type { GameNotice } from '../contracts/bridge.js'
import type {
  GameOutcome,
  GameState,
  GoRulesPort,
  MoveRejectionReason,
  Player,
  Point,
} from '../contracts/rules.js'
import { buildGameNotice } from '../tools/go/notice.js'
import { buildBoardView, type BoardViewModel } from './board-view.js'
import { planBoardAnimation, type BoardAnimationPlan, type MoveEffects } from './effects.js'

export type UiRejectionReason = MoveRejectionReason | 'out-of-board'

export type GoBoardControllerOptions = {
  readonly port: GoRulesPort
  readonly gameId: string
  readonly player: Player
  readonly effects?: MoveEffects
}

export type GoMoveOutcome = {
  readonly ok: boolean
  readonly state: GameState
  readonly view: BoardViewModel
  readonly notice: GameNotice
  readonly animation: BoardAnimationPlan | null
  readonly reason?: UiRejectionReason
}

export type GoResignOutcome = {
  readonly ok: boolean
  readonly state: GameState
  readonly view: BoardViewModel
  readonly notice: GameNotice
  readonly result: GameOutcome | null
  readonly reason?: 'game-over'
}

function isIntersection(point: Point, boardSize: number): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < boardSize &&
    point.y < boardSize
  )
}

export class GoBoardController {
  readonly #port: GoRulesPort
  readonly #gameId: string
  readonly #player: Player
  readonly #effects: MoveEffects | undefined

  constructor(options: GoBoardControllerOptions) {
    this.#port = options.port
    this.#gameId = options.gameId
    this.#player = options.player
    this.#effects = options.effects
  }

  get state(): GameState {
    return this.#port.getState(this.#gameId)
  }

  get view(): BoardViewModel {
    return buildBoardView(this.state)
  }

  playAt(point: Point): GoMoveOutcome {
    const current = this.state
    if (!isIntersection(point, current.boardSize)) {
      return this.#reject('out-of-board', current)
    }

    const result = this.#port.play(this.#gameId, this.#player, point)
    if (!result.ok) return this.#reject(result.reason, result.state)

    const animation = planBoardAnimation(result)
    if (animation !== null) {
      this.#animate(animation)
    }
    return {
      ok: true,
      state: result.state,
      view: buildBoardView(result.state),
      notice: buildGameNotice(result.state),
      animation,
    }
  }

  pass(): GoMoveOutcome {
    const result = this.#port.pass(this.#gameId, this.#player)
    if (!result.ok) return this.#reject(result.reason, result.state)

    return {
      ok: true,
      state: result.state,
      view: buildBoardView(result.state),
      notice: buildGameNotice(result.state),
      animation: null,
    }
  }

  resign(): GoResignOutcome {
    const result = this.#port.resign(this.#gameId, this.#player)
    const view = buildBoardView(result.state)
    if (!result.ok) {
      return {
        ok: false,
        state: result.state,
        view,
        notice: buildGameNotice(result.state),
        result: view.result,
        reason: result.reason,
      }
    }

    return {
      ok: true,
      state: result.state,
      view,
      notice: buildGameNotice(result.state),
      result: view.result,
    }
  }

  #reject(reason: UiRejectionReason, state: GameState): GoMoveOutcome {
    return {
      ok: false,
      state,
      view: buildBoardView(state),
      notice: buildGameNotice(state),
      animation: null,
      reason,
    }
  }

  #animate(animation: BoardAnimationPlan): void {
    if (this.#effects === undefined) return
    this.#effects.animate(animation)
    this.#effects.sound.playPlacement()
  }
}
