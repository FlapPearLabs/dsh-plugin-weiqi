/**
 * Spec §39.3 anti-cheat capability suite (Spec §21 "cannot see + cannot
 * execute", §40 Anti-Cheat "forbidden capabilities fail at execution
 * authority").
 *
 * Every attempt runs through the real `GoCapabilityGuard` and the real composed
 * Go scope; the guard is never mocked. Assertions pin the exact refusal class
 * and reason, so removing one guard layer turns the corresponding cases red
 * (mutation evidence in `handoffs/WAVE-C-T05.md`).
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GO_FORBIDDEN_CAPABILITY_KINDS,
  GO_PRESET,
  GO_PRESET_ID,
  type GoForbiddenCapabilityKind,
} from '../../src/preset/go-preset.js'
import {
  ForbiddenGoCapabilityError,
  ForgedGoCapabilityError,
  GO_CAPABILITY_SERVICE,
  GoCapabilityGuard,
  assertGoCapabilityAllowed,
  composeGoLaneScope,
  nativeGoCapability,
  resetGoCapabilityGuardForTest,
  resolveGoCapabilityGuard,
  type GoCapability,
  type GoCapabilityScope,
} from '../../src/runtime/go-capability-guard.js'

type ForbiddenAttempt = Readonly<{
  readonly capability: GoForbiddenCapabilityKind
  readonly label: string
  readonly toolPath: string
}>

/**
 * Tool paths are `go.`-looking aliases on purpose: the interesting case is a
 * forbidden capability wearing a Go-lane name, and `go.exec` is the alias the
 * C-T04 review proved must never mint.
 */
const FORBIDDEN_ATTEMPTS: readonly ForbiddenAttempt[] = [
  { capability: 'code-mode', label: 'Code Mode / run_code', toolPath: 'go.run_code' },
  { capability: 'bash', label: 'bash / shell execution', toolPath: 'go.bash' },
  { capability: 'python', label: 'Python execution', toolPath: 'go.python' },
  { capability: 'web', label: 'Web access', toolPath: 'go.web' },
  { capability: 'subagent', label: 'subagent delegation', toolPath: 'go.subagent' },
  { capability: 'generic-mcp', label: 'generic MCP tool', toolPath: 'go.mcp' },
  { capability: 'external-solver', label: 'external solver (KataGo)', toolPath: 'go.katago' },
  { capability: 'general-execution', label: 'general execution alias', toolPath: 'go.exec' },
]

const EXTERNAL_SOLVER_PATHS = ['go.katago', 'go.leela', 'go.mcts', 'go.gnu_go'] as const

const FOREIGN_ALIAS_PATHS = ['bash.run', 'fs.read', 'mcp.call', 'gonzo.state'] as const

type Rejection = Readonly<{
  readonly name: string
  readonly reason?: string
  readonly kind?: string
  readonly declaredKind?: string
  readonly toolPath?: string
  readonly presetId?: string
}>

/** An admitted attempt fails the test outright rather than being reported as a pass. */
function rejectionOf(attempt: () => unknown): Rejection {
  let admitted = false
  let caught: unknown
  try {
    attempt()
    admitted = true
  } catch (error) {
    caught = error
  }

  if (admitted) {
    throw new Error('anti-cheat: a forbidden capability attempt was admitted')
  }
  if (!(caught instanceof Error)) {
    throw new Error(`anti-cheat: attempt threw a non-Error value: ${String(caught)}`)
  }
  // A rejection only counts when it came from the guard's own refusal types:
  // a TypeError from broken guard code must fail the test, not pass as a denial.
  if (!(caught instanceof ForbiddenGoCapabilityError)
    && !(caught instanceof ForgedGoCapabilityError)) {
    throw new Error(`anti-cheat: attempt threw an unexpected error: ${caught.name}: ${caught.message}`)
  }

  const rejection = caught as Error & {
    readonly reason?: unknown
    readonly kind?: unknown
    readonly declaredKind?: unknown
    readonly toolPath?: unknown
    readonly presetId?: unknown
  }
  return {
    name: rejection.name,
    ...(typeof rejection.reason === 'string' ? { reason: rejection.reason } : {}),
    ...(typeof rejection.kind === 'string' ? { kind: rejection.kind } : {}),
    ...(typeof rejection.declaredKind === 'string'
      ? { declaredKind: rejection.declaredKind }
      : {}),
    ...(typeof rejection.toolPath === 'string' ? { toolPath: rejection.toolPath } : {}),
    ...(typeof rejection.presetId === 'string' ? { presetId: rejection.presetId } : {}),
  }
}

function makeSentinel(): { readonly calls: unknown[]; run: (args?: unknown) => string } {
  const calls: unknown[] = []
  return {
    calls,
    run: (args?: unknown) => {
      calls.push(args)
      return 'EXECUTED'
    },
  }
}

/** The same setup composition `src/index.ts` hands the Go lane's `agents.create`. */
function composedGoScope(): GoCapabilityScope {
  const agentCtx = new Context()
  composeGoLaneScope(agentCtx)
  const scope = agentCtx.get(GO_CAPABILITY_SERVICE) as GoCapabilityScope | undefined
  if (scope === undefined) {
    throw new Error('Go lane composition did not provide the goCapabilities scope')
  }
  return scope
}

afterEach(() => {
  resetGoCapabilityGuardForTest()
})

describe('Spec §39.3 attempt matrix covers the frozen forbidden realm', () => {
  it('has one attempt per forbidden capability kind the preset names', () => {
    const covered = new Set(FORBIDDEN_ATTEMPTS.map(attempt => attempt.capability))
    for (const kind of GO_FORBIDDEN_CAPABILITY_KINDS) {
      expect(covered.has(kind), `no §39.3 attempt covers ${kind}`).toBe(true)
    }
    expect(GO_PRESET.forbiddenCapabilities).toEqual([...GO_FORBIDDEN_CAPABILITY_KINDS])
    expect(covered.size).toBe(GO_FORBIDDEN_CAPABILITY_KINDS.length)
  })

  it('aims every attempt at a path outside the exact native surface', () => {
    for (const attempt of FORBIDDEN_ATTEMPTS) {
      expect(GO_PRESET.toolPaths as readonly string[]).not.toContain(attempt.toolPath)
    }
  })
})

describe('Spec §39.3 forbidden capabilities fail at the execution authority', () => {
  for (const attempt of FORBIDDEN_ATTEMPTS) {
    it(`${attempt.label} is refused at registration and at execution`, () => {
      const guard = new GoCapabilityGuard()
      const sentinel = makeSentinel()

      // 1. Registration is the first authority boundary: a descriptor that
      // declares a forbidden kind never enters the Go scope.
      const registration = rejectionOf(() =>
        guard.register({
          toolPath: attempt.toolPath,
          kind: attempt.capability,
          run: sentinel.run,
        }),
      )
      expect(registration).toEqual({
        name: 'ForbiddenGoCapabilityError',
        reason: 'forbidden-kind',
        kind: attempt.capability,
        toolPath: attempt.toolPath,
        presetId: GO_PRESET_ID,
      })

      // 2. Execution is the second boundary: the quarantined path replays the
      // same policy reason, deterministically, even after the failed attempt.
      const firstExecution = rejectionOf(() =>
        guard.execute(attempt.toolPath, { command: 'id' }),
      )
      const secondExecution = rejectionOf(() => guard.execute(attempt.toolPath))
      expect(firstExecution).toEqual(secondExecution)
      expect(firstExecution).toEqual({
        name: 'ForbiddenGoCapabilityError',
        reason: 'forbidden-kind',
        kind: attempt.capability,
        toolPath: attempt.toolPath,
        presetId: GO_PRESET_ID,
      })

      // 3. No capability code ran: the attempt is refused, not contained.
      expect(sentinel.calls).toEqual([])
    })
  }

  it('refuses every forbidden capability through the scope the Go agent receives', () => {
    const scope = composedGoScope()
    expect(scope.presetId).toBe(GO_PRESET_ID)
    expect(scope.toolPaths).toEqual(GO_PRESET.toolPaths)

    for (const attempt of FORBIDDEN_ATTEMPTS) {
      const sentinel = makeSentinel()

      const registration = rejectionOf(() =>
        resolveGoCapabilityGuard().register({
          toolPath: attempt.toolPath,
          kind: attempt.capability,
          run: sentinel.run,
        }),
      )
      expect(registration.reason).toBe('forbidden-kind')

      const first = rejectionOf(() => scope.execute(attempt.toolPath, { command: 'id' }))
      const second = rejectionOf(() => scope.execute(attempt.toolPath))
      expect(first).toEqual(second)
      expect(first.reason).toBe('forbidden-kind')
      expect(first.presetId).toBe(GO_PRESET_ID)
      expect(sentinel.calls).toEqual([])
    }
  })

  it('refuses a forbidden path at execution even when nobody tried to register it', () => {
    const scope = composedGoScope()

    for (const attempt of FORBIDDEN_ATTEMPTS) {
      const rejection = rejectionOf(() => scope.execute(attempt.toolPath, { command: 'id' }))
      expect(rejection).toEqual({
        name: 'ForbiddenGoCapabilityError',
        reason: 'not-in-surface',
        kind: '<unregistered>',
        toolPath: attempt.toolPath,
        presetId: GO_PRESET_ID,
      })
    }
  })
})

describe('Spec §39.3 external solver transports', () => {
  it('refuses KataGo, Leela, MCTS and GNU Go at mint, registration and execution', () => {
    const sentinel = makeSentinel()

    for (const toolPath of EXTERNAL_SOLVER_PATHS) {
      expect(rejectionOf(() => nativeGoCapability(toolPath, sentinel.run)).reason)
        .toBe('not-in-surface')

      const guard = new GoCapabilityGuard()
      expect(rejectionOf(() =>
        guard.register({ toolPath, kind: 'external-solver', run: sentinel.run }),
      ).reason).toBe('forbidden-kind')
      expect(rejectionOf(() => guard.execute(toolPath)).reason).toBe('forbidden-kind')
    }

    expect(sentinel.calls).toEqual([])
  })
})

describe('Spec §39.3 aliased and forged capability paths', () => {
  it('refuses go.exec at every entry point', () => {
    const sentinel = makeSentinel()
    const guard = new GoCapabilityGuard()
    const scope = composedGoScope()

    // 1. the minting factory
    expect(rejectionOf(() => nativeGoCapability('go.exec', sentinel.run))).toEqual({
      name: 'ForbiddenGoCapabilityError',
      reason: 'not-in-surface',
      kind: 'model-native',
      toolPath: 'go.exec',
      presetId: GO_PRESET_ID,
    })
    // 2. direct registration of a hand-written descriptor
    expect(rejectionOf(() =>
      guard.register({ toolPath: 'go.exec', kind: 'model-native', run: sentinel.run }),
    ).reason).toBe('not-in-surface')
    // 3. execution of the quarantined path
    expect(rejectionOf(() => guard.execute('go.exec')).reason).toBe('not-in-surface')
    // 4. the composed Go agent scope
    expect(rejectionOf(() => scope.execute('go.exec')).reason).toBe('not-in-surface')
    // 5. the direct tool-boundary assertion (no mint exists, so it is forged)
    expect(rejectionOf(() =>
      assertGoCapabilityAllowed({
        toolPath: 'go.exec',
        kind: 'model-native',
        run: sentinel.run,
      } as unknown as GoCapability),
    ).name).toBe('ForgedGoCapabilityError')

    expect(sentinel.calls).toEqual([])
  })

  it('refuses non-Go-lane aliases before provenance is even considered', () => {
    const sentinel = makeSentinel()

    for (const toolPath of FOREIGN_ALIAS_PATHS) {
      expect(rejectionOf(() => nativeGoCapability(toolPath, sentinel.run)).reason)
        .toBe('tool-path')

      const guard = new GoCapabilityGuard()
      expect(rejectionOf(() =>
        guard.register({ toolPath, kind: 'model-native', run: sentinel.run }),
      ).reason).toBe('tool-path')
      expect(rejectionOf(() => guard.execute(toolPath)).reason).toBe('tool-path')
    }

    expect(sentinel.calls).toEqual([])
  })

  it('refuses a forged kind: model-native descriptor for a real Go surface path', () => {
    const sentinel = makeSentinel()
    const forged = { toolPath: 'go.try_move', kind: 'model-native', run: sentinel.run }

    // 1. registration refuses the unminted descriptor and quarantines the path
    expect(rejectionOf(() => new GoCapabilityGuard().register(forged))).toEqual({
      name: 'ForgedGoCapabilityError',
      toolPath: 'go.try_move',
      declaredKind: 'model-native',
    })

    // 2. execution replays the forgery reason, deterministically
    const guard = new GoCapabilityGuard()
    rejectionOf(() => guard.register(forged))
    const first = rejectionOf(() => guard.execute('go.try_move', { point: 'D4' }))
    const second = rejectionOf(() => guard.execute('go.try_move'))
    expect(first).toEqual(second)
    expect(first).toEqual({
      name: 'ForbiddenGoCapabilityError',
      reason: 'forged-descriptor',
      kind: 'model-native',
      toolPath: 'go.try_move',
      presetId: GO_PRESET_ID,
    })

    // 3. the direct tool boundary refuses the same object
    expect(rejectionOf(() => assertGoCapabilityAllowed(forged as GoCapability)).name)
      .toBe('ForgedGoCapabilityError')

    // 4. the composed Go scope refuses it too
    const scope = composedGoScope()
    rejectionOf(() => resolveGoCapabilityGuard().register(forged))
    expect(rejectionOf(() => scope.execute('go.try_move', { point: 'D4' })).reason)
      .toBe('forged-descriptor')

    expect(sentinel.calls).toEqual([])
  })

  it('refuses a copy of a minted descriptor, so provenance cannot be cloned', () => {
    const minted = nativeGoCapability('go.pass', () => 'minted')
    const cloned = { ...minted }
    const sentinel = makeSentinel()
    const forged = { ...minted, run: sentinel.run }

    expect(rejectionOf(() => new GoCapabilityGuard().register(cloned)).name)
      .toBe('ForgedGoCapabilityError')
    expect(rejectionOf(() => new GoCapabilityGuard().register(forged)).name)
      .toBe('ForgedGoCapabilityError')
    expect(rejectionOf(() => assertGoCapabilityAllowed(cloned as GoCapability)).name)
      .toBe('ForgedGoCapabilityError')
    expect(sentinel.calls).toEqual([])
  })
})

describe('Spec §39.3 anti-vacuity control', () => {
  it('still admits the exact native surface, so refusals are policy not blanket failure', () => {
    const guard = new GoCapabilityGuard()

    for (const toolPath of GO_PRESET.toolPaths) {
      const sentinel = makeSentinel()
      guard.register(nativeGoCapability(toolPath, sentinel.run))
      expect(guard.execute(toolPath)).toBe('EXECUTED')
      expect(sentinel.calls).toHaveLength(1)
    }

    // The composed scope is the same authority, so a minted native tool runs
    // through it — proving the suite would notice an admitted capability.
    const scope = composedGoScope()
    const sentinel = makeSentinel()
    resolveGoCapabilityGuard().register(nativeGoCapability('go.state', sentinel.run))
    expect(scope.execute('go.state')).toBe('EXECUTED')
    expect(sentinel.calls).toHaveLength(1)
  })

  it('keeps the refusal class itself stable across repeated attempts', () => {
    const guard = new GoCapabilityGuard()
    const sentinel = makeSentinel()
    const attempt = (): unknown => guard.register({
      toolPath: 'go.bash',
      kind: 'bash',
      run: sentinel.run,
    })

    const first = rejectionOf(attempt)
    const second = rejectionOf(attempt)
    expect(first).toEqual(second)
    expect(first.name).toBe('ForbiddenGoCapabilityError')
    expect(sentinel.calls).toEqual([])
  })
})
