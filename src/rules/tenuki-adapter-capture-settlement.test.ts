import { describe, expect, it } from 'vitest'
import type { GameConfig, Player, Point } from '../contracts/rules.js'
import { createTenukiGoRulesPort } from './tenuki-adapter.js'

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

function start(gameId: string): Port {
  const port = createTenukiGoRulesPort()
  port.createGame(gameConfig(gameId))
  return port
}

function step(port: Port, gameId: string, by: Player, point: Point | null): void {
  const result = point === null ? port.pass(gameId, by) : port.play(gameId, by, point)
  if (!result.ok) {
    const where = point === null ? 'pass' : `(${point.x},${point.y})`
    throw new Error(`${by} ${where} rejected: ${result.reason}`)
  }
}

function run(port: Port, gameId: string, steps: readonly Step[]): void {
  for (const [by, point] of steps) step(port, gameId, by, point)
}

const pointKeys = (points: readonly Point[]): string[] => points.map(point => `${point.x},${point.y}`).sort()

const stoneKeys = (stones: readonly { readonly point: Point }[]): string[] =>
  pointKeys(stones.map(stone => stone.point))

const opposite = (player: Player): Player => (player === 'user' ? 'deepseek' : 'user')

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

function plainDataProblems(value: unknown, path: string, problems: string[] = []): string[] {
  if (typeof value === 'function') {
    problems.push(`${path}: function`)
    return problems
  }
  if (value === null || typeof value !== 'object') return problems

  const prototype: unknown = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) problems.push(`${path}: exotic array prototype`)
    value.forEach((item, index) => plainDataProblems(item, `${path}[${index}]`, problems))
    return problems
  }
  if (prototype !== Object.prototype) {
    const name = (prototype as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'null'
    problems.push(`${path}: ${name}`)
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
    plainDataProblems(item, `${path}.${key}`, problems),
  )
  return problems
}

describe('WAVE-B-T04 single capture (Spec §31)', () => {
  it('captures one white stone and counts it for black', () => {
    const id = 'b-t04-capture-black'
    const port = start(id)
    run(port, id, [
      ['user', { x: 1, y: 0 }],
      ['deepseek', { x: 0, y: 0 }],
    ])

    const capture = port.play(id, 'user', { x: 0, y: 1 })
    if (!capture.ok) throw new Error(`capture rejected: ${capture.reason}`)

    expect(capture.captured).toEqual([{ point: { x: 0, y: 0 }, color: 'white' }])
    expect(capture.state.captures).toEqual({ user: 1, deepseek: 0 })
    expect(stoneKeys(capture.state.stones)).toEqual(['0,1', '1,0'])
    expect(capture.state.moveNumber).toBe(3)
    expect(capture.state.toPlay).toBe('deepseek')
    expect(capture.state.lastMove).toEqual({
      type: 'play',
      by: 'user',
      point: { x: 0, y: 1 },
      moveNumber: 3,
    })
  })

  it('captures one black stone and counts it for white', () => {
    const id = 'b-t04-capture-white'
    const port = start(id)
    run(port, id, [
      ['user', { x: 0, y: 0 }],
      ['deepseek', { x: 1, y: 0 }],
      ['user', { x: 8, y: 8 }],
    ])

    const capture = port.play(id, 'deepseek', { x: 0, y: 1 })
    if (!capture.ok) throw new Error(`capture rejected: ${capture.reason}`)

    expect(capture.captured).toEqual([{ point: { x: 0, y: 0 }, color: 'black' }])
    expect(capture.state.captures).toEqual({ user: 0, deepseek: 1 })
    expect(stoneKeys(capture.state.stones)).toEqual(['0,1', '1,0', '8,8'])
  })

  it('accumulates separate captures in the state', () => {
    const id = 'b-t04-capture-accumulate'
    const port = start(id)
    run(port, id, [
      ['user', { x: 5, y: 5 }],
      ['deepseek', { x: 0, y: 0 }],
      ['user', { x: 1, y: 0 }],
      ['deepseek', null],
    ])

    const first = port.play(id, 'user', { x: 0, y: 1 })
    if (!first.ok) throw new Error(`first capture rejected: ${first.reason}`)
    expect(first.state.captures).toEqual({ user: 1, deepseek: 0 })

    run(port, id, [
      ['deepseek', { x: 8, y: 8 }],
      ['user', { x: 8, y: 7 }],
      ['deepseek', null],
    ])

    const second = port.play(id, 'user', { x: 7, y: 8 })
    if (!second.ok) throw new Error(`second capture rejected: ${second.reason}`)
    expect(second.captured).toEqual([{ point: { x: 8, y: 8 }, color: 'white' }])
    expect(second.state.captures).toEqual({ user: 2, deepseek: 0 })
  })
})

describe('WAVE-B-T04 multi-stone capture (Spec §31)', () => {
  it('removes a two-stone group in one move and counts both stones', () => {
    const id = 'b-t04-capture-multi'
    const port = start(id)
    run(port, id, [
      ['user', { x: 0, y: 0 }],
      ['deepseek', { x: 2, y: 0 }],
      ['user', { x: 1, y: 0 }],
      ['deepseek', { x: 0, y: 1 }],
      ['user', { x: 8, y: 8 }],
    ])

    const capture = port.play(id, 'deepseek', { x: 1, y: 1 })
    if (!capture.ok) throw new Error(`capture rejected: ${capture.reason}`)

    expect(pointKeys(capture.captured.map(stone => stone.point))).toEqual(['0,0', '1,0'])
    expect(capture.captured.every(stone => stone.color === 'black')).toBe(true)
    expect(capture.state.captures).toEqual({ user: 0, deepseek: 2 })
    expect(stoneKeys(capture.state.stones)).toEqual(['0,1', '1,1', '2,0', '8,8'])
  })
})

describe('WAVE-B-T04 suicide rejection (Spec §31)', () => {
  it('rejects a single-stone suicide with no board or counter mutation', () => {
    const id = 'b-t04-suicide'
    const port = start(id)
    run(port, id, [
      ['user', { x: 0, y: 1 }],
      ['deepseek', { x: 5, y: 5 }],
      ['user', { x: 1, y: 0 }],
    ])
    const before = port.getState(id)

    const rejected = port.play(id, 'deepseek', { x: 0, y: 0 })

    expect(rejected.ok).toBe(false)
    expect(rejected.ok ? null : rejected.reason).toBe('suicide')
    expect(rejected.state).toEqual(before)
    expect(port.getState(id)).toEqual(before)
    expect(rejected.state.moveNumber).toBe(3)
    expect(rejected.state.captures).toEqual({ user: 0, deepseek: 0 })
  })

  it('rejects a whole-group suicide with no board mutation', () => {
    const id = 'b-t04-suicide-group'
    const port = start(id)
    run(port, id, [
      ['user', { x: 0, y: 1 }],
      ['deepseek', { x: 1, y: 0 }],
      ['user', { x: 2, y: 0 }],
      ['deepseek', null],
      ['user', { x: 1, y: 1 }],
    ])
    const white = port.inspectGroup(id, { x: 1, y: 0 })
    expect(pointKeys(white?.liberties ?? [])).toEqual(['0,0'])
    const before = port.getState(id)

    const rejected = port.play(id, 'deepseek', { x: 0, y: 0 })

    expect(rejected.ok ? null : rejected.reason).toBe('suicide')
    expect(rejected.state).toEqual(before)
    expect(port.getState(id)).toEqual(before)
  })

  it('accepts a self-atari instead of misclassifying it as suicide', () => {
    const id = 'b-t04-one-liberty'
    const port = start(id)
    run(port, id, [
      ['user', { x: 5, y: 5 }],
      ['deepseek', null],
      ['user', { x: 1, y: 0 }],
    ])

    const placed = port.play(id, 'deepseek', { x: 0, y: 0 })
    if (!placed.ok) throw new Error(`one-liberty play rejected: ${placed.reason}`)
    expect(pointKeys(port.inspectGroup(id, { x: 0, y: 0 })?.liberties ?? [])).toEqual(['0,1'])

    const capture = port.play(id, 'user', { x: 0, y: 1 })
    if (!capture.ok) throw new Error(`capture rejected: ${capture.reason}`)
    expect(capture.captured).toEqual([{ point: { x: 0, y: 0 }, color: 'white' }])
    expect(capture.state.captures).toEqual({ user: 1, deepseek: 0 })
  })
})

describe('WAVE-B-T04 pass (Spec §31)', () => {
  it('advances the turn, records the pass and clears the count on the next play', () => {
    const id = 'b-t04-pass'
    const port = start(id)
    const created = port.getState(id)

    const first = port.pass(id, 'user')
    if (!first.ok) throw new Error(`pass rejected: ${first.reason}`)
    expect(first.captured).toEqual([])
    expect(first.state.stones).toEqual(created.stones)
    expect(first.state.consecutivePasses).toBe(1)
    expect(first.state.toPlay).toBe('deepseek')
    expect(first.state.moveNumber).toBe(1)
    expect(first.state.lastMove).toEqual({ type: 'pass', by: 'user', moveNumber: 1 })

    const second = port.pass(id, 'deepseek')
    if (!second.ok) throw new Error(`second pass rejected: ${second.reason}`)
    expect(second.state.consecutivePasses).toBe(2)
    expect(second.state.toPlay).toBe('user')

    const played = port.play(id, 'user', { x: 4, y: 4 })
    if (!played.ok) throw new Error(`play after passes rejected: ${played.reason}`)
    expect(played.state.consecutivePasses).toBe(0)
    expect(played.state.moveNumber).toBe(3)
    expect(played.state.status).toBe('playing')
    expect(played.state.outcome).toBeNull()
  })

  it('accepts a play instead of settling while the ending is not confirmed', () => {
    const id = 'b-t04-pass-then-play'
    const port = start(id)
    expect(port.pass(id, 'user').ok).toBe(true)
    expect(port.pass(id, 'deepseek').ok).toBe(true)

    const played = port.play(id, 'user', { x: 2, y: 2 })

    if (!played.ok) throw new Error(`play after two passes rejected: ${played.reason}`)
    expect(played.state.status).toBe('playing')
    expect(played.state.consecutivePasses).toBe(0)
    expect(stoneKeys(played.state.stones)).toEqual(['2,2'])
    expect(played.state.toPlay).toBe('deepseek')
  })
})

describe('WAVE-B-T04 two-pass ending (Spec §31)', () => {
  it('refuses to settle before two consecutive passes without mutation', () => {
    const id = 'b-t04-settle-early'
    const port = start(id)
    run(port, id, [
      ['user', { x: 2, y: 2 }],
      ['deepseek', null],
    ])
    const before = port.getState(id)

    const early = port.settle(id, { deadStones: [{ x: 5, y: 5 }], agreed: true })

    expect(early.settled).toBe(false)
    expect(early.settled ? null : early.reason).toBe('not-two-passes')
    expect(early.state).toEqual(before)
    expect(port.getState(id)).toEqual(before)
  })

  it('settles a two-pass ending with an explicit area score outcome', () => {
    const id = 'b-t04-settle-agree'
    const port = start(id)
    run(port, id, [
      ['user', { x: 2, y: 2 }],
      ['deepseek', null],
      ['user', null],
    ])

    const settled = port.settle(id, { deadStones: [], agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)

    expect(settled.state.status).toBe('over')
    expect(settled.state.consecutivePasses).toBe(2)
    expect(settled.score.black).toEqual({ stones: 1, territory: 80, komi: 0, total: 81 })
    expect(settled.score.white).toEqual({ stones: 0, territory: 0, komi: 7.5, total: 7.5 })
    expect(settled.score.margin).toBe(73.5)
    expect(settled.score.winner).toBe('user')
    expect(settled.state.outcome).toEqual({ winner: 'user', loser: 'deepseek', reason: 'score' })
    expect(port.score(id)).toEqual(settled.score)
  })

  it('is terminal: later play, pass and settle leave the settled state unchanged', () => {
    const id = 'b-t04-settle-terminal'
    const port = start(id)
    run(port, id, [
      ['user', { x: 2, y: 2 }],
      ['deepseek', null],
      ['user', null],
    ])
    const settled = port.settle(id, { deadStones: [], agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)
    const terminal = port.getState(id)

    const played = port.play(id, 'user', { x: 4, y: 4 })
    expect(played.ok ? null : played.reason).toBe('game-over')

    const passed = port.pass(id, 'user')
    expect(passed.ok ? null : passed.reason).toBe('game-over')

    const again = port.settle(id, { deadStones: [], agreed: false })
    expect(again.settled ? null : again.reason).toBe('game-over')

    expect(port.getState(id)).toEqual(terminal)
  })
})

describe('WAVE-B-T04 dead-stone confirmation (Spec §31)', () => {
  it('leaves enclosed stones counted as live when nothing is confirmed dead', () => {
    const id = 'b-t04-dead-none'
    const port = start(id)
    run(port, id, SEALED_CORNER)

    const settled = port.settle(id, { deadStones: [], agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)

    // The sealed 3x3 corner holds 2 black stones and 7 empty points touching both
    // colours, so only the 66 points outside the white wall are white territory.
    expect(settled.score.black).toEqual({ stones: 2, territory: 0, komi: 0, total: 2 })
    expect(settled.score.white).toEqual({ stones: 6, territory: 66, komi: 7.5, total: 79.5 })
    expect(settled.score.margin).toBe(77.5)
    expect(settled.score.winner).toBe('deepseek')
    expect(settled.state.outcome).toEqual({ winner: 'deepseek', loser: 'user', reason: 'score' })
  })

  it('moves confirmed dead stones into the opponent score without mutating the board', () => {
    const id = 'b-t04-dead-confirmed'
    const port = start(id)
    run(port, id, SEALED_CORNER)

    const settled = port.settle(id, { deadStones: SEALED_CORNER_DEAD, agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)

    expect(settled.score.black).toEqual({ stones: 0, territory: 0, komi: 0, total: 0 })
    expect(settled.score.white).toEqual({ stones: 6, territory: 75, komi: 7.5, total: 88.5 })
    expect(settled.score.margin).toBe(88.5)
    expect(settled.state.outcome).toEqual({ winner: 'deepseek', loser: 'user', reason: 'score' })
    expect(port.score(id)).toEqual(settled.score)
    expect(stoneKeys(settled.state.stones)).toEqual(SEALED_CORNER_STONES)
    expect(settled.state.captures).toEqual({ user: 0, deepseek: 0 })
  })
})

describe('WAVE-B-T04 disagreement -> resume play (Spec §25)', () => {
  it('ignores the offered dead stones and resumes from the pre-ending position', () => {
    const id = 'b-t04-disagree'
    const port = start(id)
    run(port, id, SEALED_CORNER)
    expect(port.getState(id).consecutivePasses).toBe(2)

    const disagreed = port.settle(id, { deadStones: SEALED_CORNER_DEAD, agreed: false })
    if (disagreed.settled) throw new Error('disagreement settled the game')

    expect(disagreed.reason).toBe('disagreement')
    expect(disagreed.state.status).toBe('playing')
    expect(disagreed.state.consecutivePasses).toBe(0)
    expect(disagreed.state.moveNumber).toBe(12)
    expect(disagreed.state.lastMove).toEqual({
      type: 'play',
      by: 'deepseek',
      point: { x: 2, y: 3 },
      moveNumber: 12,
    })
    expect(stoneKeys(disagreed.state.stones)).toEqual(SEALED_CORNER_STONES)
    expect(disagreed.state.captures).toEqual({ user: 0, deepseek: 0 })
    // Tenuki reports territory only while its own two-pass ending stands, so the
    // "no dead stones were applied" check reads the live stone counts instead.
    expect(port.score(id).black.stones).toBe(2)
    expect(port.score(id).white.stones).toBe(6)

    const resumedPass = port.pass(id, 'user')
    if (!resumedPass.ok) throw new Error(`pass after disagreement rejected: ${resumedPass.reason}`)
    expect(resumedPass.state.consecutivePasses).toBe(1)
    expect(resumedPass.state.toPlay).toBe('deepseek')
    expect(resumedPass.state.status).toBe('playing')
  })
})

describe('WAVE-B-T04 public boundary', () => {
  it('returns only plain contract data, with no engine objects in any result', () => {
    const id = 'b-t04-shape-capture'
    const port = start(id)
    run(port, id, [
      ['user', { x: 1, y: 0 }],
      ['deepseek', { x: 0, y: 0 }],
    ])
    const capture = port.play(id, 'user', { x: 0, y: 1 })
    if (!capture.ok) throw new Error(`capture rejected: ${capture.reason}`)
    expect(plainDataProblems(capture, 'move-result')).toEqual([])
    expect(plainDataProblems(port.getState(id), 'state')).toEqual([])

    const settleId = 'b-t04-shape-settle'
    const settlePort = start(settleId)
    run(settlePort, settleId, [
      ['user', { x: 2, y: 2 }],
      ['deepseek', null],
      ['user', null],
    ])
    const settled = settlePort.settle(settleId, { deadStones: [], agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)
    expect(plainDataProblems(settled, 'settle-result')).toEqual([])
  })
})
