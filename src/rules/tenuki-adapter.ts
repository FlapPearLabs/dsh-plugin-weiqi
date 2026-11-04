import { Game } from 'tenuki'
import type {
  BoardStone,
  GameConfig,
  GameOutcome,
  GameState,
  GameStatus,
  GoRulesPort,
  GroupInfo,
  LastMove,
  MoveRejectionReason,
  MoveResult,
  Player,
  PlayerColors,
  Point,
  ResignResult,
  ResignedOutcome,
  ScoreBreakdown,
  ScoreResult,
  SettlementConfirmation,
  SettlementResult,
  StoneColor,
} from '../contracts/rules.js'

/**
 * The sole Tenuki-touching module (Spec §26/§27). Every frozen rule value is
 * passed explicitly at construction; Tenuki's defaults are territory / simple
 * ko / komi 0 and are never relied on.
 */
const FROZEN_RULES = {
  scoring: 'area',
  koRule: 'positional-superko',
  komi: 7.5,
} as const

type GameRecord = {
  readonly config: GameConfig
  readonly colors: PlayerColors
  readonly game: Game
  status: GameStatus
  consecutivePasses: number
  lastMove: LastMove | null
  outcome: GameOutcome | null
}

const otherPlayer = (player: Player): Player => (player === 'user' ? 'deepseek' : 'user')

const pointKey = (point: Point): string => `${point.x},${point.y}`

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y }
}

function copyColors(colors: PlayerColors): PlayerColors {
  return colors.user === 'black'
    ? { user: 'black', deepseek: 'white' }
    : { user: 'white', deepseek: 'black' }
}

function playerOfColor(colors: PlayerColors, color: StoneColor): Player {
  return colors.user === color ? 'user' : 'deepseek'
}

function copyLastMove(lastMove: LastMove): LastMove {
  return lastMove.type === 'play'
    ? {
        type: 'play',
        by: lastMove.by,
        point: copyPoint(lastMove.point),
        moveNumber: lastMove.moveNumber,
      }
    : { type: 'pass', by: lastMove.by, moveNumber: lastMove.moveNumber }
}

function copyOutcome(outcome: GameOutcome): GameOutcome {
  return { winner: outcome.winner, loser: outcome.loser, reason: outcome.reason }
}

function copyResignedOutcome(outcome: ResignedOutcome): ResignedOutcome {
  return { winner: outcome.winner, loser: outcome.loser, reason: 'resignation' }
}

function freezeState(state: GameState): GameState {
  const stones = state.stones.map(stone =>
    Object.freeze({ point: Object.freeze(copyPoint(stone.point)), color: stone.color }),
  )
  const lastMove = state.lastMove === null ? null : Object.freeze(copyLastMove(state.lastMove))
  const outcome = state.outcome === null ? null : Object.freeze(copyOutcome(state.outcome))

  return Object.freeze({
    ...state,
    colors: Object.freeze(copyColors(state.colors)),
    captures: Object.freeze({ user: state.captures.user, deepseek: state.captures.deepseek }),
    stones: Object.freeze(stones),
    lastMove,
    outcome,
  })
}

export class TenukiAdapter implements GoRulesPort {
  private readonly games = new Map<string, GameRecord>()

  createGame(config: GameConfig): GameState {
    if (this.games.has(config.gameId)) {
      throw new Error(`game already exists: ${config.gameId}`)
    }

    const frozenConfig: GameConfig = {
      gameId: config.gameId,
      boardSize: config.boardSize,
      scoring: FROZEN_RULES.scoring,
      koRule: FROZEN_RULES.koRule,
      komi: FROZEN_RULES.komi,
      colors: copyColors(config.colors),
    }
    const record: GameRecord = {
      config: frozenConfig,
      colors: frozenConfig.colors,
      game: new Game({
        boardSize: frozenConfig.boardSize,
        scoring: FROZEN_RULES.scoring,
        koRule: FROZEN_RULES.koRule,
        komi: FROZEN_RULES.komi,
      }),
      status: 'playing',
      consecutivePasses: 0,
      lastMove: null,
      outcome: null,
    }
    this.games.set(config.gameId, record)
    return this.snapshot(record)
  }

  play(gameId: string, by: Player, point: Point): MoveResult {
    const record = this.requireGame(gameId)
    if (record.status === 'over') {
      return this.rejected(record, 'game-over')
    }
    if (record.game.currentPlayer() !== record.colors[by]) {
      return this.rejected(record, 'out-of-turn')
    }
    if (!this.inBoard(record, point)) {
      return this.rejected(record, 'out-of-board')
    }
    if (!record.game.intersectionAt(point.y, point.x).isEmpty()) {
      return this.rejected(record, 'occupied')
    }
    if (record.game.isIllegalAt(point.y, point.x)) {
      return this.rejected(record, this.classifyIllegal(record, by, point))
    }

    const before = this.stones(record)
    if (!record.game.playAt(point.y, point.x, { render: false })) {
      throw new Error(`tenuki rejected a move the adapter accepted: (${point.x}, ${point.y})`)
    }
    const after = this.stones(record)
    const surviving = new Set(after.map(stone => pointKey(stone.point)))
    const captured = before.filter(stone => !surviving.has(pointKey(stone.point)))

    record.consecutivePasses = 0
    record.lastMove = {
      type: 'play',
      by,
      point: copyPoint(point),
      moveNumber: record.game.moveNumber(),
    }
    return { ok: true, state: this.snapshot(record), captured: Object.freeze(captured) }
  }

  pass(gameId: string, by: Player): MoveResult {
    const record = this.requireGame(gameId)
    if (record.status === 'over') {
      return this.rejected(record, 'game-over')
    }
    if (record.game.currentPlayer() !== record.colors[by]) {
      return this.rejected(record, 'out-of-turn')
    }
    if (!record.game.pass({ render: false })) {
      // Tenuki is already at two consecutive passes (settlement was rejected),
      // so only a board play can resume the position.
      return this.rejected(record, 'game-over')
    }

    record.consecutivePasses += 1
    record.lastMove = { type: 'pass', by, moveNumber: record.game.moveNumber() }
    return { ok: true, state: this.snapshot(record), captured: Object.freeze([]) }
  }

  resign(gameId: string, by: Player): ResignResult {
    const record = this.requireGame(gameId)
    if (record.status === 'over') {
      return { ok: false, reason: 'game-over', state: this.snapshot(record) }
    }

    const outcome: ResignedOutcome = { winner: otherPlayer(by), loser: by, reason: 'resignation' }
    record.status = 'over'
    record.outcome = outcome
    return { ok: true, state: this.snapshot(record), outcome: copyResignedOutcome(outcome) }
  }

  getState(gameId: string): GameState {
    return this.snapshot(this.requireGame(gameId))
  }

  inspectGroup(gameId: string, point: Point): GroupInfo | null {
    const record = this.requireGame(gameId)
    if (!this.inBoard(record, point)) return null

    const stones = this.stones(record)
    const origin = stones.find(stone => stone.point.x === point.x && stone.point.y === point.y)
    if (origin === undefined) return null

    const byPoint = new Map(stones.map(stone => [pointKey(stone.point), stone.color]))
    const group: Point[] = []
    const liberties: Point[] = []
    const seenStones = new Set<string>()
    const seenLiberties = new Set<string>()
    const pending: Point[] = [copyPoint(origin.point)]

    while (pending.length > 0) {
      const current = pending.pop()
      if (current === undefined) break
      seenStones.add(pointKey(current))
      group.push(current)
      for (const neighbor of this.neighbors(record, current)) {
        const key = pointKey(neighbor)
        const color = byPoint.get(key)
        if (color === undefined) {
          if (!seenLiberties.has(key)) {
            seenLiberties.add(key)
            liberties.push(neighbor)
          }
          continue
        }
        if (color !== origin.color || seenStones.has(key)) continue
        pending.push(neighbor)
      }
    }

    return {
      point: copyPoint(origin.point),
      color: origin.color,
      stones: Object.freeze(group),
      liberties: Object.freeze(liberties),
    }
  }

  score(gameId: string): ScoreResult {
    return this.scoreFor(this.requireGame(gameId))
  }

  settle(gameId: string, confirmation: SettlementConfirmation): SettlementResult {
    const record = this.requireGame(gameId)
    if (record.status === 'over') {
      return { settled: false, reason: 'game-over', state: this.snapshot(record) }
    }
    if (record.consecutivePasses < 2) {
      return { settled: false, reason: 'not-two-passes', state: this.snapshot(record) }
    }
    if (!confirmation.agreed) {
      return { settled: false, reason: 'disagreement', state: this.snapshot(record) }
    }

    for (const point of confirmation.deadStones) {
      if (this.inBoard(record, point)) {
        record.game.markDeadAt(point.y, point.x, { render: false })
      }
    }

    const score = this.scoreFor(record)
    record.status = 'over'
    record.outcome = { winner: score.winner, loser: otherPlayer(score.winner), reason: 'score' }
    return { settled: true, score, state: this.snapshot(record) }
  }

  private snapshot(record: GameRecord): GameState {
    const board = record.game.currentState()
    const blackPlayer = playerOfColor(record.colors, 'black')
    const whitePlayer = playerOfColor(record.colors, 'white')
    const captures: Record<Player, number> = { user: 0, deepseek: 0 }
    captures[blackPlayer] = board.whiteStonesCaptured
    captures[whitePlayer] = board.blackStonesCaptured

    return freezeState({
      ...record.config,
      colors: record.colors,
      status: record.status,
      toPlay: playerOfColor(record.colors, record.game.currentPlayer()),
      moveNumber: record.game.moveNumber(),
      consecutivePasses: record.consecutivePasses,
      captures,
      stones: this.stones(record),
      lastMove: record.lastMove,
      outcome: record.outcome,
    })
  }

  private scoreFor(record: GameRecord): ScoreResult {
    const totals = record.game.score()
    const deadPoints = new Set(record.game.deadStones().map(point => pointKey(point)))
    const liveStones = this.stones(record).filter(stone => !deadPoints.has(pointKey(stone.point)))
    const blackStones = liveStones.filter(stone => stone.color === 'black').length
    const whiteStones = liveStones.length - blackStones

    const black: ScoreBreakdown = {
      stones: blackStones,
      territory: totals.black - blackStones,
      komi: 0,
      total: totals.black,
    }
    const white: ScoreBreakdown = {
      stones: whiteStones,
      territory: totals.white - whiteStones - FROZEN_RULES.komi,
      komi: FROZEN_RULES.komi,
      total: totals.white,
    }
    const winner =
      totals.black > totals.white
        ? playerOfColor(record.colors, 'black')
        : playerOfColor(record.colors, 'white')

    return {
      scoring: FROZEN_RULES.scoring,
      komi: FROZEN_RULES.komi,
      black,
      white,
      winner,
      margin: Math.abs(totals.black - totals.white),
    }
  }

  private classifyIllegal(record: GameRecord, by: Player, point: Point): MoveRejectionReason {
    const hypothetical = record.game
      .currentState()
      .playAt(point.y, point.x, record.colors[by])
    return hypothetical.libertiesAt(point.y, point.x) === 0 ? 'suicide' : 'superko'
  }

  private stones(record: GameRecord): BoardStone[] {
    const stones: BoardStone[] = []
    for (const intersection of record.game.intersections()) {
      if (intersection.isEmpty()) continue
      stones.push({
        point: { x: intersection.x, y: intersection.y },
        color: intersection.isBlack() ? 'black' : 'white',
      })
    }
    return stones
  }

  private rejected(record: GameRecord, reason: MoveRejectionReason): MoveResult {
    return { ok: false, reason, state: this.snapshot(record) }
  }

  private requireGame(gameId: string): GameRecord {
    const record = this.games.get(gameId)
    if (record === undefined) throw new Error(`game not found: ${gameId}`)
    return record
  }

  private inBoard(record: GameRecord, point: Point): boolean {
    return (
      Number.isInteger(point.x) &&
      Number.isInteger(point.y) &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < record.config.boardSize &&
      point.y < record.config.boardSize
    )
  }

  private neighbors(record: GameRecord, point: Point): Point[] {
    const neighbors: Point[] = []
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const neighbor = { x: point.x + dx, y: point.y + dy }
      if (this.inBoard(record, neighbor)) neighbors.push(neighbor)
    }
    return neighbors
  }
}

export function createTenukiGoRulesPort(): GoRulesPort {
  return new TenukiAdapter()
}
