import { describe, expect, it } from 'vitest'
import type { GameNotice } from '../../contracts/bridge.js'
import type { GameConfig, GameState, GoRulesPort } from '../../contracts/rules.js'
import type { GoTurnBudget } from '../../contracts/budget.js'
import {
  GoTurnAnalysisEndedError,
  GoTurnBudgetExhaustedError,
  createGoTurnEnforcement,
} from '../../budget/enforcement.js'
import { GoCapabilityGuard } from '../../runtime/go-capability-guard.js'
import { createTenukiGoRulesPort } from '../../rules/tenuki-adapter.js'
import { createStubGoRulesPort } from '../../../tests/rules/stub-port.js'
import { GO_TOOL_DEFINITIONS, GO_TOOL_NAMES, GoToolArgumentError } from './go-tools.js'
import { registerGoTools } from './go-tool-registry.js'
import type {
  GoDeepThinkResult,
  GoInspectGroupResult,
  GoInspectRegionResult,
  GoPassResult,
  GoPlayResult,
  GoResignResult,
  GoStateResult,
  GoToolDefinition,
  GoToolRegistry,
  GoTryMoveResult,
} from './types.js'

/**
 * TEST FIXTURE ONLY. Not production calibration; BL-BUD-06 / WAVE-C-T10 owns
 * the benchmark-derived numbers.
 */
const NON_PRODUCTION_BUDGET = {
  maxModelSteps: 3,
  maxInspectCalls: 2,
  maxTryMoves: 2,
  perRequestMaxTokens: 500,
  maxTurnTokens: 1000,
} as const satisfies GoTurnBudget

const CATEGORICAL_COLORS: GameConfig['colors'] = { user: 'black', deepseek: 'white' }
const DEEPSEEK_FIRST_COLORS: GameConfig['colors'] = { user: 'white', deepseek: 'black' }

type HarnessOptions = {
  readonly port?: GoRulesPort
  readonly budget?: Partial<GoTurnBudget>
  readonly gameId?: string
  readonly colors?: GameConfig['colors']
}

function createRecordingPort(port: GoRulesPort): { port: GoRulesPort; calls: string[] } {
  const calls: string[] = []
  const recording = new Proxy(port, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        calls.push(String(property))
        return (value as (...inner: unknown[]) => unknown).apply(target, args)
      }
    },
  })
  return { port: recording, calls }
}

function createHarness(options: HarnessOptions = {}) {
  const recording = createRecordingPort(options.port ?? createStubGoRulesPort())
  const enforcement = createGoTurnEnforcement({ ...NON_PRODUCTION_BUDGET, ...options.budget })
  const notices: GameNotice[] = []
  const guard = new GoCapabilityGuard()
  const registry = registerGoTools({
    port: recording.port,
    enforcement,
    guard,
    noticeSink: {
      updateGame(notice) {
        notices.push(notice)
        return 'published'
      },
    },
  })

  const gameId = options.gameId ?? 'tool-game'
  const config: GameConfig = {
    gameId,
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: options.colors ?? CATEGORICAL_COLORS,
  }
  const initial = recording.port.createGame(config)

  return {
    gameId,
    port: recording.port,
    calls: recording.calls,
    enforcement,
    notices,
    registry,
    guard,
    initial,
  }
}

/**
 * The registry speaks `unknown` at the guard boundary; tests name the expected
 * result type per invocation instead of narrowing eight unions inline.
 */
function invoke<T>(registry: GoToolRegistry, toolPath: string, args: unknown = {}): T {
  return registry.invoke(toolPath, args) as T
}

function collectSchemaPropertyNames(schema: unknown): string[] {
  const names: string[] = []
  if (typeof schema !== 'object' || schema === null) return names
  const record = schema as Record<string, unknown>
  const properties = record.properties
  if (typeof properties === 'object' && properties !== null) {
    for (const [name, value] of Object.entries(properties)) {
      names.push(name)
      names.push(...collectSchemaPropertyNames(value))
    }
  }
  return names
}

const EVALUATIVE_FIELD_TOKENS = [
  'best',
  'bestmove',
  'good',
  'bad',
  'recommend',
  'recommended',
  'recommendation',
  'win',
  'winrate',
  'score',
  'scorelead',
  'eval',
  'evaluation',
  'advice',
  'rank',
  'ranking',
  'danger',
  'critical',
  'urgency',
  'strategy',
  'variant',
] as const

function assertNoEvaluativeField(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null) return
  for (const key of Object.keys(value)) {
    expect(EVALUATIVE_FIELD_TOKENS, `${label}.${key}`).not.toContain(key.toLowerCase())
  }
}

function lastSnapshot(enforcement: ReturnType<typeof createGoTurnEnforcement>) {
  return enforcement.snapshot()
}

describe('Go model-facing tool declarations (Spec §20 Phase A)', () => {
  it('declares exactly the eight Spec §20 go.* tools, in Spec order', () => {
    expect(GO_TOOL_DEFINITIONS).toHaveLength(8)
    expect([...GO_TOOL_NAMES]).toEqual([
      'go.state',
      'go.inspect_group',
      'go.inspect_region',
      'go.try_move',
      'go.play',
      'go.pass',
      'go.resign',
      'go.request_deep_think',
    ])
  })

  it('gives every tool a description and a strict object JSON schema', () => {
    for (const definition of GO_TOOL_DEFINITIONS) {
      expect(definition.description.length, definition.name).toBeGreaterThan(0)
      expect(definition.parameters.type, definition.name).toBe('object')
      expect(definition.parameters.additionalProperties, definition.name).toBe(false)
      const propertyNames = Object.keys(definition.parameters.properties)
      for (const requiredName of definition.parameters.required) {
        expect(propertyNames, definition.name).toContain(requiredName)
      }
    }
  })

  it('exposes no evaluative field in any tool schema', () => {
    for (const definition of GO_TOOL_DEFINITIONS) {
      for (const propertyName of collectSchemaPropertyNames(definition.parameters)) {
        expect(EVALUATIVE_FIELD_TOKENS, `${definition.name}.${propertyName}`).not.toContain(
          propertyName.toLowerCase(),
        )
      }
    }
  })

  it('declares go.try_move with only gameId, point and the local facts it may return', () => {
    const tryMove = GO_TOOL_DEFINITIONS.find(definition => definition.name === 'go.try_move')
    expect(tryMove).toBeDefined()
    const schema = (tryMove as GoToolDefinition).parameters
    expect(Object.keys(schema.properties).sort()).toEqual(['gameId', 'point'])
    expect([...schema.required].sort()).toEqual(['gameId', 'point'])
  })
})

describe('go.state', () => {
  it('returns the authoritative snapshot and charges no analysis budget', () => {
    const harness = createHarness()
    const result = invoke<GoStateResult>(harness.registry, 'go.state', { gameId: harness.gameId })

    expect(result.ok).toBe(true)
    expect(result.state).toEqual(harness.initial)
    expect(harness.calls).not.toContain('play')
    expect(lastSnapshot(harness.enforcement)).toMatchObject({
      inspectCalls: 0,
      tryMoves: 0,
      deepThinkRequests: 0,
      modelSteps: 0,
      committedAction: undefined,
    })
  })

  it('rejects a non-string gameId before touching the port', () => {
    const harness = createHarness()
    expect(() => invoke(harness.registry, 'go.state', { gameId: 7 })).toThrowError(
      GoToolArgumentError,
    )
    expect(harness.calls).toEqual(['createGame'])
  })

  it('rejects unknown argument keys instead of ignoring them', () => {
    const harness = createHarness()
    expect(() =>
      invoke(harness.registry, 'go.state', { gameId: harness.gameId, best: true }),
    ).toThrowError(GoToolArgumentError)
  })
})

describe('go.inspect_group', () => {
  it('returns connected stones and liberties, and charges exactly one inspect', () => {
    const harness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    harness.port.play(harness.gameId, 'deepseek', { x: 4, y: 4 })
    harness.port.play(harness.gameId, 'user', { x: 0, y: 0 })

    const result = invoke<GoInspectGroupResult>(harness.registry, 'go.inspect_group', {
      gameId: harness.gameId,
      point: { x: 4, y: 4 },
    })

    expect(result.ok).toBe(true)
    expect(result.group?.color).toBe('black')
    expect(result.group?.stones).toEqual([{ x: 4, y: 4 }])
    expect(result.group?.liberties).toHaveLength(4)
    expect(lastSnapshot(harness.enforcement).inspectCalls).toBe(1)
  })

  it('charges the inspect even when the point holds no stone', () => {
    const harness = createHarness()
    const result = invoke<GoInspectGroupResult>(harness.registry, 'go.inspect_group', {
      gameId: harness.gameId,
      point: { x: 8, y: 8 },
    })

    expect(result.group).toBeNull()
    expect(lastSnapshot(harness.enforcement).inspectCalls).toBe(1)
  })

  it('denies the third inspect under a maxInspectCalls of two without executing it', () => {
    const harness = createHarness()
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }
    invoke(harness.registry, 'go.inspect_group', args)
    invoke(harness.registry, 'go.inspect_group', args)

    const inspectCallsBefore = harness.calls.filter(call => call === 'inspectGroup').length
    expect(() => invoke(harness.registry, 'go.inspect_group', args)).toThrowError(
      GoTurnBudgetExhaustedError,
    )
    expect(harness.calls.filter(call => call === 'inspectGroup')).toHaveLength(inspectCallsBefore)
    expect(lastSnapshot(harness.enforcement).inspectCalls).toBe(2)
  })
})

describe('go.inspect_region', () => {
  it('reports the local stones, empty points and liberties of a clipped region', () => {
    const harness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    harness.port.play(harness.gameId, 'deepseek', { x: 4, y: 4 })
    harness.port.play(harness.gameId, 'user', { x: 0, y: 0 })

    const result = invoke<GoInspectRegionResult>(harness.registry, 'go.inspect_region', {
      gameId: harness.gameId,
      point: { x: 4, y: 4 },
    })

    expect(result.ok).toBe(true)
    expect(result.region.center).toEqual({ x: 4, y: 4 })
    expect(result.region.radius).toBe(2)
    expect(result.region.stones).toEqual([{ point: { x: 4, y: 4 }, color: 'black' }])
    expect(result.region.emptyPoints).toHaveLength(24)
    expect(result.region.liberties).toHaveLength(4)
    expect(lastSnapshot(harness.enforcement).inspectCalls).toBe(1)
    assertNoEvaluativeField(result.region, 'region')
  })

  it('clips a corner region to the board and honours an explicit radius', () => {
    const harness = createHarness()
    const corner = invoke<GoInspectRegionResult>(harness.registry, 'go.inspect_region', {
      gameId: harness.gameId,
      point: { x: 0, y: 0 },
      radius: 1,
    })
    expect(corner.region.radius).toBe(1)
    expect(corner.region.emptyPoints).toHaveLength(4)
    expect(corner.region.stones).toEqual([])
  })

  it('rejects a negative radius without charging budget', () => {
    const harness = createHarness()
    expect(() =>
      invoke(harness.registry, 'go.inspect_region', {
        gameId: harness.gameId,
        point: { x: 0, y: 0 },
        radius: -1,
      }),
    ).toThrowError(GoToolArgumentError)
    expect(lastSnapshot(harness.enforcement).inspectCalls).toBe(0)
  })
})

describe('go.try_move', () => {
  it('reports local legality, captures and resulting liberties without touching the board', () => {
    const harness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })

    const result = invoke<GoTryMoveResult>(harness.registry, 'go.try_move', {
      gameId: harness.gameId,
      point: { x: 4, y: 4 },
    })

    expect(Object.keys(result).sort()).toEqual([
      'basis',
      'captures',
      'legal',
      'localLiberties',
      'ok',
      'point',
    ])
    expect(result.ok).toBe(true)
    expect(result.legal).toBe(true)
    expect(result.basis).toBe('local-board')
    expect(result.captures).toEqual([])
    expect(result.localLiberties).toHaveLength(4)
    assertNoEvaluativeField(result, 'go.try_move')
    expect(harness.calls).not.toContain('play')
    expect(harness.port.getState(harness.gameId)).toEqual(harness.initial)
    expect(lastSnapshot(harness.enforcement).tryMoves).toBe(1)
  })

  it('reports a capture the move would make', () => {
    const harness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    harness.port.play(harness.gameId, 'deepseek', { x: 0, y: 1 })
    harness.port.play(harness.gameId, 'user', { x: 0, y: 0 })

    const result = invoke<GoTryMoveResult>(harness.registry, 'go.try_move', {
      gameId: harness.gameId,
      point: { x: 1, y: 0 },
    })

    expect(result.legal).toBe(true)
    expect(result.captures).toEqual([{ point: { x: 0, y: 0 }, color: 'white' }])
    expect(result.localLiberties).toHaveLength(3)
    expect(harness.port.getState(harness.gameId).stones).toHaveLength(2)
  })

  it('reports local suicide, occupation and out-of-turn without mutating state', () => {
    const suicideHarness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    suicideHarness.port.play(suicideHarness.gameId, 'deepseek', { x: 8, y: 8 })
    suicideHarness.port.play(suicideHarness.gameId, 'user', { x: 0, y: 1 })
    suicideHarness.port.play(suicideHarness.gameId, 'deepseek', { x: 8, y: 7 })
    suicideHarness.port.play(suicideHarness.gameId, 'user', { x: 1, y: 0 })

    const suicide = invoke<GoTryMoveResult>(suicideHarness.registry, 'go.try_move', {
      gameId: suicideHarness.gameId,
      point: { x: 0, y: 0 },
    })
    expect(suicide.legal).toBe(false)
    expect(suicide.reason).toBe('suicide')
    expect(suicide.captures).toEqual([])
    expect(suicide.localLiberties).toEqual([])

    const occupiedHarness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    occupiedHarness.port.play(occupiedHarness.gameId, 'deepseek', { x: 4, y: 4 })
    occupiedHarness.port.play(occupiedHarness.gameId, 'user', { x: 0, y: 0 })
    const occupied = invoke<GoTryMoveResult>(occupiedHarness.registry, 'go.try_move', {
      gameId: occupiedHarness.gameId,
      point: { x: 4, y: 4 },
    })
    expect(occupied.legal).toBe(false)
    expect(occupied.reason).toBe('occupied')

    const turnHarness = createHarness()
    const outOfTurn = invoke<GoTryMoveResult>(turnHarness.registry, 'go.try_move', {
      gameId: turnHarness.gameId,
      point: { x: 4, y: 4 },
    })
    expect(outOfTurn.legal).toBe(false)
    expect(outOfTurn.reason).toBe('out-of-turn')

    const deepseekTurnHarness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    const offBoard = invoke<GoTryMoveResult>(deepseekTurnHarness.registry, 'go.try_move', {
      gameId: deepseekTurnHarness.gameId,
      point: { x: 9, y: 0 },
    })
    expect(offBoard.legal).toBe(false)
    expect(offBoard.reason).toBe('out-of-board')
  })
})

describe('go.play', () => {
  it('applies an accepted move through the port and ends the analysis loop', () => {
    const harness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    const result = invoke<GoPlayResult>(harness.registry, 'go.play', {
      gameId: harness.gameId,
      point: { x: 4, y: 4 },
    })

    expect(result.ok).toBe(true)
    expect(result.state.moveNumber).toBe(1)
    expect(result.state.stones).toEqual([{ point: { x: 4, y: 4 }, color: 'black' }])
    expect(result.captured).toEqual([])
    expect(result.notice.status).toBe('playing')
    expect(harness.notices).toHaveLength(1)
    expect(harness.calls).toContain('play')
    expect(harness.port.getState(harness.gameId)).toEqual(result.state)
    expect(lastSnapshot(harness.enforcement)).toMatchObject({
      committedAction: 'play',
      gameTerminal: false,
    })
    expect(() =>
      invoke(harness.registry, 'go.inspect_group', {
        gameId: harness.gameId,
        point: { x: 4, y: 4 },
      }),
    ).toThrowError(GoTurnAnalysisEndedError)
  })

  it('returns the rejection, keeps the authoritative state and does not end the loop', () => {
    const harness = createHarness()
    harness.port.play(harness.gameId, 'user', { x: 4, y: 4 })
    const before = harness.port.getState(harness.gameId)

    const result = invoke<GoPlayResult>(harness.registry, 'go.play', {
      gameId: harness.gameId,
      point: { x: 4, y: 4 },
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('occupied')
    expect(result.state).toEqual(before)
    expect(harness.port.getState(harness.gameId)).toEqual(before)
    expect(harness.notices).toHaveLength(0)
    expect(lastSnapshot(harness.enforcement).committedAction).toBeUndefined()
    expect(() =>
      invoke(harness.registry, 'go.inspect_group', {
        gameId: harness.gameId,
        point: { x: 0, y: 0 },
      }),
    ).not.toThrow()
  })
})

describe('go.pass', () => {
  it('applies the pass, publishes the notice and records the commit', () => {
    const harness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    const result = invoke<GoPassResult>(harness.registry, 'go.pass', { gameId: harness.gameId })

    expect(result.ok).toBe(true)
    expect(result.state.consecutivePasses).toBe(1)
    expect(result.notice).toMatchObject({ status: 'playing', moveNumber: 1, lastMove: 'pass' })
    expect(harness.notices).toHaveLength(1)
    expect(lastSnapshot(harness.enforcement).committedAction).toBe('pass')
  })
})

describe('go.resign', () => {
  it('is the only board route: GoRulesPort.resign, authoritative terminal state, GameNotice', () => {
    const harness = createHarness({
      port: createTenukiGoRulesPort(),
      colors: DEEPSEEK_FIRST_COLORS,
    })
    harness.port.play(harness.gameId, 'deepseek', { x: 4, y: 4 })
    harness.port.play(harness.gameId, 'user', { x: 4, y: 5 })
    harness.calls.length = 0
    const before = harness.port.getState(harness.gameId)

    const result = invoke<GoResignResult>(harness.registry, 'go.resign', {
      gameId: harness.gameId,
    })

    expect(result.ok).toBe(true)
    expect(harness.calls).toEqual(['resign'])
    expect(result.state.status).toBe('over')
    expect(result.state.outcome).toEqual({
      winner: 'user',
      loser: 'deepseek',
      reason: 'resignation',
    })
    expect(result.outcome).toEqual({
      winner: 'user',
      loser: 'deepseek',
      reason: 'resignation',
    })
    // No board mutation: the resignation is terminal state only.
    expect(result.state.stones).toEqual(before.stones)
    expect(result.state.moveNumber).toBe(before.moveNumber)
    expect(result.state.captures).toEqual(before.captures)
    expect(harness.calls).not.toContain('score')
    expect(harness.calls).not.toContain('settle')
    expect(harness.notices).toHaveLength(1)
    expect(harness.notices[0]).toMatchObject({
      gameId: harness.gameId,
      status: 'over',
      moveNumber: before.moveNumber,
    })
    expect(lastSnapshot(harness.enforcement)).toMatchObject({
      committedAction: 'resign',
      gameTerminal: true,
    })
    expect(harness.port.getState(harness.gameId)).toEqual(result.state)
  })

  it('denies every analysis tool afterwards but reports a second resignation as game-over', () => {
    const harness = createHarness({ colors: DEEPSEEK_FIRST_COLORS })
    invoke(harness.registry, 'go.resign', { gameId: harness.gameId })

    expect(() =>
      invoke(harness.registry, 'go.inspect_group', {
        gameId: harness.gameId,
        point: { x: 4, y: 4 },
      }),
    ).toThrowError(GoTurnAnalysisEndedError)
    expect(() =>
      invoke(harness.registry, 'go.try_move', { gameId: harness.gameId, point: { x: 4, y: 4 } }),
    ).toThrowError(GoTurnAnalysisEndedError)
    expect(() => invoke(harness.registry, 'go.request_deep_think')).toThrowError(
      GoTurnAnalysisEndedError,
    )

    const second = invoke<GoResignResult>(harness.registry, 'go.resign', { gameId: harness.gameId })
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('game-over')
    expect(harness.notices).toHaveLength(1)
  })
})

describe('go.request_deep_think', () => {
  it('records one bounded request and applies no boost itself', () => {
    const harness = createHarness()
    const result = invoke<GoDeepThinkResult>(harness.registry, 'go.request_deep_think')

    expect(result).toEqual({ ok: true, requested: true, applied: false })
    expect(lastSnapshot(harness.enforcement)).toMatchObject({
      deepThinkRequests: 1,
      committedAction: undefined,
    })
  })

  it('is denied once the turn token budget is exhausted', () => {
    const harness = createHarness({ budget: { maxTurnTokens: 0 } })
    expect(() => invoke(harness.registry, 'go.request_deep_think')).toThrowError(
      GoTurnBudgetExhaustedError,
    )
    expect(lastSnapshot(harness.enforcement).deepThinkRequests).toBe(0)
  })
})
