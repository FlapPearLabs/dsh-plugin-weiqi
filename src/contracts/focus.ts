import type { UserMessage } from '@deepseek-ai/dsh-session'

/** The two isolated foreground cognition lanes frozen by R2.4. */
export type Lane = 'work' | 'go'

/** The one atomic, non-mailbox focus request owned by Runtime. */
export type PendingFocusIntent = {
  target: Lane
  origin: 'user_command' | 'self_initiated'
  sourceMessage?: {
    sourceSessionId: string
    message: UserMessage
  }
}

/** Minimal focus state required for safe two-lane switching. */
export type RuntimeFocusState = {
  activeLane: Lane
  llmRunning: boolean
  pendingFocus?: PendingFocusIntent
  pausedLane?: Lane
}
