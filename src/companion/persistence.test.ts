import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CompanionState } from '../contracts/companion.js'
import { loadLatestCompanionState, saveLatestCompanionState } from './persistence.js'

type Persona = { readonly placeholder: string }
type Mood = { readonly confidence: number }

function state(
  variationSeed: string,
  overrides: Partial<CompanionState<Persona, Mood>> = {},
): CompanionState<Persona, Mood> {
  return {
    persona: { placeholder: 'uncompiled' },
    mood: { confidence: 0 },
    attentionMode: 'normal',
    variationSeed,
    ...overrides,
  }
}

const directories: string[] = []

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'companion-state-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('latest CompanionState persistence', () => {
  it('round-trips the persisting state, including persona and mood placeholders', async () => {
    const filePath = join(await tempDirectory(), 'companion-state.json')
    const saved = state('seed-1', {
      attentionMode: 'strict',
      persona: { placeholder: 'persona-placeholder' },
      mood: { confidence: 7 },
    })

    await saveLatestCompanionState(filePath, saved)

    await expect(loadLatestCompanionState<Persona, Mood>(filePath)).resolves.toEqual(saved)
  })

  it('leaves only the latest state on disk', async () => {
    const directory = await tempDirectory()
    const filePath = join(directory, 'companion-state.json')

    await saveLatestCompanionState(filePath, state('seed-1', { attentionMode: 'normal' }))
    await saveLatestCompanionState(filePath, state('seed-2', { attentionMode: 'manual' }))

    const loaded = await loadLatestCompanionState<Persona, Mood>(filePath)
    expect(loaded?.variationSeed).toBe('seed-2')
    expect(loaded?.attentionMode).toBe('manual')

    const files = await readdir(directory)
    expect(files).toEqual(['companion-state.json'])
    expect(files.some((file) => file.includes('journal') || file.endsWith('.jsonl'))).toBe(false)

    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['state', 'version'])
  })

  it('reports no persisted state before the first save', async () => {
    const filePath = join(await tempDirectory(), 'companion-state.json')

    await expect(loadLatestCompanionState(filePath)).resolves.toBeUndefined()
  })
})
