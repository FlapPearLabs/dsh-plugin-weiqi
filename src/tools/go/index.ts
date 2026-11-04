/** The eight `go.*` model-facing tools and their registration (Spec §20). */
export {
  GO_LANE_PLAYER,
  GO_TOOL_DEFINITIONS,
  GO_TOOL_NAMES,
  createGoToolRuntime,
  type GoToolRuntimeOptions,
} from './go-tools.js'
export {
  assertExactGoToolSurface,
  registerGoToolDefinition,
  registerGoTools,
  type GoToolRegistrationOptions,
} from './go-tool-registry.js'
export { buildGameNotice, formatBoardPoint } from './notice.js'
export { GoToolArgumentError, GoToolSurfaceError, type GoToolSurfaceIssue } from './errors.js'
export type {
  GameNoticeSink,
  GoDeepThinkResult,
  GoInspectGroupResult,
  GoInspectRegionResult,
  GoLocalMoveObservation,
  GoMoveBasis,
  GoPassResult,
  GoPlayResult,
  GoRegionObservation,
  GoResignResult,
  GoStateResult,
  GoToolDefinition,
  GoToolParameters,
  GoToolPath,
  GoToolRegistry,
  GoToolRuntime,
  GoTryMoveResult,
} from './types.js'
