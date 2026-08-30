import { describe, expect, it } from 'vitest'
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
    expect(submitted.handoff).toBeUndefined()
    expect(owner.state).toEqual({
      activeLane: 'work',
      llmRunning: true,
      pendingFocus: pending,
    })

    owner.modelRequestSettled('work')
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state.pendingFocus).toBe(pending)
  })

  it('serves the pending transition only after the executing step commits', () => {
    const owner = new RuntimeFocusOwner('work')
    const pending = intent('go', 'user_command')

    owner.stepStarted('work', 4, 3)
    owner.modelRequestStarted('work')
    owner.submitFocusIntent(pending)
    owner.modelRequestSettled('work')

    const handoff = owner.stepCommitted('work', 4, 3)

    expect(handoff).toEqual({
      from: 'work',
      to: 'go',
      intent: pending,
      boundary: { kind: 'step-end', lane: 'work', turn: 4, step: 3 },
    })
    expect(owner.executingStep).toBeUndefined()
    expect(owner.state.activeLane).toBe('go')
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

    owner.stepCommitted('work', 2, 7)
    expect(owner.state.activeLane).toBe('go')
  })

  it('serves an idle transition immediately without consuming pendingFocus', () => {
    const owner = new RuntimeFocusOwner('work')
    const pending = intent('go')

    const submitted = owner.submitFocusIntent(pending)

    expect(submitted.handoff).toEqual({
      from: 'work',
      to: 'go',
      intent: pending,
      boundary: { kind: 'idle' },
    })
    expect(owner.state).toEqual({
      activeLane: 'go',
      llmRunning: false,
      pendingFocus: pending,
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
