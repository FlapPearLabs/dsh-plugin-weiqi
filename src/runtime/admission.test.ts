import { readFile } from 'node:fs/promises'
import {
  createToolResultMessage,
  createUserMessage,
  type ContentBlock,
} from '@deepseek-ai/dsh-llm'
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
    source: { kind: 'user' as const },
  } satisfies UserMessage

  Object.freeze(message.source)
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

function messageWithSource(
  source: UserMessage['source'],
  id: string,
): UserMessage {
  const content = [{ type: 'text' as const, text: '带来源的占位内容' }]
  for (const block of content) Object.freeze(block)
  Object.freeze(content)
  return Object.freeze({
    id: id as UserMessage['id'],
    role: 'user',
    content,
    source: Object.freeze(source),
  } satisfies UserMessage)
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

  it('admits without an Agent handle and leaves the lane and run state untouched', () => {
    const message = textMessage('Go 这边看一手')
    const initial = createRuntimeFocusState('work')

    const result = submitted(
      admitInactiveLaneUserMessage(
        initial,
        admissionFor(message, 'go', 'companion-go-go'),
      ),
    )

    expect(result.intent.sourceMessage?.message).toBe(message)
    expect(result.state.activeLane).toBe('work')
    expect(result.state.llmRunning).toBe(false)
    expect(initial.activeLane).toBe('work')
    expect(initial.llmRunning).toBe(false)
    expect(initial.pendingFocus).toBeUndefined()
  })

  it('has no Agent dependency: no dsh-agent import and no Agent parameter', async () => {
    const source = await readFile(new URL('./admission.ts', import.meta.url), 'utf8')
    const importSpecifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(
      match => match[1] ?? '',
    )
    const exported = source.slice(
      source.indexOf('export function admitInactiveLaneUserMessage'),
    )

    expect(importSpecifiers.length).toBeGreaterThan(0)
    expect(
      importSpecifiers.filter(specifier => /(^|\/)dsh-agent(\/|$)/.test(specifier)),
    ).toEqual([])
    expect(exported).not.toMatch(/\bAgent\b/)
    expect(exported).not.toMatch(/\bagent\b/)
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

  it.each([
    { activeLane: 'work' as Lane, target: 'work' as Lane },
    { activeLane: 'go' as Lane, target: 'go' as Lane },
  ])(
    'rejects a $target message while $activeLane is the active lane',
    ({ activeLane, target }) => {
      const arbitrate = spyArbitration()
      const initial = createRuntimeFocusState(activeLane)

      const result = admitInactiveLaneUserMessage(
        initial,
        admissionFor(textMessage('当前泳道上的消息'), target),
        arbitrate,
      )

      expect(result).toEqual({ kind: 'rejected', reason: 'already-active-lane' })
      expect(result).not.toHaveProperty('intent')
      expect(arbitrate).not.toHaveBeenCalled()
      expect(initial).toEqual(createRuntimeFocusState(activeLane))
      expect(initial.pendingFocus).toBeUndefined()
    },
  )

  it('keeps the single focus slot free after a same-lane attempt', () => {
    const initial = createRuntimeFocusState('work')

    const sameLane = admitInactiveLaneUserMessage(
      initial,
      admissionFor(textMessage('本该在当前泳道处理', 'same-lane'), 'work'),
    )

    const stateAfterSameLane = sameLane.kind === 'submitted' ? sameLane.state : initial
    const crossLane = admitInactiveLaneUserMessage(
      stateAfterSameLane,
      admissionFor(textMessage('去 Go 那边', 'cross-lane'), 'go'),
    )

    expect(crossLane.kind === 'submitted' ? crossLane.disposition : crossLane).toBe('admitted')
    expect(crossLane.kind === 'submitted' ? crossLane.intent.target : undefined).toBe('go')
    expect(sameLane).toEqual({ kind: 'rejected', reason: 'already-active-lane' })
    expect(stateAfterSameLane.pendingFocus).toBeUndefined()
  })

  it('admits a work-targeted message while go is the active lane', () => {
    const message = textMessage('回到 Work 看这条')

    const result = submitted(
      admitInactiveLaneUserMessage(
        createRuntimeFocusState('go'),
        admissionFor(message, 'work', 'companion-work-work'),
      ),
    )

    expect(result.intent.target).toBe('work')
    expect(result.state.activeLane).toBe('go')
    expect(result.state.pendingFocus).toBe(result.intent)
  })

  it('accepts a real DSH createUserMessage as the immutable stored reference', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'DSH 生成的消息' }],
      source: { kind: 'user' },
    })

    const result = submitted(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    )

    expect(result.intent.sourceMessage?.message).toBe(message)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(() => {
      ;(message.content[0] as unknown as { text: string }).text = 'MUTATED'
    }).toThrow(TypeError)
  })

  it('rejects a mutable message it could not store immutably', () => {
    const message = {
      id: 'mutable-message',
      role: 'user',
      content: [{ type: 'text', text: '尚未冻结' }],
      source: { kind: 'user' },
    } as unknown as UserMessage
    const arbitrate = spyArbitration()
    const initial = createRuntimeFocusState('work')

    const result = admitInactiveLaneUserMessage(initial, admissionFor(message), arbitrate)

    expect(result).toEqual({ kind: 'rejected', reason: 'mutable-message' })
    expect(arbitrate).not.toHaveBeenCalled()
    expect(initial.pendingFocus).toBeUndefined()
  })

  it('rejects a message whose frozen shell still holds mutable content', () => {
    const message = {
      ...textMessage('占位', 'shallow-frozen'),
      content: [{ type: 'text', text: '内容仍可变' }],
    } as UserMessage
    Object.freeze(message)

    expect(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    ).toEqual({ kind: 'rejected', reason: 'mutable-message' })
  })

  it('rejects malformed null content blocks as empty instead of throwing', () => {
    const message = {
      ...textMessage('占位', 'malformed-block'),
      content: [null as unknown as ContentBlock],
    } as UserMessage

    expect(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    ).toEqual({ kind: 'rejected', reason: 'empty-message' })
  })

  it('rejects a malformed block without a string type as empty', () => {
    const message = userMessage('untyped-block', [{} as unknown as ContentBlock])

    expect(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    ).toEqual({ kind: 'rejected', reason: 'empty-message' })
  })

  it('rejects a message whose frozen shell, content and block still hold a mutable source', () => {
    const message = {
      ...textMessage('占位', 'mutable-source'),
      source: { kind: 'user' as const },
    } as UserMessage
    Object.freeze(message)

    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(Object.isFrozen(message.source)).toBe(false)

    expect(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    ).toEqual({ kind: 'rejected', reason: 'mutable-message' })
  })

  it('rejects a frozen source that still holds mutable nested provenance', () => {
    const source = Object.freeze({
      kind: 'user' as const,
      sections: [{ name: 'snapshot', text: 'mutable section' }],
    }) as unknown as UserMessage['source']
    const message = {
      ...textMessage('占位', 'mutable-provenance'),
      source,
    } as UserMessage
    Object.freeze(message)

    expect(Object.isFrozen(source)).toBe(true)
    expect(
      Object.isFrozen((source as unknown as { sections: unknown[] }).sections),
    ).toBe(false)

    expect(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    ).toEqual({ kind: 'rejected', reason: 'mutable-message' })
  })

  it.each([
    { name: 'tool', source: { kind: 'tool', callId: 'call-1' } },
    { name: 'plugin', source: { kind: 'plugin', plugin: 'dsh-test' } },
    { name: 'model', source: { kind: 'model', provider: 'deepseek', model: 'test-model' } },
  ] as const)('rejects a $name source as a non-user message', ({ source }) => {
    const message = messageWithSource(
      source as UserMessage['source'],
      `non-user-${source.kind}`,
    )
    const arbitrate = spyArbitration()

    const result = admitInactiveLaneUserMessage(
      createRuntimeFocusState('work'),
      admissionFor(message),
      arbitrate,
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'not-user-message' })
    expect(result).not.toHaveProperty('intent')
    expect(arbitrate).not.toHaveBeenCalled()
  })

  it('rejects a real DSH tool-result message instead of admitting it as user intent', () => {
    const message = createToolResultMessage({
      callId: 'call-1' as never,
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    })
    const arbitrate = spyArbitration()

    const result = admitInactiveLaneUserMessage(
      createRuntimeFocusState('work'),
      admissionFor(message),
      arbitrate,
    )

    expect(result).toEqual({ kind: 'rejected', reason: 'not-user-message' })
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

  it('stores the exact message by reference, never a text copy', () => {
    const message = textMessage('照这张图下')
    const result = submitted(
      admitInactiveLaneUserMessage(createRuntimeFocusState('work'), admissionFor(message)),
    )

    expect(result.intent.sourceMessage?.message).toBe(message)
    expect(result.intent.sourceMessage?.message.content[0]).toBe(message.content[0])
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
