import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { PendingFocusIntent } from '../contracts/focus.js'
import { RuntimeFocusOwner, type SettledFocusSwitch } from './focus-boundary.js'
import { bindPinnedDshCooperativeYield } from './focus-yield.js'
import {
  bindPinnedDshLaneResume,
  COMPANION_RESUME_PLUGIN,
  emitLaneSwitched,
} from './focus-resume.js'

type Listener = (...args: any[]) => any

function message(id: string, text: string, source: UserMessage['source'] = { kind: 'plugin', plugin: 'a-t07-test' }): UserMessage {
  return Object.freeze({
    id: id as UserMessage['id'],
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze(source),
  }) as UserMessage
}

function intent(
  target: PendingFocusIntent['target'],
  origin: PendingFocusIntent['origin'] = 'self_initiated',
  message?: UserMessage,
): PendingFocusIntent {
  return message === undefined
    ? Object.freeze({ target, origin })
    : Object.freeze({
        target,
        origin,
        sourceMessage: { sourceSessionId: 'source-session', message },
      })
}

function fixture() {
  const listeners = new Map<string, Listener[]>()
  const ctx = {
    on(event: string, listener: Listener) {
      const entries = listeners.get(event) ?? []
      entries.push(listener)
      listeners.set(event, entries)
      return vi.fn()
    },
    // Real cordis `emit` dispatches synchronously without awaiting listeners.
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
    },
  } as unknown as Context

  const makeAgent = (id: string) => {
    const nextStep: UserMessage[] = []
    const nextTurn: UserMessage[] = []
    const steered: UserMessage[] = []
    const value = {
      id,
      status: 'idle',
      inbox: {
        nextStep,
        nextTurn,
        splice(_target: 'next-step', start: number, remove: number, inserted: UserMessage[]) {
          nextStep.splice(start, remove, ...inserted)
        },
      },
      // Real pinned-DSH semantics: steering wakes the idle driver.
      steer: vi.fn((m: UserMessage) => {
        steered.push(m)
        value.status = 'running'
      }),
      whenIdle: vi.fn(async () => {}),
    }
    return { value: value as unknown as Agent, mutable: value, steered }
  }

  const work = makeAgent('work')
  const go = makeAgent('go')
  const owner = new RuntimeFocusOwner('work')

  const listener = (event: string): Listener => {
    const entries = listeners.get(event) ?? []
    expect(entries, `missing ${event} listener`).toHaveLength(1)
    return entries[0]!
  }

  return { ctx, work, go, owner, listener }
}

type Fixture = ReturnType<typeof fixture>

/**
 * Drive the verified A-T04 away path: yield → settle → switch(work→go). The
 * composition root forwards the one committed switch through
 * `emitLaneSwitched`, exactly as `src/index.ts` wires it.
 */
async function yieldAway(f: Fixture, batch: readonly UserMessage[]): Promise<void> {
  const next = vi.fn(async () => ({ kind: 'enter', messages: [batch[0]!] } as const))
  const decision = await f.listener('agent/pre-step')({
    agent: f.work.value,
    messages: batch,
    turn: 1,
    step: 4,
    signal: new AbortController().signal,
  }, next)
  expect(decision).toEqual({ kind: 'reject' })

  f.work.mutable.status = 'idle'
  await f.listener('agent/status')({ agent: f.work.value, status: 'idle' })

  expect(f.owner.state.activeLane).toBe('go')
  expect(f.owner.state.pausedLane).toBe('work')
}

/**
 * Drive the A-T07 return path: a winning intent targets the paused lane, the
 * owner's confirmed-settle switch admits it atomically, and the composition
 * root forwards the one committed transition.
 */
function returnToPausedLane(f: Fixture, returnIntent: PendingFocusIntent): SettledFocusSwitch {
  expect(f.owner.submitFocusIntent(returnIntent).disposition).toBe('replaced')
  const transition = f.owner.switchAfterConfirmedSettle('go', 'natural')
  expect(transition?.resumedLane).toBe('work')
  emitLaneSwitched(f.ctx, transition!)
  return transition!
}

describe('pinned DSH lane resume sequencing (A-T07)', () => {
  it('admits the paused lane at the return switch and sends exactly one companion-resume', async () => {
    const f = fixture()
    const a = message('A', 'A')
    const b = message('B', 'B')
    const c = message('C', 'C')
    const sentIds: UserMessage['id'][] = []
    const admitted: Array<Readonly<{ lane: string; syntheticResume: boolean }>> = []
    const created: UserMessage[] = []
    const returnIntent = intent('work')

    // The A-T04 yield claims [A,B] and C was injected after the claim; the
    // splice restores [A,B,C] inside the pre-step guard.
    f.work.mutable.inbox.nextStep.push(c)
    f.owner.submitFocusIntent(intent('go'))

    bindPinnedDshCooperativeYield(f.ctx, f.owner, { work: f.work.value, go: f.go.value })
    bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value }, {
      onResumeAdmitted: event => admitted.push(event),
      onCompanionResumeCreated: m => created.push(m),
      onResumeSent: ({ messageId }) => {
        // At send time the pause marker must already be consumed (the owner
        // admitted inside the switch) and the preserved batch must be intact.
        expect(f.owner.state).toEqual({
          activeLane: 'work',
          llmRunning: false,
          pendingFocus: returnIntent,
        })
        expect(f.owner.state).not.toHaveProperty('pausedLane')
        expect(f.work.mutable.inbox.nextStep.map(item => item.id)).toEqual([a.id, b.id, c.id])
        sentIds.push(messageId)
      },
    })

    // The away switch (work→go) must not resume anything.
    await yieldAway(f, [a, b])
    expect(f.work.steered).toEqual([])

    returnToPausedLane(f, returnIntent)

    // Admission happened at the return switch: pausedLane cleared exactly once.
    expect(admitted).toEqual([{ lane: 'work', syntheticResume: true }])
    expect(f.owner.state).toEqual({
      activeLane: 'work',
      llmRunning: false,
      pendingFocus: returnIntent,
    })
    expect(f.owner.state).not.toHaveProperty('pausedLane')

    // Exactly one synthetic resume, plugin-sourced, through the verified steer seam.
    expect(f.work.steered).toHaveLength(1)
    expect(created).toHaveLength(1)
    expect(created[0]).toBe(f.work.steered[0])
    expect(created[0]!.source).toEqual({ kind: 'plugin', plugin: COMPANION_RESUME_PLUGIN })
    expect(sentIds).toEqual([created[0]!.id])
    // Steering parks the resume in its own slot; the restored batch stays in
    // stored order, and the pinned driver claims A → B → C → companion-resume
    // at the next step boundary (verified seam).
    expect(f.work.mutable.inbox.nextStep.map(item => item.id))
      .toEqual([a.id, b.id, c.id])
    expect(new Set(f.work.mutable.inbox.nextStep.map(item => item.id)).size).toBe(3)
    expect(f.go.steered).toEqual([])
  })

  it('never resumes for a natural settle without a pause marker', async () => {
    const f = fixture()
    const resumed = vi.fn()
    const goSteered = vi.fn()
    f.owner.submitFocusIntent(intent('go'))
    bindPinnedDshCooperativeYield(f.ctx, f.owner, { work: f.work.value, go: f.go.value })
    bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value }, {
      onResumeAdmitted: resumed,
      onResumeSent: goSteered,
    })

    f.work.mutable.status = 'idle'
    await f.listener('agent/status')({ agent: f.work.value, status: 'idle' })

    expect(f.owner.state.activeLane).toBe('go')
    expect(f.owner.state).not.toHaveProperty('pausedLane')
    expect(f.work.steered).toEqual([])
    expect(resumed).not.toHaveBeenCalled()
  })

  it('is a no-op when the same return-switch event is replayed (no second resume)', async () => {
    const f = fixture()
    const a = message('A', 'A')
    f.owner.submitFocusIntent(intent('go'))
    bindPinnedDshCooperativeYield(f.ctx, f.owner, { work: f.work.value, go: f.go.value })
    bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value })

    await yieldAway(f, [a])
    const transition = returnToPausedLane(f, intent('work'))
    expect(f.work.steered).toHaveLength(1)
    // Steering woke the driver (real pinned semantics), so the replay finds a
    // non-idle lane and must stay at exactly one synthetic resume.
    emitLaneSwitched(f.ctx, transition)
    emitLaneSwitched(f.ctx, transition)

    expect(f.work.steered).toHaveLength(1)
    expect(f.owner.state.activeLane).toBe('work')
    expect(f.owner.state).not.toHaveProperty('pausedLane')
  })

  it('a real user wake parked in next-turn suppresses the synthetic resume but pausedLane is still cleared', async () => {
    const f = fixture()
    const a = message('A', 'A')
    const userWake = message('U', 'continue on your own terms', { kind: 'user' })
    const returnIntent = intent('work')
    f.owner.submitFocusIntent(intent('go'))

    bindPinnedDshCooperativeYield(f.ctx, f.owner, { work: f.work.value, go: f.go.value })
    bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value }, {
      onResumeAdmitted: ({ lane, syntheticResume }) => {
        expect(lane).toBe('work')
        expect(syntheticResume).toBe(false)
      },
      onCompanionResumeCreated: () => {
        throw new Error('a real user wake must not produce a synthetic resume')
      },
      onResumeSent: () => {
        throw new Error('a real user wake must not steer a synthetic resume')
      },
    })

    await yieldAway(f, [a])
    // The user wake arrives while the lane is paused; the return intent wins.
    f.work.mutable.inbox.nextTurn.push(userWake)
    returnToPausedLane(f, returnIntent)

    expect(f.work.steered).toEqual([])
    expect(f.owner.state).toEqual({
      activeLane: 'work',
      llmRunning: false,
      pendingFocus: returnIntent,
    })
    expect(f.owner.state).not.toHaveProperty('pausedLane')
    // The preserved batch and the user wake are both left untouched for the
    // real driver wake to consume.
    expect(f.work.mutable.inbox.nextStep.map(item => item.id)).toEqual([a.id])
    expect(f.work.mutable.inbox.nextTurn.map(item => item.id)).toEqual([userWake.id])
  })

  it('a user-command intent carrying the user message suppresses the synthetic resume', async () => {
    const f = fixture()
    const a = message('A', 'A')
    const userMessage = message('U', 'user says continue', { kind: 'user' })
    const returnIntent = intent('work', 'user_command', userMessage)
    f.owner.submitFocusIntent(intent('go'))

    bindPinnedDshCooperativeYield(f.ctx, f.owner, { work: f.work.value, go: f.go.value })
    bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value }, {
      onResumeAdmitted: ({ syntheticResume }) => {
        expect(syntheticResume).toBe(false)
      },
      onCompanionResumeCreated: () => {
        throw new Error('a user-command wake must not produce a synthetic resume')
      },
      onResumeSent: () => {
        throw new Error('a user-command wake must not steer a synthetic resume')
      },
    })

    await yieldAway(f, [a])
    returnToPausedLane(f, returnIntent)

    expect(f.work.steered).toEqual([])
    expect(f.owner.state.activeLane).toBe('work')
    expect(f.owner.state).not.toHaveProperty('pausedLane')
    expect(f.work.mutable.inbox.nextStep.map(item => item.id)).toEqual([a.id])
  })

  it('a consumed batch suppresses the synthetic resume', async () => {
    const f = fixture()
    const a = message('A', 'A')
    f.owner.submitFocusIntent(intent('go'))
    bindPinnedDshCooperativeYield(f.ctx, f.owner, { work: f.work.value, go: f.go.value })
    bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value }, {
      onResumeAdmitted: ({ syntheticResume }) => {
        expect(syntheticResume).toBe(false)
      },
      onCompanionResumeCreated: () => {
        throw new Error('a consumed batch must not produce a synthetic resume')
      },
      onResumeSent: () => {
        throw new Error('a consumed batch must not be resumed synthetically')
      },
    })

    await yieldAway(f, [a])
    // A real user turn consumed the preserved batch before the return switch.
    f.work.mutable.inbox.nextStep.length = 0
    returnToPausedLane(f, intent('work'))

    expect(f.work.steered).toEqual([])
    expect(f.owner.state.activeLane).toBe('work')
    expect(f.owner.state).not.toHaveProperty('pausedLane')
    expect(f.work.mutable.inbox.nextStep).toEqual([])
  })

  it('never resumes a lane that was never paused (stale/negative control)', async () => {
    const f = fixture()
    const binding = bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value })

    // Away-switch transitions (no resumedLane) and direct no-marker calls are
    // both no-ops; nothing is steered into either lane.
    binding.admitResume({
      from: 'work',
      to: 'go',
      intent: intent('go'),
      settle: 'cooperative-yield',
    })
    binding.admitResume({
      from: 'go',
      to: 'go',
      intent: intent('go'),
      settle: 'natural',
    })
    binding.admitResume({
      from: 'go',
      to: 'work',
      intent: intent('work'),
      settle: 'natural',
    })
    expect(f.work.steered).toEqual([])
    expect(f.go.steered).toEqual([])
    expect(f.owner.state).toEqual({ activeLane: 'work', llmRunning: false })
    expect(f.owner.state).not.toHaveProperty('pausedLane')
  })

  it('does not resume when the owner did not actually admit the returned lane', async () => {
    const f = fixture()
    const a = message('A', 'A')
    f.owner.submitFocusIntent(intent('go'))
    bindPinnedDshCooperativeYield(f.ctx, f.owner, { work: f.work.value, go: f.go.value })
    const binding = bindPinnedDshLaneResume(f.ctx, f.owner, { work: f.work.value, go: f.go.value })

    await yieldAway(f, [a])

    // A fabricated transition claims a resume while the owner still has the
    // marker unconsumed and go active: the sanity guard must refuse.
    binding.admitResume({
      from: 'go',
      to: 'work',
      intent: intent('work'),
      settle: 'natural',
      resumedLane: 'work',
    })
    expect(f.work.steered).toEqual([])
    expect(f.owner.state.pausedLane).toBe('work')
    expect(f.owner.state.activeLane).toBe('go')
  })
})
