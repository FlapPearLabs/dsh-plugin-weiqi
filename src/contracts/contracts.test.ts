import { describe, expect, expectTypeOf, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {
  CompanionBridge,
  CompanionState,
  GameNotice,
  Lane,
  PendingFocusIntent,
  RuntimeFocusState,
  WorkSnapshot,
} from './index.js'

describe('frozen foundation contracts', () => {
  it('keeps focus intent atomic and tied to the immutable DSH message value', () => {
    expectTypeOf<PendingFocusIntent['target']>().toEqualTypeOf<Lane>()
    expectTypeOf<NonNullable<PendingFocusIntent['sourceMessage']>['message']>()
      .toEqualTypeOf<UserMessage>()

    const state: RuntimeFocusState = {
      activeLane: 'work',
      llmRunning: false,
      pendingFocus: { target: 'go', origin: 'user_command' },
    }
    expect(state.pendingFocus?.target).toBe('go')
  })

  it('keeps Bridge projections factual and latest-value only', () => {
    const work: WorkSnapshot = {
      summary: 'typecheck complete',
      runningJobs: [],
      blockers: [],
      lastResult: 'passed',
    }
    const game: GameNotice = {
      gameId: 'fixture',
      moveNumber: 1,
      toPlay: 'deepseek',
      captures: 0,
      status: 'playing',
    }
    const bridge: CompanionBridge = {
      latestWorkSnapshot: work,
      latestGameNotice: game,
    }
    expect(bridge).toEqual({ latestWorkSnapshot: work, latestGameNotice: game })
  })

  it('does not prematurely freeze persona or mood internals', () => {
    type Persona = { voice: string }
    type Mood = { confidence: number }
    const state: CompanionState<Persona, Mood> = {
      persona: { voice: 'direct' },
      mood: { confidence: 0 },
      attentionMode: 'manual',
      variationSeed: 'fixture',
    }
    expect(state.attentionMode).toBe('manual')
  })
})
