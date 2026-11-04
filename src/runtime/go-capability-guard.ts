/**
 * Execution-time capability guard for the isolated Go lane (Spec §19/§21).
 *
 * Prompt hiding is not isolation, and registration is not authority. A
 * capability descriptor can only be minted by {@link nativeGoCapability}, whose
 * module-private provenance record — not the caller-supplied object — decides
 * the capability's kind. A caller that forges `kind: 'model-native'` is
 * rejected at registration and permanently denied at execution.
 *
 * Enforcement is split along the two places a kind can actually appear:
 *
 * - registration sees the descriptor's *declared* kind, an untrusted claim.
 *   It is consulted only to deny: a forbidden or unclassified kind is refused
 *   by the frozen preset policy, an unminted native claim is refused as forged,
 *   and either way the tool path is quarantined with the rejection reason;
 * - execution admits only minted descriptors, re-checks the preset's tool-path
 *   rule, and replays a quarantined path's recorded rejection. A forbidden
 *   capability therefore cannot acquire authority even if it was accidentally
 *   registered or aliased into the scope (Spec §19): its path fails at
 *   execution with the same reason that refused it.
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

/**
 * Evaluate the frozen preset's capability-kind rule for one claimed kind.
 *
 * This is the single definition of which kinds the Go realm admits. It is pure
 * and total, so tests exercise every branch directly, and `register()` calls it
 * on the real admission path with the descriptor's declared kind — a claim that
 * can only deny, never grant.
 */
export function goCapabilityKindViolation(
  kind: string,
): 'forbidden-kind' | 'unknown-kind' | undefined {
  if ((GO_PRESET.forbiddenCapabilities as readonly string[]).includes(kind)) {
    return 'forbidden-kind'
  }
  if (!(GO_PRESET.capabilityKinds as readonly string[]).includes(kind)) {
    return 'unknown-kind'
  }
  return undefined
}

/**
 * Evaluate the frozen preset's tool-path rule.
 *
 * This is a coarse prefix check on purpose: the fine-grained 8 + 2 tool
 * allowlist is the C-T01 registry. Admission here only keeps the Go scope
 * inside the lane's own path space, so a stray `fs.*` or `gonzo.*` descriptor
 * can never execute even when it was minted.
 */
export function goToolPathViolation(toolPath: string): 'tool-path' | undefined {
  return GO_PRESET.toolPathPrefixes.some(prefix => toolPath.startsWith(prefix))
    ? undefined
    : 'tool-path'
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
  private readonly quarantined = new Map<
    string,
    { readonly declaredKind: string; readonly reason: GoCapabilityRejectionReason }
  >()

  constructor(preset: unknown = GO_PRESET) {
    if (preset !== GO_PRESET) {
      throw new Error(
        'GoCapabilityGuard: the Go realm is fixed by the frozen GO_PRESET; '
        + 'a caller-supplied preset is not accepted',
      )
    }
  }

  /** Record a minted capability; reject every forbidden, unknown or forged descriptor. */
  register(capability: unknown): void {
    const { toolPath, declaredKind } = describeDeclaredCapability(capability)

    // The declared kind is untrusted input: reading it can only deny, never
    // admit. A descriptor naming a forbidden or unclassified capability is
    // refused by the frozen preset policy before provenance is considered, so
    // the refusal carries the policy reason instead of a generic forgery.
    const kindViolation = goCapabilityKindViolation(declaredKind)
    if (kindViolation !== undefined) {
      this.quarantine(toolPath, declaredKind, kindViolation)
      throw new ForbiddenGoCapabilityError(toolPath, declaredKind, kindViolation, GO_PRESET.id)
    }

    if (!isNativeGoCapability(capability)) {
      this.quarantine(toolPath, declaredKind, 'forged-descriptor')
      throw new ForgedGoCapabilityError(toolPath, declaredKind)
    }

    this.capabilities.set(capability.toolPath, capability)
    this.quarantined.delete(capability.toolPath)
  }

  /** Run one registered capability only when the frozen preset admits it right now. */
  execute(toolPath: string, args?: unknown): unknown {
    const capability = this.capabilities.get(toolPath)
    if (capability === undefined) {
      const quarantined = this.quarantined.get(toolPath)
      if (quarantined !== undefined) {
        throw new ForbiddenGoCapabilityError(
          toolPath,
          quarantined.declaredKind,
          quarantined.reason,
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

  /** Drop every registration and quarantine record. Test seam; not for production wiring. */
  clearForTest(): void {
    this.capabilities.clear()
    this.quarantined.clear()
  }

  private quarantine(
    toolPath: string,
    declaredKind: string,
    reason: GoCapabilityRejectionReason,
  ): void {
    this.quarantined.set(toolPath, { declaredKind, reason })
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

  // A minted kind is native by construction, so the kind rule is enforced where
  // a kind can actually be claimed (register) and is not restated here as an
  // unreachable branch. What execution still enforces is the tool-path rule,
  // which a minted descriptor can genuinely violate (e.g. `fs.read`).
  const pathViolation = goToolPathViolation(toolPath)
  if (pathViolation !== undefined) {
    throw new ForbiddenGoCapabilityError(toolPath, kind, pathViolation, GO_PRESET.id)
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

/**
 * Hand the shared Go scope back empty.
 *
 * The singleton lives for the whole process, so a suite that registers into it
 * would otherwise leak a capability into every later suite (review r2 P2).
 */
export function resetGoCapabilityGuardForTest(): void {
  goCapabilityGuard.clearForTest()
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
