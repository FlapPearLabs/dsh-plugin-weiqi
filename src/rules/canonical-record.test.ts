import { describe, expect, it } from 'vitest'
import type { CanonicalGameRecord, GameAction, SettlementRecord } from './canonical-record.js'
import {
  parseCanonicalGameRecord,
  serializeCanonicalGameRecord,
} from './canonical-record.js'

const PLAY_PASS_RESIGN: readonly GameAction[] = [
  { type: 'play', by: 'user', point: { x: 1, y: 0 } },
  { type: 'pass', by: 'deepseek' },
  { type: 'resign', by: 'user' },
]

function record(
  actions: readonly GameAction[] = PLAY_PASS_RESIGN,
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

function parseJson(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>
}

describe('CanonicalGameRecord persistence (Spec §28)', () => {
  it('serializes only the canonical Spec §28 shape and never a derived result truth', () => {
    const wire = parseJson(serializeCanonicalGameRecord(record()))

    expect(Object.keys(wire).sort()).toEqual(['actions', 'boardSize', 'koRule', 'komi', 'scoring'])
    for (const forbidden of [
      'status',
      'outcome',
      'winner',
      'loser',
      'reason',
      'toPlay',
      'moveNumber',
      'captures',
      'stones',
      'lastMove',
      'colors',
      'gameId',
      'game',
      'tenuki',
    ]) {
      expect(wire).not.toHaveProperty(forbidden)
    }

    const actions = wire.actions as Record<string, unknown>[]
    expect(actions.map(action => action.type)).toEqual(['play', 'pass', 'resign'])
    expect(Object.keys(actions[0] ?? {}).sort()).toEqual(['by', 'point', 'type'])
    expect(Object.keys(actions[1] ?? {}).sort()).toEqual(['by', 'type'])
    expect(Object.keys(actions[2] ?? {}).sort()).toEqual(['by', 'type'])
  })

  it('round-trips play, pass and resign actions without loss', () => {
    expect(parseCanonicalGameRecord(serializeCanonicalGameRecord(record()))).toEqual(record())
  })

  it('round-trips the accepted settlement input without copying a score or winner', () => {
    const withSettlement = record(
      [
        { type: 'play', by: 'user', point: { x: 1, y: 0 } },
        { type: 'pass', by: 'deepseek' },
        { type: 'pass', by: 'user' },
      ],
      { deadStones: [{ x: 2, y: 2 }], agreed: true },
    )
    const parsed = parseCanonicalGameRecord(serializeCanonicalGameRecord(withSettlement))

    expect(parsed).toEqual(withSettlement)
    const wire = parseJson(serializeCanonicalGameRecord(withSettlement))
    expect(Object.keys(wire.settlement as Record<string, unknown>).sort()).toEqual([
      'agreed',
      'deadStones',
    ])
    expect(wire.settlement).not.toHaveProperty('score')
    expect(wire.settlement).not.toHaveProperty('winner')
  })

  it('returns a deeply frozen record', () => {
    const parsed = parseCanonicalGameRecord(serializeCanonicalGameRecord(record()))

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.actions)).toBe(true)
    expect(Object.isFrozen(parsed.actions[0])).toBe(true)
    const play = parsed.actions[0]
    if (play?.type !== 'play') throw new Error('expected a play action')
    expect(Object.isFrozen(play.point)).toBe(true)
  })

  it('accepts both players for every action type', () => {
    const actions: readonly GameAction[] = [
      { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
      { type: 'pass', by: 'user' },
      { type: 'resign', by: 'deepseek' },
    ]
    expect(parseCanonicalGameRecord(serializeCanonicalGameRecord(record(actions)))).toEqual(
      record(actions),
    )
  })
})

describe('CanonicalGameRecord rejects non-canonical or unsafe payloads', () => {
  it('rejects a settlement recorded after a resignation', () => {
    const wire = JSON.stringify({
      ...record(),
      settlement: { deadStones: [], agreed: true },
    })
    expect(() => parseCanonicalGameRecord(wire)).toThrow(/settlement follows a resignation/)
  })

  it('rejects an action recorded after a resignation', () => {
    const wire = JSON.stringify({
      ...record(),
      actions: [
        { type: 'resign', by: 'user' },
        { type: 'play', by: 'deepseek', point: { x: 0, y: 0 } },
      ],
    })
    expect(() => parseCanonicalGameRecord(wire)).toThrow(/action 2 follows a resignation/)
  })

  it.each([
    ['board size', { boardSize: 7 }],
    ['scoring', { scoring: 'territory' }],
    ['ko rule', { koRule: 'simple-ko' }],
    ['komi', { komi: 6.5 }],
  ])('rejects a non-canonical %s', (_label, override) => {
    const wire = JSON.stringify({ ...record(), ...override })
    expect(() => parseCanonicalGameRecord(wire)).toThrow(/canonical game record/)
  })

  it.each([
    ['unknown action type', { type: 'move', by: 'user', point: { x: 0, y: 0 } }],
    ['unknown player', { type: 'pass', by: 'narrator' }],
    ['missing point', { type: 'play', by: 'user' }],
    ['non-integer point', { type: 'play', by: 'user', point: { x: 0.5, y: 0 } }],
  ])('rejects an action with an %s', (_label, action) => {
    const wire = JSON.stringify({ ...record(), actions: [action] })
    expect(() => parseCanonicalGameRecord(wire)).toThrow(/canonical action 1/)
  })

  it('rejects engine-shaped extras so Tenuki internals cannot enter the record', () => {
    const topLevel = JSON.stringify({
      ...record(),
      game: { currentState: {} },
    })
    expect(() => parseCanonicalGameRecord(topLevel)).toThrow(/canonical game record: unknown key game/)

    const pointExtra = JSON.stringify({
      ...record(),
      actions: [{ type: 'play', by: 'user', point: { x: 0, y: 0, isEmpty: true } }],
    })
    expect(() => parseCanonicalGameRecord(pointExtra)).toThrow(/canonical action 1: point unknown key isEmpty/)

    const actionExtra = JSON.stringify({
      ...record(),
      actions: [{ type: 'pass', by: 'user', moveNumber: 1 }],
    })
    expect(() => parseCanonicalGameRecord(actionExtra)).toThrow(/canonical action 1: unknown key moveNumber/)
  })

  it('rejects malformed settlement input', () => {
    const wire = JSON.stringify({
      ...record(),
      settlement: { deadStones: [{ x: 0, y: 0, color: 'black' }], agreed: true },
    })
    expect(() => parseCanonicalGameRecord(wire)).toThrow(
      /canonical settlement: point 1 unknown key color/,
    )
  })

  it('rejects invalid JSON', () => {
    expect(() => parseCanonicalGameRecord('{')).toThrow(/not valid JSON/)
  })

  it('refuses to serialize an in-memory record that is not canonical', () => {
    const invalid = {
      ...record(),
      actions: [{ type: 'move', by: 'user', point: { x: 0, y: 0 } }],
    } as unknown as CanonicalGameRecord

    expect(() => serializeCanonicalGameRecord(invalid)).toThrow(/canonical action 1/)
  })
})
