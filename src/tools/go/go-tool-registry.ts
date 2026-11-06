/**
 * Registration of the eight `go.*` tools into the single Go execution scope.
 *
 * Registration is the join point of the two authority rules this package
 * already owns: C-T01's registry policy decides which paths may exist at all,
 * and C-T04's guard decides what may execute. A definition is admitted by
 * `admitGoLaneToolPath`, minted by `nativeGoCapability` (the only writer of the
 * native kind) and registered into `GoCapabilityGuard`; execution later goes
 * through `guard.execute`, which re-evaluates policy on every call.
 *
 * The registered set is not asserted by hand: it is derived from the
 * definitions, then compared with the frozen Spec §20 Phase A surface. A
 * missing tool, an extra tool or a duplicate path refuses the whole
 * registration, so enumeration cannot drift from the Spec.
 */
import type { GoTurnEnforcement } from '../../budget/enforcement.js'
import type { GoRulesPort } from '../../contracts/rules.js'
import { GO_PRESET, type GoToolPath } from '../../preset/go-preset.js'
import {
  GoCapabilityGuard,
  nativeGoCapability,
  resolveGoCapabilityGuard,
  type GoCapability,
} from '../../runtime/go-capability-guard.js'
import { admitGoLaneToolPath } from '../go-lane-registry.js'
import { GoToolSurfaceError } from './errors.js'
import { GO_TOOL_DEFINITIONS, createGoToolRuntime } from './go-tools.js'
import type { GameNoticeSink, GoToolDefinition, GoToolRegistry, GoToolRuntime } from './types.js'

export { GoToolSurfaceError } from './errors.js'

export type GoToolRegistrationOptions = {
  readonly port: GoRulesPort
  readonly enforcement: GoTurnEnforcement
  readonly noticeSink?: GameNoticeSink
  readonly guard?: GoCapabilityGuard
}

/**
 * Assert that a tool set is exactly the eight admitted `go.*` paths.
 *
 * Total over any input: duplicates are reported before the set comparison, and
 * a set that gains or loses a path never reaches registration.
 */
export function assertExactGoToolSurface(paths: readonly string[]): readonly GoToolPath[] {
  const seen = new Set<string>()
  for (const toolPath of paths) {
    if (seen.has(toolPath)) {
      throw new GoToolSurfaceError({
        reason: 'duplicate-path',
        toolPath,
        missing: [],
        extra: [],
      })
    }
    seen.add(toolPath)
  }

  const admitted = GO_PRESET.toolPaths as readonly string[]
  const missing = admitted.filter(toolPath => !seen.has(toolPath))
  const extra = [...seen].filter(toolPath => !admitted.includes(toolPath))
  if (missing.length > 0 || extra.length > 0) {
    throw new GoToolSurfaceError({ reason: 'surface-mismatch', missing, extra })
  }

  return [...paths] as readonly GoToolPath[]
}

/**
 * Admit one definition through the registry policy and mint its capability.
 *
 * A path outside the Phase A surface (`companion.*`, `go.best_move`,
 * `go.exec`, …) is refused here with the C-T01 reason, before the guard is
 * asked to hold it.
 */
export function registerGoToolDefinition(
  definition: GoToolDefinition,
  runtime: GoToolRuntime,
  guard: GoCapabilityGuard,
): GoCapability {
  const toolPath = admitGoLaneToolPath(definition.name)
  const capability = nativeGoCapability(toolPath, (args?: unknown) =>
    definition.run(args, runtime),
  )
  guard.register(capability)
  return capability
}

/**
 * Register the eight tools of one Go turn and return the executable registry.
 *
 * Pass `guard` to keep a test or a scoped composition isolated; production
 * composition resolves the single process scope.
 */
export function registerGoTools(options: GoToolRegistrationOptions): GoToolRegistry {
  const runtime = createGoToolRuntime({
    port: options.port,
    enforcement: options.enforcement,
    ...(options.noticeSink === undefined ? {} : { noticeSink: options.noticeSink }),
  })
  const guard = options.guard ?? resolveGoCapabilityGuard()

  const registered: GoToolPath[] = []
  for (const definition of GO_TOOL_DEFINITIONS) {
    registerGoToolDefinition(definition, runtime, guard)
    registered.push(definition.name)
  }

  const registeredPaths = Object.freeze(assertExactGoToolSurface(registered))

  return Object.freeze({
    registeredPaths,
    invoke(toolPath: string, args?: unknown): unknown {
      return guard.execute(toolPath, args)
    },
  })
}
