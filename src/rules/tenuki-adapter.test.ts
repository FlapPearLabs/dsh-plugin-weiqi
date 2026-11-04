import { describe, expect, it } from 'vitest'
import type { GameConfig, GameState, Player, Point } from '../contracts/rules.js'
import { createTenukiGoRulesPort } from './tenuki-adapter.js'
import {
  EXPECTED_GO_RULES_PORT_METHODS,
  formatHarnessReport,
  runGoRulesPortContract,
} from '../../tests/rules/port-harness.js'

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

// §31-relevant repetition cycle from tenuki's own suite, reused from the B-S01
// conformance record (docs/validation/TENUKI_CONFORMANCE_VERIFIED.md).
const SUPERKO_SETUP: readonly Point[] = [
  { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 1 },
  { x: 4, y: 2 }, { x: 1, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 3 },
  { x: 2, y: 3 }, { x: 3, y: 4 }, { x: 1, y: 3 }, { x: 2, y: 4 }, { x: 0, y: 3 },
  { x: 1, y: 4 }, { x: 8, y: 0 }, { x: 0, y: 4 }, { x: 8, y: 1 }, { x: 1, y: 0 },
  { x: 8, y: 2 }, { x: 0, y: 1 }, { x: 8, y: 3 }, { x: 0, y: 2 }, { x: 8, y: 4 },
  { x: 2, y: 0 }, { x: 0, y: 0 },
]

describe('TenukiAdapter against the engine-independent harness', () => {
  const report = runGoRulesPortContract(createTenukiGoRulesPort)

  it('is green against the pinned engine and exercises all eight methods', () => {
    console.log(formatHarnessReport(report))
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect([...report.methods]).toEqual([...EXPECTED_GO_RULES_PORT_METHODS])
    expect(report.cases.length).toBeGreaterThanOrEqual(13)
  })
})

describe('TenukiAdapter observable frozen rules (Spec §25/§27)', () => {
  it('negative control: counts live stones by area (black 1), not tenuki territory defaults (0)', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('area-control'))
    expect(port.play('area-control', 'user', { x: 2, y: 2 }).ok).toBe(true)

    const score = port.score('area-control')
    expect(score.scoring).toBe('area')
    expect(score.black.stones).toBe(1)
    expect(score.black.territory).toBe(0)
    expect(score.black.total).toBe(1)
  })

  it('negative control: applies komi 7.5 to white, not tenuki komi 0', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('komi-control'))
    expect(port.play('komi-control', 'user', { x: 2, y: 2 }).ok).toBe(true)

    const score = port.score('komi-control')
    expect(score.white.stones).toBe(0)
    expect(score.white.komi).toBe(7.5)
    expect(score.white.total).toBe(7.5)
  })

  it('negative control: rejects a repeated position under positional superko, not simple ko', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('superko-control'))
    SUPERKO_SETUP.forEach((point, index) => {
      const by: Player = index % 2 === 0 ? 'user' : 'deepseek'
      expect(port.play('superko-control', by, point).ok).toBe(true)
    })
    const before = port.getState('superko-control')

    const repeated = port.play('superko-control', 'deepseek', { x: 1, y: 0 })
    expect(repeated.ok).toBe(false)
    expect(repeated.ok ? null : repeated.reason).toBe('superko')
    expect(port.getState('superko-control')).toEqual(before)
  })
})

// Ten black stones with no white stone on the board: the board score favours
// user (black), which is what makes the resignation case below observable.
const BLACK_LEADING_POSITION: readonly Point[] = [
  { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 0 },
  { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 6, y: 2 }, { x: 8, y: 2 },
]

describe('TenukiAdapter settlement disagreement (Spec §25: disagreement -> resume play)', () => {
  it('accepts a pass after a disagreed settlement and keeps the state coherent', () => {
    const port = createTenukiGoRulesPort()
    const created = port.createGame(gameConfig('disagree-pass'))
    expect(port.pass('disagree-pass', 'user').ok).toBe(true)
    expect(port.pass('disagree-pass', 'deepseek').ok).toBe(true)

    const disagreed = port.settle('disagree-pass', { deadStones: [], agreed: false })
    if (disagreed.settled) throw new Error('disagreement settled the game')
    expect(disagreed.reason).toBe('disagreement')
    expect(disagreed.state.status).toBe('playing')
    // The disputed pass pair is rolled back: play resumes from the last
    // uncontested position, so the ending can be replayed and settled again.
    expect(disagreed.state.consecutivePasses).toBe(0)
    expect(disagreed.state.toPlay).toBe('user')
    expect(disagreed.state.stones).toEqual(created.stones)
    expect(disagreed.state.lastMove).toBeNull()
    expect(disagreed.state.outcome).toBeNull()

    const resumedPass = port.pass('disagree-pass', 'user')
    if (!resumedPass.ok) throw new Error(`pass after disagreement rejected: ${resumedPass.reason}`)
    expect(resumedPass.state.status).toBe('playing')
    expect(resumedPass.state.consecutivePasses).toBe(1)
    expect(resumedPass.state.toPlay).toBe('deepseek')
    expect(resumedPass.state.outcome).toBeNull()
    expect(resumedPass.state.moveNumber).toBe(disagreed.state.moveNumber + 1)
    expect(resumedPass.state.lastMove).toEqual({
      type: 'pass',
      by: 'user',
      moveNumber: resumedPass.state.moveNumber,
    })

    const secondPass = port.pass('disagree-pass', 'deepseek')
    expect(secondPass.ok).toBe(true)
    const settled = port.settle('disagree-pass', { deadStones: [], agreed: true })
    if (!settled.settled) throw new Error(`second settlement rejected: ${settled.reason}`)
    expect(settled.state.status).toBe('over')
    expect(settled.state.outcome?.reason).toBe('score')
  })

  it('resumes with a board play after a disagreed settlement', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('disagree-play'))
    port.pass('disagree-play', 'user')
    port.pass('disagree-play', 'deepseek')

    const disagreed = port.settle('disagree-play', { deadStones: [], agreed: false })
    if (disagreed.settled) throw new Error('disagreement settled the game')

    const resumed = port.play('disagree-play', 'user', { x: 4, y: 4 })
    if (!resumed.ok) throw new Error(`play after disagreement rejected: ${resumed.reason}`)
    expect(resumed.state.status).toBe('playing')
    expect(resumed.state.consecutivePasses).toBe(0)
    expect(resumed.state.toPlay).toBe('deepseek')
    expect(resumed.state.stones).toEqual([{ point: { x: 4, y: 4 }, color: 'black' }])
  })
})

describe('TenukiAdapter terminal score boundary (Spec §25 resignation rule)', () => {
  it('rejects score() after a resignation instead of reporting a contradicting winner', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('resign-score'))
    for (const point of BLACK_LEADING_POSITION) {
      expect(port.play('resign-score', 'user', point).ok).toBe(true)
      expect(port.pass('resign-score', 'deepseek').ok).toBe(true)
    }
    expect(port.score('resign-score').winner).toBe('user')

    const resigned = port.resign('resign-score', 'user')
    if (!resigned.ok) throw new Error(`resignation rejected: ${resigned.reason}`)
    expect(resigned.outcome.winner).toBe('deepseek')
    const terminal = port.getState('resign-score')

    expect(() => port.score('resign-score')).toThrow(/resignation/i)
    expect(port.getState('resign-score')).toEqual(terminal)
  })

  it('keeps score() available and consistent after an agreed score settlement', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('settle-score'))
    expect(port.play('settle-score', 'user', { x: 2, y: 2 }).ok).toBe(true)
    expect(port.pass('settle-score', 'deepseek').ok).toBe(true)
    expect(port.pass('settle-score', 'user').ok).toBe(true)

    const settled = port.settle('settle-score', { deadStones: [], agreed: true })
    if (!settled.settled) throw new Error(`settlement rejected: ${settled.reason}`)
    expect(settled.state.outcome?.reason).toBe('score')
    expect(port.score('settle-score')).toEqual(settled.score)
    expect(port.score('settle-score').winner).toBe(settled.state.outcome?.winner)
  })
})

describe('TenukiAdapter snapshot boundary', () => {
  it('returns only frozen contract-shaped snapshots, with no engine objects', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('snapshot-shape'))
    port.play('snapshot-shape', 'user', { x: 2, y: 2 })
    const state: GameState = port.getState('snapshot-shape')

    expect(Object.keys(state).sort()).toEqual(
      [
        'boardSize',
        'captures',
        'colors',
        'consecutivePasses',
        'gameId',
        'koRule',
        'komi',
        'lastMove',
        'moveNumber',
        'outcome',
        'scoring',
        'status',
        'stones',
        'toPlay',
      ].sort(),
    )
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.stones)).toBe(true)
    expect(Object.isFrozen(state.stones[0])).toBe(true)
    expect(Object.isFrozen(state.stones[0]?.point)).toBe(true)
  })

  it('is immutable: mutating a returned snapshot cannot change the authoritative state', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('snapshot-immutable'))
    port.play('snapshot-immutable', 'user', { x: 2, y: 2 })
    const first = port.getState('snapshot-immutable')

    expect(() => {
      ;(first as { moveNumber: number }).moveNumber = 99
    }).toThrow(TypeError)
    expect(() => {
      ;(first.stones as unknown as unknown[]).push({ point: { x: 8, y: 8 }, color: 'white' })
    }).toThrow(TypeError)

    expect(port.getState('snapshot-immutable')).toEqual(first)
  })
})
