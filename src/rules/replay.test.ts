import { describe, expect, it } from 'vitest'
import type {
  GameConfig,
  GameState,
  MoveResult,
  PlayerColors,
  ResignResult,
} from '../contracts/rules.js'
import type { CanonicalGameRecord, GameAction, SettlementRecord } from './canonical-record.js'
import { replayCanonicalGame } from './replay.js'
import { createTenukiGoRulesPort } from './tenuki-adapter.js'

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

function record(
  actions: readonly GameAction[],
  settlement?: SettlementRecord,
): CanonicalGameRecord {
  return {
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    actions,
    ...(settlement === undefined ? {} : { settlement }),
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

function liveSettledState(
  actions: readonly GameAction[],
  settlement: SettlementRecord,
  gameId: string,
  colors: PlayerColors = USER_BLACK,
): GameState {
  const port = createTenukiGoRulesPort()
  port.createGame(gameConfig(gameId, colors))
  actions.forEach((action, index) => applyAction(port, gameId, action, index))
  const settled = port.settle(gameId, settlement)
  if (!settled.settled) throw new Error(`live settlement was rejected: ${settled.reason}`)
  return port.getState(gameId)
}

function replay(
  actions: readonly GameAction[],
  gameId: string,
  colors: PlayerColors = USER_BLACK,
  settlement?: SettlementRecord,
): { port: ReturnType<typeof createTenukiGoRulesPort>; state: GameState } {
  const port = createTenukiGoRulesPort()
  const state = replayCanonicalGame(port, record(actions, settlement), { gameId, colors })
  return { port, state }
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
]

describe('replayCanonicalGame restores the authoritative state (Spec §28)', () => {
  it('reproduces a long play/pass sequence: board, turn, move number, passes and captures', () => {
    const live = liveState(LONG_SEQUENCE, 'canonical-long')
    const { state } = replay(LONG_SEQUENCE, 'canonical-long')

    expect(state).toEqual(live)
    expect(state.stones).toHaveLength(6)
    expect(state.captures.user).toBe(1)
    expect(state.toPlay).toBe('user')
    expect(state.consecutivePasses).toBe(2)
    expect(state.status).toBe('playing')
  })

  it('is deterministic across independent replays', () => {
    const first = replay(LONG_SEQUENCE, 'canonical-deterministic').state
    const second = replay(LONG_SEQUENCE, 'canonical-deterministic').state

    expect(first).toEqual(second)
  })

  it('honours the supplied player colours instead of assuming user is black', () => {
    const swapped: readonly GameAction[] = [
      { type: 'play', by: 'deepseek', point: { x: 1, y: 0 } },
      { type: 'play', by: 'user', point: { x: 0, y: 0 } },
      { type: 'play', by: 'deepseek', point: { x: 0, y: 1 } },
      { type: 'pass', by: 'user' },
    ]
    const live = liveState(swapped, 'canonical-swapped', USER_WHITE)
    const { state } = replay(swapped, 'canonical-swapped', USER_WHITE)

    expect(state).toEqual(live)
    expect(state.captures.deepseek).toBe(1)
    expect(state.toPlay).toBe('deepseek')
  })

  it('restores the initial state for an empty action log', () => {
    const initialPort = createTenukiGoRulesPort()
    const initial = initialPort.createGame(gameConfig('canonical-empty'))
    const { state } = replay([], 'canonical-empty')

    expect(state).toEqual(initial)
  })
})

describe('replayCanonicalGame treats resign as terminal, not as a board move (Spec §25/§28)', () => {
  const BEFORE_RESIGN: readonly GameAction[] = [
    { type: 'play', by: 'user', point: { x: 1, y: 0 } },
    { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
    { type: 'play', by: 'user', point: { x: 0, y: 1 } },
  ]

  it.each([
    ['deepseek', 'user'],
    ['user', 'deepseek'],
  ] as const)('derives winner = opponent when %s resigns', (resigner, winner) => {
    const before = liveState(BEFORE_RESIGN, `canonical-resign-${resigner}`)
    const actions: readonly GameAction[] = [...BEFORE_RESIGN, { type: 'resign', by: resigner }]
    const { state } = replay(actions, `canonical-resign-${resigner}`)

    expect(state.status).toBe('over')
    expect(state.outcome).toEqual({ winner, loser: resigner, reason: 'resignation' })
    expect(state.stones).toEqual(before.stones)
    expect(state.moveNumber).toBe(before.moveNumber)
    expect(state.consecutivePasses).toBe(before.consecutivePasses)
    expect(state.captures).toEqual(before.captures)
    expect(state.lastMove).toEqual(before.lastMove)
  })

  it('keeps the terminal state after replay and rejects every later play, pass and resign', () => {
    const before = liveState(BEFORE_RESIGN, 'canonical-terminal')
    const actions: readonly GameAction[] = [
      ...BEFORE_RESIGN,
      { type: 'resign', by: 'deepseek' },
    ]
    const { port, state } = replay(actions, 'canonical-terminal')

    expect(state.status).toBe('over')
    expect(state.stones).toEqual(before.stones)

    const laterPlay = port.play('canonical-terminal', 'user', { x: 5, y: 5 })
    expect(laterPlay.ok).toBe(false)
    if (laterPlay.ok) throw new Error('play was accepted after a replayed resignation')
    expect(laterPlay.reason).toBe('game-over')

    const laterPass = port.pass('canonical-terminal', 'user')
    expect(laterPass.ok).toBe(false)
    if (laterPass.ok) throw new Error('pass was accepted after a replayed resignation')
    expect(laterPass.reason).toBe('game-over')

    const laterResign = port.resign('canonical-terminal', 'user')
    expect(laterResign.ok).toBe(false)
    if (laterResign.ok) throw new Error('resign was accepted after a replayed resignation')
    expect(laterResign.reason).toBe('game-over')

    expect(port.getState('canonical-terminal')).toEqual(state)
  })

  it('marks resignation on an empty board terminal without adding a stone', () => {
    const actions: readonly GameAction[] = [{ type: 'resign', by: 'user' }]
    const { state } = replay(actions, 'replayed-empty-resign')

    expect(state.status).toBe('over')
    expect(state.outcome).toEqual({ winner: 'deepseek', loser: 'user', reason: 'resignation' })
    expect(state.stones).toEqual([])
    expect(state.moveNumber).toBe(0)
  })

  it('rejects a canonical log that keeps acting after a resignation', () => {
    const actions: readonly GameAction[] = [
      { type: 'resign', by: 'user' },
      { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
    ]

    expect(() => replay(actions, 'replayed-after-resign')).toThrow(
      /canonical action 2 follows a resignation/,
    )
  })
})

describe('replayCanonicalGame settlement and rejected actions', () => {
  it('restores an accepted settlement through the port without storing its result', () => {
    const actions: readonly GameAction[] = [
      { type: 'pass', by: 'user' },
      { type: 'pass', by: 'deepseek' },
    ]
    const settlement: SettlementRecord = { deadStones: [], agreed: true }
    const live = liveSettledState(actions, settlement, 'canonical-settled')
    const { state } = replay(actions, 'canonical-settled', USER_BLACK, settlement)

    expect(state).toEqual(live)
    expect(state.status).toBe('over')
    expect(state.outcome?.reason).toBe('score')
  })

  it('throws with the action index and port reason when the port rejects a replayed action', () => {
    const actions: readonly GameAction[] = [
      { type: 'play', by: 'user', point: { x: 0, y: 0 } },
      { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
    ]

    expect(() => replay(actions, 'replayed-illegal')).toThrow(
      /canonical action 2 \(play by deepseek\) was rejected: occupied/,
    )
  })
})
