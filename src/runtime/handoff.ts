import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Lane, PendingFocusIntent } from '../contracts/focus.js'

/** Stable producer id recorded on a user message carried across lanes. */
export const COMPANION_HANDOFF_PLUGIN = 'companion-go'

/** The exact target-lane delivery value for one winning focus intent. */
export type CompanionHandoff = Readonly<{
  target: Lane
  message: UserMessage
}>

/**
 * Build the target-lane user message from the winning intent's already-created
 * immutable source message.
 *
 * The stored content blocks are copied verbatim into a fresh identified
 * message. The plugin source records explicit Companion-handoff provenance and
 * the original session id. This function never reads a session surface and
 * never stores a text copy in Runtime state.
 */
export function createCompanionHandoff(
  intent: PendingFocusIntent,
): CompanionHandoff | undefined {
  const source = intent.sourceMessage
  if (source === undefined) return undefined

  const provenance = {
    kind: 'plugin' as const,
    plugin: COMPANION_HANDOFF_PLUGIN,
    form: 'relay' as const,
    sourceSessionId: source.sourceSessionId,
  }

  const message = createUserMessage({
    content: source.message.content,
    source: provenance,
  })

  return { target: intent.target, message }
}
