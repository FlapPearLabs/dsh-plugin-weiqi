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
  | 'missing-source-session'
  | 'not-user-message'
  | 'empty-message'

export type FocusIntentArbitration = (
  state: RuntimeFocusState,
  incoming: PendingFocusIntent,
) => FocusIntentTransition

export type InactiveLaneAdmissionResult =
  | Readonly<{
    kind: 'submitted'
    intent: PendingFocusIntent
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
 */
export function admitInactiveLaneUserMessage(
  state: RuntimeFocusState,
  admission: InactiveLaneAdmission,
  arbitrate: FocusIntentArbitration = submitFocusIntent,
): InactiveLaneAdmissionResult {
  const reason = rejectionReason(admission)
  if (reason !== undefined) return Object.freeze({ kind: 'rejected' as const, reason })

  const intent: PendingFocusIntent = Object.freeze({
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
  admission: InactiveLaneAdmission,
): InactiveLaneAdmissionRejection | undefined {
  if (admission.target !== 'work' && admission.target !== 'go') return 'invalid-target'
  if (!isNonBlankString(admission.sourceSessionId)) return 'missing-source-session'
  if (!isUserMessage(admission.message)) return 'not-user-message'
  if (!hasMeaningfulContent(admission.message.content)) return 'empty-message'
  return undefined
}

function isNonBlankString(value: string): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function isUserMessage(message: UserMessage): boolean {
  return typeof message === 'object' && message !== null && message.role === 'user'
}

function hasMeaningfulContent(content: readonly ContentBlock[]): boolean {
  if (!Array.isArray(content) || content.length === 0) return false
  return content.some(block =>
    block.type !== 'text' || (typeof block.text === 'string' && block.text.trim() !== ''))
}
