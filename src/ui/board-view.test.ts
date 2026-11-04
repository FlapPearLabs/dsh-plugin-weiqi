import { describe, expect, it } from 'vitest'
import type { GameState } from '../contracts/rules.js'
import { createTenukiGoRulesPort } from '../rules/tenuki-adapter.js'
import { BOARD_SIZES, center, keys, uiGameConfig } from '../../tests/ui/ui-fixtures.js'
import { buildBoardView, pointKey } from './board-view.js'

const VIEW_KEYS = [
  'gameId',
  'boardSize',
  'komi',
  'intersections',
  'stones',
  'lastMove',
  'lastMoveWasPass',
  'toPlay',
  'toPlayColor',
  'moveNumber',
  'captures',
  'totalCaptures',
  'status',
  'result',
  'canPlay',
].sort()

function newPort(size: 9 | 13 | 19 = 9, gameId = `view-${size}`) {
  const port = createTenukiGoRulesPort()
  const state = port.createGame(uiGameConfig(size, gameId))
  return { port, state, gameId }
}

function captureBoard() {
  const port = createTenukiGoRulesPort()
  const gameId = 'view-capture'
  port.createGame(uiGameConfig(9, gameId))
  port.play(gameId, 'user', { x: 1, y: 0 })
  port.play(gameId, 'deepseek', { x: 0, y: 0 })
  const capture = port.play(gameId, 'user', { x: 0, y: 1 })
  if (!capture.ok) throw new Error(`capture rejected: ${capture.reason}`)
  return { port, gameId, capture }
}

describe('§32 row 1 — board sizes 9x9 / 13x13 / 19x19', () => {
  it('projects each size from the authoritative state', () => {
    for (const size of BOARD_SIZES) {
      const { state } = newPort(size)
      const view = buildBoardView(state)
      expect(view.boardSize).toBe(size)
      expect(view.intersections).toBe(size * size)
      expect(view.stones).toEqual([])
      expect(view.moveNumber).toBe(0)
    }
  })
})

describe('§32 row 2 — stones come from authoritative state', () => {
  it('renders exactly the state stones with their colors', () => {
    const { port, gameId } = newPort()
    port.play(gameId, 'user', { x: 2, y: 2 })
    port.play(gameId, 'deepseek', { x: 3, y: 3 })
    const state = port.getState(gameId)
    const view = buildBoardView(state)

    expect(view.stones.map(stone => `${stone.key}:${stone.color}`))
      .toEqual(['2,2:black', '3,3:white'])
    expect(view.stones.map(stone => stone.key))
      .toEqual(state.stones.map(stone => pointKey(stone.point)))
  })
})

describe('§32 row 3 — automatic captures reflected after the port update', () => {
  it('drops captured stones and reports the capture count', () => {
    const { port, gameId, capture } = captureBoard()
    const view = buildBoardView(capture.state)

    expect(capture.captured).toEqual([{ point: { x: 0, y: 0 }, color: 'white' }])
    expect(view.captures).toEqual({ user: 1, deepseek: 0 })
    expect(view.totalCaptures).toBe(1)
    expect(view.stones.map(stone => stone.key).sort()).toEqual(['0,1', '1,0'])
    expect(buildBoardView(port.getState(gameId)).totalCaptures).toBe(1)
  })
})

describe('§32 row 4 — last-move indication', () => {
  it('reports the last played point', () => {
    const { port, gameId } = newPort()
    port.play(gameId, 'user', { x: 4, y: 4 })
    const view = buildBoardView(port.getState(gameId))

    expect(view.lastMove).toEqual({ point: { x: 4, y: 4 }, by: 'user' })
    expect(view.lastMoveWasPass).toBe(false)
  })

  it('reports a pass without inventing a point', () => {
    const { port, gameId } = newPort()
    port.pass(gameId, 'user')
    const view = buildBoardView(port.getState(gameId))

    expect(view.lastMove).toBeNull()
    expect(view.lastMoveWasPass).toBe(true)
  })
})

describe('§32 row 5 — current turn indication', () => {
  it('reports the player and stone color to move', () => {
    const { port, gameId } = newPort()
    expect(buildBoardView(port.getState(gameId)).toPlayColor).toBe('black')

    port.play(gameId, 'user', center(9))
    const view = buildBoardView(port.getState(gameId))
    expect(view.toPlay).toBe('deepseek')
    expect(view.toPlayColor).toBe('white')
  })
})

describe('§32 row 8 — final result derives from authoritative state', () => {
  it('has no result while playing and the port outcome when terminal', () => {
    const { port, gameId } = newPort()
    expect(buildBoardView(port.getState(gameId)).result).toBeNull()

    port.play(gameId, 'user', { x: 2, y: 2 })
    port.play(gameId, 'deepseek', { x: 3, y: 3 })
    const resign = port.resign(gameId, 'deepseek')
    if (!resign.ok) throw new Error('resign rejected')

    const view = buildBoardView(resign.state)
    expect(view.status).toBe('over')
    expect(view.canPlay).toBe(false)
    expect(view.result).toEqual({ winner: 'user', loser: 'deepseek', reason: 'resignation' })
    expect(view.result).toEqual(port.getState(gameId).outcome)
  })
})

describe('§32 row 12 — no transcript fusion in the view projection', () => {
  it('exposes only the whitelisted board fields', () => {
    const { port, gameId } = newPort()
    port.play(gameId, 'user', center(9))
    const view = buildBoardView(port.getState(gameId))

    expect(Object.keys(view).sort()).toEqual(VIEW_KEYS)
    expect(JSON.stringify(view)).not.toContain('transcript')
  })

  it('ignores foreign fields carried by an augmented state object', () => {
    const { port, gameId } = newPort()
    const state = port.getState(gameId)
    const augmented = { ...state, transcript: 'WORK_TRANSCRIPT_ONLY', nodes: [] } as GameState
    const view = buildBoardView(augmented)

    expect(Object.keys(view).sort()).toEqual(VIEW_KEYS)
    expect(JSON.stringify(view)).not.toContain('WORK_TRANSCRIPT_ONLY')
  })

  it('freezes the projection so later UI code cannot mutate it', () => {
    const { port, gameId } = newPort()
    port.play(gameId, 'user', center(9))
    const view = buildBoardView(port.getState(gameId))

    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.stones)).toBe(true)
    expect(Object.isFrozen(view.captures)).toBe(true)
    if (view.lastMove !== null) expect(Object.isFrozen(view.lastMove)).toBe(true)
  })
})

describe('§32 row 13 — no prototype rule constants', () => {
  it('takes komi and rules from the authoritative state', () => {
    const { state } = newPort()
    const view = buildBoardView(state)

    expect(view.komi).toBe(state.komi)
    expect(view.komi).toBe(7.5)
    expect(view.komi).not.toBe(6.5)
  })
})

describe('point keys are protocol coordinates', () => {
  it('keys intersections by zero-based x,y', () => {
    expect(pointKey({ x: 0, y: 0 })).toBe('0,0')
    expect(pointKey({ x: 18, y: 18 })).toBe('18,18')
    expect(keys([{ x: 2, y: 1 }, { x: 1, y: 2 }])).toEqual(['1,2', '2,1'])
  })
})
