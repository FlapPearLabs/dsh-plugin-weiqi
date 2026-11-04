import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  GameConfig,
  GameState,
  GoRulesPort,
  GoRulesPortMethod,
  GroupInfo,
  MoveResult,
  Player,
  Point,
  ResignResult,
  ScoreResult,
  SettlementConfirmation,
  SettlementResult,
} from './rules.js'
import { GO_RULES_PORT_METHODS } from './rules.js'
import type { GoRulesPort as PublicGoRulesPort } from './index.js'
import { createStubGoRulesPort } from '../../tests/rules/stub-port.js'
import { EXPECTED_GO_RULES_PORT_METHODS, runGoRulesPortContract } from '../../tests/rules/port-harness.js'

class BoardMutatingResignPort implements GoRulesPort {
  private readonly inner: GoRulesPort
  private corrupted: GameState | null = null

  constructor(inner: GoRulesPort) {
    this.inner = inner
  }

  createGame(config: GameConfig): GameState {
    return this.inner.createGame(config)
  }

  play(gameId: string, by: Player, point: Point): MoveResult {
    return this.inner.play(gameId, by, point)
  }

  pass(gameId: string, by: Player): MoveResult {
    return this.inner.pass(gameId, by)
  }

  resign(gameId: string, by: Player): ResignResult {
    const result = this.inner.resign(gameId, by)
    if (result.ok) {
      this.corrupted = {
        ...result.state,
        stones: [...result.state.stones, { point: { x: 8, y: 8 }, color: 'white' }],
      }
    }
    return result
  }

  getState(gameId: string): GameState {
    if (this.corrupted !== null && this.corrupted.gameId === gameId) return this.corrupted
    return this.inner.getState(gameId)
  }

  inspectGroup(gameId: string, point: Point): GroupInfo | null {
    return this.inner.inspectGroup(gameId, point)
  }

  score(gameId: string): ScoreResult {
    return this.inner.score(gameId)
  }

  settle(gameId: string, confirmation: SettlementConfirmation): SettlementResult {
    return this.inner.settle(gameId, confirmation)
  }
}

describe('GoRulesPort contract (Spec §26/§30)', () => {
  it('exposes exactly the eight frozen methods, resign included', () => {
    expectTypeOf<GoRulesPort>().toHaveProperty('createGame')
    expectTypeOf<GoRulesPort>().toHaveProperty('play')
    expectTypeOf<GoRulesPort>().toHaveProperty('pass')
    expectTypeOf<GoRulesPort>().toHaveProperty('resign')
    expectTypeOf<GoRulesPort>().toHaveProperty('getState')
    expectTypeOf<GoRulesPort>().toHaveProperty('inspectGroup')
    expectTypeOf<GoRulesPort>().toHaveProperty('score')
    expectTypeOf<GoRulesPort>().toHaveProperty('settle')
    expectTypeOf<GoRulesPortMethod>().toEqualTypeOf<keyof GoRulesPort>()
    expectTypeOf<PublicGoRulesPort>().toEqualTypeOf<GoRulesPort>()
    expectTypeOf<PublicGoRulesPort['resign']>().toBeFunction()
  })

  it('types resign as a required terminal action returning ResignResult', () => {
    expectTypeOf<GoRulesPort['resign']>().toBeFunction()
    expectTypeOf<GoRulesPort['resign']>().parameters.toEqualTypeOf<[string, Player]>()
    expectTypeOf<GoRulesPort['resign']>().returns.toEqualTypeOf<ResignResult>()
    expectTypeOf<Extract<ResignResult, { ok: true }>>().toHaveProperty('outcome')
    expectTypeOf<Extract<ResignResult, { ok: true }>['outcome']['reason']>().toEqualTypeOf<'resignation'>()
  })

  it('keeps every other method on its frozen contract type', () => {
    expectTypeOf<GoRulesPort['createGame']>().returns.toEqualTypeOf<GameState>()
    expectTypeOf<GoRulesPort['play']>().returns.toEqualTypeOf<MoveResult>()
    expectTypeOf<GoRulesPort['pass']>().returns.toEqualTypeOf<MoveResult>()
    expectTypeOf<GoRulesPort['getState']>().returns.toEqualTypeOf<GameState>()
    expectTypeOf<GoRulesPort['inspectGroup']>().returns.toEqualTypeOf<GroupInfo | null>()
    expectTypeOf<GoRulesPort['score']>().returns.toEqualTypeOf<ScoreResult>()
    expectTypeOf<GoRulesPort['settle']>().returns.toEqualTypeOf<SettlementResult>()
    expectTypeOf<GoRulesPort['settle']>().parameters.toEqualTypeOf<[string, SettlementConfirmation]>()
  })

  it('declares the eight method names as a runtime-checkable value', () => {
    expect([...GO_RULES_PORT_METHODS]).toHaveLength(8)
    expect([...GO_RULES_PORT_METHODS].sort()).toEqual([...EXPECTED_GO_RULES_PORT_METHODS])
  })
})

describe('engine-independent GoRulesPort harness', () => {
  const report = runGoRulesPortContract(createStubGoRulesPort)

  it('is green against the deterministic stub and exercises all eight methods', () => {
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect([...report.methods]).toEqual([...EXPECTED_GO_RULES_PORT_METHODS])
    expect(report.cases.length).toBeGreaterThanOrEqual(12)
  })

  it('exposes resign at runtime on the stub', () => {
    expect(typeof createStubGoRulesPort().resign).toBe('function')
  })

  it('has teeth: reports a port that mutates the board on resignation', () => {
    const corrupted = runGoRulesPortContract(() => new BoardMutatingResignPort(createStubGoRulesPort()))

    expect(corrupted.ok).toBe(false)
    expect(corrupted.failures).toHaveLength(1)
    expect(corrupted.failures[0]?.name).toBe('resign ends the game immediately, opponent wins, board is not mutated')
  })
})
