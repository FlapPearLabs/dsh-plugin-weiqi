import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Lane, PendingFocusIntent } from '../contracts/focus.js'

/** Stable producer id recorded on a user message carried across lanes. */
export const COMPANION_HANDOFF_PLUGIN = 'companion-go'

/** Plugin provenance carried by a Companion-relayed user message. */
export type CompanionHandoffSource = Extract<
  UserMessage['source'],
  { kind: 'plugin' }
> & {
  readonly sourceSessionId: string
}

/** Target-lane message with its concrete Companion provenance. */
export type CompanionHandoffMessage = UserMessage & {
  readonly source: CompanionHandoffSource
}

/** The exact target-lane delivery value for one winning focus intent. */
export type CompanionHandoff = Readonly<{
  target: Lane
  message: CompanionHandoffMessage
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

  // DSH widens plugin sources to the base MessageSource; this package's public
  // type records the relay field written immediately above.
  const message = createUserMessage({
    content: source.message.content,
    source: provenance,
  }) as CompanionHandoffMessage

  return Object.freeze({ target: intent.target, message })
}
