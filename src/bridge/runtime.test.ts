import { describe, expect, expectTypeOf, it } from 'vitest'
import type { CompanionBridge, GameNotice, WorkSnapshot } from '../contracts/bridge.js'
import { BridgeRuntime } from './runtime.js'
import { BridgeSchemaError } from './schema.js'

function notice(moveNumber: number, overrides: Partial<GameNotice> = {}): GameNotice {
  return {
    gameId: 'fixture',
    lastMove: `M${moveNumber}`,
    moveNumber,
    toPlay: 'deepseek',
    captures: 0,
    status: 'playing',
    ...overrides,
  }
}

function snapshot(summary: string): WorkSnapshot {
  return {
    summary,
    runningJobs: ['typecheck'],
    blockers: [],
    lastResult: 'previous run: passed',
  }
}

function countingSnapshot(): { snapshot: WorkSnapshot; reads: () => number } {
  let reads = 0
  const value: WorkSnapshot = {
    get summary() {
      reads += 1
      return 'hash normalization changed'
    },
    get runningJobs() {
      reads += 1
      return ['typecheck']
    },
    get blockers() {
      reads += 1
      return []
    },
    get lastResult() {
      reads += 1
      return 'previous run: passed'
    },
  }

  return { snapshot: value, reads: () => reads }
}

describe('Bridge latest-value runtime', () => {
  it('exposes nothing until an authoritative source publishes', () => {
    const runtime = new BridgeRuntime()

    expect(runtime.latestWorkSnapshot).toBeUndefined()
    expect(runtime.latestGameNotice).toBeUndefined()
    expect(runtime.read()).toEqual({})
    expectTypeOf(runtime.read()).toEqualTypeOf<CompanionBridge>()
  })

  it('coalesces rapid GameNotice updates into the newest notice', () => {
    const runtime = new BridgeRuntime()

    for (let moveNumber = 1; moveNumber <= 20; moveNumber += 1) {
      expect(runtime.updateGame(notice(moveNumber), moveNumber)).toBe('published')
    }

    const latest = runtime.read().latestGameNotice
    expect(latest?.moveNumber).toBe(20)
    expect(latest?.lastMove).toBe('M20')
    expect(Array.isArray(latest)).toBe(false)
    expectTypeOf(runtime.latestGameNotice).toEqualTypeOf<GameNotice | undefined>()
  })

  it('does not resurrect a stale GameNotice or WorkSnapshot', () => {
    const runtime = new BridgeRuntime()
    const newestNotice = notice(8)
    const staleNotice = notice(7)

    runtime.updateGame(newestNotice, 8)
    expect(runtime.updateGame(staleNotice, 7)).toBe('stale')
    expect(runtime.latestGameNotice).toBe(newestNotice)

    const newestWork = snapshot('newest fact')
    const staleWork = snapshot('older fact')
    runtime.updateWork(newestWork, 4)
    expect(runtime.updateWork(staleWork, 3)).toBe('stale')
    expect(runtime.latestWorkSnapshot).toBe(newestWork)
  })

  it('keeps the two Bridge payloads independent', () => {
    const runtime = new BridgeRuntime()
    const work = snapshot('typecheck complete')

    runtime.updateWork(work, 1)
    expect(runtime.latestGameNotice).toBeUndefined()
    expect(runtime.read()).toEqual({ latestWorkSnapshot: work })

    const game = notice(3)
    runtime.updateGame(game, 1)
    expect(runtime.latestWorkSnapshot).toBe(work)
    expect(runtime.read()).toEqual({
      latestWorkSnapshot: work,
      latestGameNotice: game,
    })
  })

  it('does not re-project published facts while reading', () => {
    const runtime = new BridgeRuntime()
    const { snapshot: work, reads } = countingSnapshot()

    runtime.updateWork(work, 1)
    const readsAfterUpdate = reads()
    expect(readsAfterUpdate).toBeGreaterThan(0)

    const first = runtime.read()
    const second = runtime.read()
    expect(runtime.latestWorkSnapshot).toBe(work)
    expect(second).toEqual(first)
    expect(reads()).toBe(readsAfterUpdate)

    runtime.updateGame(notice(1), 1)
    expect(reads()).toBe(readsAfterUpdate)
  })

  it('does not trigger a second update from a published payload', () => {
    const runtime = new BridgeRuntime()
    const game = notice(5)

    runtime.updateGame(game, 1)

    expect(runtime.latestWorkSnapshot).toBeUndefined()
    expect(runtime.read()).toEqual({ latestGameNotice: game })

    runtime.updateWork(snapshot('work changed'), 1)
    expect(runtime.latestGameNotice).toBe(game)
  })

  it('replaces affected groups instead of accumulating move history', () => {
    const runtime = new BridgeRuntime()
    runtime.updateGame(
      notice(1, {
        affectedGroups: [
          { owner: 'deepseek', stones: 12, libertiesBefore: 3, libertiesAfter: 1 },
          { owner: 'user', stones: 4, libertiesBefore: 4, libertiesAfter: 4 },
        ],
      }),
      1,
    )
    runtime.updateGame(
      notice(2, {
        affectedGroups: [
          { owner: 'user', stones: 3, libertiesBefore: 2, libertiesAfter: 1 },
        ],
      }),
      2,
    )

    expect(runtime.latestGameNotice?.affectedGroups).toEqual([
      { owner: 'user', stones: 3, libertiesBefore: 2, libertiesAfter: 1 },
    ])
  })

  it('rejects a GameNotice that carries a strategic label or command', () => {
    const runtime = new BridgeRuntime()
    const accepted = notice(1)
    runtime.updateGame(accepted, 1)

    const forbidden = { ...notice(2), urgency: 'CRITICAL DRAGON' }

    expect(() => runtime.updateGame(forbidden, 2)).toThrow(BridgeSchemaError)
    expect(runtime.latestGameNotice).toBe(accepted)
  })

  it('rejects a WorkSnapshot with invented progress or derived state', () => {
    const runtime = new BridgeRuntime()
    const accepted = snapshot('grounded')
    runtime.updateWork(accepted, 1)

    const invented = { ...snapshot('fabricated'), progressPercent: 75 }

    expect(() => runtime.updateWork(invented, 2)).toThrow(BridgeSchemaError)
    expect(runtime.latestWorkSnapshot).toBe(accepted)
  })

  it('returns the authoritative Work facts unchanged', () => {
    const runtime = new BridgeRuntime()
    const work = snapshot('hash normalization changed; validating again')

    runtime.updateWork(work, 1)

    expect(runtime.read().latestWorkSnapshot).toBe(work)
    expect(Object.keys(runtime.read().latestWorkSnapshot ?? {}).sort()).toEqual([
      'blockers',
      'lastResult',
      'runningJobs',
      'summary',
    ])
  })

  it('offers no queue, mailbox, or history surface', () => {
    const runtime = new BridgeRuntime()

    for (const forbidden of ['enqueue', 'dequeue', 'push', 'messages', 'history', 'subscribe']) {
      expect(forbidden in runtime).toBe(false)
    }
    expectTypeOf<Parameters<BridgeRuntime['updateWork']>[0]>().toEqualTypeOf<WorkSnapshot>()
    expectTypeOf<Parameters<BridgeRuntime['updateGame']>[0]>().toEqualTypeOf<GameNotice>()
  })
})
