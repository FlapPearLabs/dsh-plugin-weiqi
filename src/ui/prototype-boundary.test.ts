import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GO_VIEW_REGISTRATION,
  registerGoView,
  type ConversationViewComponent,
  type ConversationViewEntry,
} from './registration.js'

type Recorded = {
  readonly calls: string[]
  readonly entries: ConversationViewEntry[]
  readonly components: ConversationViewComponent[]
}

function recordingRegistry(): {
  registry: { inject: (name: string, setup: () => void) => void; register: (entry: ConversationViewEntry, component: ConversationViewComponent) => void }
  recorded: Recorded
} {
  const recorded: Recorded = { calls: [], entries: [], components: [] }
  return {
    recorded,
    registry: {
      inject(name, setup) {
        recorded.calls.push(`inject:${name}`)
        setup()
      },
      register(entry, component) {
        recorded.calls.push(`register:${entry.name}:${entry.id}`)
        recorded.entries.push(entry)
        recorded.components.push(component)
      },
    },
  }
}

describe('§34 conversation.view registration uses the verified seam shape', () => {
  it('injects the owner declaration before registering the Go entry', () => {
    const { registry, recorded } = recordingRegistry()
    const component: ConversationViewComponent = props => ({ sessionId: props.sessionId })

    registerGoView(registry, component)

    expect(recorded.calls).toEqual(['inject:conversation.view', 'register:conversation.view:go'])
    expect(recorded.entries).toEqual([
      { name: 'conversation.view', id: 'go', order: 20, label: 'Go' },
    ])
    expect(recorded.components).toEqual([component])
  })

  it('keeps the E-S01 entry identity stable', () => {
    expect(GO_VIEW_REGISTRATION).toEqual({ id: 'go', order: 20, label: 'Go' })
  })
})

const UI_DIR = fileURLToPath(new URL('.', import.meta.url))

function productionSources(): { file: string; text: string }[] {
  return readdirSync(UI_DIR)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort()
    .map(file => ({ file, text: readFileSync(join(UI_DIR, file), 'utf8') }))
}

describe('§32 row 13 — production UI does not inherit prototype behavior', () => {
  it('has at least the board view, interaction, effects and registration sources', () => {
    expect(productionSources().map(source => source.file)).toEqual([
      'board-view.ts',
      'effects.ts',
      'index.ts',
      'interaction.ts',
      'registration.ts',
    ])
  })

  it('declares no randomness, timers, wall-clock timing or hard-coded komi', () => {
    const forbidden = [
      'Math.random',
      'setTimeout',
      'setInterval',
      'Date.now',
      'performance.now',
      '6.5',
      '7.5',
    ]
    for (const source of productionSources()) {
      for (const token of forbidden) {
        expect(source.text, `${source.file} must not contain ${token}`).not.toContain(token)
      }
    }
  })

  it('keeps the rules engine and focus arbitration outside the UI', () => {
    for (const source of productionSources()) {
      expect(source.text, source.file).not.toContain("from 'tenuki'")
      expect(source.text, source.file).not.toContain('PendingFocusIntent')
      expect(source.text, source.file).not.toContain('../runtime/')
      expect(source.text, source.file).not.toContain('../preset/')
    }
  })

  it('never reads a session transcript or snapshot', () => {
    for (const source of productionSources()) {
      expect(source.text, source.file).not.toContain('transcript')
      expect(source.text, source.file).not.toContain('useSession')
      expect(source.text, source.file).not.toContain('.nodes')
    }
  })
})
