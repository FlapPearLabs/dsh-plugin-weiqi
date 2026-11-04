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
