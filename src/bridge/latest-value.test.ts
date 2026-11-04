import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AffectedGroupDelta } from '../contracts/bridge.js'
import { LatestValueSlot, type PublishOutcome } from './latest-value.js'

function delta(libertiesAfter: number): AffectedGroupDelta {
  return {
    owner: 'deepseek',
    stones: 12,
    libertiesBefore: 3,
    libertiesAfter,
  }
}

describe('latest-value slot', () => {
  it('starts without a value or sequence', () => {
    const slot = new LatestValueSlot<AffectedGroupDelta>()

    expect(slot.value).toBeUndefined()
    expect(slot.sequence).toBeUndefined()
  })

  it('coalesces rapid publications into the single newest value', () => {
    const slot = new LatestValueSlot<AffectedGroupDelta>()
    const outcomes: PublishOutcome[] = []

    for (let index = 0; index < 50; index += 1) {
      outcomes.push(slot.publish(delta(50 - index), index))
    }

    expect(outcomes.every((outcome) => outcome === 'published')).toBe(true)
    expect(slot.value).toEqual(delta(1))
    expect(slot.sequence).toBe(49)
    expectTypeOf(slot.value).toEqualTypeOf<AffectedGroupDelta | undefined>()
  })

  it('retains no history or drain surface, only the latest value', () => {
    const slot = new LatestValueSlot<AffectedGroupDelta>()
    slot.publish(delta(3), 0)
    slot.publish(delta(2), 1)

    expect(Object.keys(slot)).toEqual([])
    expect('history' in slot).toBe(false)
    expect('values' in slot).toBe(false)
    expect('drain' in slot).toBe(false)
    expect('flush' in slot).toBe(false)
  })

  it('does not resurrect an older value published after the newest one', () => {
    const slot = new LatestValueSlot<AffectedGroupDelta>()
    const newest = delta(2)
    const stale = delta(1)

    expect(slot.publish(newest, 10)).toBe('published')
    expect(slot.publish(stale, 9)).toBe('stale')

    expect(slot.value).toBe(newest)
    expect(slot.sequence).toBe(10)
  })

  it('treats a repeated sequence as stale even when the value differs', () => {
    const slot = new LatestValueSlot<AffectedGroupDelta>()
    const first = delta(3)
    const competing = delta(0)

    expect(slot.publish(first, 7)).toBe('published')
    expect(slot.publish(competing, 7)).toBe('stale')

    expect(slot.value).toBe(first)
  })

  it('rejects a sequence that cannot order authoritative facts', () => {
    const slot = new LatestValueSlot<AffectedGroupDelta>()

    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => slot.publish(delta(1), invalid)).toThrow(RangeError)
    }
    expect(slot.value).toBeUndefined()
    expect(slot.publish(delta(1), 0)).toBe('published')
  })
})
