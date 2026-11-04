import { describe, expect, it, vi } from 'vitest'
import type { MoveEffects, StoneSound } from './effects.js'
import { createTenukiGoRulesPort } from '../rules/tenuki-adapter.js'
import { createStubGoRulesPort } from '../../tests/rules/stub-port.js'
import { BOARD_SIZES, center, uiGameConfig } from '../../tests/ui/ui-fixtures.js'
import { GoBoardController } from './interaction.js'

function stubGame(size: 9 | 13 | 19 = 9, gameId = `stub-${size}`) {
  const port = createStubGoRulesPort()
  port.createGame(uiGameConfig(size, gameId))
  return { port, gameId }
}

function recordingEffects(): {
  effects: MoveEffects
  animations: unknown[]
  sound: StoneSound & { calls: number }
} {
  const animations: unknown[] = []
  const sound = {
    calls: 0,
    playPlacement(): void {
      sound.calls += 1
    },
  }
  return {
    effects: {
      animate: plan => {
        animations.push(plan)
      },
      sound,
    },
    animations,
    sound,
  }
}

describe('§32 row 11 — board click routes directly through GoRulesPort', () => {
  it('calls port.play once with the session player and clicked point', () => {
    const { port, gameId } = stubGame()
    const play = vi.spyOn(port, 'play')
    const controller = new GoBoardController({ port, gameId, player: 'user' })

    const outcome = controller.playAt({ x: 4, y: 4 })

    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith(gameId, 'user', { x: 4, y: 4 })
    expect(outcome.ok).toBe(true)
    expect(outcome.state.toPlay).toBe('deepseek')
    expect(outcome.view.stones).toEqual([
      { key: '4,4', point: { x: 4, y: 4 }, color: 'black' },
    ])
  })

  it('updates the GameNotice from the authoritative state', () => {
    const { port, gameId } = stubGame()
    const controller = new GoBoardController({ port, gameId, player: 'user' })

    const outcome = controller.playAt({ x: 4, y: 4 })

    expect(outcome.notice).toEqual({
      gameId,
      moveNumber: 1,
      toPlay: 'deepseek',
      captures: 0,
      status: 'playing',
      lastMove: 'E5',
    })
  })

  it('rejects an illegal click from the port and leaves state and notice unchanged', () => {
    const { port, gameId } = stubGame()
    const before = port.getState(gameId)
    const controller = new GoBoardController({ port, gameId, player: 'user' })
    controller.playAt({ x: 4, y: 4 })
    const afterLegal = port.getState(gameId)

    const illegal = controller.playAt({ x: 4, y: 4 })

    expect(illegal.ok).toBe(false)
    expect(illegal.ok ? null : illegal.reason).toBe('out-of-turn')
    expect(illegal.state).toEqual(afterLegal)
    expect(illegal.notice.moveNumber).toBe(afterLegal.moveNumber)
    expect(before.moveNumber).toBe(0)
  })

  it('rejects off-board and non-integer clicks before reaching the engine', () => {
    const { port, gameId } = stubGame(9)
    const play = vi.spyOn(port, 'play')
    const controller = new GoBoardController({ port, gameId, player: 'user' })

    for (const point of [
      { x: 9, y: 0 },
      { x: 0, y: 9 },
      { x: -1, y: 0 },
      { x: 1.5, y: 2 },
    ]) {
      const outcome = controller.playAt(point)
      expect(outcome.ok).toBe(false)
      expect(outcome.ok ? null : outcome.reason).toBe('out-of-board')
    }
    expect(play).not.toHaveBeenCalled()
  })

  it('never fabricates a PendingFocusIntent on the click path', () => {
    const { port, gameId } = stubGame()
    const controller = new GoBoardController({ port, gameId, player: 'user' })

    const outcome = controller.playAt({ x: 4, y: 4 })
    const keys = Object.keys(outcome).sort()

    expect(keys).toEqual(['animation', 'notice', 'ok', 'state', 'view'])
    expect(JSON.stringify(outcome)).not.toContain('PendingFocusIntent')
    expect(JSON.stringify(outcome)).not.toContain('origin')
  })

  it('plays a legal move on each board size', () => {
    for (const size of BOARD_SIZES) {
      const { port, gameId } = stubGame(size, `stub-size-${size}`)
      const controller = new GoBoardController({ port, gameId, player: 'user' })
      const point = center(size)
      const outcome = controller.playAt(point)

      expect(outcome.ok).toBe(true)
      expect(outcome.view.boardSize).toBe(size)
      expect(outcome.view.stones).toEqual([{ key: `${point.x},${point.y}`, point, color: 'black' }])
    }
  })
})

describe('§32 row 6 — Pass invokes GoRulesPort.pass', () => {
  it('routes pass through the port and reports the pass notice', () => {
    const { port, gameId } = stubGame()
    const pass = vi.spyOn(port, 'pass')
    const controller = new GoBoardController({ port, gameId, player: 'user' })

    const outcome = controller.pass()

    expect(pass).toHaveBeenCalledTimes(1)
    expect(pass).toHaveBeenCalledWith(gameId, 'user')
    expect(outcome.ok).toBe(true)
    expect(outcome.state.consecutivePasses).toBe(1)
    expect(outcome.notice.lastMove).toBe('pass')
    expect(outcome.view.lastMoveWasPass).toBe(true)
  })
})

describe('§32 rows 7/8 — Resign and final result come from the authoritative state', () => {
  it('routes resign through the port and exposes only the authoritative outcome', () => {
    const { port, gameId } = stubGame()
    const resign = vi.spyOn(port, 'resign')
    const controller = new GoBoardController({ port, gameId, player: 'user' })
    controller.playAt({ x: 4, y: 4 })
    controller.pass()

    const outcome = controller.resign()

    expect(resign).toHaveBeenCalledTimes(1)
    expect(resign).toHaveBeenCalledWith(gameId, 'user')
    expect(outcome.ok).toBe(true)
    expect(outcome.view.status).toBe('over')
    expect(outcome.view.result).toEqual({ winner: 'deepseek', loser: 'user', reason: 'resignation' })
    expect(outcome.result).toEqual(port.getState(gameId).outcome)
    expect(outcome.notice.status).toBe('over')
  })

  it('does not invent a terminal state when the port rejects resign', () => {
    const { port, gameId } = stubGame()
    port.resign(gameId, 'user')
    const controller = new GoBoardController({ port, gameId, player: 'user' })

    const outcome = controller.resign()

    expect(outcome.ok).toBe(false)
    expect(outcome.result).toEqual({ winner: 'deepseek', loser: 'user', reason: 'resignation' })
    expect(outcome.result).toBe(port.getState(gameId).outcome)
  })

  it('rejects clicks after the game is over without touching the board', () => {
    const { port, gameId } = stubGame()
    port.resign(gameId, 'user')
    const controller = new GoBoardController({ port, gameId, player: 'user' })
    const before = port.getState(gameId)

    const outcome = controller.playAt({ x: 4, y: 4 })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? null : outcome.reason).toBe('game-over')
    expect(outcome.state).toEqual(before)
  })
})

describe('§32 row 12 — the controller has no transcript input', () => {
  it('ignores foreign session fields passed by a caller', () => {
    const { port, gameId } = stubGame()
    const controller = new GoBoardController({
      port,
      gameId,
      player: 'user',
      transcript: 'WORK_TRANSCRIPT_ONLY',
      sessionSnapshot: { nodes: [] },
    } as never)

    const outcome = controller.playAt({ x: 4, y: 4 })

    expect(JSON.stringify(outcome)).not.toContain('WORK_TRANSCRIPT_ONLY')
    expect(JSON.stringify(outcome)).not.toContain('sessionSnapshot')
  })
})

describe('§32 rows 9/10 — effects never affect game truth', () => {
  it('emits one placement animation and one sound for an accepted stone', () => {
    const { port, gameId } = stubGame()
    const recorder = recordingEffects()
    const controller = new GoBoardController({
      port,
      gameId,
      player: 'user',
      effects: recorder.effects,
    })

    const outcome = controller.playAt({ x: 4, y: 4 })

    expect(recorder.animations).toEqual([
      { placement: { x: 4, y: 4 }, captures: [], placementMs: 140, captureMs: 200 },
    ])
    expect(recorder.sound.calls).toBe(1)
    expect(outcome.state).toEqual(port.getState(gameId))
  })

  it('emits nothing for rejected clicks, pass, or resign', () => {
    const { port, gameId } = stubGame()
    const recorder = recordingEffects()
    const controller = new GoBoardController({
      port,
      gameId,
      player: 'user',
      effects: recorder.effects,
    })

    controller.playAt({ x: 4, y: 4 })
    recorder.animations.length = 0
    recorder.sound.calls = 0

    controller.playAt({ x: 4, y: 4 })
    controller.pass()
    controller.resign()

    expect(recorder.animations).toEqual([])
    expect(recorder.sound.calls).toBe(0)
  })

  it('emits capture animation data for an automatic capture', () => {
    const port = createTenukiGoRulesPort()
    const gameId = 'ui-capture-effects'
    port.createGame(uiGameConfig(9, gameId))
    port.play(gameId, 'user', { x: 1, y: 0 })
    port.play(gameId, 'deepseek', { x: 0, y: 0 })
    const recorder = recordingEffects()
    const controller = new GoBoardController({
      port,
      gameId,
      player: 'user',
      effects: recorder.effects,
    })

    const outcome = controller.playAt({ x: 0, y: 1 })

    expect(outcome.ok).toBe(true)
    expect(recorder.animations).toEqual([
      {
        placement: { x: 0, y: 1 },
        captures: [{ x: 0, y: 0 }],
        placementMs: 140,
        captureMs: 200,
      },
    ])
    expect(outcome.view.totalCaptures).toBe(1)
  })
})
