import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { Lane, PendingFocusIntent, RuntimeFocusState } from '../contracts/focus.js'
import {
  activateLane,
  admitPausedLaneResume,
  consumePendingFocus,
  createRuntimeFocusState,
  markLanePaused,
  setLlmRunning,
  submitFocusIntent,
} from './focus.js'

function userMessage(id: string, text: string): UserMessage {
  const message = {
    id: id as UserMessage['id'],
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  } satisfies UserMessage

  Object.freeze(message.content[0])
  Object.freeze(message.content)
  return Object.freeze(message)
}

function intent(
  target: Lane,
  origin: PendingFocusIntent['origin'],
  message?: UserMessage,
): PendingFocusIntent {
  return message === undefined
    ? { target, origin }
    : {
        target,
        origin,
        sourceMessage: { sourceSessionId: `source-${target}`, message },
      }
}

describe('focus intent arbitration', () => {
  const existingSelf = intent('go', 'self_initiated')
  const existingUser = intent('go', 'user_command', userMessage('existing', 'first'))
  const incomingSelf = intent('work', 'self_initiated')
  const incomingUser = intent('work', 'user_command', userMessage('incoming', 'second'))

  it.each([
    {
      name: 'none + self admits incoming',
      existing: undefined,
      incoming: incomingSelf,
      expected: incomingSelf,
      disposition: 'admitted',
    },
    {
      name: 'none + user admits incoming',
      existing: undefined,
      incoming: incomingUser,
      expected: incomingUser,
      disposition: 'admitted',
    },
    {
      name: 'self + self replaces with incoming',
      existing: existingSelf,
      incoming: incomingSelf,
      expected: incomingSelf,
      disposition: 'replaced',
    },
    {
      name: 'self + user replaces with incoming',
      existing: existingSelf,
      incoming: incomingUser,
      expected: incomingUser,
      disposition: 'replaced',
    },
    {
      name: 'user + self retains existing',
      existing: existingUser,
      incoming: incomingSelf,
      expected: existingUser,
      disposition: 'retained-existing',
    },
    {
      name: 'user + user retains existing and does not admit incoming',
      existing: existingUser,
      incoming: incomingUser,
      expected: existingUser,
      disposition: 'retained-existing',
    },
  ] as const)('$name', ({ existing, incoming, expected, disposition }) => {
    const state: RuntimeFocusState = existing === undefined
      ? createRuntimeFocusState('work')
      : { ...createRuntimeFocusState('work'), pendingFocus: existing }

    const result = submitFocusIntent(state, incoming)

    expect(result.state.pendingFocus).toBe(expected)
    expect(result.disposition).toBe(disposition)
    expect(Array.isArray(result.state.pendingFocus)).toBe(false)
  })

  it('preserves the exact pending user intent and immutable source message for user + user', () => {
    const originalMessage = userMessage('original-message', 'handle the first command')
    const newerMessage = userMessage('newer-message', 'handle the newer command')
    const existing = intent('go', 'user_command', originalMessage)
    const incoming = intent('work', 'user_command', newerMessage)
    const state: RuntimeFocusState = {
      activeLane: 'work',
      llmRunning: true,
      pendingFocus: existing,
    }
    const before = JSON.stringify(state)

    const result = submitFocusIntent(state, incoming)

    expect(result.disposition).toBe('retained-existing')
    expect(result.state).toBe(state)
    expect(result.state.pendingFocus).toBe(existing)
    expect(result.state.pendingFocus?.sourceMessage?.message).toBe(originalMessage)
    expect(result.state.pendingFocus?.sourceMessage?.message).not.toBe(newerMessage)
    expect(JSON.stringify(state)).toBe(before)
    expect(Object.isFrozen(originalMessage)).toBe(true)
    expect(Object.isFrozen(originalMessage.content)).toBe(true)
  })

  it('never accumulates pending intents into a queue, list, or mailbox', () => {
    let state = createRuntimeFocusState('work')
    const submissions = [incomingSelf, existingSelf, incomingUser, existingUser, incomingSelf]

    for (const submission of submissions) {
      state = submitFocusIntent(state, submission).state
      const pendingCount = state.pendingFocus === undefined ? 0 : 1
      expect(pendingCount).toBeLessThanOrEqual(1)
      expect(Array.isArray(state.pendingFocus)).toBe(false)
      expect(Object.keys(state).filter(key => /queue|mailbox|list/i.test(key))).toEqual([])
    }
  })

  it('clears the consumed single slot so the next intent can be admitted', () => {
    const first = submitFocusIntent(createRuntimeFocusState('work'), existingUser).state
    const consumed = consumePendingFocus(first)
    const next = submitFocusIntent(consumed, incomingSelf)

    expect(consumed).not.toHaveProperty('pendingFocus')
    expect(next.disposition).toBe('admitted')
    expect(next.state.pendingFocus).toBe(incomingSelf)
  })
})

describe('active lane and foreground model execution', () => {
  it('always keeps exactly one active Lane through deterministic transitions', () => {
    const sequences: Lane[][] = [
      ['work'],
      ['go'],
      ['work', 'go', 'work', 'go'],
      ['go', 'go', 'work', 'work'],
    ]

    for (const sequence of sequences) {
      let state = createRuntimeFocusState(sequence[0]!)
      for (const lane of sequence) {
        state = activateLane(state, lane)
        expect(state.activeLane).toBe(lane)
        expect(['work', 'go']).toContain(state.activeLane)
      }
    }
  })

  it('tracks llmRunning only through explicit pure transitions', () => {
    const initial = createRuntimeFocusState('go')
    const running = setLlmRunning(initial, true)
    const settled = setLlmRunning(running, false)

    expect(initial.llmRunning).toBe(false)
    expect(running).toEqual({ activeLane: 'go', llmRunning: true })
    expect(settled).toEqual({ activeLane: 'go', llmRunning: false })
  })
})

describe('paused lane', () => {
  it('represents at most one deliberately yielded lane without a stack', () => {
    const first = markLanePaused(createRuntimeFocusState('work'), 'work')
    const replacement = markLanePaused(first, 'go')

    expect(first.pausedLane).toBe('work')
    expect(replacement.pausedLane).toBe('go')
    expect(Array.isArray(replacement.pausedLane)).toBe(false)
  })

  it('admits the paused lane and clears pausedLane in one pure transition', () => {
    const yielded = markLanePaused(createRuntimeFocusState('go'), 'go')
    const servingOtherLane = activateLane(yielded, 'work')

    const resumed = admitPausedLaneResume(servingOtherLane)

    expect(resumed.activeLane).toBe('go')
    expect(resumed).not.toHaveProperty('pausedLane')
    expect(resumed.llmRunning).toBe(false)
  })

  it('is a no-op when no lane is paused', () => {
    const state = createRuntimeFocusState('work')
    expect(admitPausedLaneResume(state)).toBe(state)
  })
})
