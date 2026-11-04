import { describe, expect, expectTypeOf, it } from 'vitest'
import type { GameNotice, WorkSnapshot } from '../contracts/bridge.js'
import {
  CrossLaneAwareness,
  type GoLaneAwareness,
  type WorkLaneAwareness,
} from './awareness.js'
import { BridgeRuntime } from './runtime.js'
import { BridgeSchemaError } from './schema.js'

const HISTORY_KEYS = [
  'history',
  'moves',
  'moveHistory',
  'transcript',
  'board',
  'boards',
  'boardStates',
  'events',
  'messages',
  'toolCalls',
  'toolHistory',
  'sessionHistory',
  'handoff',
] as const

function notice(moveNumber: number): GameNotice {
  return {
    gameId: 'fixture',
    lastMove: `M${moveNumber}`,
    moveNumber,
    toPlay: moveNumber % 2 === 0 ? 'deepseek' : 'user',
    captures: Math.floor(moveNumber / 7),
    status: 'playing',
    affectedGroups: [
      { owner: 'deepseek', stones: 12, libertiesBefore: 3, libertiesAfter: 1 },
      { owner: 'user', stones: 4, libertiesBefore: 4, libertiesAfter: 4 },
      { owner: 'deepseek', stones: 7, libertiesBefore: 2, libertiesAfter: 2 },
    ],
  }
}

function snapshot(summary: string): WorkSnapshot {
  return {
    summary,
    runningJobs: ['typecheck', 'pytest'],
    blockers: [],
    lastResult: 'previous run: passed',
  }
}

/** Own keys of an object graph, including non-enumerable and symbol keys. */
function ownKeys(value: unknown, keys: Set<string | symbol> = new Set()): Set<string | symbol> {
  if (Array.isArray(value)) {
    for (const entry of value) ownKeys(entry, keys)
    return keys
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) {
      keys.add(key)
      ownKeys((value as Record<string | symbol, unknown>)[key], keys)
    }
  }
  return keys
}

/** Longest array reachable from a projection. */
function longestArray(value: unknown): number {
  if (Array.isArray(value)) {
    return Math.max(value.length, ...value.map((entry) => longestArray(entry)))
  }
  if (value !== null && typeof value === 'object') {
    return Math.max(
      0,
      ...Reflect.ownKeys(value).map((key) =>
        longestArray((value as Record<string | symbol, unknown>)[key]),
      ),
    )
  }
  return 0
}

describe('cross-lane awareness', () => {
  it('exposes nothing until the counterpart lane publishes', () => {
    const awareness = new CrossLaneAwareness(new BridgeRuntime())

    expect(awareness.forWorkLane()).toEqual({})
    expect(awareness.forGoLane()).toEqual({})
    expectTypeOf<keyof WorkLaneAwareness>().toEqualTypeOf<'latestGameNotice'>()
    expectTypeOf<keyof GoLaneAwareness>().toEqualTypeOf<'latestWorkSnapshot'>()
  })

  it('gives the Work lane only the latest GameNotice of a long game', () => {
    const runtime = new BridgeRuntime()
    const awareness = new CrossLaneAwareness(runtime)
    const rawGoTranscript: string[] = []
    const rawBoardStates: string[] = []

    for (let moveNumber = 1; moveNumber <= 400; moveNumber += 1) {
      rawGoTranscript.push(`raw-go-turn-${moveNumber}`, `raw-go-thought-${moveNumber}`)
      rawBoardStates.push(`raw-board-${moveNumber}`)
      runtime.updateGame(notice(moveNumber), moveNumber)
    }

    const view = awareness.forWorkLane()
    const serialized = JSON.stringify(view)

    expect(view.latestGameNotice?.moveNumber).toBe(400)
    expect(view.latestGameNotice?.affectedGroups).toEqual(
      notice(400).affectedGroups,
    )
    expect('latestWorkSnapshot' in view).toBe(false)
    expect(longestArray(view)).toBe(3)
    expect(serialized).not.toContain('raw-go-turn-')
    expect(serialized).not.toContain('raw-go-thought-')
    expect(serialized).not.toContain('raw-board-')

    const keys = ownKeys(view)
    for (const forbidden of HISTORY_KEYS) {
      expect(keys.has(forbidden)).toBe(false)
    }
    expect(ownKeys(view)).toEqual(
      new Set([
        'latestGameNotice',
        'gameId',
        'lastMove',
        'moveNumber',
        'toPlay',
        'captures',
        'status',
        'affectedGroups',
        'owner',
        'stones',
        'libertiesBefore',
        'libertiesAfter',
      ]),
    )
  })

  it('adds nothing to the Work awareness as the game keeps moving', () => {
    const longGameRuntime = new BridgeRuntime()
    const longGame = new CrossLaneAwareness(longGameRuntime)

    expect(longGame.forWorkLane()).toEqual({})

    for (let moveNumber = 1; moveNumber <= 400; moveNumber += 1) {
      longGameRuntime.updateGame(notice(moveNumber), moveNumber)
    }

    const longView = longGame.forWorkLane()

    expect(JSON.stringify(longView).length).toBe(
      JSON.stringify({ latestGameNotice: notice(400) }).length,
    )
    expect(JSON.stringify(longView).length).toBeLessThan(500)
    expect(longView).toEqual({ latestGameNotice: notice(400) })
    expect(longGame.forWorkLane()).toBe(longView)
  })

  it('gives the Go lane only WorkSnapshot facts and no Work transcript', () => {
    const runtime = new BridgeRuntime()
    const awareness = new CrossLaneAwareness(runtime)
    const rawWorkTranscript: string[] = []

    for (let entry = 1; entry <= 400; entry += 1) {
      rawWorkTranscript.push(`raw-work-tool-call-${entry}`, `raw-work-stdout-${entry}`)
    }
    for (let moveNumber = 1; moveNumber <= 400; moveNumber += 1) {
      runtime.updateGame(notice(moveNumber), moveNumber)
    }
    runtime.updateWork(snapshot('hash normalization changed; validating again'), 1)

    const view = awareness.forGoLane()
    const serialized = JSON.stringify(view)

    expect(view.latestWorkSnapshot).toEqual(
      snapshot('hash normalization changed; validating again'),
    )
    expect('latestGameNotice' in view).toBe(false)
    expect(longestArray(view)).toBe(2)
    expect(serialized).not.toContain('raw-work-')
    expect(view.latestWorkSnapshot?.summary).not.toMatch(/raw-go-/)
    expect(ownKeys(view)).toEqual(
      new Set([
        'latestWorkSnapshot',
        'summary',
        'runningJobs',
        'blockers',
        'lastResult',
      ]),
    )
    for (const forbidden of HISTORY_KEYS) {
      expect(ownKeys(view).has(forbidden)).toBe(false)
    }
  })

  it('never inherits hidden payload carrying another lane history', () => {
    const runtime = new BridgeRuntime()
    const awareness = new CrossLaneAwareness(runtime)

    const work = snapshot('hidden lanes rejected') as WorkSnapshot & Record<string, unknown>
    Object.defineProperty(work, 'history', {
      value: ['raw-work-turn-1'],
      enumerable: false,
    })
    Object.defineProperty(work, Symbol('transcript'), {
      value: ['raw-work-turn-2'],
      enumerable: false,
    })
    runtime.updateWork(work, 1)

    const game = notice(9) as GameNotice & Record<string, unknown>
    Object.defineProperty(game, 'board', {
      value: Array.from({ length: 361 }, (_, index) => `raw-board-${index}`),
      enumerable: false,
    })
    Object.defineProperty(game, 'moves', {
      value: ['raw-go-turn-1', 'raw-go-turn-2'],
      enumerable: false,
    })
    runtime.updateGame(game, 9)

    const workView = awareness.forWorkLane()
    const goView = awareness.forGoLane()

    expect(JSON.stringify(workView)).not.toContain('raw-board-')
    expect(JSON.stringify(workView)).not.toContain('raw-go-turn-')
    expect(JSON.stringify(goView)).not.toContain('raw-work-')
    expect(Reflect.ownKeys(workView.latestGameNotice ?? {})).toEqual([
      'gameId',
      'lastMove',
      'moveNumber',
      'toPlay',
      'captures',
      'status',
      'affectedGroups',
    ])
    expect(Reflect.ownKeys(goView.latestWorkSnapshot ?? {})).toEqual([
      'summary',
      'runningJobs',
      'blockers',
      'lastResult',
    ])
    expect(Object.getOwnPropertySymbols(goView.latestWorkSnapshot ?? {})).toEqual([])
    expect(Object.getPrototypeOf(goView.latestWorkSnapshot)).toBe(Object.prototype)
  })

  it('hands each lane its own frozen copy, not the authoritative array', () => {
    const runtime = new BridgeRuntime()
    const awareness = new CrossLaneAwareness(runtime)
    const jobs = ['typecheck']
    runtime.updateWork({ summary: 'running', runningJobs: jobs, blockers: [] }, 1)
    runtime.updateGame(notice(3), 3)

    const goView = awareness.forGoLane()
    const workView = awareness.forWorkLane()

    expect(goView.latestWorkSnapshot?.runningJobs).not.toBe(jobs)
    expect(Object.isFrozen(goView)).toBe(true)
    expect(Object.isFrozen(goView.latestWorkSnapshot)).toBe(true)
    expect(Object.isFrozen(goView.latestWorkSnapshot?.runningJobs)).toBe(true)
    expect(Object.isFrozen(workView.latestGameNotice?.affectedGroups)).toBe(true)
    expect(Object.isFrozen(workView.latestGameNotice?.affectedGroups?.[0])).toBe(true)

    expect(() => {
      ;(goView.latestWorkSnapshot?.runningJobs as string[]).push('pytest')
    }).toThrow(TypeError)
    expect(() => {
      ;(workView.latestGameNotice as GameNotice).moveNumber = 400
    }).toThrow(TypeError)

    expect(runtime.latestWorkSnapshot?.runningJobs).toEqual(['typecheck'])
    expect(runtime.latestGameNotice?.moveNumber).toBe(3)
  })

  it('does not re-project or grow across repeated reads', () => {
    const runtime = new BridgeRuntime()
    const awareness = new CrossLaneAwareness(runtime)
    let reads = 0
    const work: WorkSnapshot = {
      get summary() {
        reads += 1
        return 'one computed fact'
      },
      get runningJobs() {
        reads += 1
        return ['typecheck']
      },
      get blockers() {
        reads += 1
        return []
      },
    }

    runtime.updateWork(work, 1)
    runtime.updateGame(notice(120), 120)

    const first = awareness.forGoLane()
    const readsAfterFirst = reads
    expect(readsAfterFirst).toBeGreaterThan(0)

    for (let index = 0; index < 200; index += 1) {
      expect(awareness.forGoLane()).toBe(first)
      expect(JSON.stringify(awareness.forWorkLane())).toBe(
        JSON.stringify(awareness.forWorkLane()),
      )
    }

    expect(reads).toBe(readsAfterFirst)
    expect(JSON.stringify(first)).toBe(JSON.stringify(awareness.forGoLane()))
  })

  it('rejects a projection republished as another projection source', () => {
    const runtime = new BridgeRuntime()
    const awareness = new CrossLaneAwareness(runtime)
    runtime.updateGame(notice(4), 4)
    runtime.updateWork(snapshot('work facts'), 1)

    const forwarded = {
      ...(awareness.forWorkLane().latestGameNotice as GameNotice),
      latestWorkSnapshot: awareness.forGoLane().latestWorkSnapshot,
    }

    expect(() => runtime.updateGame(forwarded, 5)).toThrow(BridgeSchemaError)
    expect(() => runtime.updateGame(forwarded, 5)).toThrow(/latestWorkSnapshot/)
    expect(runtime.latestGameNotice?.moveNumber).toBe(4)
    expect(longestArray(awareness.forWorkLane())).toBe(3)
  })

  it('does not re-forward a handoff message as awareness', () => {
    const runtime = new BridgeRuntime()
    const awareness = new CrossLaneAwareness(runtime)

    for (const forbidden of [
      'enqueue',
      'dequeue',
      'push',
      'messages',
      'history',
      'subscribe',
      'inject',
      'handoff',
      'forwardHandoff',
      'forwardSourceMessage',
    ]) {
      expect(forbidden in awareness).toBe(false)
    }

    const withHandoff = {
      ...notice(6),
      handoff: '回去把剩下两个测试修掉。',
    }
    expect(() => runtime.updateGame(withHandoff, 6)).toThrow(BridgeSchemaError)
    expect(runtime.latestGameNotice).toBeUndefined()
    expect(JSON.stringify(awareness.forWorkLane())).not.toContain('回去把剩下两个测试修掉')
    expect(JSON.stringify(awareness.forGoLane())).not.toContain('回去把剩下两个测试修掉')
  })
})
