import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { Lane, PendingFocusIntent, RuntimeFocusState } from '../contracts/focus.js'
import * as admissionModule from './admission.js'
import {
  admitInactiveLaneUserMessage,
  type FocusIntentArbitration,
  type InactiveLaneAdmission,
} from './admission.js'
import { createRuntimeFocusState, submitFocusIntent } from './focus.js'

function userMessage(id: string, content: ContentBlock[]): UserMessage {
  const message = {
    id: id as UserMessage['id'],
    role: 'user',
    content,
    source: { kind: 'user' },
  } satisfies UserMessage

  for (const block of message.content) Object.freeze(block)
  Object.freeze(message.content)
  return Object.freeze(message)
}

function textMessage(text: string, id = 'inactive-lane-message'): UserMessage {
  return userMessage(id, [{ type: 'text', text }])
}

function admissionFor(
  message: UserMessage,
  target: Lane = 'go',
  sourceSessionId = 'companion-go-go',
): InactiveLaneAdmission {
  return { target, sourceSessionId, message }
}

function spyArbitration(): FocusIntentArbitration & ReturnType<typeof vi.fn> {
  return vi.fn((state: RuntimeFocusState, incoming: PendingFocusIntent) =>
    submitFocusIntent(state, incoming))
}

function submitted(
  result: ReturnType<typeof admitInactiveLaneUserMessage>,
): Extract<ReturnType<typeof admitInactiveLaneUserMessage>, { kind: 'submitted' }> {
  if (result.kind !== 'submitted') {
    throw new Error(`expected a submitted admission, got ${JSON.stringify(result)}`)
  }
  return result
}

function simulatedInactiveView(message: UserMessage) {
  const reads: string[] = []
  const agent = {
    steer: vi.fn(),
    run: vi.fn(),
    cancel: vi.fn(),
    get status(): string {
      reads.push('status')
      return 'idle'
    },
  }

  return { lane: 'go' as Lane, agent, message, reads }
}

describe('inactive-lane user message admission', () => {
  it('creates exactly one user-command intent carrying the exact target and message', () => {
    const message = textMessage('去下一手')
    const arbitrate = spyArbitration()
    const initial = createRuntimeFocusState('work')

    const result = submitted(
      admitInactiveLaneUserMessage(
        initial,
        admissionFor(message, 'go', 'companion-go-go'),
        arbitrate,
      ),
    )

    expect(arbitrate).toHaveBeenCalledTimes(1)
    const incoming = arbitrate.mock.calls[0]![1]

    expect(incoming.target).toBe('go')
    expect(incoming.origin).toBe('user_command')
    expect(incoming.sourceMessage?.sourceSessionId).toBe('companion-go-go')
    expect(incoming.sourceMessage?.message).toBe(message)
    expect(incoming).toEqual({
      target: 'go',
      origin: 'user_command',
      sourceMessage: {
        sourceSessionId: 'companion-go-go',
        message,
      },
    })
    expect(Object.keys(incoming)).toEqual(['target', 'origin', 'sourceMessage'])
    expect(Object.keys(incoming.sourceMessage!)).toEqual(['sourceSessionId', 'message'])
  })

  it('submits the one intent through the A-T02 arbitration and returns its outcome', () => {
    const message = textMessage('从这里开始')

    const result = submitted(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    )

    expect(result.disposition).toBe('admitted')
    expect(result.state.pendingFocus).toBe(result.intent)
    expect(result.state.activeLane).toBe('work')
    expect(result.state.llmRunning).toBe(false)
  })

  it('keeps the older pending user command and reports retained-existing', () => {
    const older = textMessage('先处理这条', 'older-message')
    const newer = textMessage('再处理这条', 'newer-message')
    const first = submitted(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(older)),
    )

    const second = submitted(
      admitInactiveLaneUserMessage(first.state, admissionFor(newer)),
    )

    expect(second.disposition).toBe('retained-existing')
    expect(second.state.pendingFocus).toBe(first.intent)
    expect(second.state.pendingFocus?.sourceMessage?.message).toBe(older)
    expect(second.state.pendingFocus).not.toBe(second.intent)
    expect(second.intent).not.toBe(first.intent)
  })

  it('never runs or consults the inactive Agent before admission', () => {
    const view = simulatedInactiveView(textMessage('Go 这边看一手'))
    const arbitrate = spyArbitration()

    const result = submitted(
      admitInactiveLaneUserMessage(
        createRuntimeFocusState('work'),
        { target: view.lane, sourceSessionId: 'companion-go-go', message: view.message },
        arbitrate,
      ),
    )

    expect(result.intent.sourceMessage?.message).toBe(view.message)
    expect(arbitrate).toHaveBeenCalledTimes(1)
    expect(view.agent.run).not.toHaveBeenCalled()
    expect(view.agent.steer).not.toHaveBeenCalled()
    expect(view.agent.cancel).not.toHaveBeenCalled()
    expect(view.reads).toEqual([])
    expect(Object.keys(view.agent)).not.toContain('admitInactiveLaneUserMessage')
  })

  it('exposes no queue, mailbox, or router surface', () => {
    expect(Object.keys(admissionModule).sort()).toEqual(['admitInactiveLaneUserMessage'])
    expect(
      Object.keys(admissionModule).filter(name => /queue|mailbox|router|buffer|history/i.test(name)),
    ).toEqual([])

    let state = createRuntimeFocusState('work')
    for (let round = 0; round < 3; round += 1) {
      const result = submitted(
        admitInactiveLaneUserMessage(
          state,
          admissionFor(textMessage(`第 ${round} 条`, `repeated-${round}`)),
        ),
      )
      state = result.state
      expect(Array.isArray(result.state.pendingFocus)).toBe(false)
      expect(result.state.pendingFocus === undefined ? 0 : 1).toBe(1)
    }

    expect(Object.keys(state)).toEqual(['activeLane', 'llmRunning', 'pendingFocus'])
    expect(
      Object.keys(state).filter(key => /queue|mailbox|router|buffer|list/i.test(key)),
    ).toEqual([])
  })

  it('rejects an empty message without creating or submitting an intent', () => {
    const arbitrate = spyArbitration()
    const initial = createRuntimeFocusState('work')

    const result = admitInactiveLaneUserMessage(
      initial,
      admissionFor(userMessage('empty-message', [])),
      arbitrate,
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'empty-message' })
    expect(result).not.toHaveProperty('intent')
    expect(arbitrate).not.toHaveBeenCalled()
    expect(initial).toEqual(createRuntimeFocusState('work'))
  })

  it('rejects whitespace-only text without creating or submitting an intent', () => {
    const arbitrate = spyArbitration()

    const result = admitInactiveLaneUserMessage(
      createRuntimeFocusState('work'),
      admissionFor(textMessage('   \n\t ')),
      arbitrate,
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'empty-message' })
    expect(arbitrate).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'missing source session id',
      request: { target: 'go', sourceSessionId: '', message: textMessage('下一手') },
      reason: 'missing-source-session',
    },
    {
      name: 'blank source session id',
      request: { target: 'go', sourceSessionId: '   ', message: textMessage('下一手') },
      reason: 'missing-source-session',
    },
    {
      name: 'non-lane target',
      request: {
        target: 'board' as Lane,
        sourceSessionId: 'companion-go-go',
        message: textMessage('下一手'),
      },
      reason: 'invalid-target',
    },
    {
      name: 'non-user role',
      request: {
        target: 'go',
        sourceSessionId: 'companion-go-go',
        message: {
          ...textMessage('下一手'),
          role: 'assistant',
        } as unknown as UserMessage,
      },
      reason: 'not-user-message',
    },
    {
      name: 'missing message',
      request: {
        target: 'go',
        sourceSessionId: 'companion-go-go',
        message: undefined as unknown as UserMessage,
      },
      reason: 'not-user-message',
    },
  ] as const)('rejects $name without an intent', ({ request, reason }) => {
    const arbitrate = spyArbitration()

    const result = admitInactiveLaneUserMessage(
      createRuntimeFocusState('work'),
      request,
      arbitrate,
    )

    expect(result).toEqual({ kind: 'rejected', reason })
    expect(result).not.toHaveProperty('intent')
    expect(arbitrate).not.toHaveBeenCalled()
  })

  it('admits non-text message content that still carries user intent', () => {
    const message = userMessage('image-only-message', [
      {
        type: 'image',
        attachment: { id: 'attachment-1' } as never,
      },
    ])

    const result = submitted(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    )

    expect(result.state.pendingFocus?.sourceMessage?.message).toBe(message)
  })

  it('stores the exact immutable message by reference, never a text copy', () => {
    const message = textMessage('照这张图下')
    const result = submitted(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    )

    expect(result.intent.sourceMessage?.message).toBe(message)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(result.intent)).toBe(true)
    expect(Object.isFrozen(result.intent.sourceMessage)).toBe(true)
    expect(Object.keys(result.intent.sourceMessage!)).toEqual(['sourceSessionId', 'message'])
    expect(result.intent).not.toHaveProperty('capturedText')
    expect(result.intent.sourceMessage).not.toHaveProperty('capturedText')
  })

  it('does not mutate the caller state or the exact message', () => {
    const message = textMessage('保持原样')
    const initial = createRuntimeFocusState('work')
    const stateBefore = JSON.stringify(initial)
    const messageBefore = JSON.stringify(message)

    admitInactiveLaneUserMessage(initial, admissionFor(message))

    expect(JSON.stringify(initial)).toBe(stateBefore)
    expect(JSON.stringify(message)).toBe(messageBefore)
    expect(initial).not.toHaveProperty('pendingFocus')
  })

  it('returns exactly one frozen result carrying no extra channels', () => {
    const result = submitted(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(textMessage('走'))),
    )

    expect(Object.keys(result)).toEqual(['kind', 'intent', 'disposition', 'state'])
    expect(Object.isFrozen(result)).toBe(true)
  })
})
