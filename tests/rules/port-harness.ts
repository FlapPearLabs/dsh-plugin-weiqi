import { isDeepStrictEqual } from 'node:util'
import { GO_RULES_PORT_METHODS } from '../../src/contracts/rules.js'
import type {
  GameConfig,
  GameState,
  GoRulesPort,
  GoRulesPortMethod,
  Player,
  Point,
} from '../../src/contracts/rules.js'

export type GoRulesPortHarnessCase = {
  readonly name: string
  readonly method: GoRulesPortMethod
  readonly ok: boolean
  readonly detail: string
}

export type GoRulesPortHarnessReport = {
  readonly cases: readonly GoRulesPortHarnessCase[]
  readonly methods: readonly GoRulesPortMethod[]
  readonly failures: readonly GoRulesPortHarnessCase[]
  readonly ok: boolean
}

const BASE_CONFIG: Omit<GameConfig, 'gameId'> = {
  boardSize: 9,
  scoring: 'area',
  koRule: 'positional-superko',
  komi: 7.5,
  colors: { user: 'black', deepseek: 'white' },
}

function gameConfig(gameId: string): GameConfig {
  return { ...BASE_CONFIG, gameId }
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function same(actual: unknown, expected: unknown, message: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function playablePoint(state: GameState): Point {
  const mid = Math.floor(state.boardSize / 2)
  return { x: mid, y: mid }
}

/**
 * Engine-independent acceptance harness for any `GoRulesPort` (Spec §26,
 * §31). It only uses the port and the frozen contract types, exercises all
 * eight methods, and returns collected results so a failing case cannot hide
 * the others.
 */
export function runGoRulesPortContract(createPort: () => GoRulesPort): GoRulesPortHarnessReport {
  const cases: GoRulesPortHarnessCase[] = []

  const record = (name: string, method: GoRulesPortMethod, body: () => string): void => {
    try {
      cases.push({ name, method, ok: true, detail: body() })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      cases.push({ name, method, ok: false, detail })
    }
  }

  record('createGame exposes the explicit 9x9 area/positional-superko/komi-7.5 state', 'createGame', () => {
    const port = createPort()
    const state = port.createGame(gameConfig('harness-create'))

    ensure(state.gameId === 'harness-create', 'gameId not echoed')
    ensure(state.boardSize === 9, 'boardSize is not 9')
    ensure(state.scoring === 'area', 'scoring is not area')
    ensure(state.koRule === 'positional-superko', 'koRule is not positional-superko')
    ensure(state.komi === 7.5, 'komi is not 7.5')
    ensure(state.status === 'playing', 'new game is not playing')
    ensure(state.toPlay === 'user', 'black (user) must move first')
    ensure(state.moveNumber === 0, 'new game already has moves')
    ensure(state.stones.length === 0, 'new game already has stones')
    ensure(state.outcome === null, 'new game already has an outcome')
    return '9x9 empty board, user=black to play, komi 7.5'
  })

  record('getState returns the same authoritative snapshot and does not mutate it', 'getState', () => {
    const port = createPort()
    const created = port.createGame(gameConfig('harness-state'))
    const first = port.getState('harness-state')
    const second = port.getState('harness-state')

    same(first, created, 'getState differs from createGame')
    same(second, first, 'repeated getState differs')
    return 'createGame and repeated getState agree'
  })

  record('play accepts a legal move and advances the turn', 'play', () => {
    const port = createPort()
    const before = port.createGame(gameConfig('harness-play'))
    const point = playablePoint(before)
    const result = port.play('harness-play', 'user', point)

    ensure(result.ok, `legal play rejected: ${result.ok ? '' : result.reason}`)
    same(result.state.stones, [{ point, color: 'black' }], 'board stones after legal play')
    ensure(result.state.moveNumber === before.moveNumber + 1, 'moveNumber did not advance')
    ensure(result.state.toPlay === 'deepseek', 'turn did not pass to deepseek')
    ensure(result.state.lastMove !== null && result.state.lastMove.type === 'play', 'lastMove is not a play')
    same(result.state.lastMove, { type: 'play', by: 'user', point, moveNumber: 1 }, 'recorded lastMove')
    return 'user move recorded, deepseek to play'
  })

  record('play rejects an out-of-turn move without mutating the state', 'play', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-turn'))
    port.play('harness-turn', 'user', { x: 2, y: 2 })
    const before = port.getState('harness-turn')
    const result = port.play('harness-turn', 'user', { x: 3, y: 3 })

    ensure(!result.ok, 'out-of-turn move was accepted')
    ensure(result.reason === 'out-of-turn', `wrong rejection reason: ${result.reason}`)
    same(port.getState('harness-turn'), before, 'state changed after rejected move')
    return 'rejected as out-of-turn with unchanged state'
  })

  record('play rejects an occupied point without mutating the state', 'play', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-occupied'))
    port.play('harness-occupied', 'user', { x: 2, y: 2 })
    const before = port.getState('harness-occupied')
    const result = port.play('harness-occupied', 'deepseek', { x: 2, y: 2 })

    ensure(!result.ok, 'occupied point was accepted')
    ensure(result.reason === 'occupied', `wrong rejection reason: ${result.reason}`)
    same(port.getState('harness-occupied'), before, 'state changed after rejected move')
    return 'rejected as occupied with unchanged state'
  })

  record('play rejects an off-board point without mutating the state', 'play', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-offboard'))
    const before = port.getState('harness-offboard')
    const result = port.play('harness-offboard', 'user', { x: 9, y: 0 })

    ensure(!result.ok, 'off-board point was accepted')
    ensure(result.reason === 'out-of-board', `wrong rejection reason: ${result.reason}`)
    same(port.getState('harness-offboard'), before, 'state changed after rejected move')
    return 'rejected as out-of-board with unchanged state'
  })

  record('inspectGroup reports the connected group, its color and liberties', 'inspectGroup', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-group'))
    port.play('harness-group', 'user', { x: 2, y: 2 })

    const group = port.inspectGroup('harness-group', { x: 2, y: 2 })
    ensure(group !== null, 'no group reported for an occupied point')
    ensure(group.color === 'black', 'group color is not black')
    same(group.stones, [{ x: 2, y: 2 }], 'group stones')
    ensure(group.liberties.length === 4, `isolated stone must have 4 liberties, got ${group.liberties.length}`)
    ensure(port.inspectGroup('harness-group', { x: 5, y: 5 }) === null, 'empty point reported a group')
    return 'single-stone group with 4 liberties; empty point is null'
  })

  record('pass advances the turn and counts consecutive passes', 'pass', () => {
    const port = createPort()
    const before = port.createGame(gameConfig('harness-pass'))
    const first = port.pass('harness-pass', 'user')

    ensure(first.ok, `legal pass rejected: ${first.ok ? '' : first.reason}`)
    ensure(first.state.consecutivePasses === before.consecutivePasses + 1, 'pass counter did not advance')
    ensure(first.state.toPlay === 'deepseek', 'turn did not pass after pass')
    ensure(first.state.lastMove !== null && first.state.lastMove.type === 'pass', 'lastMove is not a pass')

    const second = port.pass('harness-pass', 'deepseek')
    ensure(second.ok, `second pass rejected: ${second.ok ? '' : second.reason}`)
    ensure(second.state.consecutivePasses === 2, 'second consecutive pass not counted')
    return 'two consecutive passes recorded'
  })

  record('score reports area scoring with komi 7.5 applied to white', 'score', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-score'))
    port.play('harness-score', 'user', { x: 2, y: 2 })

    const score = port.score('harness-score')
    ensure(score.scoring === 'area', 'scoring is not area')
    ensure(score.komi === 7.5, 'komi is not 7.5')
    ensure(score.black.total === score.black.stones + score.black.territory + score.black.komi, 'black total mismatch')
    ensure(score.white.total === score.white.stones + score.white.territory + score.white.komi, 'white total mismatch')
    ensure(score.white.komi === 7.5, 'white breakdown does not carry komi 7.5')
    ensure(score.winner === 'user' || score.winner === 'deepseek', 'winner is not a player')
    ensure(score.margin === Math.abs(score.black.total - score.white.total), 'margin does not match totals')
    return `score totals black=${score.black.total} white=${score.white.total}`
  })

  record('settle resumes play when the players disagree', 'settle', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-settle-disagree'))
    port.pass('harness-settle-disagree', 'user')
    port.pass('harness-settle-disagree', 'deepseek')

    const result = port.settle('harness-settle-disagree', { deadStones: [], agreed: false })
    ensure(!result.settled, 'disagreement settled the game')
    ensure(result.reason === 'disagreement', `wrong settlement reason: ${result.reason}`)
    ensure(result.state.status === 'playing', 'disagreement did not resume play')
    return 'game resumed as playing'
  })

  record('settle finalizes the game after two passes when the players agree', 'settle', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-settle-agree'))
    port.pass('harness-settle-agree', 'user')
    port.pass('harness-settle-agree', 'deepseek')

    const result = port.settle('harness-settle-agree', { deadStones: [], agreed: true })
    ensure(result.settled, 'agreement did not settle the game')
    ensure(result.state.status === 'over', 'settled game is not over')
    ensure(result.state.outcome !== null && result.state.outcome.reason === 'score', 'outcome is not a score result')
    ensure(result.score.scoring === 'area', 'settled score is not area scoring')
    ensure(result.score.komi === 7.5, 'settled score does not carry komi 7.5')
    return `settled with winner ${result.state.outcome.winner}`
  })

  record('resign ends the game immediately, opponent wins, board is not mutated', 'resign', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-resign'))
    port.play('harness-resign', 'user', { x: 2, y: 2 })
    port.play('harness-resign', 'deepseek', { x: 3, y: 3 })
    const before = port.getState('harness-resign')

    const result = port.resign('harness-resign', 'deepseek')
    ensure(result.ok, `resignation rejected: ${result.ok ? '' : result.reason}`)
    ensure(result.outcome.reason === 'resignation', 'outcome reason is not resignation')
    ensure(result.outcome.winner === 'user', 'opponent did not win by resignation')
    ensure(result.outcome.loser === 'deepseek', 'resigner is not the loser')
    ensure(result.state.status === 'over', 'game is not terminal after resignation')
    ensure(result.state.outcome !== null && result.state.outcome.reason === 'resignation', 'state outcome is not resignation')
    same(result.state.stones, before.stones, 'resignation mutated the board')
    ensure(result.state.moveNumber === before.moveNumber, 'resignation advanced the move number')
    same(port.getState('harness-resign'), result.state, 'getState disagrees with resign result')
    return 'terminal by resignation, user wins, board unchanged'
  })

  record('resign is terminal: later play, pass and resign are rejected without mutation', 'resign', () => {
    const port = createPort()
    port.createGame(gameConfig('harness-terminal'))
    port.play('harness-terminal', 'user', { x: 2, y: 2 })
    port.play('harness-terminal', 'deepseek', { x: 3, y: 3 })
    port.resign('harness-terminal', 'deepseek')
    const terminal = port.getState('harness-terminal')

    const playResult = port.play('harness-terminal', 'user', { x: 4, y: 4 })
    ensure(!playResult.ok, 'play accepted after resignation')
    ensure(playResult.reason === 'game-over', `wrong play rejection: ${playResult.reason}`)

    const passResult = port.pass('harness-terminal', 'user')
    ensure(!passResult.ok, 'pass accepted after resignation')
    ensure(passResult.reason === 'game-over', `wrong pass rejection: ${passResult.reason}`)

    const resignResult = port.resign('harness-terminal', 'user')
    ensure(!resignResult.ok, 'second resignation was accepted')
    ensure(resignResult.reason === 'game-over', `wrong resign rejection: ${resignResult.reason}`)

    same(port.getState('harness-terminal'), terminal, 'terminal state changed after rejected actions')
    return 'play, pass and resign rejected with unchanged terminal state'
  })

  const methods = [...new Set(cases.map((harnessCase) => harnessCase.method))].sort()
  const failures = cases.filter((harnessCase) => !harnessCase.ok)
  return { cases, methods, failures, ok: failures.length === 0 }
}

export const EXPECTED_GO_RULES_PORT_METHODS: readonly GoRulesPortMethod[] = [...GO_RULES_PORT_METHODS].sort()

export function formatHarnessReport(report: GoRulesPortHarnessReport): string {
  const lines = report.cases.map(
    (harnessCase) =>
      `${harnessCase.ok ? 'ok  ' : 'FAIL'} ${harnessCase.method.padEnd(13)} ${harnessCase.name}`,
  )
  lines.push(
    `harness: ${report.cases.length} cases, methods: ${report.methods.join(', ')}, failures: ${report.failures.length}`,
  )
  return lines.join('\n')
}
