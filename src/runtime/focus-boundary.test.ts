import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PendingFocusIntent } from '../contracts/focus.js'
import { RuntimeFocusOwner } from './focus-boundary.js'

function intent(
  target: PendingFocusIntent['target'],
  origin: PendingFocusIntent['origin'] = 'self_initiated',
): PendingFocusIntent {
  return { target, origin }
}

describe('RuntimeFocusOwner safe DSH boundary', () => {
  it('keeps Work active when focus becomes pending during a model request', () => {
    const owner = new RuntimeFocusOwner('work')
    const pending = intent('go')

    owner.stepStarted('work', 1, 3)
    owner.modelRequestStarted('work')
    const submitted = owner.submitFocusIntent(pending)

    expect(submitted.disposition).toBe('admitted')
    expect(submitted.eligibility).toBeUndefined()
    expect(owner.state).toEqual({
      activeLane: 'work',
      llmRunning: true,
      pendingFocus: pending,
    })

    owner.modelRequestSettled('work')
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state.pendingFocus).toBe(pending)
  })

  it('reports eligibility only after the executing step commits without switching lanes', () => {
    const owner = new RuntimeFocusOwner('work')
    const pending = intent('go', 'user_command')

    owner.stepStarted('work', 4, 3)
    owner.modelRequestStarted('work')
    owner.submitFocusIntent(pending)
    owner.modelRequestSettled('work')

    const eligibility = owner.stepCommitted('work', 4, 3)

    expect(eligibility).toEqual({
      from: 'work',
      to: 'go',
      intent: pending,
      boundary: { kind: 'step-end', lane: 'work', turn: 4, step: 3 },
    })
    expect(owner.executingStep).toBeUndefined()
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state.llmRunning).toBe(false)
    expect(owner.state.pendingFocus).toBe(pending)
  })

  it('keeps activeLane stable through model and tool portions of one step', () => {
    const owner = new RuntimeFocusOwner('work')

    owner.stepStarted('work', 2, 7)
    owner.modelRequestStarted('work')
    owner.submitFocusIntent(intent('go'))
    expect(owner.state.activeLane).toBe('work')

    owner.modelRequestSettled('work')
    expect(owner.state.activeLane).toBe('work')
    expect(owner.executingStep).toEqual({ lane: 'work', turn: 2, step: 7 })

    const eligibility = owner.stepCommitted('work', 2, 7)
    expect(eligibility?.to).toBe('go')
    expect(owner.state.activeLane).toBe('work')
  })

  it('reports no-step eligibility without treating the Agent as idle or switching lanes', () => {
    const owner = new RuntimeFocusOwner('work')
    const pending = intent('go')

    const submitted = owner.submitFocusIntent(pending)

    expect(submitted.eligibility).toEqual({
      from: 'work',
      to: 'go',
      intent: pending,
      boundary: { kind: 'no-step' },
    })
    expect(owner.state).toEqual({
      activeLane: 'work',
      llmRunning: false,
      pendingFocus: pending,
    })
  })

  it('reports after-step-end no-step eligibility; no-step does not mean Agent idle', () => {
    const owner = new RuntimeFocusOwner('work')
    const pending = intent('go', 'user_command')

    owner.stepStarted('work', 8, 3)
    expect(owner.stepCommitted('work', 8, 3)).toBeUndefined()

    // No observed step is executing; this says nothing about Agent settle or continuation.
    const submitted = owner.submitFocusIntent(pending)

    expect(submitted.eligibility).toEqual({
      from: 'work',
      to: 'go',
      intent: pending,
      boundary: { kind: 'no-step' },
    })
    expect(owner.executingStep).toBeUndefined()
    expect(owner.state).toEqual({
      activeLane: 'work',
      llmRunning: false,
      pendingFocus: pending,
    })
  })

  it('does not report cross-lane eligibility for a same-lane pending target', () => {
    const owner = new RuntimeFocusOwner('work')
    const sameLane = intent('work')

    const submitted = owner.submitFocusIntent(sameLane)

    expect(submitted.disposition).toBe('admitted')
    expect(submitted.eligibility).toBeUndefined()
    expect(owner.state).toEqual({
      activeLane: 'work',
      llmRunning: false,
      pendingFocus: sameLane,
    })
  })

  it('preserves the A-T02 single pending slot and arbitration result', () => {
    const owner = new RuntimeFocusOwner('work')
    owner.stepStarted('work', 1, 1)
    const user = intent('go', 'user_command')

    expect(owner.submitFocusIntent(user).disposition).toBe('admitted')
    const laterSelf = owner.submitFocusIntent(intent('go', 'self_initiated'))

    expect(laterSelf.disposition).toBe('retained-existing')
    expect(owner.state.pendingFocus).toBe(user)
    expect(Array.isArray(owner.state.pendingFocus)).toBe(false)
  })

  it('tracks llmRunning through explicit deterministic request transitions', () => {
    const owner = new RuntimeFocusOwner('go')
    owner.stepStarted('go', 9, 2)

    owner.modelRequestStarted('go')
    expect(owner.state.llmRunning).toBe(true)
    owner.modelRequestSettled('go')
    expect(owner.state.llmRunning).toBe(false)
    owner.modelRequestStarted('go')
    expect(owner.state.llmRunning).toBe(true)
    owner.modelRequestSettled('go')
    expect(owner.state.llmRunning).toBe(false)
  })

  it('consumes the winning intent at the resume admission and leaves no stale lock', () => {
    const owner = new RuntimeFocusOwner('work')
    owner.submitFocusIntent(intent('go'))
    const away = owner.switchAfterConfirmedSettle('work', 'cooperative-yield')

    // The away switch retains the winning away intent (accepted A-T04 contract).
    expect(away?.resumedLane).toBeUndefined()
    expect(owner.state.pendingFocus).toEqual(intent('go'))
    expect(owner.state.pausedLane).toBe('work')

    const returnIntent = intent('work', 'user_command')
    expect(owner.submitFocusIntent(returnIntent).disposition).toBe('replaced')
    const back = owner.switchAfterConfirmedSettle('go', 'natural')

    // The resume admission consumed pausedLane AND the winning intent (P1-3).
    expect(back?.resumedLane).toBe('work')
    expect(back?.intent).toBe(returnIntent)
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state).not.toHaveProperty('pausedLane')
    expect(owner.state).not.toHaveProperty('pendingFocus')

    // No stale user_command lock: later requests are admitted normally.
    expect(owner.submitFocusIntent(intent('go', 'self_initiated')).disposition).toBe('admitted')
    expect(owner.submitFocusIntent(intent('work', 'user_command')).disposition).toBe('replaced')
  })

  it('keeps the immutable sourceMessage reachable through the transition after consumption', () => {
    const owner = new RuntimeFocusOwner('work')
    const userWake = {
      id: 'U' as UserMessage['id'],
      role: 'user',
      content: [{ type: 'text', text: 'user says continue' }],
      source: { kind: 'user' },
    } as UserMessage
    owner.submitFocusIntent(intent('go'))
    owner.switchAfterConfirmedSettle('work', 'cooperative-yield')

    const returnIntent = {
      target: 'work' as const,
      origin: 'user_command' as const,
      sourceMessage: { sourceSessionId: 'ui-session', message: userWake },
    }
    owner.submitFocusIntent(returnIntent)
    const back = owner.switchAfterConfirmedSettle('go', 'natural')

    expect(back?.resumedLane).toBe('work')
    // Consuming the owner slot does not discard the source message: the
    // returned transition retains the immutable winning intent for the
    // delivery path owned by later Tickets.
    expect(back?.intent).toBe(returnIntent)
    expect(back?.intent.sourceMessage?.message).toBe(userWake)
    expect(owner.state).not.toHaveProperty('pendingFocus')
  })

  it('refuses to treat step/end as safe while the model is still running', () => {
    const owner = new RuntimeFocusOwner('work')
    owner.stepStarted('work', 3, 2)
    owner.modelRequestStarted('work')
    owner.submitFocusIntent(intent('go'))

    expect(() => owner.stepCommitted('work', 3, 2)).toThrow(/model is still running/)
    expect(owner.executingStep).toEqual({ lane: 'work', turn: 3, step: 2 })
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state.llmRunning).toBe(true)

    owner.modelRequestSettled('work')
    expect(owner.stepCommitted('work', 3, 2)?.to).toBe('go')
    expect(owner.state.activeLane).toBe('work')
  })

  it('rejects mismatched lifecycle observations without creating another owner', () => {
    const owner = new RuntimeFocusOwner('work')
    owner.stepStarted('work', 1, 1)

    expect(() => owner.stepStarted('go', 1, 1)).toThrow(/already executing/)
    expect(() => owner.modelRequestStarted('go')).toThrow(/does not match/)
    expect(() => owner.stepCommitted('work', 1, 2)).toThrow(/does not match/)
    expect(owner.executingStep).toEqual({ lane: 'work', turn: 1, step: 1 })
    expect(owner.state.activeLane).toBe('work')
  })
})
