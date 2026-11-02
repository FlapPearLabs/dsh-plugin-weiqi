import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { PendingFocusIntent } from '../contracts/focus.js'
import { COMPANION_HANDOFF_PLUGIN, createCompanionHandoff } from './handoff.js'

const SOURCE_SESSION_ID = 'source-session-t05'

function userMessage(id: string, content: UserMessage['content']): UserMessage {
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

const ORIGINAL_BLOCKS: UserMessage['content'] = [
  { type: 'text', text: '去下一手' },
  { type: 'text', text: '从左上角开始' },
]

function intentWithSource(
  target: PendingFocusIntent['target'] = 'go',
): PendingFocusIntent {
  return {
    target,
    origin: 'user_command',
    sourceMessage: {
      sourceSessionId: SOURCE_SESSION_ID,
      message: userMessage('source-message-t05', ORIGINAL_BLOCKS),
    },
  }
}

describe('Companion source-message handoff', () => {
  it('returns undefined when the winning intent has no source message', () => {
    expect(
      createCompanionHandoff({ target: 'go', origin: 'self_initiated' }),
    ).toBeUndefined()
  })

  it('delivers the exact stored content blocks into the target lane', () => {
    const intent = intentWithSource()
    const handoff = createCompanionHandoff(intent)

    expect(handoff).toBeDefined()
    expect(handoff?.target).toBe('go')
    expect(handoff?.message.role).toBe('user')
    expect(handoff?.message.content).toEqual(intent.sourceMessage?.message.content)
  })

  it('preserves non-text blocks verbatim and keeps the actual target lane', () => {
    const intent = intentWithSource('work')
    intent.sourceMessage = {
      sourceSessionId: SOURCE_SESSION_ID,
      message: userMessage('source-message-nontext', [
        { type: 'text', text: '看这张图' },
        { type: 'reasoning', text: 'thinking' },
      ]),
    }

    const handoff = createCompanionHandoff(intent)

    expect(handoff?.target).toBe('work')
    expect(handoff?.message.content).toEqual(intent.sourceMessage.message.content)
  })

  it('marks explicit Companion-handoff provenance and source session', () => {
    const handoff = createCompanionHandoff(intentWithSource())

    expect(handoff?.message.source).toMatchObject({
      kind: 'plugin',
      plugin: COMPANION_HANDOFF_PLUGIN,
      form: 'relay',
      sourceSessionId: SOURCE_SESSION_ID,
    })
  })

  it('exposes the source session on the public handoff message type', () => {
    const handoff = createCompanionHandoff(intentWithSource())

    expect(handoff?.message.source.sourceSessionId).toBe(SOURCE_SESSION_ID)
  })

  it('allocates a fresh message identity instead of reusing the source id', () => {
    const intent = intentWithSource()
    const handoff = createCompanionHandoff(intent)

    expect(handoff?.message.id).not.toBe(intent.sourceMessage?.message.id)
    expect(handoff?.message.id).toBeTruthy()
  })

  it('accepts only the stored intent, never a session surface', () => {
    const intent = intentWithSource()

    // @ts-expect-error the handoff API has no session/surface parameter
    createCompanionHandoff(intent, { renderedText: 'late lookup' })
  })

  it('keeps the delivered snapshot after the stored intent is rewritten', () => {
    const intent = intentWithSource()
    const handoff = createCompanionHandoff(intent)

    intent.sourceMessage = {
      sourceSessionId: 'rewritten-session',
      message: userMessage('rewritten-message', [
        { type: 'text', text: '重写后的内容' },
      ]),
    }

    expect(handoff?.message.content).toEqual(ORIGINAL_BLOCKS)
    expect(handoff?.message.source.sourceSessionId).toBe(SOURCE_SESSION_ID)
  })

  it('does not mutate the stored intent', () => {
    const intent = intentWithSource()
    const before = JSON.stringify(intent)

    const handoff = createCompanionHandoff(intent)

    expect(JSON.stringify(intent)).toBe(before)
    expect(Object.keys(handoff ?? {})).toEqual(['target', 'message'])
  })

  it('returns a deeply frozen delivery value', () => {
    const handoff = createCompanionHandoff(intentWithSource())

    expect(Object.isFrozen(handoff)).toBe(true)
    expect(Object.isFrozen(handoff?.message)).toBe(true)
    expect(Object.isFrozen(handoff?.message.content)).toBe(true)
    expect(Object.isFrozen(handoff?.message.content[0])).toBe(true)
    expect(Object.isFrozen(handoff?.message.source)).toBe(true)
  })
})
