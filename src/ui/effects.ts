import type { MoveResult, Point } from '../contracts/rules.js'

export const PLACEMENT_ANIMATION_MS = 140
export const CAPTURE_ANIMATION_MS = 200

export type BoardAnimationPlan = {
  readonly placement: Point | null
  readonly captures: readonly Point[]
  readonly placementMs: number
  readonly captureMs: number
}

export function planBoardAnimation(result: MoveResult): BoardAnimationPlan | null {
  if (!result.ok) return null
  const lastMove = result.state.lastMove
  if (lastMove === null || lastMove.type !== 'play') return null

  return Object.freeze({
    placement: Object.freeze({ x: lastMove.point.x, y: lastMove.point.y }),
    captures: Object.freeze(
      result.captured.map(stone => Object.freeze({ x: stone.point.x, y: stone.point.y })),
    ),
    placementMs: PLACEMENT_ANIMATION_MS,
    captureMs: CAPTURE_ANIMATION_MS,
  })
}

export type StoneSound = {
  readonly playPlacement: () => void
}

export function createSilentStoneSound(): StoneSound {
  return Object.freeze({ playPlacement: (): void => undefined })
}

export type AudioParamLike = {
  setValueAtTime(value: number, time: number): void
  exponentialRampToValueAtTime(value: number, time: number): void
}

export type AudioFrequencyLike = {
  setValueAtTime(value: number, time: number): void
}

export type AudioOscillatorLike = {
  type: string
  readonly frequency: AudioFrequencyLike
  connect(destination: unknown): unknown
  start(time: number): void
  stop(time: number): void
}

export type AudioGainLike = {
  readonly gain: AudioParamLike
  connect(destination: unknown): unknown
}

export type AudioContextLike = {
  readonly currentTime: number
  readonly destination: unknown
  createOscillator(): AudioOscillatorLike
  createGain(): AudioGainLike
}

const TONE_HZ = 220
const SILENCE_GAIN = 0.0001
const PEAK_GAIN = 0.12
const ATTACK_SECONDS = 0.01
const DECAY_END_SECONDS = 0.09
const STOP_SECONDS = 0.1

export function createWebAudioStoneSound(context: AudioContextLike): StoneSound {
  return {
    playPlacement(): void {
      const start = context.currentTime
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(TONE_HZ, start)
      gain.gain.setValueAtTime(SILENCE_GAIN, start)
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + ATTACK_SECONDS)
      gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, start + DECAY_END_SECONDS)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + STOP_SECONDS)
    },
  }
}

export type MoveEffects = {
  readonly animate: (plan: BoardAnimationPlan) => void
  readonly sound: StoneSound
}
