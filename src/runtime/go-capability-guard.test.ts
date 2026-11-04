import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GO_FORBIDDEN_CAPABILITY_KINDS,
  GO_PRESET,
  GO_PRESET_ID,
} from '../preset/go-preset.js'
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
    expect(GO_PRESET.toolPathPrefixes).toEqual(['go.', 'companion.'])
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

  it('fails at execution when a forbidden capability was registered into the Go scope', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'shell output')

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

  it('rejects an aliased forbidden capability registered under an allowed-looking path', () => {
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

  it('fails closed for every forbidden capability kind, even when registered', () => {
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

  it('rejects a minted capability outside the Go lane tool paths at execution', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'filesystem')
    guard.register(nativeGoCapability('fs.read', run))

    expect(() => guard.execute('fs.read')).toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()

    try {
      guard.execute('fs.read')
    } catch (error) {
      expect((error as ForbiddenGoCapabilityError).reason).toBe('tool-path')
    }
  })

  it('rejects an unregistered tool path instead of executing it', () => {
    const guard = new GoCapabilityGuard()
    expect(() => guard.execute('go.unknown')).toThrow(ForbiddenGoCapabilityError)
  })

  it('keeps a quarantined path denied until a minted descriptor replaces it', () => {
    const guard = new GoCapabilityGuard()
    const forgedRun = vi.fn(() => 'forged')

    expect(() => guard.register({
      toolPath: 'go.replace',
      kind: 'model-native',
      run: forgedRun,
    })).toThrow(ForgedGoCapabilityError)
    expect(() => guard.execute('go.replace')).toThrow(ForbiddenGoCapabilityError)

    const mintedRun = vi.fn(() => 'minted')
    guard.register(nativeGoCapability('go.replace', mintedRun))

    expect(guard.execute('go.replace')).toBe('minted')
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

  it('still denies execution when an aliased forbidden capability is registered into the scope', () => {
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
    const minted = nativeGoCapability('go.dynamic', run)

    expect(Object.isFrozen(minted)).toBe(true)
    expect(() => {
      (minted as { kind: string }).kind = 'python'
    }).toThrow(TypeError)

    guard.register(minted)
    expect(guard.execute('go.dynamic')).toBe('ran')
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
    consumerA.register(nativeGoCapability('go.shared-scope', () => 'shared'))

    expect(consumerB.execute('go.shared-scope')).toBe('shared')
  })

  it('can be reset for tests so one suite never leaks into the next', () => {
    const reset = exportedFrom<() => void>(guardModule, 'resetGoCapabilityGuardForTest')
    expect(typeof reset, 'go-capability-guard must expose resetGoCapabilityGuardForTest')
      .toBe('function')

    goCapabilityGuard.register(nativeGoCapability('go.shared-reset', () => 'shared'))
    expect(goCapabilityGuard.execute('go.shared-reset')).toBe('shared')

    reset?.()

    expect(() => resolveGoCapabilityGuard().execute('go.shared-reset'))
      .toThrow(ForbiddenGoCapabilityError)
    try {
      goCapabilityGuard.execute('go.shared-reset')
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

    expect(pathViolation?.('go.state')).toBeUndefined()
    expect(pathViolation?.('companion.handoff')).toBeUndefined()
    expect(pathViolation?.('fs.read')).toBe('tool-path')
    expect(pathViolation?.('gonzo.state')).toBe('tool-path')
  })
})

describe('Runtime barrel contract', () => {
  it('re-exports the guard API downstream consumers need to mint and resolve', () => {
    const names = [
      'ForbiddenGoCapabilityError',
      'ForgedGoCapabilityError',
      'GoCapabilityGuard',
      'assertGoCapabilityAllowed',
      'goCapabilityGuard',
      'isNativeGoCapability',
      'nativeGoCapability',
      'resetGoCapabilityGuardForTest',
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

    const capability = mint?.('go.barrel', () => 'barrel')
    expect(capability).toBeDefined()
    expect(isNativeGoCapability(capability)).toBe(true)

    const guard = new GoCapabilityGuard()
    guard.register(capability)
    expect(guard.execute('go.barrel')).toBe('barrel')
  })
})
