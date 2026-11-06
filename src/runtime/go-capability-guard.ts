/**
 * Execution-time capability guard for the isolated Go lane (Spec §19/§21).
 *
 * Prompt hiding is not isolation, and registration is not authority. A
 * capability descriptor can only be minted by {@link nativeGoCapability}, whose
 * module-private provenance record — not the caller-supplied object — decides
 * the capability's kind, and whose tool path must be one of the exact eight
 * `go.*` paths of the Spec §20 Phase A surface. `go.exec` and every other
 * off-surface path are refused at mint time, so a general-execution capability
 * cannot be aliased into the Go scope under a `go.`-looking name.
 *
 * Enforcement is split along the two places a kind can actually appear:
 *
 * - registration sees the descriptor's *declared* kind and path, both
 *   untrusted claims. They are consulted only to deny: a forbidden or
 *   unclassified kind is refused by the frozen preset policy, a path outside
 *   the lane or outside the exact surface is refused, an unminted native claim
 *   is refused as forged, and either way the tool path is quarantined with the
 *   rejection reason;
 * - execution admits only minted descriptors and replays a quarantined path's
 *   recorded rejection. A forbidden capability therefore cannot acquire
 *   authority even if it was accidentally registered or aliased into the scope
 *   (Spec §19): its path fails at execution with the same reason that refused it.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  GO_PRESET,
  type GoNativeCapabilityKind,
  type GoToolPath,
} from '../preset/go-preset.js'

/** One capability descriptor bound into the Go lane execution scope. */
export type GoCapability = {
  readonly toolPath: GoToolPath
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

/** Placeholder path for a caller-supplied value that is not a string at all. */
const INVALID_TOOL_PATH = '<invalid-tool-path>'

/**
 * Mint the only admissible Go capability descriptor.
 *
 * This is the single place in the package where the native kind is written;
 * `register()` rejects every descriptor this function did not produce. The
 * tool path is not taken on trust either: it must be one of the exact
 * {@link GO_PRESET.toolPaths} entries, so a caller cannot manufacture
 * `go.exec` (or any other general-execution alias) merely by asking for it.
 */
export function nativeGoCapability(
  toolPath: string,
  run: (args?: unknown) => unknown,
): GoCapability {
  if (typeof toolPath !== 'string') {
    throw new ForbiddenGoCapabilityError(
      INVALID_TOOL_PATH,
      'model-native',
      'invalid-tool-path',
      GO_PRESET.id,
    )
  }
  const pathViolation = goToolPathViolation(toolPath) ?? goSurfaceViolation(toolPath)
  if (pathViolation !== undefined) {
    throw new ForbiddenGoCapabilityError(toolPath, 'model-native', pathViolation, GO_PRESET.id)
  }

  const capability: GoCapability = Object.freeze({
    toolPath: toolPath as GoToolPath,
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
 * Evaluate the frozen preset's coarse tool-path rule.
 *
 * The lane rule keeps the Go scope inside its own path space, so a stray
 * `fs.*`, `gonzo.*` or Phase B `companion.*` descriptor never gets as far as
 * the exact-surface check. The exact list is {@link goSurfaceViolation}.
 */
export function goToolPathViolation(toolPath: string): 'tool-path' | undefined {
  return GO_PRESET.toolPathPrefixes.some(prefix => toolPath.startsWith(prefix))
    ? undefined
    : 'tool-path'
}

/**
 * Evaluate the frozen preset's exact tool surface (Spec §20 Phase A).
 *
 * The prefix rule alone would admit `go.exec`; this is the rule that makes the
 * surface an allowlist rather than a namespace.
 */
export function goSurfaceViolation(toolPath: string): 'not-in-surface' | undefined {
  return (GO_PRESET.toolPaths as readonly string[]).includes(toolPath)
    ? undefined
    : 'not-in-surface'
}

/** Whether a value is one of the exact Spec §20 Phase A Go tool paths. */
export function isGoToolPath(toolPath: unknown): toolPath is GoToolPath {
  return typeof toolPath === 'string' && goSurfaceViolation(toolPath) === undefined
}

/** Why the Go execution authority refused one capability invocation. */
export type GoCapabilityRejectionReason =
  | 'unregistered'
  | 'forged-descriptor'
  | 'forbidden-kind'
  | 'unknown-kind'
  | 'tool-path'
  | 'not-in-surface'
  | 'invalid-tool-path'

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
      this.quarantine(toolPath ?? INVALID_TOOL_PATH, declaredKind, kindViolation)
      throw new ForbiddenGoCapabilityError(
        toolPath ?? INVALID_TOOL_PATH,
        declaredKind,
        kindViolation,
        GO_PRESET.id,
      )
    }

    if (toolPath === undefined) {
      this.quarantine(INVALID_TOOL_PATH, declaredKind, 'invalid-tool-path')
      throw new ForbiddenGoCapabilityError(
        INVALID_TOOL_PATH,
        declaredKind,
        'invalid-tool-path',
        GO_PRESET.id,
      )
    }

    // The declared path is untrusted too: `go.exec` is refused here even when
    // the descriptor is an ordinary hand-written object, and the refusal is
    // recorded so execution replays the same policy reason.
    const pathViolation = goToolPathViolation(toolPath) ?? goSurfaceViolation(toolPath)
    if (pathViolation !== undefined) {
      this.quarantine(toolPath, declaredKind, pathViolation)
      throw new ForbiddenGoCapabilityError(toolPath, declaredKind, pathViolation, GO_PRESET.id)
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
    if (typeof toolPath !== 'string') {
      throw new ForbiddenGoCapabilityError(
        INVALID_TOOL_PATH,
        '<none>',
        'invalid-tool-path',
        GO_PRESET.id,
      )
    }

    const capability = this.capabilities.get(toolPath)
    const quarantined = this.quarantined.get(toolPath)

    // The surface rule is re-evaluated at the execution boundary, so an
    // off-surface path such as `go.exec` is refused with a policy reason even
    // when nobody ever tried to register it. A path that was already refused
    // replays the reason recorded at registration time.
    const pathViolation = goToolPathViolation(toolPath) ?? goSurfaceViolation(toolPath)
    if (pathViolation !== undefined) {
      throw new ForbiddenGoCapabilityError(
        toolPath,
        quarantined?.declaredKind ?? '<unregistered>',
        quarantined?.reason ?? pathViolation,
        GO_PRESET.id,
      )
    }

    if (capability === undefined) {
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
 * The same provenance check for tool boundaries that invoke an already-bound
 * function directly, so authority never depends on one wrapper.
 *
 * A minted descriptor already passed the kind and exact-surface rules at mint
 * time — those rules are unreachable here because minting is the only way a
 * descriptor can exist — so this boundary re-asserts the one thing a caller can
 * still influence: that the descriptor really is a minted one.
 */
export function assertGoCapabilityAllowed(capability: GoCapability): void {
  if (!isNativeGoCapability(capability)) {
    const { toolPath, declaredKind } = describeDeclaredCapability(capability)
    throw new ForgedGoCapabilityError(toolPath ?? INVALID_TOOL_PATH, declaredKind)
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

/** Name of the Go capability scope composed into each Go agent's context. */
export const GO_CAPABILITY_SERVICE = 'goCapabilities' as const

/**
 * The Go execution seam one Go agent's scoped world exposes.
 *
 * Every Go tool boundary resolves this from its own agent context and calls
 * {@link GoCapabilityScope.execute}; no other path confers authority.
 */
export type GoCapabilityScope = {
  readonly presetId: typeof GO_PRESET.id
  readonly toolPaths: readonly GoToolPath[]
  execute(toolPath: string, args?: unknown): unknown
}

/** Bind one guard behind the agent-visible Go execution seam. */
export function createGoCapabilityScope(guard: GoCapabilityGuard): GoCapabilityScope {
  return Object.freeze({
    presetId: GO_PRESET.id,
    toolPaths: GO_PRESET.toolPaths,
    execute: (toolPath: string, args?: unknown): unknown => guard.execute(toolPath, args),
  })
}

/**
 * Compose the native-only Go scope into one Go agent's scoped world (Spec §19/§21).
 *
 * Passed as `CreateAgentOptions.setup` for the Go lane only, so the factory runs
 * it while the agent is still unpublished ({@link CreateAgentOptions.setup} in
 * `@deepseek-ai/dsh-agent`, which documents setup as the creation-time
 * composition of the agent's scoped world). The composition binds the single
 * execution guard into that world as {@link GO_CAPABILITY_SERVICE}: every Go
 * tool boundary in this agent resolves the scope and executes through
 * `GoCapabilityGuard.execute`, the only path that confers authority.
 *
 * The eight tool implementations themselves are C-T02's; this composes the
 * authority they run under. The pinned dependency surface exposes no tool
 * registration or tool-execution service, so a per-tool hook cannot be
 * composed here yet — the scope plus the guard is the boundary that exists.
 */
export function composeGoLaneScope(agentCtx: Context): void {
  agentCtx.provide(GO_CAPABILITY_SERVICE, createGoCapabilityScope(resolveGoCapabilityGuard()))
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

/** Diagnostic view of an untrusted value being registered. */
function describeDeclaredCapability(
  value: unknown,
): { toolPath: string | undefined; declaredKind: string } {
  if (typeof value !== 'object' || value === null) {
    return { toolPath: undefined, declaredKind: '<unknown>' }
  }
  const record = value as { readonly toolPath?: unknown; readonly kind?: unknown }
  return {
    toolPath: typeof record.toolPath === 'string' ? record.toolPath : undefined,
    declaredKind: typeof record.kind === 'string' ? record.kind : '<unknown>',
  }
}
