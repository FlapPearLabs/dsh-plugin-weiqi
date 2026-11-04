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
  admitInactiveLaneUserMessage,
  type InactiveLaneAdmission,
  type InactiveLaneAdmissionRejection,
  type InactiveLaneAdmissionResult,
  type InactiveLaneUserCommandIntent,
} from './admission.js'

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

export {
  ForbiddenGoCapabilityError,
  ForgedGoCapabilityError,
  GO_CAPABILITY_SERVICE,
  GoCapabilityGuard,
  assertGoCapabilityAllowed,
  composeGoLaneScope,
  createGoCapabilityScope,
  isNativeGoCapability,
  nativeGoCapability,
  resolveGoCapabilityGuard,
  type GoCapability,
  type GoCapabilityRejectionReason,
  type GoCapabilityScope,
} from './go-capability-guard.js'

export {
  GO_FORBIDDEN_CAPABILITY_KINDS,
  GO_NATIVE_CAPABILITY_KINDS,
  GO_PRESET,
  GO_PRESET_ID,
  GO_TOOL_PATH_PREFIXES,
  GO_TOOL_PATHS,
  type GoForbiddenCapabilityKind,
  type GoNativeCapabilityKind,
  type GoPresetDeclaration,
  type GoToolPath,
  type GoToolPathPrefix,
} from '../preset/go-preset.js'

export {
  bindPinnedDshLaneResume,
  COMPANION_RESUME_PLUGIN,
  emitLaneSwitched,
  type FocusResumeBinding,
  type FocusResumeBindingOptions,
} from './focus-resume.js'

export {
  COMPANION_HANDOFF_PLUGIN,
  createCompanionHandoff,
  type CompanionHandoff,
  type CompanionHandoffMessage,
  type CompanionHandoffSource,
} from './handoff.js'
