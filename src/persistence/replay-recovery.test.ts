import { describe, expect, it } from 'vitest'
import type {
  GameConfig,
  GameState,
  GoRulesPort,
  MoveResult,
  PlayerColors,
  ResignResult,
} from '../contracts/rules.js'
import type { CanonicalGameRecord, GameAction } from '../rules/canonical-record.js'
import { serializeCanonicalGameRecord } from '../rules/canonical-record.js'
import { createTenukiGoRulesPort } from '../rules/tenuki-adapter.js'
import { restoreFromCanonicalRecord } from './replay-recovery.js'

const USER_BLACK: PlayerColors = { user: 'black', deepseek: 'white' }
const USER_WHITE: PlayerColors = { user: 'white', deepseek: 'black' }

function gameConfig(gameId: string, colors: PlayerColors = USER_BLACK): GameConfig {
  return {
    gameId,
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors,
  }
}

function canonicalRecord(actions: readonly GameAction[]): CanonicalGameRecord {
  return {
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    actions,
  }
}

function applyAction(
  port: ReturnType<typeof createTenukiGoRulesPort>,
  gameId: string,
  action: GameAction,
  index: number,
): MoveResult | ResignResult {
  const result =
    action.type === 'play'
      ? port.play(gameId, action.by, action.point)
      : action.type === 'pass'
        ? port.pass(gameId, action.by)
        : port.resign(gameId, action.by)
  if (!result.ok) {
    throw new Error(`live action ${index + 1} (${action.type}) was rejected: ${result.reason}`)
  }
  return result
}

/** The pre-crash live game: actions applied directly through the rules authority. */
function liveState(
  actions: readonly GameAction[],
  gameId: string,
  colors: PlayerColors = USER_BLACK,
): GameState {
  const port = createTenukiGoRulesPort()
  port.createGame(gameConfig(gameId, colors))
  actions.forEach((action, index) => applyAction(port, gameId, action, index))
  return port.getState(gameId)
}

const LONG_SEQUENCE: readonly GameAction[] = [
  { type: 'play', by: 'user', point: { x: 1, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
  { type: 'play', by: 'user', point: { x: 0, y: 1 } },
  { type: 'play', by: 'deepseek', point: { x: 5, y: 5 } },
  { type: 'play', by: 'user', point: { x: 2, y: 2 } },
  { type: 'pass', by: 'deepseek' },
  { type: 'play', by: 'user', point: { x: 3, y: 3 } },
  { type: 'play', by: 'deepseek', point: { x: 4, y: 4 } },
  { type: 'pass', by: 'user' },
  { type: 'pass', by: 'deepseek' },
  { type: 'play', by: 'user', point: { x: 4, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 2, y: 6 } },
  { type: 'play', by: 'user', point: { x: 6, y: 2 } },
  { type: 'play', by: 'deepseek', point: { x: 3, y: 7 } },
  { type: 'play', by: 'user', point: { x: 7, y: 4 } },
  { type: 'play', by: 'deepseek', point: { x: 1, y: 7 } },
  { type: 'play', by: 'user', point: { x: 8, y: 2 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 4 } },
  { type: 'play', by: 'user', point: { x: 5, y: 1 } },
  { type: 'play', by: 'deepseek', point: { x: 2, y: 1 } },
  { type: 'play', by: 'user', point: { x: 7, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 8, y: 6 } },
  { type: 'play', by: 'user', point: { x: 6, y: 7 } },
  { type: 'play', by: 'deepseek', point: { x: 4, y: 8 } },
  { type: 'play', by: 'user', point: { x: 1, y: 4 } },
  { type: 'play', by: 'deepseek', point: { x: 6, y: 0 } },
  { type: 'play', by: 'user', point: { x: 8, y: 8 } },
  { type: 'play', by: 'deepseek', point: { x: 1, y: 2 } },
  { type: 'play', by: 'user', point: { x: 5, y: 6 } },
  { type: 'play', by: 'deepseek', point: { x: 2, y: 4 } },
  { type: 'play', by: 'user', point: { x: 7, y: 8 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 6 } },
  { type: 'play', by: 'user', point: { x: 3, y: 5 } },
  { type: 'play', by: 'deepseek', point: { x: 5, y: 3 } },
  { type: 'play', by: 'user', point: { x: 4, y: 2 } },
  { type: 'play', by: 'deepseek', point: { x: 7, y: 6 } },
  { type: 'play', by: 'user', point: { x: 3, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 8, y: 3 } },
  { type: 'play', by: 'user', point: { x: 5, y: 8 } },
  { type: 'play', by: 'deepseek', point: { x: 6, y: 5 } },
  { type: 'pass', by: 'user' },
  { type: 'pass', by: 'deepseek' },
]

const BEFORE_RESIGN: readonly GameAction[] = [
  { type: 'play', by: 'user', point: { x: 1, y: 0 } },
  { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
  { type: 'play', by: 'user', point: { x: 0, y: 1 } },
  { type: 'play', by: 'deepseek', point: { x: 4, y: 4 } },
  { type: 'pass', by: 'user' },
]

/**
 * A port whose `getState` lies about a replayed resignation. Restore must not
 * accept a non-terminal authoritative state for a record that resigned.
 */
function createNonTerminalPort(port: GoRulesPort): GoRulesPort {
  return new Proxy(port, {
    get(target, property) {
      if (property === 'getState') {
        return (gameId: string): GameState => ({
          ...target.getState(gameId),
          status: 'playing',
          outcome: null,
        })
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

describe('restoreFromCanonicalRecord round-trips a persisted game (Spec §28/§36)', () => {
  it('restores a 42-action sequence field-for-field from serialized JSON', () => {
    const gameId = 'recovered-long'
    const live = liveState(LONG_SEQUENCE, gameId)
    const persisted = serializeCanonicalGameRecord(canonicalRecord(LONG_SEQUENCE))
    const restored = restoreFromCanonicalRecord(persisted, createTenukiGoRulesPort(), {
      gameId,
      colors: USER_BLACK,
    })

    expect(LONG_SEQUENCE.length).toBeGreaterThanOrEqual(40)
    expect(restored.state).toEqual(live)
    expect(restored.state.stones).toEqual(live.stones)
    expect(restored.state.toPlay).toBe(live.toPlay)
    expect(restored.state.captures).toEqual(live.captures)
    expect(restored.state.moveNumber).toBe(live.moveNumber)
    expect(restored.state.consecutivePasses).toBe(live.consecutivePasses)
    expect(restored.state.lastMove).toEqual(live.lastMove)
    expect(restored.state.status).toBe('playing')
    expect(restored.state.outcome).toBeNull()

    expect(live.captures.user).toBeGreaterThanOrEqual(1)
    expect(restored.record).toEqual(canonicalRecord(LONG_SEQUENCE))
    expect(restored.resignation).toBeNull()
  })

  it('accepts an already parsed record and honours the supplied player colours', () => {
    const actions: readonly GameAction[] = [
      { type: 'play', by: 'deepseek', point: { x: 1, y: 0 } },
      { type: 'play', by: 'user', point: { x: 0, y: 0 } },
      { type: 'play', by: 'deepseek', point: { x: 0, y: 1 } },
      { type: 'pass', by: 'user' },
    ]
    const gameId = 'recovered-swapped'
    const live = liveState(actions, gameId, USER_WHITE)
    const restored = restoreFromCanonicalRecord(
      canonicalRecord(actions),
      createTenukiGoRulesPort(),
      { gameId, colors: USER_WHITE },
    )

    expect(restored.state).toEqual(live)
    expect(restored.state.captures.deepseek).toBe(1)
    expect(restored.state.toPlay).toBe('deepseek')
  })

  it('is deterministic across independent restores', () => {
    const persisted = serializeCanonicalGameRecord(canonicalRecord(LONG_SEQUENCE))
    const first = restoreFromCanonicalRecord(persisted, createTenukiGoRulesPort(), {
      gameId: 'recovered-deterministic',
      colors: USER_BLACK,
    })
    const second = restoreFromCanonicalRecord(persisted, createTenukiGoRulesPort(), {
      gameId: 'recovered-deterministic',
      colors: USER_BLACK,
    })

    expect(first.state).toEqual(second.state)
  })
})

describe('resigned games stay terminal after restore (Spec §28/§36)', () => {
  it('restores the pre-resign board and derives winner/reason without board mutation', () => {
    const gameId = 'recovered-resign'
    const before = liveState(BEFORE_RESIGN, gameId)
    const actions: readonly GameAction[] = [...BEFORE_RESIGN, { type: 'resign', by: 'deepseek' }]
    const restored = restoreFromCanonicalRecord(
      serializeCanonicalGameRecord(canonicalRecord(actions)),
      createTenukiGoRulesPort(),
      { gameId, colors: USER_BLACK },
    )

    expect(restored.state.status).toBe('over')
    expect(restored.state.outcome).toEqual({
      winner: 'user',
      loser: 'deepseek',
      reason: 'resignation',
    })
    expect(restored.resignation).toEqual({ resignedBy: 'deepseek', winner: 'user' })

    expect(restored.state.stones).toEqual(before.stones)
    expect(restored.state.moveNumber).toBe(before.moveNumber)
    expect(restored.state.consecutivePasses).toBe(before.consecutivePasses)
    expect(restored.state.captures).toEqual(before.captures)
    expect(restored.state.lastMove).toEqual(before.lastMove)
  })

  it('keeps rejecting play, pass and resign after the restored resignation', () => {
    const gameId = 'recovered-resign-terminal'
    const actions: readonly GameAction[] = [...BEFORE_RESIGN, { type: 'resign', by: 'user' }]
    const port = createTenukiGoRulesPort()
    const restored = restoreFromCanonicalRecord(
      serializeCanonicalGameRecord(canonicalRecord(actions)),
      port,
      { gameId, colors: USER_BLACK },
    )

    expect(restored.state.outcome).toEqual({
      winner: 'deepseek',
      loser: 'user',
      reason: 'resignation',
    })

    const laterPlay = port.play(gameId, 'deepseek', { x: 6, y: 6 })
    expect(laterPlay.ok).toBe(false)
    if (laterPlay.ok) throw new Error('play was accepted after a restored resignation')
    expect(laterPlay.reason).toBe('game-over')

    const laterPass = port.pass(gameId, 'deepseek')
    expect(laterPass.ok).toBe(false)
    if (laterPass.ok) throw new Error('pass was accepted after a restored resignation')
    expect(laterPass.reason).toBe('game-over')

    const laterResign = port.resign(gameId, 'deepseek')
    expect(laterResign.ok).toBe(false)
    if (laterResign.ok) throw new Error('resign was accepted after a restored resignation')
    expect(laterResign.reason).toBe('game-over')

    expect(port.getState(gameId)).toEqual(restored.state)
  })

  it('restores an empty-board resignation as terminal with no stones', () => {
    const gameId = 'recovered-empty-resign'
    const restored = restoreFromCanonicalRecord(
      serializeCanonicalGameRecord(canonicalRecord([{ type: 'resign', by: 'user' }])),
      createTenukiGoRulesPort(),
      { gameId, colors: USER_BLACK },
    )

    expect(restored.state.status).toBe('over')
    expect(restored.state.stones).toEqual([])
    expect(restored.state.moveNumber).toBe(0)
    expect(restored.state.outcome).toEqual({
      winner: 'deepseek',
      loser: 'user',
      reason: 'resignation',
    })
  })

  it('rejects an authoritative state that is not terminal after a replayed resignation', () => {
    const gameId = 'recovered-lying-port'
    const port = createNonTerminalPort(createTenukiGoRulesPort())

    expect(() =>
      restoreFromCanonicalRecord(
        serializeCanonicalGameRecord(canonicalRecord([{ type: 'resign', by: 'user' }])),
        port,
        { gameId, colors: USER_BLACK },
      ),
    ).toThrow(/resignation.*not terminal|not terminal.*resignation/)
  })
})

describe('restoreFromCanonicalRecord rejects malformed persisted records', () => {
  const valid = canonicalRecord([{ type: 'pass', by: 'user' }])

  it('rejects invalid JSON', () => {
    expect(() =>
      restoreFromCanonicalRecord('{"boardSize":9', createTenukiGoRulesPort(), {
        gameId: 'recovered-bad-json',
        colors: USER_BLACK,
      }),
    ).toThrow(/not valid JSON/)
  })

  it('rejects unknown top-level keys such as Tenuki internals', () => {
    expect(() =>
      restoreFromCanonicalRecord(
        { ...valid, game: { internal: true } },
        createTenukiGoRulesPort(),
        { gameId: 'recovered-unknown-top', colors: USER_BLACK },
      ),
    ).toThrow(/unknown key game/)
  })

  it('rejects an unknown action key', () => {
    expect(() =>
      restoreFromCanonicalRecord(
        {
          ...valid,
          actions: [{ type: 'play', by: 'user', point: { x: 0, y: 0 }, moveNumber: 1 }],
        },
        createTenukiGoRulesPort(),
        { gameId: 'recovered-unknown-action', colors: USER_BLACK },
      ),
    ).toThrow(/unknown key moveNumber/)
  })

  it('rejects a record that keeps acting after a resignation', () => {
    expect(() =>
      restoreFromCanonicalRecord(
        canonicalRecord([
          { type: 'resign', by: 'user' },
          { type: 'pass', by: 'deepseek' },
        ]),
        createTenukiGoRulesPort(),
        { gameId: 'recovered-after-resign', colors: USER_BLACK },
      ),
    ).toThrow(/canonical action 2 follows a resignation/)
  })

  it('rejects non-canonical rule parameters and missing actions', () => {
    expect(() =>
      restoreFromCanonicalRecord(
        { ...valid, boardSize: 10 },
        createTenukiGoRulesPort(),
        { gameId: 'recovered-bad-size', colors: USER_BLACK },
      ),
    ).toThrow(/boardSize must be 9, 13 or 19/)

    expect(() =>
      restoreFromCanonicalRecord(
        { boardSize: 9, scoring: 'area', koRule: 'positional-superko', komi: 7.5 },
        createTenukiGoRulesPort(),
        { gameId: 'recovered-missing-actions', colors: USER_BLACK },
      ),
    ).toThrow(/actions must be an array/)
  })
})
