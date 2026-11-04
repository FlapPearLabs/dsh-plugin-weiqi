/**
 * Execution-time capability guard for the isolated Go lane (Spec §21).
 *
 * Prompt hiding is not isolation. Registration is not authority: a capability
 * can be registered into the Go scope — including a forbidden or aliased one —
 * and every `execute` call still re-reads the frozen preset policy and throws
 * before the capability runs. Unknown kinds fail closed.
 */
import {
  GO_PRESET,
  type GoPresetDeclaration,
} from '../preset/go-preset.js'

/** One capability bound into the Go lane execution scope. */
export type GoCapability = {
  readonly toolPath: string
  readonly kind: string
  readonly run: (args?: unknown) => unknown
}

/** Why the Go execution authority refused one capability invocation. */
export type GoCapabilityRejectionReason =
  | 'unregistered'
  | 'forbidden-kind'
  | 'unknown-kind'
  | 'tool-path'

/** Deterministic refusal raised before a capability's own code can run. */
export class ForbiddenGoCapabilityError extends Error {
  constructor(
    readonly toolPath: string,
    readonly kind: string,
    readonly reason: GoCapabilityRejectionReason,
    readonly presetId: string,
  ) {
    super(`Go preset ${presetId} rejected ${toolPath} (${kind}): ${reason}`)
    this.name = 'ForbiddenGoCapabilityError'
  }
}

/**
 * The Go lane's execution authority.
 *
 * `register` records what the scope contains; `execute` is the only path that
 * confers authority, and it re-evaluates the preset on every invocation.
 */
export class GoCapabilityGuard {
  private readonly capabilities = new Map<string, GoCapability>()

  constructor(private readonly preset: GoPresetDeclaration = GO_PRESET) {}

  /** Record a capability without granting it execution authority. */
  register(capability: GoCapability): void {
    this.capabilities.set(capability.toolPath, capability)
  }

  /** Run one registered capability only when the preset admits it right now. */
  execute(toolPath: string, args?: unknown): unknown {
    const capability = this.capabilities.get(toolPath)
    if (capability === undefined) {
      throw new ForbiddenGoCapabilityError(
        toolPath,
        '<unregistered>',
        'unregistered',
        this.preset.id,
      )
    }
    assertGoCapabilityAllowed(capability, this.preset)
    return capability.run(args)
  }
}

/**
 * The same execution-time policy check for tool boundaries that invoke an
 * already-bound function directly, so authority never depends on one wrapper.
 */
export function assertGoCapabilityAllowed(
  capability: Pick<GoCapability, 'toolPath' | 'kind'>,
  preset: GoPresetDeclaration = GO_PRESET,
): void {
  const { toolPath, kind } = capability

  if ((preset.forbiddenCapabilities as readonly string[]).includes(kind)) {
    throw new ForbiddenGoCapabilityError(toolPath, kind, 'forbidden-kind', preset.id)
  }
  if (!(preset.capabilityKinds as readonly string[]).includes(kind)) {
    throw new ForbiddenGoCapabilityError(toolPath, kind, 'unknown-kind', preset.id)
  }
  if (!preset.toolPathPrefixes.some(prefix => toolPath.startsWith(prefix))) {
    throw new ForbiddenGoCapabilityError(toolPath, kind, 'tool-path', preset.id)
  }
}
