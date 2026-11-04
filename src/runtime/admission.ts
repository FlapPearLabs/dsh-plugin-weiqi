/**
 * User-origin admission for a natural-language message arriving on the
 * inactive lane (Spec §7.2, §16 Manual, §44).
 *
 * The message itself is the evidence of user intent, so Runtime creates one
 * `user_command` intent from the exact immutable DSH `UserMessage` and submits
 * it to the A-T02 single-slot arbitration. The inactive Agent is never asked
 * to read the message or request focus first. This module holds no Agent,
 * queue, mailbox, router, timer, or copied text.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { Lane, PendingFocusIntent, RuntimeFocusState } from '../contracts/focus.js'
import {
  submitFocusIntent,
  type FocusIntentDisposition,
  type FocusIntentTransition,
} from './focus.js'

export type InactiveLaneAdmission = Readonly<{
  target: Lane
  sourceSessionId: string
  message: UserMessage
}>

export type InactiveLaneAdmissionRejection =
  | 'invalid-target'
  | 'already-active-lane'
  | 'missing-source-session'
  | 'not-user-message'
  | 'empty-message'
  | 'mutable-message'

export type FocusIntentArbitration = (
  state: RuntimeFocusState,
  incoming: PendingFocusIntent,
) => FocusIntentTransition

/**
 * The exact user-command intent created for one inactive-lane admission.
 *
 * A narrowing of the shared `PendingFocusIntent` contract: unlike a generic
 * intent, an inactive-lane user message always carries `origin: "user_command"`
 * and the DSH message that produced it.
 */
export type InactiveLaneUserCommandIntent = Readonly<
  PendingFocusIntent & {
    origin: 'user_command'
    sourceMessage: Readonly<{
      sourceSessionId: string
      message: UserMessage
    }>
  }
>

export type InactiveLaneAdmissionResult =
  | Readonly<{
    kind: 'submitted'
    intent: InactiveLaneUserCommandIntent
    disposition: FocusIntentDisposition
    state: RuntimeFocusState
  }>
  | Readonly<{
    kind: 'rejected'
    reason: InactiveLaneAdmissionRejection
  }>

/**
 * Admit one natural-language user message that arrived on the inactive lane.
 *
 * Creates exactly one `PendingFocusIntent` with `origin: "user_command"` and
 * submits it once through `submitFocusIntent`. Invalid or empty input is
 * rejected before any intent exists, so arbitration is never called.
 *
 * `admission.target` must be the inactive lane: the active lane is the lane the
 * user is already watching, so a same-lane target would occupy the single
 * pending slot with an intent the §5 boundary can never consume (it skips
 * `intent.target === activeLane`) and would deadlock every later cross-lane
 * user command as `retained-existing`.
 *
 * The message is stored by exact reference, so it must already be deeply frozen
 * by the DSH `createUserMessage` contract. A mutable message is rejected rather
 * than freezing the caller's object or copying its text.
 *
 * @param arbitrate - test-only injection seam defaulting to the A-T02
 *   `submitFocusIntent`; production callers must omit it so admission has
 *   exactly one arbitration path.
 */
export function admitInactiveLaneUserMessage(
  state: RuntimeFocusState,
  admission: InactiveLaneAdmission,
  arbitrate: FocusIntentArbitration = submitFocusIntent,
): InactiveLaneAdmissionResult {
  const reason = rejectionReason(state, admission)
  if (reason !== undefined) return Object.freeze({ kind: 'rejected' as const, reason })

  const intent: InactiveLaneUserCommandIntent = Object.freeze({
    target: admission.target,
    origin: 'user_command' as const,
    sourceMessage: Object.freeze({
      sourceSessionId: admission.sourceSessionId,
      message: admission.message,
    }),
  })

  const transition = arbitrate(state, intent)
  return Object.freeze({
    kind: 'submitted' as const,
    intent,
    disposition: transition.disposition,
    state: transition.state,
  })
}

function rejectionReason(
  state: RuntimeFocusState,
  admission: InactiveLaneAdmission,
): InactiveLaneAdmissionRejection | undefined {
  if (admission.target !== 'work' && admission.target !== 'go') return 'invalid-target'
  if (admission.target === state.activeLane) return 'already-active-lane'
  if (!isNonBlankString(admission.sourceSessionId)) return 'missing-source-session'
  if (!isUserMessage(admission.message)) return 'not-user-message'
  if (!hasMeaningfulContent(admission.message.content)) return 'empty-message'
  if (!isDeeplyFrozenUserMessage(admission.message)) return 'mutable-message'
  return undefined
}

function isNonBlankString(value: string): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function isUserMessage(message: UserMessage): boolean {
  return typeof message === 'object'
    && message !== null
    && message.role === 'user'
    && typeof message.source === 'object'
    && message.source !== null
    && message.source.kind === 'user'
}

function hasMeaningfulContent(content: readonly ContentBlock[]): boolean {
  if (!Array.isArray(content) || content.length === 0) return false
  return content.some(block => {
    if (typeof block !== 'object' || block === null) return false
    const type: unknown = (block as { type?: unknown }).type
    if (typeof type !== 'string') return false
    if (type !== 'text') return true
    const text: unknown = (block as { text?: unknown }).text
    return typeof text === 'string' && text.trim() !== ''
  })
}

/**
 * The stored message is the exact caller reference, never a copy, so its
 * immutability must come from DSH `createUserMessage` deep-freezing. Check the
 * message, its content array, every block, and the source provenance (including
 * any nested provenance object) before publishing that reference.
 */
function isDeeplyFrozenUserMessage(message: UserMessage): boolean {
  return Object.isFrozen(message)
    && Array.isArray(message.content)
    && Object.isFrozen(message.content)
    && message.content.every(block => block != null && Object.isFrozen(block))
    && isDeeplyFrozen(message.source)
}

function isDeeplyFrozen(value: unknown, seen: Set<object> = new Set()): boolean {
  if (typeof value !== 'object' || value === null) return true
  if (seen.has(value)) return true
  if (!Object.isFrozen(value)) return false

  seen.add(value)
  const children = Array.isArray(value) ? value : Object.values(value)
  return children.every(child => isDeeplyFrozen(child, seen))
}
