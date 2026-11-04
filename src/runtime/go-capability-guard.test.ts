import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GO_FORBIDDEN_CAPABILITY_KINDS,
  GO_PRESET,
  GO_PRESET_ID,
} from '../preset/go-preset.js'
import * as presetModule from '../preset/go-preset.js'
import {
  ForbiddenGoCapabilityError,
  ForgedGoCapabilityError,
  GoCapabilityGuard,
  assertGoCapabilityAllowed,
  goCapabilityGuard,
  isNativeGoCapability,
  nativeGoCapability,
  resolveGoCapabilityGuard,
  type GoCapability,
} from './go-capability-guard.js'
import * as guardModule from './go-capability-guard.js'
import * as runtimeBarrel from './index.js'

/**
 * Read a binding a module namespace may not export yet, so a missing export
 * fails as an assertion instead of aborting the whole file at link time.
 */
function exportedFrom<T>(moduleNamespace: object, name: string): T | undefined {
  return (moduleNamespace as Record<string, unknown>)[name] as T | undefined
}

describe('Go preset declaration', () => {
  it('declares a native-only capability realm for the Go lane', () => {
    expect(GO_PRESET.id).toBe(GO_PRESET_ID)
    expect(GO_PRESET.lane).toBe('go')
    expect(GO_PRESET.presentation).toBe('native-only')
    expect(GO_PRESET.capabilityKinds).toEqual(['model-native'])
    // Phase A admits `go.*` only; Phase B adds the two `companion.*` paths.
    expect(GO_PRESET.toolPathPrefixes).toEqual(['go.'])
  })

  it('pins the exact Spec §20 Phase A tool surface', () => {
    const toolPaths = exportedFrom<readonly string[]>(presetModule, 'GO_TOOL_PATHS')
    expect(toolPaths, 'go-preset must declare GO_TOOL_PATHS').toEqual([
      'go.state',
      'go.inspect_group',
      'go.inspect_region',
      'go.try_move',
      'go.play',
      'go.pass',
      'go.resign',
      'go.request_deep_think',
    ])
    expect(exportedFrom<readonly string[]>(GO_PRESET, 'toolPaths')).toEqual(toolPaths)
    expect(Object.isFrozen(exportedFrom<readonly string[]>(GO_PRESET, 'toolPaths'))).toBe(true)
  })

  it('names every forbidden general-execution capability explicitly', () => {
    expect(GO_PRESET.forbiddenCapabilities).toEqual([
      'code-mode',
      'bash',
      'python',
      'web',
      'subagent',
      'generic-mcp',
      'external-solver',
      'general-execution',
    ])
    expect(GO_PRESET.forbiddenCapabilities).toEqual([...GO_FORBIDDEN_CAPABILITY_KINDS])
  })

  it('is frozen so runtime code cannot widen the realm', () => {
    expect(Object.isFrozen(GO_PRESET)).toBe(true)
    expect(Object.isFrozen(GO_PRESET.capabilityKinds)).toBe(true)
    expect(Object.isFrozen(GO_PRESET.toolPathPrefixes)).toBe(true)
    expect(Object.isFrozen(GO_PRESET.forbiddenCapabilities)).toBe(true)
  })
})

describe('Go execution-time capability guard', () => {
  it('executes a registered native Go tool', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn((args?: unknown) => ({ echoed: args }))
    guard.register(nativeGoCapability('go.state', run))

    expect(guard.execute('go.state', { board: true })).toEqual({ echoed: { board: true } })
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith({ board: true })
  })

  it('refuses a forbidden capability at registration and replays that refusal at execution', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'shell output')

    // Registration is the first refusal: a capability declaring a forbidden
    // kind never enters the scope. The execution check below is the second
    // line of defence for a path that was quarantined on the way in.
    try {
      guard.register({ toolPath: 'go.shell', kind: 'bash', run })
      expect.fail('a forbidden capability kind must not register')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenGoCapabilityError)
      expect((error as ForbiddenGoCapabilityError).reason).toBe('forbidden-kind')
    }

    expect(() => guard.execute('go.shell', { command: 'ls' }))
      .toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()

    try {
      guard.execute('go.shell')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenGoCapabilityError)
      const rejection = error as ForbiddenGoCapabilityError
      expect(rejection.reason).toBe('forbidden-kind')
      expect(rejection.toolPath).toBe('go.shell')
      expect(rejection.kind).toBe('bash')
      expect(rejection.presetId).toBe(GO_PRESET_ID)
    }
  })

  it('refuses an aliased forbidden capability declared under a Go-looking path', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'hidden execution')

    expect(() => guard.register({
      toolPath: 'go.helpers.run',
      kind: 'general-execution',
      run,
    })).toThrow(ForbiddenGoCapabilityError)

    expect(() => guard.execute('go.helpers.run')).toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()
  })

  it('fails closed for every forbidden capability kind, even when a registration was attempted', () => {
    for (const kind of GO_FORBIDDEN_CAPABILITY_KINDS) {
      const guard = new GoCapabilityGuard()
      const run = vi.fn(() => kind)
      const toolPath = `go.alias.${kind}`

      expect(() => guard.register({ toolPath, kind, run })).toThrow(ForbiddenGoCapabilityError)
      expect(() => guard.execute(toolPath)).toThrow(ForbiddenGoCapabilityError)
      expect(run).not.toHaveBeenCalled()

      try {
        guard.execute(toolPath)
      } catch (error) {
        const rejection = error as ForbiddenGoCapabilityError
        expect(rejection.reason).toBe('forbidden-kind')
        expect(rejection.kind).toBe(kind)
      }
    }
  })

  it('fails closed for an unclassified capability kind instead of allowing it', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'unclassified')

    try {
      guard.register({ toolPath: 'go.mystery', kind: 'some-new-transport', run })
      expect.fail('an unclassified capability kind must not register')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenGoCapabilityError)
      expect((error as ForbiddenGoCapabilityError).reason).toBe('unknown-kind')
    }

    expect(() => guard.execute('go.mystery')).toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()

    try {
      guard.execute('go.mystery')
    } catch (error) {
      expect((error as ForbiddenGoCapabilityError).reason).toBe('unknown-kind')
    }
  })

  it('refuses to mint a capability outside the exact Go tool surface', () => {
    const run = vi.fn(() => 'filesystem')

    for (const toolPath of ['fs.read', 'go.arbitrary', 'companion.handoff']) {
      try {
        nativeGoCapability(toolPath, run)
        expect.fail(`minting ${toolPath} must be refused`)
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenGoCapabilityError)
        expect((error as ForbiddenGoCapabilityError).reason).toBe('not-in-surface')
      }
    }

    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an unregistered tool path instead of executing it', () => {
    const guard = new GoCapabilityGuard()
    expect(() => guard.execute('go.unknown')).toThrow(ForbiddenGoCapabilityError)
  })

  it('keeps a quarantined path denied until a minted descriptor replaces it', () => {
    const guard = new GoCapabilityGuard()
    const forgedRun = vi.fn(() => 'forged')

    expect(() => guard.register({
      toolPath: 'go.state',
      kind: 'model-native',
      run: forgedRun,
    })).toThrow(ForgedGoCapabilityError)
    expect(() => guard.execute('go.state')).toThrow(ForbiddenGoCapabilityError)

    const mintedRun = vi.fn(() => 'minted')
    guard.register(nativeGoCapability('go.state', mintedRun))

    expect(guard.execute('go.state')).toBe('minted')
    expect(forgedRun).not.toHaveBeenCalled()
  })

  it('exposes the same provenance and policy check for direct tool boundaries', () => {
    expect(() => assertGoCapabilityAllowed(
      nativeGoCapability('go.play', () => 'played'),
    )).not.toThrow()
    expect(() => assertGoCapabilityAllowed(
      nativeGoCapability('fs.read', () => 'filesystem'),
    )).toThrow(ForbiddenGoCapabilityError)
    expect(() => assertGoCapabilityAllowed({
      toolPath: 'go.play',
      kind: 'model-native',
      run: () => 'played',
    } as unknown as GoCapability)).toThrow(ForgedGoCapabilityError)
  })
})

describe('Unforgeable native capability provenance', () => {
  it('rejects a capability that self-reports kind: model-native without module minting', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'shell output')
    const forged: GoCapability = { toolPath: 'go.helpers.run', kind: 'model-native', run }

    expect(() => guard.register(forged)).toThrow(ForgedGoCapabilityError)
    expect(run).not.toHaveBeenCalled()
  })

  it('still denies execution after a forged alias is refused at registration', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'shell output')
    const forged: GoCapability = { toolPath: 'go.helpers.run', kind: 'model-native', run }

    try {
      guard.register(forged)
    } catch {
      // Rejected at registration on purpose: the scope must still deny the path.
    }

    expect(() => guard.execute('go.helpers.run', { command: 'ls' }))
      .toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()
  })

  it('recognizes only descriptors minted by the module factory', () => {
    const minted = nativeGoCapability('go.state', () => 'minted')
    expect(isNativeGoCapability(minted)).toBe(true)
    expect(isNativeGoCapability({
      toolPath: 'go.state',
      kind: 'model-native',
      run: () => 'minted',
    })).toBe(false)
    expect(isNativeGoCapability(undefined)).toBe(false)
  })

  it('keeps the minted kind outside caller control', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'ran')
    const minted = nativeGoCapability('go.pass', run)

    expect(Object.isFrozen(minted)).toBe(true)
    expect(() => {
      (minted as { kind: string }).kind = 'python'
    }).toThrow(TypeError)

    guard.register(minted)
    expect(guard.execute('go.pass')).toBe('ran')
  })
})

describe('Go preset authority is not caller-supplied', () => {
  it('refuses a caller-supplied preset that widens the realm', () => {
    const widened = {
      ...GO_PRESET,
      capabilityKinds: [...GO_PRESET.capabilityKinds, 'bash'],
      forbiddenCapabilities: [],
    }
    const ConfigurableGuard = GoCapabilityGuard as unknown as new (
      preset: unknown,
    ) => GoCapabilityGuard

    expect(() => new ConfigurableGuard(widened)).toThrow()
  })

  it('accepts the frozen preset as the only configuration', () => {
    expect(() => new GoCapabilityGuard(GO_PRESET)).not.toThrow()
  })
})

describe('Single shared Go scope', () => {
  // The scope is process-wide: every case must hand it back clean so later
  // files (C-T02, C-T05) never inherit a registration from this one.
  afterEach(() => {
    exportedFrom<() => void>(guardModule, 'resetGoCapabilityGuardForTest')?.()
  })

  it('resolves one guard for every consumer', () => {
    expect(resolveGoCapabilityGuard()).toBe(goCapabilityGuard)
    expect(resolveGoCapabilityGuard()).toBe(resolveGoCapabilityGuard())

    const consumerA = resolveGoCapabilityGuard()
    const consumerB = resolveGoCapabilityGuard()
    consumerA.register(nativeGoCapability('go.try_move', () => 'shared'))

    expect(consumerB.execute('go.try_move')).toBe('shared')
  })

  it('can be reset for tests so one suite never leaks into the next', () => {
    const reset = exportedFrom<() => void>(guardModule, 'resetGoCapabilityGuardForTest')
    expect(typeof reset, 'go-capability-guard must expose resetGoCapabilityGuardForTest')
      .toBe('function')

    goCapabilityGuard.register(nativeGoCapability('go.inspect_region', () => 'shared'))
    expect(goCapabilityGuard.execute('go.inspect_region')).toBe('shared')

    reset?.()

    expect(() => resolveGoCapabilityGuard().execute('go.inspect_region'))
      .toThrow(ForbiddenGoCapabilityError)
    try {
      goCapabilityGuard.execute('go.inspect_region')
    } catch (error) {
      expect((error as ForbiddenGoCapabilityError).reason).toBe('unregistered')
    }
  })
})

describe('Go preset policy evaluation', () => {
  it('rejects forbidden and unclassified capability kinds', () => {
    const kindViolation = exportedFrom<(kind: string) => string | undefined>(
      guardModule,
      'goCapabilityKindViolation',
    )
    expect(typeof kindViolation, 'go-capability-guard must expose goCapabilityKindViolation')
      .toBe('function')

    expect(kindViolation?.('model-native')).toBeUndefined()
    for (const kind of GO_FORBIDDEN_CAPABILITY_KINDS) {
      expect(kindViolation?.(kind)).toBe('forbidden-kind')
    }
    expect(kindViolation?.('some-new-transport')).toBe('unknown-kind')
  })

  it('rejects tool paths outside the Go lane prefixes', () => {
    const pathViolation = exportedFrom<(toolPath: string) => string | undefined>(
      guardModule,
      'goToolPathViolation',
    )
    expect(typeof pathViolation, 'go-capability-guard must expose goToolPathViolation')
      .toBe('function')

    for (const toolPath of exportedFrom<readonly string[]>(GO_PRESET, 'toolPaths') ?? []) {
      expect(pathViolation?.(toolPath)).toBeUndefined()
    }
    expect(pathViolation?.('companion.handoff')).toBe('tool-path')
    expect(pathViolation?.('fs.read')).toBe('tool-path')
    expect(pathViolation?.('gonzo.state')).toBe('tool-path')
  })
})

describe('Exact Spec §20 tool surface', () => {
  it('refuses a non-string tool path with a deterministic reason', () => {
    const mint = exportedFrom<(toolPath: unknown, run: () => unknown) => GoCapability>(
      guardModule,
      'nativeGoCapability',
    )

    for (const value of [undefined, 42, { path: 'go.state' }, null]) {
      try {
        mint?.(value, () => 'nope')
        expect.fail('a non-string tool path must be refused')
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenGoCapabilityError)
        expect((error as ForbiddenGoCapabilityError).reason).toBe('invalid-tool-path')
      }
    }

    const guard = new GoCapabilityGuard()
    expect(() => guard.execute(undefined as unknown as string)).toThrow(ForbiddenGoCapabilityError)
  })

  it('quarantines a declared path outside the exact surface at registration', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'pwned-through-go-scope')

    try {
      guard.register({ toolPath: 'go.exec', kind: 'model-native', run })
      expect.fail('go.exec must never register')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenGoCapabilityError)
      expect((error as ForbiddenGoCapabilityError).reason).toBe('not-in-surface')
    }

    try {
      guard.execute('go.exec')
      expect.fail('go.exec must never execute')
    } catch (error) {
      expect((error as ForbiddenGoCapabilityError).reason).toBe('not-in-surface')
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('cannot run go.exec through any public entry point', () => {
    const run = vi.fn(() => 'pwned-through-go-scope')
    const guard = new GoCapabilityGuard()
    const mint = exportedFrom<(toolPath: string, run: () => unknown) => GoCapability>(
      guardModule,
      'nativeGoCapability',
    )
    const compose = exportedFrom<(agentCtx: Context) => void>(guardModule, 'composeGoLaneScope')

    // 1. the minting factory
    expect(() => mint?.('go.exec', run)).toThrow(ForbiddenGoCapabilityError)
    // 2. direct registration of a hand-written descriptor
    expect(() => guard.register({ toolPath: 'go.exec', kind: 'model-native', run }))
      .toThrow(ForbiddenGoCapabilityError)
    // 3. execution of the quarantined path
    expect(() => guard.execute('go.exec')).toThrow(ForbiddenGoCapabilityError)
    // 4. the direct tool-boundary assertion (refused as forged: no mint exists)
    expect(() => assertGoCapabilityAllowed(
      { toolPath: 'go.exec', kind: 'model-native', run } as unknown as GoCapability,
    )).toThrow(ForgedGoCapabilityError)
    // 5. the scope composed into the Go agent's world
    const agentCtx = new Context()
    compose?.(agentCtx)
    const scope = agentCtx.get('goCapabilities') as GoComposedScope | undefined
    expect(scope).toBeDefined()
    expect(() => scope?.execute('go.exec')).toThrow(ForbiddenGoCapabilityError)

    expect(run).not.toHaveBeenCalled()
  })
})

type GoComposedScope = {
  readonly presetId: string
  readonly toolPaths: readonly string[]
  execute(toolPath: string, args?: unknown): unknown
}

describe('Go lane scope composition', () => {
  afterEach(() => {
    exportedFrom<() => void>(guardModule, 'resetGoCapabilityGuardForTest')?.()
  })

  it('composes the guard and the exact surface into the Go agent scope', () => {
    const compose = exportedFrom<(agentCtx: Context) => void>(guardModule, 'composeGoLaneScope')
    expect(typeof compose, 'go-capability-guard must expose composeGoLaneScope').toBe('function')

    resolveGoCapabilityGuard().register(nativeGoCapability('go.state', () => 'state'))
    const agentCtx = new Context()
    compose?.(agentCtx)

    const scope = agentCtx.get('goCapabilities') as GoComposedScope | undefined
    expect(scope).toBeDefined()
    expect(scope?.presetId).toBe(GO_PRESET_ID)
    expect(scope?.toolPaths).toEqual(exportedFrom<readonly string[]>(GO_PRESET, 'toolPaths'))
    expect(scope?.execute('go.state')).toBe('state')
    expect(() => scope?.execute('go.exec')).toThrow(ForbiddenGoCapabilityError)
  })
})

describe('Runtime barrel contract', () => {
  it('re-exports the guard API downstream consumers need to mint and resolve', () => {
    const names = [
      'ForbiddenGoCapabilityError',
      'ForgedGoCapabilityError',
      'GO_CAPABILITY_SERVICE',
      'GoCapabilityGuard',
      'assertGoCapabilityAllowed',
      'composeGoLaneScope',
      'createGoCapabilityScope',
      'isNativeGoCapability',
      'nativeGoCapability',
      'resolveGoCapabilityGuard',
    ] as const

    for (const name of names) {
      const barrelValue = exportedFrom<unknown>(runtimeBarrel, name)
      expect(barrelValue, 'src/runtime/index.ts must export ' + name).toBeDefined()
      expect(barrelValue, 'src/runtime/index.ts must re-export the module binding ' + name)
        .toBe(exportedFrom<unknown>(guardModule, name))
    }
  })

  it('lets a downstream consumer mint and execute through the barrel alone', () => {
    const mint = exportedFrom<(toolPath: string, run: (args?: unknown) => unknown) => GoCapability>(
      runtimeBarrel,
      'nativeGoCapability',
    )
    const resolve = exportedFrom<() => GoCapabilityGuard>(runtimeBarrel, 'resolveGoCapabilityGuard')
    const GuardError = exportedFrom<new (...args: never[]) => Error>(
      runtimeBarrel,
      'ForgedGoCapabilityError',
    )

    expect(typeof resolve).toBe('function')
    expect(typeof GuardError).toBe('function')
    // The scope stays untouched here: a fresh guard proves the barrel's
    // minted descriptor is the admissible one, without polluting the singleton.
    expect(resolve?.()).toBe(goCapabilityGuard)

    const capability = mint?.('go.play', () => 'barrel')
    expect(capability).toBeDefined()
    expect(isNativeGoCapability(capability)).toBe(true)

    const guard = new GoCapabilityGuard()
    guard.register(capability)
    expect(guard.execute('go.play')).toBe('barrel')
  })

  it('keeps the test-only reset seam out of the public barrel', () => {
    // Production composition resolves the single scope through
    // resolveGoCapabilityGuard(); a public reset would let any consumer wipe
    // the Go authority out from under the lane.
    expect(exportedFrom<unknown>(runtimeBarrel, 'resetGoCapabilityGuardForTest')).toBeUndefined()
    expect(exportedFrom<unknown>(runtimeBarrel, 'goCapabilityGuard')).toBeUndefined()
  })
})
