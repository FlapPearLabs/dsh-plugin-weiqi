import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { PendingFocusIntent } from '../contracts/focus.js'
import { RuntimeFocusOwner } from './focus-boundary.js'
import { bindPinnedDshCooperativeYield } from './focus-yield.js'

type Listener = (...args: any[]) => any

function message(id: string, text: string): UserMessage {
  return Object.freeze({
    id: id as UserMessage['id'],
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'plugin', plugin: 'a-t04-test' }),
  }) as UserMessage
}

function intent(
  target: PendingFocusIntent['target'],
  origin: PendingFocusIntent['origin'] = 'self_initiated',
): PendingFocusIntent {
  return Object.freeze({ target, origin })
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
  } as unknown as Context

  const makeAgent = (id: string) => {
    const nextStep: UserMessage[] = []
    const trace: string[] = []
    const value = {
      id,
      status: 'idle',
      inbox: {
        nextStep,
        splice(_target: 'next-step', start: number, remove: number, inserted: UserMessage[]) {
          nextStep.splice(start, remove, ...inserted)
          trace.push('splice')
        },
      },
      whenIdle: vi.fn(async () => {
        trace.push('whenIdle')
      }),
    }
    return { value: value as unknown as Agent, mutable: value, trace }
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

describe('pinned DSH cooperative focus yield', () => {
  it('restores the exact claimed batch, rejects, confirms settle, then switches once', async () => {
    const { ctx, work, go, owner, listener } = fixture()
    const a = message('A', 'A')
    const b = message('B', 'B')
    const c = message('C', 'C')
    work.mutable.inbox.nextStep.push(c)
    owner.submitFocusIntent(intent('go'))
    const trace: string[] = []

    bindPinnedDshCooperativeYield(ctx, owner, { work: work.value, go: go.value }, {
      onBatchRestored: ({ claimed, restored }) => {
        trace.push('restored')
        expect(claimed).toEqual([a, b])
        expect(restored).toEqual([a, b, c])
        expect(restored[0]).toBe(a)
        expect(restored[1]).toBe(b)
        expect(restored[2]).toBe(c)
      },
      onSettleConfirmed: () => trace.push('settled'),
      onLaneSwitch: () => trace.push('switched'),
    })

    const next = vi.fn(async () => ({ kind: 'enter', messages: [a, b] } as const))
    const decision = await listener('agent/pre-step')({
      agent: work.value,
      messages: [a, b],
      turn: 1,
      step: 4,
      signal: new AbortController().signal,
    }, next)
    trace.push('reject-returned')

    expect(decision).toEqual({ kind: 'reject' })
    expect(next).not.toHaveBeenCalled()
    expect(work.mutable.inbox.nextStep).toEqual([a, b, c])
    expect(work.mutable.inbox.nextStep.map(item => item.id)).toEqual([a.id, b.id, c.id])
    expect(new Set(work.mutable.inbox.nextStep.map(item => item.id)).size).toBe(3)
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state.pendingFocus).toEqual(intent('go'))
    expect(work.mutable.whenIdle).not.toHaveBeenCalled()

    work.mutable.status = 'idle'
    await listener('agent/status')({ agent: work.value, status: 'idle' })

    expect(owner.state).toEqual({
      activeLane: 'go',
      llmRunning: false,
      pendingFocus: intent('go'),
      pausedLane: 'work',
    })
    expect(work.mutable.whenIdle).toHaveBeenCalledOnce()
    expect(trace).toEqual(['restored', 'reject-returned', 'settled', 'switched'])

    await listener('agent/status')({ agent: work.value, status: 'idle' })
    expect(trace.filter(event => event === 'switched')).toHaveLength(1)
  })

  it('lets continuation proceed without a pending cross-lane focus', async () => {
    const { ctx, work, go, owner, listener } = fixture()
    bindPinnedDshCooperativeYield(ctx, owner, { work: work.value, go: go.value })
    const batch = [message('A', 'A')]
    const next = vi.fn(async () => ({ kind: 'enter', messages: batch } as const))

    const decision = await listener('agent/pre-step')({
      agent: work.value,
      messages: batch,
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, next)

    expect(decision).toEqual({ kind: 'enter', messages: batch })
    expect(next).toHaveBeenCalledOnce()
    expect(work.trace).toEqual([])
    expect(owner.state.activeLane).toBe('work')
  })

  it('does not yield, restart, or switch for a same-lane target', async () => {
    const { ctx, work, go, owner, listener } = fixture()
    owner.submitFocusIntent(intent('work', 'user_command'))
    bindPinnedDshCooperativeYield(ctx, owner, { work: work.value, go: go.value })
    const batch = [message('A', 'A')]
    const next = vi.fn(async () => ({ kind: 'enter', messages: batch } as const))

    expect(await listener('agent/pre-step')({
      agent: work.value,
      messages: batch,
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }, next)).toEqual({ kind: 'enter', messages: batch })
    await listener('agent/status')({ agent: work.value, status: 'idle' })

    expect(next).toHaveBeenCalledOnce()
    expect(work.mutable.whenIdle).not.toHaveBeenCalled()
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state).not.toHaveProperty('pausedLane')
  })

  it('uses natural settle without splice/reject and switches only after whenIdle', async () => {
    const { ctx, work, go, owner, listener } = fixture()
    const trace: string[] = []
    owner.submitFocusIntent(intent('go'))
    work.mutable.whenIdle.mockImplementationOnce(async () => {
      trace.push('whenIdle')
      expect(owner.state.activeLane).toBe('work')
    })

    bindPinnedDshCooperativeYield(ctx, owner, { work: work.value, go: go.value }, {
      onSettleConfirmed: () => trace.push('settled'),
      onLaneSwitch: () => trace.push('switched'),
    })

    work.mutable.status = 'idle'
    await listener('agent/status')({ agent: work.value, status: 'idle' })

    expect(work.trace).not.toContain('splice')
    expect(trace).toEqual(['whenIdle', 'settled', 'switched'])
    expect(owner.state.activeLane).toBe('go')
    expect(owner.state).not.toHaveProperty('pausedLane')
    expect(owner.state.pendingFocus).toEqual(intent('go'))
  })

  it('switches with the authoritative winning intent at settle time', async () => {
    const { ctx, work, go, owner, listener } = fixture()
    const original = intent('go', 'self_initiated')
    const winning = intent('go', 'user_command')
    owner.submitFocusIntent(original)
    let switchedIntent: PendingFocusIntent | undefined
    bindPinnedDshCooperativeYield(ctx, owner, { work: work.value, go: go.value }, {
      onLaneSwitch: transition => { switchedIntent = transition.intent },
    })
    const batch = [message('A', 'A')]

    expect(await listener('agent/pre-step')({
      agent: work.value,
      messages: batch,
      turn: 1,
      step: 2,
      signal: new AbortController().signal,
    }, vi.fn())).toEqual({ kind: 'reject' })
    expect(owner.submitFocusIntent(winning).disposition).toBe('replaced')

    work.mutable.status = 'idle'
    await listener('agent/status')({ agent: work.value, status: 'idle' })

    expect(switchedIntent).toBe(winning)
    expect(owner.state.pendingFocus).toBe(winning)
    expect(owner.state.activeLane).toBe('go')
  })

  it('does not carry a canceled yield marker into a later natural settle', async () => {
    const { ctx, work, go, owner, listener } = fixture()
    owner.submitFocusIntent(intent('go'))
    bindPinnedDshCooperativeYield(ctx, owner, { work: work.value, go: go.value })
    const batch = [message('A', 'A')]

    expect(await listener('agent/pre-step')({
      agent: work.value,
      messages: batch,
      turn: 1,
      step: 2,
      signal: new AbortController().signal,
    }, vi.fn())).toEqual({ kind: 'reject' })
    expect(owner.submitFocusIntent(intent('work')).disposition).toBe('replaced')

    work.mutable.status = 'idle'
    await listener('agent/status')({ agent: work.value, status: 'idle' })
    expect(owner.state.activeLane).toBe('work')
    expect(owner.state).not.toHaveProperty('pausedLane')

    work.mutable.status = 'running'
    owner.stepStarted('work', 2, 1)
    expect(owner.submitFocusIntent(intent('go')).disposition).toBe('replaced')
    expect(owner.stepCommitted('work', 2, 1)?.to).toBe('go')
    work.mutable.status = 'idle'
    await listener('agent/status')({ agent: work.value, status: 'idle' })

    expect(owner.state.activeLane).toBe('go')
    expect(owner.state).not.toHaveProperty('pausedLane')
  })
})
