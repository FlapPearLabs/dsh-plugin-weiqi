import type {
  Lane,
  PendingFocusIntent,
  RuntimeFocusState,
} from '../contracts/focus.js'

/** Outcome of submitting one intent to the single pending-focus slot. */
export type FocusIntentDisposition =
  | 'admitted'
  | 'replaced'
  | 'retained-existing'

/**
 * Pure arbitration result. `retained-existing` means the incoming intent was
 * not admitted or consumed; its caller remains responsible for that input.
 */
export type FocusIntentTransition = {
  state: RuntimeFocusState
  disposition: FocusIntentDisposition
}

/** Create the minimal deterministic Runtime focus state. */
export function createRuntimeFocusState(activeLane: Lane = 'work'): RuntimeFocusState {
  return { activeLane, llmRunning: false }
}

/**
 * Submit one focus intent using the frozen six-case arbitration matrix.
 *
 * A pending user command is non-preemptible until consumed. No rejected or
 * displaced intent is stored here, so this remains a single-slot state
 * machine rather than a queue or mailbox.
 */
export function submitFocusIntent(
  state: RuntimeFocusState,
  incoming: PendingFocusIntent,
): FocusIntentTransition {
  const existing = state.pendingFocus

  if (existing === undefined) {
    return {
      state: { ...state, pendingFocus: incoming },
      disposition: 'admitted',
    }
  }

  if (existing.origin === 'user_command') {
    return { state, disposition: 'retained-existing' }
  }

  return {
    state: { ...state, pendingFocus: incoming },
    disposition: 'replaced',
  }
}

/** Clear the one pending intent only after its admission path has consumed it. */
export function consumePendingFocus(state: RuntimeFocusState): RuntimeFocusState {
  if (state.pendingFocus === undefined) return state

  const { pendingFocus: _consumed, ...remaining } = state
  return remaining
}

/** Select the sole foreground cognition lane without touching other state. */
export function activateLane(state: RuntimeFocusState, activeLane: Lane): RuntimeFocusState {
  return state.activeLane === activeLane ? state : { ...state, activeLane }
}

/** Record foreground model execution explicitly; no AgentLoop state is inferred. */
export function setLlmRunning(
  state: RuntimeFocusState,
  llmRunning: boolean,
): RuntimeFocusState {
  return state.llmRunning === llmRunning ? state : { ...state, llmRunning }
}

/** Record the one deliberately yielded lane; repeated calls never accumulate. */
export function markLanePaused(state: RuntimeFocusState, pausedLane: Lane): RuntimeFocusState {
  return state.pausedLane === pausedLane ? state : { ...state, pausedLane }
}

/**
 * Admit the deliberately paused lane back to foreground state and consume the
 * pause marker. Actual AgentLoop wake/resume integration belongs to A-T07.
 */
export function admitPausedLaneResume(state: RuntimeFocusState): RuntimeFocusState {
  if (state.pausedLane === undefined) return state

  const { pausedLane, ...remaining } = state
  return { ...remaining, activeLane: pausedLane }
}
