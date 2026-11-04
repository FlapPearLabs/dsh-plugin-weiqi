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
  Point,
  ResignResult,
  ResignedOutcome,
  ScoreResult,
  SettlementConfirmation,
  SettlementResult,
  StoneColor,
} from '../../src/contracts/rules.js'

/**
 * Deterministic, deliberately non-authoritative `GoRulesPort` stub for the
 * contract harness only: no capture, suicide, ko, superko, territory or
 * dead-stone rules (Spec §26/§27 keep those behind the pinned adapter).
 */
type StubGame = {
  readonly config: GameConfig
  status: GameStatus
  toPlay: Player
  moveNumber: number
  consecutivePasses: number
  captures: Record<Player, number>
  stones: BoardStone[]
  lastMove: LastMove | null
  outcome: GameOutcome | null
}

const otherPlayer = (player: Player): Player => (player === 'user' ? 'deepseek' : 'user')

const pointKey = (point: Point): string => `${point.x},${point.y}`

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y }
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

function snapshot(game: StubGame): GameState {
  return {
    gameId: game.config.gameId,
    boardSize: game.config.boardSize,
    scoring: game.config.scoring,
    koRule: game.config.koRule,
    komi: game.config.komi,
    colors: game.config.colors,
    status: game.status,
    toPlay: game.toPlay,
    moveNumber: game.moveNumber,
    consecutivePasses: game.consecutivePasses,
    captures: { user: game.captures.user, deepseek: game.captures.deepseek },
    stones: game.stones.map((stone) => ({ point: copyPoint(stone.point), color: stone.color })),
    lastMove: game.lastMove === null ? null : copyLastMove(game.lastMove),
    outcome: game.outcome === null ? null : { ...game.outcome },
  }
}

export class StubGoRulesPort implements GoRulesPort {
  private readonly games = new Map<string, StubGame>()

  createGame(config: GameConfig): GameState {
    if (this.games.has(config.gameId)) {
      throw new Error(`stub game already exists: ${config.gameId}`)
    }
    const game: StubGame = {
      config,
      status: 'playing',
      toPlay: config.colors.user === 'black' ? 'user' : 'deepseek',
      moveNumber: 0,
      consecutivePasses: 0,
      captures: { user: 0, deepseek: 0 },
      stones: [],
      lastMove: null,
      outcome: null,
    }
    this.games.set(config.gameId, game)
    return snapshot(game)
  }

  play(gameId: string, by: Player, point: Point): MoveResult {
    const game = this.requireGame(gameId)
    const rejection = this.moveRejection(game, by)
    if (rejection !== null) {
      return { ok: false, reason: rejection, state: snapshot(game) }
    }
    if (!this.inBoard(game, point)) {
      return { ok: false, reason: 'out-of-board', state: snapshot(game) }
    }
    if (game.stones.some((stone) => pointKey(stone.point) === pointKey(point))) {
      return { ok: false, reason: 'occupied', state: snapshot(game) }
    }

    game.stones.push({ point: copyPoint(point), color: this.colorOf(game, by) })
    game.moveNumber += 1
    game.consecutivePasses = 0
    game.lastMove = { type: 'play', by, point: copyPoint(point), moveNumber: game.moveNumber }
    game.toPlay = otherPlayer(by)
    return { ok: true, state: snapshot(game), captured: [] }
  }

  pass(gameId: string, by: Player): MoveResult {
    const game = this.requireGame(gameId)
    const rejection = this.moveRejection(game, by)
    if (rejection !== null) {
      return { ok: false, reason: rejection, state: snapshot(game) }
    }

    game.moveNumber += 1
    game.consecutivePasses += 1
    game.lastMove = { type: 'pass', by, moveNumber: game.moveNumber }
    game.toPlay = otherPlayer(by)
    return { ok: true, state: snapshot(game), captured: [] }
  }

  resign(gameId: string, by: Player): ResignResult {
    const game = this.requireGame(gameId)
    if (game.status === 'over') {
      return { ok: false, reason: 'game-over', state: snapshot(game) }
    }

    const outcome: ResignedOutcome = {
      winner: otherPlayer(by),
      loser: by,
      reason: 'resignation',
    }
    game.status = 'over'
    game.outcome = outcome
    return { ok: true, state: snapshot(game), outcome }
  }

  getState(gameId: string): GameState {
    return snapshot(this.requireGame(gameId))
  }

  inspectGroup(gameId: string, point: Point): GroupInfo | null {
    const game = this.requireGame(gameId)
    if (!this.inBoard(game, point)) return null

    const origin = game.stones.find((stone) => pointKey(stone.point) === pointKey(point))
    if (origin === undefined) return null

    const seen = new Set<string>([pointKey(origin.point)])
    const stones: Point[] = [copyPoint(origin.point)]
    const liberties: Point[] = []
    const libertySeen = new Set<string>()
    const pending: Point[] = [copyPoint(origin.point)]

    while (pending.length > 0) {
      const current = pending.pop()
      if (current === undefined) break
      for (const neighbor of this.neighbors(game, current)) {
        const key = pointKey(neighbor)
        const stone = game.stones.find((candidate) => pointKey(candidate.point) === key)
        if (stone === undefined) {
          if (!libertySeen.has(key)) {
            libertySeen.add(key)
            liberties.push(neighbor)
          }
          continue
        }
        if (stone.color !== origin.color || seen.has(key)) continue
        seen.add(key)
        stones.push(neighbor)
        pending.push(neighbor)
      }
    }

    return { point: copyPoint(origin.point), color: origin.color, stones, liberties }
  }

  score(gameId: string): ScoreResult {
    const game = this.requireGame(gameId)
    const blackStones = game.stones.filter((stone) => stone.color === 'black').length
    const whiteStones = game.stones.length - blackStones
    const blackTotal = blackStones
    const whiteTotal = whiteStones + 7.5
    const winner = blackTotal > whiteTotal ? this.playerOfColor(game, 'black') : this.playerOfColor(game, 'white')

    return {
      scoring: 'area',
      komi: 7.5,
      black: { stones: blackStones, territory: 0, komi: 0, total: blackTotal },
      white: { stones: whiteStones, territory: 0, komi: 7.5, total: whiteTotal },
      winner,
      margin: Math.abs(blackTotal - whiteTotal),
    }
  }

  settle(gameId: string, confirmation: SettlementConfirmation): SettlementResult {
    const game = this.requireGame(gameId)
    if (game.status === 'over') {
      return { settled: false, reason: 'game-over', state: snapshot(game) }
    }
    if (game.consecutivePasses < 2) {
      return { settled: false, reason: 'not-two-passes', state: snapshot(game) }
    }
    if (!confirmation.agreed) {
      return { settled: false, reason: 'disagreement', state: snapshot(game) }
    }

    const result = this.score(gameId)
    game.status = 'over'
    game.outcome = { winner: result.winner, loser: otherPlayer(result.winner), reason: 'score' }
    return { settled: true, score: result, state: snapshot(game) }
  }

  private requireGame(gameId: string): StubGame {
    const game = this.games.get(gameId)
    if (game === undefined) throw new Error(`stub game not found: ${gameId}`)
    return game
  }

  private moveRejection(game: StubGame, by: Player): MoveRejectionReason | null {
    if (game.status === 'over') return 'game-over'
    if (game.toPlay !== by) return 'out-of-turn'
    return null
  }

  private inBoard(game: StubGame, point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < game.config.boardSize && point.y < game.config.boardSize
  }

  private neighbors(game: StubGame, point: Point): Point[] {
    const result: Point[] = []
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const neighbor = { x: point.x + dx, y: point.y + dy }
      if (this.inBoard(game, neighbor)) result.push(neighbor)
    }
    return result
  }

  private colorOf(game: StubGame, player: Player): StoneColor {
    return game.config.colors[player]
  }

  private playerOfColor(game: StubGame, color: StoneColor): Player {
    return game.config.colors.user === color ? 'user' : 'deepseek'
  }
}

export function createStubGoRulesPort(): GoRulesPort {
  return new StubGoRulesPort()
}
