/** Phase A Go lane model-facing registry structure and tools (Spec §18/§20). */
export {
  GO_LANE_ADMITTED_PATHS,
  GO_LANE_FORBIDDEN_SURFACE_SEGMENTS,
  GO_LANE_REGISTRY,
  GO_LANE_REGISTRY_ID,
  GoLaneRegistryError,
  admitGoLaneToolPath,
  goLanePathViolation,
  type GoLaneForbiddenSurfaceSegment,
  type GoLaneRegistryDeclaration,
  type GoLaneRegistryRejectionReason,
} from './go-lane-registry.js'

export * from './go/index.js'
