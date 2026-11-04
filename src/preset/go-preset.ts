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
 * Model-facing tool path prefixes the Go lane may own (Spec §20 final surface:
 * eight `go.*` plus two `companion.*`). Phase A registers only `go.*`.
 *
 * This is a coarse prefix admission check on purpose, not a tool allowlist:
 * `GoCapabilityGuard` only keeps the Go scope inside the lane's own path space
 * (`go.arbitrary` passes here). The fine-grained 8 + 2 tool allowlist is the
 * C-T01 registry, which decides which concrete tool paths may be minted at all.
 */
export const GO_TOOL_PATH_PREFIXES = ['go.', 'companion.'] as const

export type GoToolPathPrefix = (typeof GO_TOOL_PATH_PREFIXES)[number]

/** Frozen shape of the isolated Go capability realm. */
export type GoPresetDeclaration = {
  readonly id: typeof GO_PRESET_ID
  readonly lane: Extract<Lane, 'go'>
  readonly presentation: 'native-only'
  readonly capabilityKinds: readonly GoNativeCapabilityKind[]
  readonly toolPathPrefixes: readonly GoToolPathPrefix[]
  readonly forbiddenCapabilities: readonly GoForbiddenCapabilityKind[]
}

/** The one Go preset this package composes; frozen so runtime code cannot widen it. */
export const GO_PRESET: GoPresetDeclaration = Object.freeze({
  id: GO_PRESET_ID,
  lane: 'go',
  presentation: 'native-only',
  capabilityKinds: Object.freeze([...GO_NATIVE_CAPABILITY_KINDS]),
  toolPathPrefixes: Object.freeze([...GO_TOOL_PATH_PREFIXES]),
  forbiddenCapabilities: Object.freeze([...GO_FORBIDDEN_CAPABILITY_KINDS]),
})
