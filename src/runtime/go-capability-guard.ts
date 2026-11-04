/**
 * Execution-time capability guard for the isolated Go lane (Spec §19/§21).
 *
 * Prompt hiding is not isolation, and registration is not authority. A
 * capability descriptor can only be minted by {@link nativeGoCapability}, whose
 * module-private provenance record — not the caller-supplied object — decides
 * the capability's kind. A caller that forges `kind: 'model-native'` is
 * rejected at registration and permanently denied at execution.
 *
 * Every `execute` call re-evaluates the frozen preset policy and throws before
 * the capability runs, so an aliased or accidentally registered capability can
 * never acquire authority.
 */
import {
  GO_PRESET,
  type GoNativeCapabilityKind,
} from '../preset/go-preset.js'

/** One capability descriptor bound into the Go lane execution scope. */
export type GoCapability = {
  readonly toolPath: string
  readonly kind: GoNativeCapabilityKind
  readonly run: (args?: unknown) => unknown
}

/**
 * Module-private provenance for minted descriptors.
 *
 * The guard reads the kind from this record, never from the descriptor object,
 * so a plain object that copies `kind: 'model-native'` carries no authority.
 */
const NATIVE_PROVENANCE = new WeakMap<object, GoNativeCapabilityKind>()

/**
 * Mint the only admissible Go capability descriptor.
 *
 * This is the single place in the package where the native kind is written;
 * `register()` rejects every descriptor this function did not produce.
 */
export function nativeGoCapability(
  toolPath: string,
  run: (args?: unknown) => unknown,
): GoCapability {
  const capability: GoCapability = Object.freeze({
    toolPath,
    kind: 'model-native',
    run,
  })
  NATIVE_PROVENANCE.set(capability, capability.kind)
  return capability
}

/** Whether a value is a descriptor minted by {@link nativeGoCapability}. */
export function isNativeGoCapability(value: unknown): value is GoCapability {
  return typeof value === 'object' && value !== null && NATIVE_PROVENANCE.has(value)
}

/** Why the Go execution authority refused one capability invocation. */
export type GoCapabilityRejectionReason =
  | 'unregistered'
  | 'forged-descriptor'
  | 'forbidden-kind'
  | 'unknown-kind'
  | 'tool-path'

/** Raised when a caller tries to register a descriptor this module did not mint. */
export class ForgedGoCapabilityError extends Error {
  constructor(
    readonly toolPath: string,
    readonly declaredKind: string,
  ) {
    super(
      `Go lane rejected an unminted capability descriptor for ${toolPath} `
      + `(declared kind ${declaredKind}); only nativeGoCapability() may mint one`,
    )
    this.name = 'ForgedGoCapabilityError'
  }
}

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
 * confers authority, and it re-evaluates the frozen preset on every invocation.
 *
 * The realm is fixed by {@link GO_PRESET}: the constructor accepts the frozen
 * preset itself (so a caller may pass it explicitly) and rejects any other
 * value, including a widened copy (adversarial review r1 P2-1).
 */
export class GoCapabilityGuard {
  private readonly capabilities = new Map<string, GoCapability>()
  /** Paths whose registration was rejected; denied until a minted descriptor replaces them. */
  private readonly forgedPaths = new Map<string, string>()

  constructor(preset: unknown = GO_PRESET) {
    if (preset !== GO_PRESET) {
      throw new Error(
        'GoCapabilityGuard: the Go realm is fixed by the frozen GO_PRESET; '
        + 'a caller-supplied preset is not accepted',
      )
    }
  }

  /** Record a minted capability; reject every forged or aliased descriptor. */
  register(capability: unknown): void {
    if (!isNativeGoCapability(capability)) {
      const { toolPath, declaredKind } = describeDeclaredCapability(capability)
      this.forgedPaths.set(toolPath, declaredKind)
      throw new ForgedGoCapabilityError(toolPath, declaredKind)
    }
    this.capabilities.set(capability.toolPath, capability)
    this.forgedPaths.delete(capability.toolPath)
  }

  /** Run one registered capability only when the frozen preset admits it right now. */
  execute(toolPath: string, args?: unknown): unknown {
    const capability = this.capabilities.get(toolPath)
    if (capability === undefined) {
      const forgedKind = this.forgedPaths.get(toolPath)
      if (forgedKind !== undefined) {
        throw new ForbiddenGoCapabilityError(
          toolPath,
          forgedKind,
          'forged-descriptor',
          GO_PRESET.id,
        )
      }
      throw new ForbiddenGoCapabilityError(
        toolPath,
        '<unregistered>',
        'unregistered',
        GO_PRESET.id,
      )
    }
    assertGoCapabilityAllowed(capability)
    return capability.run(args)
  }
}

/**
 * The same provenance and policy check for tool boundaries that invoke an
 * already-bound function directly, so authority never depends on one wrapper.
 */
export function assertGoCapabilityAllowed(capability: GoCapability): void {
  if (!isNativeGoCapability(capability)) {
    const { toolPath, declaredKind } = describeDeclaredCapability(capability)
    throw new ForgedGoCapabilityError(toolPath, declaredKind)
  }

  const { toolPath } = capability
  const kind = mintedKindOf(capability)

  // The frozen policy gate stays in front of every execution. Minted
  // capabilities are native by construction, so these two branches only fire
  // if the provenance record ever admits another kind.
  if ((GO_PRESET.forbiddenCapabilities as readonly string[]).includes(kind)) {
    throw new ForbiddenGoCapabilityError(toolPath, kind, 'forbidden-kind', GO_PRESET.id)
  }
  if (!(GO_PRESET.capabilityKinds as readonly string[]).includes(kind)) {
    throw new ForbiddenGoCapabilityError(toolPath, kind, 'unknown-kind', GO_PRESET.id)
  }
  if (!GO_PRESET.toolPathPrefixes.some(prefix => toolPath.startsWith(prefix))) {
    throw new ForbiddenGoCapabilityError(toolPath, kind, 'tool-path', GO_PRESET.id)
  }
}

/**
 * The one Go execution scope this package owns.
 *
 * Composition points resolve this instead of constructing a second guard, so
 * "registered into the Go scope" cannot split across instances (review P2-2).
 * Constructing a standalone guard stays available for isolated tests only.
 */
export const goCapabilityGuard = new GoCapabilityGuard()

/** Resolve the single Go scope: the supported composition-root accessor. */
export function resolveGoCapabilityGuard(): GoCapabilityGuard {
  return goCapabilityGuard
}

/** Read the kind from the module-private record; never from the caller object. */
function mintedKindOf(capability: GoCapability): GoNativeCapabilityKind {
  const kind = NATIVE_PROVENANCE.get(capability)
  if (kind === undefined) {
    throw new ForgedGoCapabilityError(capability.toolPath, capability.kind)
  }
  return kind
}

/** Diagnostic view of an untrusted value being registered. */
function describeDeclaredCapability(
  value: unknown,
): { toolPath: string; declaredKind: string } {
  if (typeof value !== 'object' || value === null) {
    return { toolPath: '<unknown>', declaredKind: '<unknown>' }
  }
  const record = value as { readonly toolPath?: unknown; readonly kind?: unknown }
  return {
    toolPath: typeof record.toolPath === 'string' ? record.toolPath : '<unknown>',
    declaredKind: typeof record.kind === 'string' ? record.kind : '<unknown>',
  }
}
