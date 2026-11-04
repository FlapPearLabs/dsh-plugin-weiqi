import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AffectedGroupDelta,
  CompanionBridge,
  GameNotice,
  WorkSnapshot,
} from '../contracts/bridge.js'
import {
  assertGameNotice,
  assertWorkSnapshot,
  BridgeSchemaError,
} from './schema.js'

const notice: GameNotice = {
  gameId: 'fixture',
  lastMove: 'E5',
  moveNumber: 12,
  toPlay: 'deepseek',
  captures: 1,
  status: 'playing',
  affectedGroups: [
    {
      owner: 'deepseek',
      stones: 12,
      libertiesBefore: 3,
      libertiesAfter: 1,
    },
  ],
}

const snapshot: WorkSnapshot = {
  summary: 'hash normalization changed; validating again',
  runningJobs: ['typecheck'],
  blockers: [],
  lastResult: 'previous typecheck: passed',
}

describe('Bridge schema', () => {
  it('keeps the frozen contract keys exactly', () => {
    expectTypeOf<keyof CompanionBridge>().toEqualTypeOf<
      'latestWorkSnapshot' | 'latestGameNotice'
    >()
    expectTypeOf<keyof WorkSnapshot>().toEqualTypeOf<
      'summary' | 'runningJobs' | 'blockers' | 'lastResult'
    >()
    expectTypeOf<keyof GameNotice>().toEqualTypeOf<
      | 'gameId'
      | 'lastMove'
      | 'moveNumber'
      | 'toPlay'
      | 'captures'
      | 'status'
      | 'affectedGroups'
    >()
    expectTypeOf<keyof AffectedGroupDelta>().toEqualTypeOf<
      'owner' | 'stones' | 'libertiesBefore' | 'libertiesAfter'
    >()
  })

  it('accepts only objective GameNotice fields', () => {
    expect(() => assertGameNotice(notice)).not.toThrow()

    const minimal: GameNotice = {
      gameId: 'fixture',
      moveNumber: 0,
      toPlay: 'user',
      captures: 0,
      status: 'playing',
    }
    expect(() => assertGameNotice(minimal)).not.toThrow()
  })

  it.each([
    ['urgency', 'CRITICAL DRAGON'],
    ['dangerLabel', 'critical'],
    ['recommendedMove', 'N10'],
    ['winRate', 0.42],
    ['strategicScore', 9],
    ['command', 'request_focus'],
    ['pendingCommands', ['play']],
  ])('rejects the forbidden GameNotice field %s', (field, value) => {
    const forbidden = { ...notice, [field]: value }

    expect(() => assertGameNotice(forbidden)).toThrow(BridgeSchemaError)
    expect(() => assertGameNotice(forbidden)).toThrow(new RegExp(field))
  })

  it('rejects a forbidden field inside an affected-group delta', () => {
    const forbidden = {
      ...notice,
      affectedGroups: [{ ...notice.affectedGroups?.[0], dangerLabel: 'URGENT' }],
    }

    expect(() => assertGameNotice(forbidden)).toThrow(/"dangerLabel"/)
  })

  it('rejects non-objective GameNotice values', () => {
    const invalid = [
      { ...notice, toPlay: 'black' },
      { ...notice, status: 'paused' },
      { ...notice, moveNumber: -1 },
      { ...notice, captures: 0.5 },
      { ...notice, gameId: '' },
      { ...notice, affectedGroups: 'none' },
    ]

    for (const value of invalid) {
      expect(() => assertGameNotice(value)).toThrow(BridgeSchemaError)
    }
  })

  it('accepts a WorkSnapshot made only of Work facts', () => {
    expect(() => assertWorkSnapshot(snapshot)).not.toThrow()

    const minimal: WorkSnapshot = {
      summary: 'idle',
      runningJobs: [],
      blockers: [],
    }
    expect(() => assertWorkSnapshot(minimal)).not.toThrow()
  })

  it.each([
    ['progressPercent', 80],
    ['plan', ['validate', 'ship']],
    ['estimatedCompletion', 'soon'],
    ['blockingFocus', 'go'],
    ['lastResult', ['not-a-string']],
    ['runningJobs', 'typecheck'],
  ])('rejects the invented WorkSnapshot field %s', (field, value) => {
    const invented = { ...snapshot, [field]: value }

    expect(() => assertWorkSnapshot(invented)).toThrow(BridgeSchemaError)
    expect(() => assertWorkSnapshot(invented)).toThrow(new RegExp(field))
  })

  it('allows the latest terminal result to be absent without inventing one', () => {
    const { lastResult: _omitted, ...withoutResult } = snapshot

    expect(() => assertWorkSnapshot(withoutResult)).not.toThrow()
    expect(Object.hasOwn(withoutResult, 'lastResult')).toBe(false)
  })
})
