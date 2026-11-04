/**
 * Repo-owned Go lane preset declaration (Spec §19).
 *
 * The pinned DSH dependency surface exposes no agent-preset package: the only
 * real preset seam available to this package is the durable session header
 * field `agentPreset`, which records the preset id a session's agent was
 * composed from. The capability realm itself is therefore declared here and
 * enforced by `GoCapabilityGuard` at execution time.
 *
 * The realm is native-only: model-native tools, no Code Mode, Bash, Python,
 * Web, subagents, generic MCP, external solver, or general execution.
 */
import type { Lane } from '../contracts/focus.js'

/** Durable DSH session `agentPreset` identity for the isolated Go realm. */
export const GO_PRESET_ID = 'companion-go-native-only' as const

/** The only capability class the Go preset admits. */
export const GO_NATIVE_CAPABILITY_KINDS = ['model-native'] as const

/** Capability classes Spec §19 forbids in the Go lane. */
export const GO_FORBIDDEN_CAPABILITY_KINDS = [
  'code-mode',
  'bash',
  'python',
  'web',
  'subagent',
  'generic-mcp',
  'external-solver',
  'general-execution',
] as const

export type GoNativeCapabilityKind = (typeof GO_NATIVE_CAPABILITY_KINDS)[number]
export type GoForbiddenCapabilityKind = (typeof GO_FORBIDDEN_CAPABILITY_KINDS)[number]

/**
 * Model-facing tool paths Spec §20 admits in Phase A.
 *
 * This is the exact 8-tool `go.*` half of the Spec §20 surface (the remaining
 * two `companion.*` tools arrive in Phase B), and it is the only set of paths
 * the guard's factory will mint. A path is never taken from the caller's word
 * alone: `nativeGoCapability()` refuses anything outside this list, so a
 * forbidden capability cannot be aliased into the Go scope under a
 * `go.`-looking name such as `go.exec`.
 */
export const GO_TOOL_PATHS = [
  'go.state',
  'go.inspect_group',
  'go.inspect_region',
  'go.try_move',
  'go.play',
  'go.pass',
  'go.resign',
  'go.request_deep_think',
] as const

export type GoToolPath = (typeof GO_TOOL_PATHS)[number]

/**
 * Path prefixes the Go lane admits.
 *
 * Phase A admits `go.` only: C-T01's Phase A acceptance forbids any
 * `companion.*` path in the Phase A registry, and the guard must not hand out
 * Phase B execution authority early. Phase B adds `companion.` here together
 * with the two `companion.*` paths of the Spec §20 surface.
 */
export const GO_TOOL_PATH_PREFIXES = ['go.'] as const

export type GoToolPathPrefix = (typeof GO_TOOL_PATH_PREFIXES)[number]

/** Frozen shape of the isolated Go capability realm. */
export type GoPresetDeclaration = {
  readonly id: typeof GO_PRESET_ID
  readonly lane: Extract<Lane, 'go'>
  readonly presentation: 'native-only'
  readonly capabilityKinds: readonly GoNativeCapabilityKind[]
  readonly toolPaths: readonly GoToolPath[]
  readonly toolPathPrefixes: readonly GoToolPathPrefix[]
  readonly forbiddenCapabilities: readonly GoForbiddenCapabilityKind[]
}

/** The one Go preset this package composes; frozen so runtime code cannot widen it. */
export const GO_PRESET: GoPresetDeclaration = Object.freeze({
  id: GO_PRESET_ID,
  lane: 'go',
  presentation: 'native-only',
  capabilityKinds: Object.freeze([...GO_NATIVE_CAPABILITY_KINDS]),
  toolPaths: Object.freeze([...GO_TOOL_PATHS]),
  toolPathPrefixes: Object.freeze([...GO_TOOL_PATH_PREFIXES]),
  forbiddenCapabilities: Object.freeze([...GO_FORBIDDEN_CAPABILITY_KINDS]),
})
