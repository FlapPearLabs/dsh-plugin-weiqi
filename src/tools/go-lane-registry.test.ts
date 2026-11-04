import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GO_PRESET, GO_TOOL_PATHS } from '../preset/go-preset.js'
import {
  GO_LANE_ADMITTED_PATHS,
  GO_LANE_FORBIDDEN_SURFACE_SEGMENTS,
  GO_LANE_REGISTRY,
  GO_LANE_REGISTRY_ID,
  GoLaneRegistryError,
  admitGoLaneToolPath,
  goLanePathViolation,
} from './go-lane-registry.js'
import * as registryModule from './go-lane-registry.js'
import * as toolsBarrel from './index.js'

const registrySource = readFileSync(
  fileURLToPath(new URL('./go-lane-registry.ts', import.meta.url)),
  'utf8',
)
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
    const specifier = match[1]
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
}

describe('Go lane model-facing registry structure (Phase A)', () => {
  it('admits exactly the eight Spec §20 Phase A go.* paths', () => {
    expect(GO_LANE_ADMITTED_PATHS).toEqual([
      'go.state',
      'go.inspect_group',
      'go.inspect_region',
      'go.try_move',
      'go.play',
      'go.pass',
      'go.resign',
      'go.request_deep_think',
    ])
    expect(GO_LANE_ADMITTED_PATHS).toBe(GO_PRESET.toolPaths)

    for (const path of GO_TOOL_PATHS) {
      expect(goLanePathViolation(path), path).toBeUndefined()
      expect(admitGoLaneToolPath(path)).toBe(path)
    }
  })

  it('rejects every companion.* path while the registry is Phase A only', () => {
    const companionPaths = [
      'companion.affect',
      'companion.request_focus',
      'companion.handoff',
    ]
    for (const path of companionPaths) {
      expect(goLanePathViolation(path), path).toBe('tool-path')
      expect(() => admitGoLaneToolPath(path)).toThrowError(GoLaneRegistryError)
      expect(() => admitGoLaneToolPath(path)).toThrowError(/tool-path/)
    }
  })

  it('rejects solver, best-move, win-rate, score-lead and general-execution surfaces', () => {
    const forbidden: ReadonlyArray<readonly [string, string]> = [
      ['go.best_move', 'forbidden-surface'],
      ['go.bestMove', 'forbidden-surface'],
      ['go.win_rate', 'forbidden-surface'],
      ['go.winrate', 'forbidden-surface'],
      ['go.score_lead', 'forbidden-surface'],
      ['go.recommend', 'forbidden-surface'],
      ['go.solver', 'forbidden-surface'],
      ['go.engine', 'forbidden-surface'],
      ['go.katago', 'forbidden-surface'],
      ['go.leela', 'forbidden-surface'],
      ['go.gnugo', 'forbidden-surface'],
      ['go.mcts', 'forbidden-surface'],
      ['go.search', 'forbidden-surface'],
      ['go.exec', 'forbidden-surface'],
      ['go.bash', 'forbidden-surface'],
      ['go.python', 'forbidden-surface'],
      ['go.subagent', 'forbidden-surface'],
      ['solver.best_move', 'tool-path'],
      ['katago.analyze', 'tool-path'],
      ['fs.read', 'tool-path'],
    ]
    for (const [path, reason] of forbidden) {
      expect(goLanePathViolation(path), path).toBe(reason)
      expect(() => admitGoLaneToolPath(path), path).toThrowError(GoLaneRegistryError)
    }

    for (const path of GO_LANE_ADMITTED_PATHS) {
      expect(goLanePathViolation(path), path).toBeUndefined()
    }
    expect(GO_LANE_FORBIDDEN_SURFACE_SEGMENTS.length).toBeGreaterThan(0)
  })

  it('rejects a go.* path that is outside the exact whitelist', () => {
    for (const path of ['go.arbitrary', 'go.state.extra']) {
      expect(goLanePathViolation(path), path).toBe('not-in-surface')
    }
    // `go.try_move_best` names an evaluation surface, not a move tool.
    expect(goLanePathViolation('go.try_move_best')).toBe('forbidden-surface')
    expect(goLanePathViolation('go.arbitrary')).toBe('not-in-surface')
  })

  it('rejects a non-string path deterministically instead of coercing it', () => {
    for (const value of [undefined, null, 42, {}, ['go.state']]) {
      expect(goLanePathViolation(value)).toBe('invalid-tool-path')
      expect(() => admitGoLaneToolPath(value)).toThrowError(GoLaneRegistryError)
    }
  })

  it('carries the refused path and the policy reason on the rejection', () => {
    try {
      admitGoLaneToolPath('go.best_move')
      throw new Error('admitGoLaneToolPath must reject a best-move surface')
    } catch (error) {
      expect(error).toBeInstanceOf(GoLaneRegistryError)
      const rejection = error as GoLaneRegistryError
      expect(rejection.name).toBe('GoLaneRegistryError')
      expect(rejection.toolPath).toBe('go.best_move')
      expect(rejection.reason).toBe('forbidden-surface')
      expect(rejection.message).toContain('go.best_move')
      expect(rejection.message).toContain('forbidden-surface')
    }
  })

  it('is a declaration only: no tool is registered in Phase A', () => {
    expect(GO_LANE_REGISTRY.id).toBe(GO_LANE_REGISTRY_ID)
    expect(GO_LANE_REGISTRY.lane).toBe('go')
    expect(GO_LANE_REGISTRY.specPhase).toBe('A')
    expect(GO_LANE_REGISTRY.registrationState).toBe('structure-only')
    expect(GO_LANE_REGISTRY.admittedPaths).toBe(GO_PRESET.toolPaths)
    // C-T02 owns registration; this ticket must not claim a registered tool set.
    expect(GO_LANE_REGISTRY.registeredPaths).toEqual([])
    expect(Object.isFrozen(GO_LANE_REGISTRY)).toBe(true)
    expect(Object.isFrozen(GO_LANE_REGISTRY.registeredPaths)).toBe(true)
  })

  it('exposes no registration entry point yet', () => {
    const registrationFunctions = Object.entries(toolsBarrel).filter(
      ([exportName, value]) => typeof value === 'function' && /register/i.test(exportName),
    )
    expect(registrationFunctions).toEqual([])
    expect('registerGoLaneTool' in toolsBarrel).toBe(false)
  })

  it('imports no solver, engine or general-execution module', () => {
    expect(importSpecifiers(registrySource)).toEqual(['../preset/go-preset.js'])

    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]
    const engineLike = dependencyNames.filter(name =>
      /katago|leela|gnugo|mcts|solver|go-engine/i.test(name),
    )
    expect(engineLike).toEqual([])

    const solverLikeExports = Object.keys(registryModule).filter(exportName =>
      /solve|best|winrate|win_rate|evaluate|recommend/i.test(exportName),
    )
    expect(solverLikeExports).toEqual([])
  })
})
