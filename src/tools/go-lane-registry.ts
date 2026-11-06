/**
 * Phase A registry structure for the Go lane's model-facing tools (Spec §18/§20).
 *
 * This module declares policy, not tools. It admits the eight `go.*` paths of
 * the Spec §20 Phase A surface and deterministically refuses everything else:
 * `companion.*` (Phase B, WAVE-C-T03), solver, best-move, win-rate, score-lead
 * and general-execution surfaces. WAVE-C-T02 owns registration; nothing here
 * registers, imports or calls a tool, and no engine or solver is imported.
 */
import { GO_PRESET, type GoToolPath } from '../preset/go-preset.js'

export const GO_LANE_REGISTRY_ID = 'companion-go-lane-registry' as const

/**
 * Path segments that name a second strategy authority or a general-execution
 * capability (Spec §18/§19). A path carrying one is refused even when it sits
 * inside the `go.` namespace, so `go.exec` and `go.best_move` cannot be aliased
 * into the lane under a `go.`-looking name.
 */
export const GO_LANE_FORBIDDEN_SURFACE_SEGMENTS = [
  'solver',
  'engine',
  'katago',
  'leela',
  'gnugo',
  'mcts',
  'best',
  'bestmove',
  'win',
  'winrate',
  'score',
  'recommend',
  'advice',
  'search',
  'eval',
  'exec',
  'shell',
  'bash',
  'python',
  'script',
  'spawn',
  'subagent',
  'mcp',
] as const

export type GoLaneForbiddenSurfaceSegment = (typeof GO_LANE_FORBIDDEN_SURFACE_SEGMENTS)[number]

/** The exact eight `go.*` paths this registry admits in Phase A. */
export const GO_LANE_ADMITTED_PATHS: readonly GoToolPath[] = GO_PRESET.toolPaths

export type GoLaneRegistryRejectionReason =
  | 'invalid-tool-path'
  | 'tool-path'
  | 'forbidden-surface'
  | 'not-in-surface'

const INVALID_TOOL_PATH = '<invalid-tool-path>'

function namesForbiddenSurface(toolPath: string): boolean {
  const tokens = toolPath.toLowerCase().split(/[^a-z0-9]+/)
  return tokens.some(token =>
    (GO_LANE_FORBIDDEN_SURFACE_SEGMENTS as readonly string[]).includes(token),
  )
}

/**
 * Evaluate the registry policy for one claimed path, total over any input.
 *
 * The order is deliberate: a path outside the lane's namespace is a
 * `tool-path` violation, and only a `go.`-prefixed path can be a
 * `forbidden-surface` violation, so `solver.best_move` and `go.best_move`
 * report different reasons.
 */
export function goLanePathViolation(
  toolPath: unknown,
): GoLaneRegistryRejectionReason | undefined {
  if (typeof toolPath !== 'string') return 'invalid-tool-path'
  if (!GO_PRESET.toolPathPrefixes.some(prefix => toolPath.startsWith(prefix))) {
    return 'tool-path'
  }
  if (namesForbiddenSurface(toolPath)) return 'forbidden-surface'
  if (!(GO_PRESET.toolPaths as readonly string[]).includes(toolPath)) {
    return 'not-in-surface'
  }
  return undefined
}

export class GoLaneRegistryError extends Error {
  constructor(
    readonly toolPath: string,
    readonly reason: GoLaneRegistryRejectionReason,
  ) {
    super(`Go lane registry rejected ${toolPath}: ${reason}`)
    this.name = 'GoLaneRegistryError'
  }
}

export function admitGoLaneToolPath(toolPath: unknown): GoToolPath {
  const violation = goLanePathViolation(toolPath)
  if (violation !== undefined) {
    throw new GoLaneRegistryError(
      typeof toolPath === 'string' ? toolPath : INVALID_TOOL_PATH,
      violation,
    )
  }
  return toolPath as GoToolPath
}

/** Frozen Phase A registry declaration; registration itself belongs to C-T02. */
export type GoLaneRegistryDeclaration = {
  readonly id: typeof GO_LANE_REGISTRY_ID
  readonly lane: 'go'
  readonly specPhase: 'A'
  readonly registrationState: 'structure-only'
  readonly admittedPaths: readonly GoToolPath[]
  readonly registeredPaths: readonly GoToolPath[]
}

export const GO_LANE_REGISTRY: GoLaneRegistryDeclaration = Object.freeze({
  id: GO_LANE_REGISTRY_ID,
  lane: 'go',
  specPhase: 'A',
  registrationState: 'structure-only',
  admittedPaths: GO_PRESET.toolPaths,
  registeredPaths: Object.freeze([] as GoToolPath[]),
})
