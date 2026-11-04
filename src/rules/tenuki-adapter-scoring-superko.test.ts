import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Game } from 'tenuki'
import { describe, expect, it } from 'vitest'
import type { GameConfig, Player, Point } from '../contracts/rules.js'
import { createTenukiGoRulesPort } from './tenuki-adapter.js'

/**
 * WAVE-B-T03 — frozen rules observed through `GoRulesPort` alone (Spec §25/§27,
 * BL-GR-04): Chinese area scoring, komi 7.5, positional superko.
 *
 * The port is the only production surface exercised here. The single direct
 * `Game` use is the simple-ko negative control: it proves the rejection in the
 * port-level test comes from the ko rule and not from some other restriction.
 */

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

/**
 * Fixed endgame, placed move by move through the port.
 *
 * Black fills row y=4 (9 stones) and white fills row y=5 (9 stones); neither
 * wall captures or is captured, so both survive.
 *
 * Hand computation (area scoring counts live stones + surrounded empty points):
 *   - rows 0-3 (36 points) are empty and bounded only by black's row-4 wall
 *     and the board edge -> black territory 36
 *   - rows 6-8 (27 points) are empty and bounded only by white's row-5 wall
 *     and the board edge -> white territory 27
 *   - black = 9 stones + 36 territory + 0 komi          = 45
 *   - white = 9 stones + 27 territory + 7.5 komi        = 43.5
 *   - winner black (user); margin |45 - 43.5| = 1.5
 *
 * Tenuki withholds empty-region territory until the position is a concluded
 * endgame, so the fixture closes with two passes before reading the score; that
 * is the same hand computation as above and no settlement is involved.
 *
 * Territory scoring would give black 36 (stones are not counted), so the exact
 * totals below separate `scoring: "area"` from the library default.
 */
function endgameMoves(): readonly { readonly by: Player; readonly point: Point }[] {
  const moves: { by: Player; point: Point }[] = []
  for (let x = 0; x < 9; x += 1) {
    moves.push({ by: 'user', point: { x, y: 4 } })
    moves.push({ by: 'deepseek', point: { x, y: 5 } })
  }
  return moves
}

function playEndgame(gameId: string) {
  const port = createTenukiGoRulesPort()
  port.createGame(gameConfig(gameId))
  for (const move of endgameMoves()) {
    const result = port.play(gameId, move.by, move.point)
    if (!result.ok) {
      throw new Error(
        `endgame move rejected: ${move.by} (${move.point.x},${move.point.y}) -> ${result.reason}`,
      )
    }
  }
  for (const by of ['user', 'deepseek'] as const) {
    const passed = port.pass(gameId, by)
    if (!passed.ok) throw new Error(`endgame pass rejected: ${by} -> ${passed.reason}`)
  }
  return { port, score: port.score(gameId) }
}

/**
 * §31-relevant repetition cycle from tenuki's own suite, reused from the B-S01
 * conformance record (docs/validation/TENUKI_CONFORMANCE_VERIFIED.md) and the
 * B-T02 adapter test. After the 27th move it is white's turn; white's (1,0)
 * recreates the position after move 25.
 */
const SUPERKO_SETUP: readonly Point[] = [
  { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 1 },
  { x: 4, y: 2 }, { x: 1, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 3 },
  { x: 2, y: 3 }, { x: 3, y: 4 }, { x: 1, y: 3 }, { x: 2, y: 4 }, { x: 0, y: 3 },
  { x: 1, y: 4 }, { x: 8, y: 0 }, { x: 0, y: 4 }, { x: 8, y: 1 }, { x: 1, y: 0 },
  { x: 8, y: 2 }, { x: 0, y: 1 }, { x: 8, y: 3 }, { x: 0, y: 2 }, { x: 8, y: 4 },
  { x: 2, y: 0 }, { x: 0, y: 0 },
]

function playSuperkoSetup(gameId: string) {
  const port = createTenukiGoRulesPort()
  port.createGame(gameConfig(gameId))
  SUPERKO_SETUP.forEach((point, index) => {
    const by: Player = index % 2 === 0 ? 'user' : 'deepseek'
    const result = port.play(gameId, by, point)
    if (!result.ok) {
      throw new Error(`setup move ${index + 1} rejected: ${by} (${point.x},${point.y}) -> ${result.reason}`)
    }
  })
  return port
}

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map(name => join(dir, name))
}

describe('TenukiAdapter area scoring (Spec §25, BL-GR-04)', () => {
  it('scores the fixed endgame exactly as hand-computed (black 45, white 43.5)', () => {
    const { score } = playEndgame('area-endgame')

    expect(score.scoring).toBe('area')
    expect(score.komi).toBe(7.5)
    expect(score.black).toEqual({ stones: 9, territory: 36, komi: 0, total: 45 })
    expect(score.white).toEqual({ stones: 9, territory: 27, komi: 7.5, total: 43.5 })
    expect(score.winner).toBe('user')
    expect(score.margin).toBe(1.5)
  })

  it('keeps total = stones + territory + komi on both sides', () => {
    const { score } = playEndgame('area-invariant')

    expect(score.black.total).toBe(score.black.stones + score.black.territory + score.black.komi)
    expect(score.white.total).toBe(score.white.stones + score.white.territory + score.white.komi)
  })

  it('is deterministic: an identical replay yields an identical result', () => {
    expect(playEndgame('area-replay-a').score).toEqual(playEndgame('area-replay-b').score)
  })
})

describe('TenukiAdapter komi 7.5 (Spec §25/§27, production 7.5 not the prototype 6.5)', () => {
  it('adds exactly 7.5 to white and nothing to black', () => {
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('komi-empty'))
    const score = port.score('komi-empty')

    expect(score.black.total).toBe(0)
    expect(score.white.komi).toBe(7.5)
    expect(score.white.total).toBe(7.5)
    expect(score.white.komi).not.toBe(6.5)
    expect(score.winner).toBe('deepseek')
    expect(score.margin).toBe(7.5)
  })

  it('applies the same 7.5 inside a populated endgame', () => {
    const { score } = playEndgame('komi-endgame')
    const whiteBoardPoints = score.white.stones + score.white.territory

    expect(whiteBoardPoints).toBe(36)
    expect(score.white.total).toBe(whiteBoardPoints + 7.5)
    expect(Number.isInteger(whiteBoardPoints)).toBe(true)
  })
})

describe('TenukiAdapter positional superko (Spec §25/§27)', () => {
  it('rejects the repeated position as superko and leaves the game playable', () => {
    const port = playSuperkoSetup('superko-port')
    const before = port.getState('superko-port')

    const repeated = port.play('superko-port', 'deepseek', { x: 1, y: 0 })
    expect(repeated.ok).toBe(false)
    if (repeated.ok) throw new Error('repeated position was accepted')

    expect(repeated.reason).toBe('superko')
    expect(port.getState('superko-port')).toEqual(before)

    const afterPass = port.pass('superko-port', 'deepseek')
    expect(afterPass.ok).toBe(true)
    if (!afterPass.ok) throw new Error(`pass rejected after superko refusal: ${afterPass.reason}`)
    expect(afterPass.state.consecutivePasses).toBe(1)
  })

  it('negative control: the identical repetition is legal under simple ko', () => {
    const simple = new Game({ boardSize: 9, scoring: 'area', koRule: 'simple', komi: 7.5 })
    for (const point of SUPERKO_SETUP) {
      expect(simple.playAt(point.y, point.x, { render: false })).toBe(true)
    }

    expect(simple.isIllegalAt(0, 1)).toBe(false)
    expect(simple.playAt(0, 1, { render: false })).toBe(true)
  })
})

describe('TenukiAdapter frozen configuration in production sources (Spec §27)', () => {
  const srcRoot = fileURLToPath(new URL('..', import.meta.url))

  it('locates the production sources it is meant to guard', () => {
    const files = productionSourceFiles(srcRoot)
    expect(files).toContain(join(srcRoot, 'rules', 'tenuki-adapter.ts'))
    expect(files).toContain(join(srcRoot, 'contracts', 'rules.ts'))
    expect(files.length).toBeGreaterThan(20)
  })

  it('never carries the prototype komi 6.5 in production sources', () => {
    const offenders = productionSourceFiles(srcRoot).filter(file =>
      readFileSync(file, 'utf8').includes('6.5'),
    )
    expect(offenders).toEqual([])
  })

  it('passes all three frozen values at every engine construction site', () => {
    const adapter = readFileSync(join(srcRoot, 'rules', 'tenuki-adapter.ts'), 'utf8')
    const sites = adapter.match(/new Game\(\{[\s\S]*?\}\)/g) ?? []

    expect(sites.length).toBe(2)
    for (const site of sites) {
      expect(site).toContain('scoring: FROZEN_RULES.scoring')
      expect(site).toContain('koRule: FROZEN_RULES.koRule')
      expect(site).toContain('komi: FROZEN_RULES.komi')
    }
    expect(adapter).toMatch(/scoring: 'area'/)
    expect(adapter).toMatch(/koRule: 'positional-superko'/)
    expect(adapter).toMatch(/komi: 7\.5/)
  })
})
