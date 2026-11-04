import { describe, expect, it, vi } from 'vitest'
import {
  GO_FORBIDDEN_CAPABILITY_KINDS,
  GO_PRESET,
  GO_PRESET_ID,
} from '../preset/go-preset.js'
import {
  ForbiddenGoCapabilityError,
  GoCapabilityGuard,
  assertGoCapabilityAllowed,
} from './go-capability-guard.js'

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
    guard.register({ toolPath: 'go.state', kind: 'model-native', run })

    expect(guard.execute('go.state', { board: true })).toEqual({ echoed: { board: true } })
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith({ board: true })
  })

  it('fails at execution when a forbidden capability was registered into the Go scope', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'shell output')
    guard.register({ toolPath: 'go.shell', kind: 'bash', run })

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
    guard.register({ toolPath: 'go.helpers.run', kind: 'general-execution', run })

    expect(() => guard.execute('go.helpers.run')).toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()
  })

  it('fails closed for every forbidden capability kind, even when registered', () => {
    for (const kind of GO_FORBIDDEN_CAPABILITY_KINDS) {
      const guard = new GoCapabilityGuard()
      const run = vi.fn(() => kind)
      const toolPath = `go.alias.${kind}`
      guard.register({ toolPath, kind, run })

      expect(() => guard.execute(toolPath)).toThrow(ForbiddenGoCapabilityError)
      expect(run).not.toHaveBeenCalled()
    }
  })

  it('fails closed for an unclassified capability kind instead of allowing it', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'unclassified')
    guard.register({ toolPath: 'go.mystery', kind: 'some-new-transport', run })

    expect(() => guard.execute('go.mystery')).toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a capability outside the Go lane tool paths', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'filesystem')
    guard.register({ toolPath: 'fs.read', kind: 'model-native', run })

    expect(() => guard.execute('fs.read')).toThrow(ForbiddenGoCapabilityError)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an unregistered tool path instead of executing it', () => {
    const guard = new GoCapabilityGuard()
    expect(() => guard.execute('go.unknown')).toThrow(ForbiddenGoCapabilityError)
  })

  it('re-evaluates authority on every execution rather than trusting registration', () => {
    const guard = new GoCapabilityGuard()
    const run = vi.fn(() => 'ran')
    let kind = 'model-native'
    guard.register({ toolPath: 'go.dynamic', get kind() { return kind }, run })

    expect(guard.execute('go.dynamic')).toBe('ran')
    kind = 'python'
    expect(() => guard.execute('go.dynamic')).toThrow(ForbiddenGoCapabilityError)
    expect(run).toHaveBeenCalledOnce()
  })

  it('exposes the same policy check for tool boundaries that execute directly', () => {
    expect(() => assertGoCapabilityAllowed({
      toolPath: 'go.play',
      kind: 'model-native',
    })).not.toThrow()
    expect(() => assertGoCapabilityAllowed({
      toolPath: 'go.play',
      kind: 'python',
    })).toThrow(ForbiddenGoCapabilityError)
  })
})
