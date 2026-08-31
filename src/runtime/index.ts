/** Internal Runtime lane identity and live-resolution seam. */
export {
  COMPANION_LANES,
  laneSessionId,
  resolveLaneSession,
} from './lane-session.js'

export {
  activateLane,
  admitPausedLaneResume,
  consumePendingFocus,
  createRuntimeFocusState,
  markLanePaused,
  setLlmRunning,
  submitFocusIntent,
  type FocusIntentDisposition,
  type FocusIntentTransition,
} from './focus.js'

export {
  RuntimeFocusOwner,
  bindPinnedDshFocusBoundary,
  type EligibleFocusHandoff,
  type ExecutingStep,
  type FocusBoundaryBindingOptions,
  type FocusIntentSubmission,
  type FocusSettleKind,
  type PairedLaneAgents,
  type SafeHandoffBoundary,
  type SettledFocusSwitch,
} from './focus-boundary.js'

export {
  bindPinnedDshCooperativeYield,
  type FocusYieldBinding,
  type FocusYieldBindingOptions,
} from './focus-yield.js'
