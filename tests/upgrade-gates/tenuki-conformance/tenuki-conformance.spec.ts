import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WAVE-B-S01 — Tenuki version + conformance spike (GitHub #10, BL-GR-03)
 *
 * Evaluates the exact pinned tenuki package against the frozen rules contract:
 *   §25/§27: Chinese area scoring, komi 7.5, positional superko, explicit config
 *   §31:     positional-superko fixture
 *
 * The tenuki package under test is loaded from TENUKI_ROOT (the runner installs
 * the exact pinned version into a scratch directory and verifies it, mirroring
 * the DSH_PINNED_ROOT convention used by C-S01 / E-S01 runners). No tenuki
 * dependency is added to the plugin manifest here; B-T02 owns the production
 * pin (Expected Surfaces: src/rules/tenuki-adapter.ts, package.json pin).
 */

const PINNED_TENUKI_VERSION = '0.3.1'

interface TenukiModule {
  Game: new (options?: Record<string, unknown>) => {
    boardSize: number
    playAt(y: number, x: number): boolean
    pass(): boolean
    isIllegalAt(y: number, x: number): boolean
    isOver(): boolean
    score(): { black: number; white: number }
    currentPlayer(): 'black' | 'white'
  }
}

function loadTenuki(): { version: string; tenuki: TenukiModule } {
  const root = process.env.TENUKI_ROOT
  if (!root) {
    throw new Error('TENUKI_ROOT must point to the installed pinned tenuki package')
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  const require = createRequire(join(root, '__spike__.cjs'))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tenuki = require(join(root, 'index.js')) as TenukiModule
  return { version: manifest.version, tenuki }
}

/** §31-relevant positional-superko cycle: black repeatedly loses two stones and
 *  the position repeats. Sequence taken from tenuki's own test suite
 *  (test/game-ko-test.js, "prevents repeating a previous position"). */
function playSuperkoCycle(tenuki: TenukiModule, koRule: string, boardSize = 9) {
  const game = new tenuki.Game({ boardSize, koRule })
  const setupMoves: Array<[number, number]> = [
    [0, 3], [0, 4], [1, 3], [1, 4], [1, 2], [2, 4], [1, 1], [2, 3], [2, 2], [3, 3], [3, 2],
    [4, 3], [3, 1], [4, 2], [3, 0], [4, 1], [0, 8], [4, 0], [1, 8], [0, 1], [2, 8], [1, 0],
    [3, 8], [2, 0], [4, 8], [0, 2], [0, 0],
  ]
  for (const [y, x] of setupMoves) {
    if (!game.playAt(y, x)) {
      throw new Error(`unexpected rejection at setup move ${y},${x}`)
    }
  }
  // White now attempts (0,1), which would recreate the position after (4,8).
  const illegalBefore = game.isIllegalAt(0, 1)
  const playResult = game.playAt(0, 1)
  return { game, illegalBefore, playResult }
}

/** Black fills every point of a 3x3 board except the center; white passes
 *  throughout, then both pass to reach two consecutive passes. */
function playThreeByThreeBlackRing(tenuki: TenukiModule, options: Record<string, unknown> = {}) {
  const game = new tenuki.Game({ boardSize: 3, koRule: 'positional-superko', ...options })
  const blackMoves: Array<[number, number]> = [
    [0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2],
  ]
  for (const [y, x] of blackMoves) {
    game.playAt(y, x)
    game.pass()
  }
  // After 8 black plays + 8 white passes, black passes (move 17): the two most
  // recent moves are a black play and a white pass, so the game is not over and
  // black's pass is accepted; white's follow-up pass then hits isOver() and is
  // rejected (tenuki refuses to move once two consecutive passes have occurred).
  game.pass()
  game.pass()
  return game
}

describe('WAVE-B-S01 tenuki conformance (BL-GR-03)', () => {
  it('exact pinned version is under test', () => {
    const { version, tenuki } = loadTenuki()
    expect(version).toBe(PINNED_TENUKI_VERSION)
    expect(typeof tenuki.Game).toBe('function')
  })

  it('accepts explicit area / positional-superko / komi 7.5 configuration', () => {
    const { tenuki } = loadTenuki()
    const game = new tenuki.Game({
      boardSize: 9,
      scoring: 'area',
      koRule: 'positional-superko',
      komi: 7.5,
    })
    expect(game.boardSize).toBe(9)
  })

  it('explicit komi 7.5 is applied exactly to white', () => {
    const { tenuki } = loadTenuki()

    const withKomi = playThreeByThreeBlackRing(tenuki, { scoring: 'area', komi: 7.5 })
    const withoutKomi = playThreeByThreeBlackRing(tenuki, { scoring: 'area', komi: 0 })

    expect(withKomi.isOver()).toBe(true)
    // Area: 8 black stones + 1 empty center = 9 black; white 0 + komi.
    expect(withKomi.score()).toEqual({ black: 9, white: 7.5 })
    expect(withoutKomi.score()).toEqual({ black: 9, white: 0 })
    // Komi changes white's score by exactly 7.5 and never touches black.
    expect(withKomi.score().white - withoutKomi.score().white).toBe(7.5)
    expect(withKomi.score().black).toBe(withoutKomi.score().black)
  })

  it('explicit area configuration takes effect (differs from territory default)', () => {
    const { tenuki } = loadTenuki()

    const area = playThreeByThreeBlackRing(tenuki, { scoring: 'area', komi: 7.5 })
    const territory = playThreeByThreeBlackRing(tenuki, { scoring: 'territory', komi: 7.5 })

    expect(area.score()).not.toEqual(territory.score())
    expect(area.score().black).toBe(9)
    // The default scoring is territory; explicit area must not be the default.
    expect(territory.score().black).not.toBe(9)
  })

  it('positional-superko rejects the §31 repeated position while simple ko allows it', () => {
    const { tenuki } = loadTenuki()

    const psk = playSuperkoCycle(tenuki, 'positional-superko')
    expect(psk.illegalBefore).toBe(true)
    expect(psk.playResult).toBe(false)
    expect(psk.game.currentPlayer()).toBe('white')

    const simple = playSuperkoCycle(tenuki, 'simple')
    expect(simple.illegalBefore).toBe(false)
    expect(simple.playResult).toBe(true)
  })

  it('deterministic rerun gives the same result', () => {
    const { tenuki } = loadTenuki()

    const run = () => {
      const psk = playSuperkoCycle(tenuki, 'positional-superko')
      const area = JSON.stringify(playThreeByThreeBlackRing(tenuki, { scoring: 'area', komi: 7.5 }).score())
      return JSON.stringify({ pskReject: psk.playResult === false, area })
    }

    const first = run()
    const second = run()
    expect(second).toBe(first)
  })
})
