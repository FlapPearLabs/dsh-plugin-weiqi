import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { PendingFocusIntent } from '../contracts/focus.js'
import { COMPANION_HANDOFF_PLUGIN, createCompanionHandoff } from './handoff.js'

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

function intentWithSource(): PendingFocusIntent {
  return {
    target: 'go',
    origin: 'user_command',
    sourceMessage: {
      sourceSessionId: 'work-session-1',
      message: userMessage('source-message-1', ORIGINAL_BLOCKS),
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

  it('preserves non-text blocks verbatim', () => {
    const intent: PendingFocusIntent = {
      target: 'go',
      origin: 'user_command',
      sourceMessage: {
        sourceSessionId: 'work-session-1',
        message: userMessage('source-message-2', [
          { type: 'text', text: '看这张图' },
          { type: 'reasoning', text: 'thinking' },
        ]),
      },
    }

    expect(createCompanionHandoff(intent)?.message.content).toEqual(
      intent.sourceMessage?.message.content,
    )
  })

  it('marks explicit Companion-handoff provenance and source session', () => {
    const handoff = createCompanionHandoff(intentWithSource())

    expect(handoff?.message.source).toMatchObject({
      kind: 'plugin',
      plugin: COMPANION_HANDOFF_PLUGIN,
      form: 'relay',
      sourceSessionId: 'work-session-1',
    })
  })

  it('allocates a fresh message identity instead of reusing the source id', () => {
    const intent = intentWithSource()
    const handoff = createCompanionHandoff(intent)

    expect(handoff?.message.id).not.toBe(intent.sourceMessage?.message.id)
    expect(handoff?.message.id).toBeTruthy()
  })

  it('does not consult or copy a mutable source surface at handoff time', () => {
    const intent = intentWithSource()
    const sourceSurface = {
      renderedText: intent.sourceMessage?.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    }

    sourceSurface.renderedText = '[compacted]'

    expect(createCompanionHandoff(intent)?.message.content).toEqual(ORIGINAL_BLOCKS)
    expect(sourceSurface.renderedText).toBe('[compacted]')
  })

  it('does not mutate the stored intent or add a second text buffer', () => {
    const intent = intentWithSource()
    const before = JSON.stringify(intent)

    const handoff = createCompanionHandoff(intent)

    expect(JSON.stringify(intent)).toBe(before)
    expect(Object.keys(handoff ?? {})).toEqual(['target', 'message'])
    expect(handoff?.message).not.toHaveProperty('capturedText')
    expect(intent).not.toHaveProperty('capturedText')
  })

  it('returns a deeply frozen message', () => {
    const handoff = createCompanionHandoff(intentWithSource())

    expect(Object.isFrozen(handoff?.message)).toBe(true)
    expect(Object.isFrozen(handoff?.message.content)).toBe(true)
  })
})
