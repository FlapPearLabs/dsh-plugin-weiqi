import { describe, expect, it } from 'vitest'
import type {
  GameConfig,
  MoveResult,
  Player,
  Point,
  ResignResult,
} from '../contracts/rules.js'
import type { CanonicalGameRecord, GameAction } from './canonical-record.js'
import { parseCanonicalGameRecord, serializeCanonicalGameRecord } from './canonical-record.js'
import { replayCanonicalGame } from './replay.js'
import { createTenukiGoRulesPort } from './tenuki-adapter.js'

/**
 * WAVE-B-T05 — Spec §31 deterministic fixture suite (BL-GR-07).
 *
 * Eleven fixed cases over `GoRulesPort` alone: no Tenuki import, no engine
 * internals, no randomness, no clock and no timers. Every case is a fixed
 * action script with exact expected results, so two runs produce byte-identical
 * state and the suite can gate CI (`pnpm verify`) before Go UI behavior.
 */

type Port = ReturnType<typeof createTenukiGoRulesPort>
type Step = readonly [Player, Point | null]

function gameConfig(gameId: string): GameConfig {
  return {
    gameId,
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: { user: 'black', deepseek: 'white' },
  }
}

function fixture(gameId: string): Port {
  const port = createTenukiGoRulesPort()
  port.createGame(gameConfig(gameId))
  return port
}

function play(port: Port, gameId: string, by: Player, point: Point) {
  const result = port.play(gameId, by, point)
  if (!result.ok) {
    throw new Error(`${by} (${point.x},${point.y}) rejected: ${result.reason}`)
  }
  return result
}

function pass(port: Port, gameId: string, by: Player) {
  const result = port.pass(gameId, by)
  if (!result.ok) throw new Error(`${by} pass rejected: ${result.reason}`)
  return result
}

function run(port: Port, gameId: string, steps: readonly Step[]): void {
  for (const [by, point] of steps) {
    if (point === null) pass(port, gameId, by)
    else play(port, gameId, by, point)
  }
}

function rejectionOf(result: MoveResult): string {
  if (result.ok) throw new Error('expected a rejected move, got an accepted one')
  return result.reason
}

function resignRejectionOf(result: ResignResult): string {
  if (result.ok) throw new Error('expected a rejected resignation, got an accepted one')
  return result.reason
}

const pointKeys = (points: readonly Point[]): string[] =>
  points.map(point => `${point.x},${point.y}`).sort()

const stoneKeys = (stones: readonly { readonly point: Point }[]): string[] =>
  pointKeys(stones.map(stone => stone.point))

/** Fixed dead-stone endgame from B-T04: a sealed 3x3 corner on the 9x9 board. */
const SEALED_CORNER: readonly Step[] = [
  ['user', { x: 0, y: 0 }],
  ['deepseek', { x: 3, y: 0 }],
  ['user', { x: 1, y: 1 }],
  ['deepseek', { x: 3, y: 1 }],
  ['user', null],
  ['deepseek', { x: 3, y: 2 }],
  ['user', null],
  ['deepseek', { x: 0, y: 3 }],
  ['user', null],
  ['deepseek', { x: 1, y: 3 }],
  ['user', null],
  ['deepseek', { x: 2, y: 3 }],
  ['user', null],
  ['deepseek', null],
]

const SEALED_CORNER_STONES = ['0,0', '0,3', '1,1', '1,3', '2,3', '3,0', '3,1', '3,2']
const SEALED_CORNER_DEAD: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]

/**
 * Fixed ko: black's (2,1) captures white's single stone at (1,1); the recapture
 * at (1,1) would recreate the previous position, so it is refused until an
 * intervening ko-threat exchange makes the position new. (8,8) is the parity
 * filler that leaves black to move at the ko.
 */
const KO_SETUP: readonly Step[] = [
  ['user', { x: 1, y: 0 }],
  ['deepseek', { x: 2, y: 0 }],
  ['user', { x: 0, y: 1 }],
  ['deepseek', { x: 3, y: 1 }],
  ['user', { x: 1, y: 2 }],
  ['deepseek', { x: 2, y: 2 }],
  ['user', { x: 8, y: 8 }],
  ['deepseek', { x: 1, y: 1 }],
]

/**
 * §31-relevant repetition cycle from Tenuki's own suite (also used by the B-S01
 * conformance record and B-T03): after the 27th move it is white's turn, and
 * white's (1,0) would recreate the position after move 25. Simple ko allows
 * that repetition; positional superko does not.
 */
const SUPERKO_SETUP: readonly Point[] = [
  { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 1 },
  { x: 4, y: 2 }, { x: 1, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 3 },
  { x: 2, y: 3 }, { x: 3, y: 4 }, { x: 1, y: 3 }, { x: 2, y: 4 }, { x: 0, y: 3 },
  { x: 1, y: 4 }, { x: 8, y: 0 }, { x: 0, y: 4 }, { x: 8, y: 1 }, { x: 1, y: 0 },
  { x: 8, y: 2 }, { x: 0, y: 1 }, { x: 8, y: 3 }, { x: 0, y: 2 }, { x: 8, y: 4 },
  { x: 2, y: 0 }, { x: 0, y: 0 },
]

/** Fixed 9x9 area endgame: black fills y=4, white fills y=5, then two passes. */
const AREA_ENDGAME: readonly Step[] = (() => {
  const steps: Step[] = []
  for (let x = 0; x < 9; x += 1) {
    steps.push(['user', { x, y: 4 }])
    steps.push(['deepseek', { x, y: 5 }])
  }
  steps.push(['user', null], ['deepseek', null])
  return steps
})()

/** Fixed canonical log: play/pass sequence with one capture and two passes. */
const CANONICAL_PLAY_LOG: readonly GameAction[] = [
  { type: 'play', by: 'user', point: { x: 1, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
  { type: 'play', by: 'user', point: { x: 0, y: 1 } },
  { type: 'play', by: 'deepseek', point: { x: 5, y: 5 } },
  { type: 'play', by: 'user', point: { x: 2, y: 2 } },
  { type: 'pass', by: 'deepseek' },
  { type: 'play', by: 'user', point: { x: 3, y: 3 } },
  { type: 'play', by: 'deepseek', point: { x: 4, y: 4 } },
  { type: 'pass', by: 'user' },
  { type: 'pass', by: 'deepseek' },
]

const BEFORE_RESIGN: readonly GameAction[] = [
  { type: 'play', by: 'user', point: { x: 1, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
  { type: 'play', by: 'user', point: { x: 0, y: 1 } },
]

function canonicalRecord(actions: readonly GameAction[]): CanonicalGameRecord {
  return {
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    actions,
  }
}

function liveState(actions: readonly GameAction[], gameId: string) {
  const port = fixture(gameId)
  for (const action of actions) {
    if (action.type === 'play') play(port, gameId, action.by, action.point)
    else if (action.type === 'pass') pass(port, gameId, action.by)
    else {
      const resigned = port.resign(gameId, action.by)
      if (!resigned.ok) throw new Error(`live resign rejected: ${resigned.reason}`)
    }
  }
  return port.getState(gameId)
}

function replay(actions: readonly GameAction[], gameId: string) {
  const port = createTenukiGoRulesPort()
  const wire = serializeCanonicalGameRecord(canonicalRecord(actions))
  const state = replayCanonicalGame(port, parseCanonicalGameRecord(wire), {
    gameId,
    colors: { user: 'black', deepseek: 'white' },
  })
  return { port, state }
}

describe('Spec §31 deterministic fixture suite (WAVE-B-T05, BL-GR-07)', () => {
  it('F01 single capture: one stone removed, counted for the capturer', () => {
    const id = 'spec31-f01-single-capture'
    const port = fixture(id)
    play(port, id, 'user', { x: 1, y: 0 })
    play(port, id, 'deepseek', { x: 0, y: 0 })

    const capture = play(port, id, 'user', { x: 0, y: 1 })

    expect(capture.captured).toEqual([{ point: { x: 0, y: 0 }, color: 'white' }])
    expect(capture.state.captures).toEqual({ user: 1, deepseek: 0 })
    expect(stoneKeys(capture.state.stones)).toEqual(['0,1', '1,0'])
    expect(capture.state.status).toBe('playing')
    expect(capture.state.toPlay).toBe('deepseek')
    expect(capture.state.moveNumber).toBe(3)
    expect(capture.state.consecutivePasses).toBe(0)
    expect(capture.state.outcome).toBeNull()
    expect(capture.state.lastMove).toEqual({
      type: 'play',
      by: 'user',
      point: { x: 0, y: 1 },
      moveNumber: 3,
    })
  })

  it('F02 multi-stone capture: a two-stone group leaves the board in one move', () => {
    const id = 'spec31-f02-multi-capture'
    const port = fixture(id)
    run(port, id, [
      ['user', { x: 0, y: 0 }],
      ['deepseek', { x: 2, y: 0 }],
      ['user', { x: 1, y: 0 }],
      ['deepseek', { x: 0, y: 1 }],
      ['user', { x: 8, y: 8 }],
    ])

    const capture = play(port, id, 'deepseek', { x: 1, y: 1 })

    expect(pointKeys(capture.captured.map(stone => stone.point))).toEqual(['0,0', '1,0'])
    expect(capture.captured.every(stone => stone.color === 'black')).toBe(true)
    expect(capture.state.captures).toEqual({ user: 0, deepseek: 2 })
    expect(stoneKeys(capture.state.stones)).toEqual(['0,1', '1,1', '2,0', '8,8'])
    expect(capture.state.moveNumber).toBe(6)
    expect(capture.state.toPlay).toBe('user')
  })

  it('F03 suicide rejection: refused with no board, counter or turn mutation', () => {
    const id = 'spec31-f03-suicide'
    const port = fixture(id)
    run(port, id, [
      ['user', { x: 0, y: 1 }],
      ['deepseek', { x: 5, y: 5 }],
      ['user', { x: 1, y: 0 }],
    ])
    const before = port.getState(id)

    const rejected = port.play(id, 'deepseek', { x: 0, y: 0 })

    expect(rejectionOf(rejected)).toBe('suicide')
    expect(rejected.state).toEqual(before)
    expect(port.getState(id)).toEqual(before)
    expect(before.moveNumber).toBe(3)
    expect(before.captures).toEqual({ user: 0, deepseek: 0 })
  })

  it('F04 pass: recorded, counted, turn-advancing and clearing on a later play', () => {
    const id = 'spec31-f04-pass'
    const port = fixture(id)
    const created = port.getState(id)

    const first = pass(port, id, 'user')

    expect(first.captured).toEqual([])
    expect(first.state.stones).toEqual(created.stones)
    expect(first.state.consecutivePasses).toBe(1)
    expect(first.state.toPlay).toBe('deepseek')
    expect(first.state.moveNumber).toBe(1)
    expect(first.state.status).toBe('playing')
    expect(first.state.lastMove).toEqual({ type: 'pass', by: 'user', moveNumber: 1 })

    const second = pass(port, id, 'deepseek')
    expect(second.state.consecutivePasses).toBe(2)
    expect(second.state.toPlay).toBe('user')
    expect(second.state.moveNumber).toBe(2)
    expect(second.state.lastMove).toEqual({ type: 'pass', by: 'deepseek', moveNumber: 2 })

    const resumed = play(port, id, 'user', { x: 4, y: 4 })
    expect(resumed.state.consecutivePasses).toBe(0)
    expect(resumed.state.moveNumber).toBe(3)
    expect(resumed.state.status).toBe('playing')
  })

  it('F05 two-pass settlement: exact area score and terminal outcome', () => {
    const id = 'spec31-f05-two-pass-settlement'
    const port = fixture(id)
    run(port, id, [['user', { x: 2, y: 2 }], ['deepseek', null], ['user', null]])

    const settled = port.settle(id, { deadStones: [], agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)

    expect(settled.score).toEqual({
      scoring: 'area',
      komi: 7.5,
      black: { stones: 1, territory: 80, komi: 0, total: 81 },
      white: { stones: 0, territory: 0, komi: 7.5, total: 7.5 },
      winner: 'user',
      margin: 73.5,
    })
    expect(settled.state.status).toBe('over')
    expect(settled.state.consecutivePasses).toBe(2)
    expect(settled.state.outcome).toEqual({ winner: 'user', loser: 'deepseek', reason: 'score' })

    const terminal = port.getState(id)
    expect(rejectionOf(port.play(id, 'user', { x: 4, y: 4 }))).toBe('game-over')
    expect(rejectionOf(port.pass(id, 'user'))).toBe('game-over')
    expect(port.getState(id)).toEqual(terminal)
  })

  it('F06 dead-stone confirmation: confirmed stones score for the opponent, board untouched', () => {
    const id = 'spec31-f06-dead-stones'
    const port = fixture(id)
    run(port, id, SEALED_CORNER)

    const settled = port.settle(id, { deadStones: SEALED_CORNER_DEAD, agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)

    expect(settled.score.black).toEqual({ stones: 0, territory: 0, komi: 0, total: 0 })
    expect(settled.score.white).toEqual({ stones: 6, territory: 75, komi: 7.5, total: 88.5 })
    expect(settled.score.margin).toBe(88.5)
    expect(settled.score.winner).toBe('deepseek')
    expect(settled.state.outcome).toEqual({ winner: 'deepseek', loser: 'user', reason: 'score' })
    expect(settled.state.status).toBe('over')
    expect(stoneKeys(settled.state.stones)).toEqual(SEALED_CORNER_STONES)
    expect(settled.state.captures).toEqual({ user: 0, deepseek: 0 })
  })

  it('F07 disagreement resume: disputed ending rolls back, play continues from there', () => {
    const id = 'spec31-f07-disagreement'
    const port = fixture(id)
    run(port, id, SEALED_CORNER)

    const disagreed = port.settle(id, { deadStones: SEALED_CORNER_DEAD, agreed: false })
    if (disagreed.settled) throw new Error('disagreement settled the game')

    expect(disagreed.reason).toBe('disagreement')
    expect(disagreed.state.status).toBe('playing')
    expect(disagreed.state.consecutivePasses).toBe(0)
    expect(disagreed.state.moveNumber).toBe(12)
    expect(disagreed.state.outcome).toBeNull()
    expect(disagreed.state.lastMove).toEqual({
      type: 'play',
      by: 'deepseek',
      point: { x: 2, y: 3 },
      moveNumber: 12,
    })
    expect(stoneKeys(disagreed.state.stones)).toEqual(SEALED_CORNER_STONES)
    expect(disagreed.state.captures).toEqual({ user: 0, deepseek: 0 })

    const resumed = pass(port, id, 'user')
    expect(resumed.state.status).toBe('playing')
    expect(resumed.state.consecutivePasses).toBe(1)
    expect(resumed.state.toPlay).toBe('deepseek')
    expect(resumed.state.moveNumber).toBe(13)
  })

  it('F08 ko / positional superko: ko recapture waits for a threat, repetition is refused', () => {
    const koId = 'spec31-f08-ko'
    const ko = fixture(koId)
    run(ko, koId, KO_SETUP)

    const koCapture = play(ko, koId, 'user', { x: 2, y: 1 })
    expect(koCapture.captured).toEqual([{ point: { x: 1, y: 1 }, color: 'white' }])
    expect(koCapture.state.captures).toEqual({ user: 1, deepseek: 0 })
    expect(stoneKeys(koCapture.state.stones)).toEqual([
      '0,1', '1,0', '1,2', '2,0', '2,1', '2,2', '3,1', '8,8',
    ])
    expect(koCapture.state.moveNumber).toBe(9)
    expect(koCapture.state.toPlay).toBe('deepseek')

    const beforeRecapture = ko.getState(koId)
    const immediate = ko.play(koId, 'deepseek', { x: 1, y: 1 })
    expect(rejectionOf(immediate)).toBe('superko')
    expect(immediate.state).toEqual(beforeRecapture)
    expect(ko.getState(koId)).toEqual(beforeRecapture)

    play(ko, koId, 'deepseek', { x: 6, y: 6 })
    play(ko, koId, 'user', { x: 7, y: 7 })
    const recapture = play(ko, koId, 'deepseek', { x: 1, y: 1 })
    expect(recapture.captured).toEqual([{ point: { x: 2, y: 1 }, color: 'black' }])
    expect(recapture.state.captures).toEqual({ user: 1, deepseek: 1 })
    expect(stoneKeys(recapture.state.stones)).toEqual([
      '0,1', '1,0', '1,1', '1,2', '2,0', '2,2', '3,1', '6,6', '7,7', '8,8',
    ])
    expect(recapture.state.moveNumber).toBe(12)
    expect(recapture.state.toPlay).toBe('user')

    const superkoId = 'spec31-f08-superko'
    const superko = fixture(superkoId)
    SUPERKO_SETUP.forEach((point, index) => {
      play(superko, superkoId, index % 2 === 0 ? 'user' : 'deepseek', point)
    })
    const beforeRepetition = superko.getState(superkoId)
    const repeated = superko.play(superkoId, 'deepseek', { x: 1, y: 0 })
    expect(rejectionOf(repeated)).toBe('superko')
    expect(repeated.state).toEqual(beforeRepetition)
    expect(superko.getState(superkoId)).toEqual(beforeRepetition)
    expect(pass(superko, superkoId, 'deepseek').state.consecutivePasses).toBe(1)
  })

  it('F09 area scoring + komi 7.5: exact hand-computed endgame totals', () => {
    const id = 'spec31-f09-area-scoring'
    const port = fixture(id)
    run(port, id, AREA_ENDGAME)

    const score = port.score(id)

    expect(score).toEqual({
      scoring: 'area',
      komi: 7.5,
      black: { stones: 9, territory: 36, komi: 0, total: 45 },
      white: { stones: 9, territory: 27, komi: 7.5, total: 43.5 },
      winner: 'user',
      margin: 1.5,
    })
    expect(port.getState(id).status).toBe('playing')
    expect(port.getState(id).consecutivePasses).toBe(2)
  })

  it('F10 resignation terminal: immediate over, opponent wins, no board change, no further action', () => {
    const id = 'spec31-f10-resign'
    const port = fixture(id)
    play(port, id, 'user', { x: 2, y: 2 })
    play(port, id, 'deepseek', { x: 3, y: 3 })
    const before = port.getState(id)

    const resigned = port.resign(id, 'deepseek')
    if (!resigned.ok) throw new Error(`resignation rejected: ${resigned.reason}`)

    expect(resigned.outcome).toEqual({
      winner: 'user',
      loser: 'deepseek',
      reason: 'resignation',
    })
    expect(resigned.state.status).toBe('over')
    expect(resigned.state.outcome).toEqual({
      winner: 'user',
      loser: 'deepseek',
      reason: 'resignation',
    })
    expect(resigned.state.stones).toEqual(before.stones)
    expect(resigned.state.moveNumber).toBe(before.moveNumber)
    expect(resigned.state.toPlay).toBe(before.toPlay)
    expect(resigned.state.lastMove).toEqual(before.lastMove)
    expect(resigned.state.captures).toEqual(before.captures)
    expect(resigned.state.consecutivePasses).toBe(before.consecutivePasses)

    const terminal = port.getState(id)
    expect(terminal).toEqual(resigned.state)
    expect(rejectionOf(port.play(id, 'user', { x: 4, y: 4 }))).toBe('game-over')
    expect(rejectionOf(port.pass(id, 'user'))).toBe('game-over')
    expect(resignRejectionOf(port.resign(id, 'user'))).toBe('game-over')
    expect(port.getState(id)).toEqual(terminal)
  })

  it('F11 canonical record -> replay restoration: board, turn, captures; resigned replay stays terminal', () => {
    const id = 'spec31-f11-canonical-replay'
    const live = liveState(CANONICAL_PLAY_LOG, id)
    const { state: restored } = replay(CANONICAL_PLAY_LOG, id)

    expect(restored).toEqual(live)
    expect(stoneKeys(restored.stones)).toHaveLength(6)
    expect(restored.captures).toEqual({ user: 1, deepseek: 0 })
    expect(restored.toPlay).toBe('user')
    expect(restored.moveNumber).toBe(10)
    expect(restored.consecutivePasses).toBe(2)
    expect(restored.status).toBe('playing')
    expect(restored.outcome).toBeNull()
    expect(restored.lastMove).toEqual({ type: 'pass', by: 'deepseek', moveNumber: 10 })

    const repeated = replay(CANONICAL_PLAY_LOG, id).state
    expect(repeated).toEqual(restored)

    const resignId = 'spec31-f11-canonical-resign'
    const resignedActions: readonly GameAction[] = [
      ...BEFORE_RESIGN,
      { type: 'resign', by: 'deepseek' },
    ]
    const beforeResign = liveState(BEFORE_RESIGN, resignId)
    const { port, state } = replay(resignedActions, resignId)

    expect(state.status).toBe('over')
    expect(state.outcome).toEqual({
      winner: 'user',
      loser: 'deepseek',
      reason: 'resignation',
    })
    expect(state.stones).toEqual(beforeResign.stones)
    expect(state.moveNumber).toBe(beforeResign.moveNumber)
    expect(state.consecutivePasses).toBe(beforeResign.consecutivePasses)
    expect(state.captures).toEqual(beforeResign.captures)
    expect(state.lastMove).toEqual(beforeResign.lastMove)

    expect(rejectionOf(port.play(resignId, 'user', { x: 5, y: 5 }))).toBe('game-over')
    expect(rejectionOf(port.pass(resignId, 'user'))).toBe('game-over')
    expect(resignRejectionOf(port.resign(resignId, 'user'))).toBe('game-over')
    expect(port.getState(resignId)).toEqual(state)
  })
})
