import { describe, expect, it, vi } from 'vitest'

const recordedOptions = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('tenuki', () => {
  class FakeGame {
    readonly boardSize: number

    constructor(options: Record<string, unknown>) {
      recordedOptions.push(options)
      this.boardSize = options.boardSize as number
    }

    currentPlayer(): 'black' | 'white' {
      return 'black'
    }

    moveNumber(): number {
      return 0
    }

    intersections(): readonly never[] {
      return []
    }

    currentState(): {
      moveNumber: number
      playedPoint: null
      color: 'white'
      pass: boolean
      blackStonesCaptured: number
      whiteStonesCaptured: number
    } {
      return {
        moveNumber: 0,
        playedPoint: null,
        color: 'white',
        pass: false,
        blackStonesCaptured: 0,
        whiteStonesCaptured: 0,
      }
    }

    isOver(): boolean {
      return false
    }

    deadStones(): readonly { readonly y: number; readonly x: number }[] {
      return []
    }
  }

  return { Game: FakeGame }
})

import { createTenukiGoRulesPort } from './tenuki-adapter.js'
import type { BoardSize, GameConfig } from '../contracts/rules.js'

function gameConfig(gameId: string, boardSize: BoardSize): GameConfig {
  return {
    gameId,
    boardSize,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: { user: 'black', deepseek: 'white' },
  }
}

describe('TenukiAdapter explicit configuration (Spec §27)', () => {
  it('passes area / positional-superko / komi 7.5 explicitly, never tenuki defaults', () => {
    recordedOptions.length = 0
    const port = createTenukiGoRulesPort()
    port.createGame(gameConfig('config-9', 9))

    expect(recordedOptions).toEqual([
      { boardSize: 9, scoring: 'area', koRule: 'positional-superko', komi: 7.5 },
    ])
    const [options] = recordedOptions
    expect(options).not.toMatchObject({ scoring: 'territory' })
    expect(options).not.toMatchObject({ koRule: 'simple' })
    expect(options).not.toMatchObject({ komi: 0 })
  })

  it('passes the configured board size through while keeping the frozen rules explicit', () => {
    recordedOptions.length = 0
    const port = createTenukiGoRulesPort()
    for (const boardSize of [9, 13, 19] as const) {
      port.createGame(gameConfig(`config-${boardSize}`, boardSize))
    }

    expect(recordedOptions).toEqual([
      { boardSize: 9, scoring: 'area', koRule: 'positional-superko', komi: 7.5 },
      { boardSize: 13, scoring: 'area', koRule: 'positional-superko', komi: 7.5 },
      { boardSize: 19, scoring: 'area', koRule: 'positional-superko', komi: 7.5 },
    ])
  })
})
