import { describe, expect, it } from 'vitest'
import type { GameConfig, GameState } from '../../contracts/rules.js'
import { createGoTurnEnforcement } from '../../budget/enforcement.js'
import { GO_PRESET, type GoToolPath } from '../../preset/go-preset.js'
import { ForbiddenGoCapabilityError, GoCapabilityGuard } from '../../runtime/go-capability-guard.js'
import { createStubGoRulesPort } from '../../../tests/rules/stub-port.js'
import {
  GO_LANE_ADMITTED_PATHS,
  GO_LANE_REGISTRY,
  GoLaneRegistryError,
  goLanePathViolation,
} from '../go-lane-registry.js'
import { GO_TOOL_DEFINITIONS, GO_TOOL_NAMES } from './go-tools.js'
import {
  GoToolSurfaceError,
  assertExactGoToolSurface,
  registerGoToolDefinition,
  registerGoTools,
} from './go-tool-registry.js'
import { createGoToolRuntime } from './go-tools.js'
import type { GoStateResult, GoToolDefinition } from './types.js'

const BUDGET = {
  maxModelSteps: 3,
  maxInspectCalls: 2,
  maxTryMoves: 2,
  perRequestMaxTokens: 500,
  maxTurnTokens: 1000,
} as const

function createRegistry() {
  const port = createStubGoRulesPort()
  const enforcement = createGoTurnEnforcement(BUDGET)
  const guard = new GoCapabilityGuard()
  const registry = registerGoTools({ port, enforcement, guard })
  const config: GameConfig = {
    gameId: 'registry-game',
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: { user: 'black', deepseek: 'white' },
  }
  port.createGame(config)
  return { port, enforcement, guard, registry, gameId: config.gameId }
}

function forgedDefinition(name: string): GoToolDefinition {
  const definition = GO_TOOL_DEFINITIONS[0]
  if (definition === undefined) throw new Error('no definitions')
  return { ...definition, name: name as GoToolPath }
}

describe('Go tool registration (post-registration enumeration)', () => {
  it('registers exactly the eight admitted go.* paths, in Spec order', () => {
    const { registry } = createRegistry()

    expect([...registry.registeredPaths]).toEqual([
      'go.state',
      'go.inspect_group',
      'go.inspect_region',
      'go.try_move',
      'go.play',
      'go.pass',
      'go.resign',
      'go.request_deep_think',
    ])
    expect([...registry.registeredPaths]).toEqual([...GO_PRESET.toolPaths])
    expect([...registry.registeredPaths]).toEqual([...GO_LANE_ADMITTED_PATHS])
    expect([...GO_TOOL_NAMES]).toEqual([...registry.registeredPaths])
    expect(registry.registeredPaths).toHaveLength(8)
    expect(Object.isFrozen(registry.registeredPaths)).toBe(true)
    expect(Object.isFrozen(registry)).toBe(true)
  })

  it('admits every registered path through the C-T01 registry policy', () => {
    const { registry } = createRegistry()
    for (const toolPath of registry.registeredPaths) {
      expect(goLanePathViolation(toolPath), toolPath).toBeUndefined()
      expect(GO_LANE_REGISTRY.admittedPaths, toolPath).toContain(toolPath)
    }
  })

  it('contains no forbidden strategy, solver or general-execution surface', () => {
    const { registry } = createRegistry()
    const forbiddenTokens = ['best', 'win', 'score', 'solver', 'engine', 'eval', 'exec', 'search']
    for (const toolPath of registry.registeredPaths) {
      const tokens = toolPath.toLowerCase().split(/[^a-z0-9]+/)
      for (const token of tokens) {
        expect(forbiddenTokens, toolPath).not.toContain(token)
      }
      expect(toolPath.startsWith('companion.'), toolPath).toBe(false)
    }
  })

  it('invokes a registered tool end to end through the guard', () => {
    const { registry, gameId } = createRegistry()
    const result = registry.invoke('go.state', { gameId }) as GoStateResult
    expect(result.ok).toBe(true)
    expect(result.state.gameId).toBe(gameId)
  })
})

describe('Go tool registration refuses a widened or narrowed surface', () => {
  it('refuses a forbidden definition with the registry policy reason', () => {
    const { runtime, guard } = createRuntime()
    for (const [name, reason] of [
      ['go.best_move', 'forbidden-surface'],
      ['go.score_lead', 'forbidden-surface'],
      ['go.exec', 'forbidden-surface'],
      ['companion.affect', 'tool-path'],
      ['go.arbitrary', 'not-in-surface'],
    ] as const) {
      let captured: unknown
      try {
        registerGoToolDefinition(forgedDefinition(name), runtime, guard)
      } catch (error) {
        captured = error
      }
      expect(captured, name).toBeInstanceOf(GoLaneRegistryError)
      expect((captured as GoLaneRegistryError).reason, name).toBe(reason)
      expect((captured as GoLaneRegistryError).toolPath, name).toBe(name)
    }
  })

  it('leaves the guard unable to execute a refused path', () => {
    const { runtime, guard } = createRuntime()
    expect(() => registerGoToolDefinition(forgedDefinition('go.best_move'), runtime, guard)).toThrow(
      GoLaneRegistryError,
    )
    expect(() => guard.execute('go.best_move', {})).toThrowError(ForbiddenGoCapabilityError)
  })

  it('fails enumeration when one of the eight is missing', () => {
    const seven = GO_TOOL_NAMES.slice(0, 7)
    expect(() => assertExactGoToolSurface(seven)).toThrowError(GoToolSurfaceError)
    try {
      assertExactGoToolSurface(seven)
    } catch (error) {
      expect((error as GoToolSurfaceError).reason).toBe('surface-mismatch')
      expect((error as GoToolSurfaceError).missing).toEqual(['go.request_deep_think'])
    }
  })

  it('fails enumeration when a forbidden tool is added or a path repeats', () => {
    const withExtra = [...GO_TOOL_NAMES, 'go.best_move' as GoToolPath]
    try {
      assertExactGoToolSurface(withExtra)
    } catch (error) {
      expect(error).toBeInstanceOf(GoToolSurfaceError)
      expect((error as GoToolSurfaceError).reason).toBe('surface-mismatch')
      expect((error as GoToolSurfaceError).extra).toEqual(['go.best_move'])
    }

    const withDuplicate = [...GO_TOOL_NAMES.slice(0, 6), 'go.state' as GoToolPath, 'go.resign']
    try {
      assertExactGoToolSurface(withDuplicate)
    } catch (error) {
      expect(error).toBeInstanceOf(GoToolSurfaceError)
      expect((error as GoToolSurfaceError).reason).toBe('duplicate-path')
      expect((error as GoToolSurfaceError).toolPath).toBe('go.state')
    }
  })

  it('accepts the exact admitted surface and returns it typed', () => {
    const admitted = assertExactGoToolSurface([...GO_PRESET.toolPaths])
    expect([...admitted]).toEqual([...GO_PRESET.toolPaths])
  })
})

function createRuntime() {
  const runtime = createGoToolRuntime({
    port: createStubGoRulesPort(),
    enforcement: createGoTurnEnforcement(BUDGET),
  })
  return { runtime, guard: new GoCapabilityGuard() }
}

describe('registered tools keep the authoritative port boundary', () => {
  it('never exposes a mutation on an inspect or try_move path', () => {
    const { port, registry, gameId } = createRegistry()
    const before: GameState = port.getState(gameId)
    registry.invoke('go.inspect_group', { gameId, point: { x: 4, y: 4 } })
    registry.invoke('go.inspect_region', { gameId, point: { x: 4, y: 4 } })
    registry.invoke('go.try_move', { gameId, point: { x: 4, y: 4 } })
    expect(port.getState(gameId)).toEqual(before)
  })
})
