import { describe, expect, it } from 'vitest'
import type { AttentionMode, CompanionState } from '../contracts/companion.js'
import { CompanionStateHolder } from './state.js'

type Persona = { readonly placeholder: string }
type Mood = { readonly confidence: number }

function initialState(
  attentionMode: AttentionMode = 'normal',
  variationSeed = 'seed-1',
): CompanionState<Persona, Mood> {
  return {
    persona: { placeholder: 'uncompiled' },
    mood: { confidence: 0 },
    attentionMode,
    variationSeed,
  }
}

describe('CompanionStateHolder', () => {
  it('keeps only the latest update', () => {
    const holder = new CompanionStateHolder<Persona, Mood>(initialState())

    holder.update({ attentionMode: 'strict', variationSeed: 'seed-2' })
    const latest = holder.update({ attentionMode: 'mofish', variationSeed: 'seed-3' })

    expect(latest.attentionMode).toBe('mofish')
    expect(latest.variationSeed).toBe('seed-3')
    expect(holder.current).toBe(latest)
  })

  it('does not mutate a previously read snapshot', () => {
    const holder = new CompanionStateHolder<Persona, Mood>(initialState())
    const before = holder.current

    holder.update({ attentionMode: 'manual' })

    expect(before.attentionMode).toBe('normal')
    expect(holder.current).not.toBe(before)
  })

  it('preserves persona and mood placeholders verbatim across updates', () => {
    const persona: Persona = { placeholder: 'uncompiled' }
    const mood: Mood = { confidence: 0 }
    const holder = new CompanionStateHolder<Persona, Mood>({
      persona,
      mood,
      attentionMode: 'normal',
      variationSeed: 'seed-1',
    })

    holder.update({ attentionMode: 'strict', variationSeed: 'seed-2' })

    expect(holder.current.persona).toBe(persona)
    expect(holder.current.mood).toBe(mood)
  })

  it('stores mood updates verbatim instead of applying reducer deltas', () => {
    const holder = new CompanionStateHolder<Persona, Mood>(initialState())
    const outOfBandMood: Mood = { confidence: 42 }

    const latest = holder.update({ mood: outOfBandMood })

    expect(latest.mood).toEqual({ confidence: 42 })
    expect(latest.mood).toBe(outOfBandMood)
  })

  it('keeps the state shape fixed and never accumulates history', () => {
    const holder = new CompanionStateHolder<Persona, Mood>(initialState())

    for (let index = 0; index < 5; index += 1) {
      holder.update({
        attentionMode: index % 2 === 0 ? 'strict' : 'normal',
        variationSeed: `seed-${index + 2}`,
      })
    }

    expect(Object.keys(holder.current).sort()).toEqual([
      'attentionMode',
      'mood',
      'persona',
      'variationSeed',
    ])
    expect(holder.current.variationSeed).toBe('seed-6')
  })
})
