import { describe, expect, it } from 'vitest'
import type { MoveResult } from '../contracts/rules.js'
import { createTenukiGoRulesPort } from '../rules/tenuki-adapter.js'
import { uiGameConfig } from '../../tests/ui/ui-fixtures.js'
import {
  CAPTURE_ANIMATION_MS,
  PLACEMENT_ANIMATION_MS,
  createSilentStoneSound,
  createWebAudioStoneSound,
  planBoardAnimation,
  type AudioContextLike,
} from './effects.js'

function acceptedPlay(capture = false): MoveResult {
  const port = createTenukiGoRulesPort()
  const gameId = capture ? 'effects-capture' : 'effects-placement'
  port.createGame(uiGameConfig(9, gameId))
  if (capture) {
    port.play(gameId, 'user', { x: 1, y: 0 })
    port.play(gameId, 'deepseek', { x: 0, y: 0 })
    return port.play(gameId, 'user', { x: 0, y: 1 })
  }
  return port.play(gameId, 'user', { x: 4, y: 4 })
}

describe('§32 row 9 — minimal placement/capture animation is presentation only', () => {
  it('plans a placement animation from an accepted move', () => {
    const result = acceptedPlay()
    const plan = planBoardAnimation(result)

    expect(plan).toEqual({
      placement: { x: 4, y: 4 },
      captures: [],
      placementMs: PLACEMENT_ANIMATION_MS,
      captureMs: CAPTURE_ANIMATION_MS,
    })
  })

  it('plans the captured points from the port result', () => {
    const plan = planBoardAnimation(acceptedPlay(true))

    expect(plan?.placement).toEqual({ x: 0, y: 1 })
    expect(plan?.captures).toEqual([{ x: 0, y: 0 }])
  })

  it('plans nothing for a pass or a rejected move', () => {
    const port = createTenukiGoRulesPort()
    const gameId = 'effects-none'
    port.createGame(uiGameConfig(9, gameId))
    port.play(gameId, 'user', { x: 4, y: 4 })

    const pass = port.pass(gameId, 'deepseek')
    const rejected = port.play(gameId, 'deepseek', { x: 4, y: 4 })

    expect(planBoardAnimation(pass)).toBeNull()
    expect(planBoardAnimation(rejected)).toBeNull()
  })

  it('does not mutate the authoritative result it reads', () => {
    const result = acceptedPlay(true)
    const before = JSON.stringify(result)

    planBoardAnimation(result)

    expect(JSON.stringify(result)).toBe(before)
  })
})

type AudioCall = readonly [string, ...readonly unknown[]]

function fakeAudioContext(): {
  context: AudioContextLike
  calls: AudioCall[]
} {
  const calls: AudioCall[] = []
  const oscillator = {
    type: 'sine',
    frequency: {
      setValueAtTime(value: number, time: number): void {
        calls.push(['frequency.setValueAtTime', value, time])
      },
    },
    connect(destination: unknown): void {
      calls.push(['oscillator.connect', destination])
    },
    start(time: number): void {
      calls.push(['oscillator.start', time])
    },
    stop(time: number): void {
      calls.push(['oscillator.stop', time])
    },
  }
  const gain = {
    gain: {
      setValueAtTime(value: number, time: number): void {
        calls.push(['gain.setValueAtTime', value, time])
      },
      exponentialRampToValueAtTime(value: number, time: number): void {
        calls.push(['gain.ramp', value, time])
      },
    },
    connect(destination: unknown): void {
      calls.push(['gain.connect', destination])
    },
  }
  const destination = { name: 'destination' }
  return {
    calls,
    context: {
      currentTime: 10,
      destination,
      createOscillator: () => oscillator,
      createGain: () => gain,
    },
  }
}

describe('§32 row 10 — minimal stone sound without audio assets', () => {
  it('plays one short synthesized placement tone on the given context', () => {
    const { context, calls } = fakeAudioContext()
    const sound = createWebAudioStoneSound(context)

    sound.playPlacement()

    expect(calls).toEqual([
      ['gain.setValueAtTime', 0.0001, 10],
      ['gain.ramp', 0.12, 10.01],
      ['gain.ramp', 0.0001, 10.09],
      ['oscillator.connect', expect.anything()],
      ['gain.connect', expect.anything()],
      ['oscillator.start', 10],
      ['oscillator.stop', 10.1],
    ])
  })

  it('offers a silent implementation so a host without audio still runs', () => {
    const sound = createSilentStoneSound()
    expect(() => {
      sound.playPlacement()
    }).not.toThrow()
  })
})
