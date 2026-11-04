/**
 * Latest-value owner for the cross-lane awareness Bridge.
 *
 * Each payload has exactly one slot. Updates carry already-computed
 * authoritative values; the runtime validates their factual shape, keeps only
 * the newest value, and exposes no observer or queue that could feed a
 * published value back into another projection.
 */
import type {
  CompanionBridge,
  GameNotice,
  WorkSnapshot,
} from '../contracts/bridge.js'
import { LatestValueSlot, type PublishOutcome } from './latest-value.js'
import { assertGameNotice, assertWorkSnapshot } from './schema.js'

export class BridgeRuntime {
  readonly #work = new LatestValueSlot<WorkSnapshot>()
  readonly #game = new LatestValueSlot<GameNotice>()

  get latestWorkSnapshot(): WorkSnapshot | undefined {
    return this.#work.value
  }

  get latestGameNotice(): GameNotice | undefined {
    return this.#game.value
  }

  /** Publish the newest native Work projection; older sequences are stale. */
  updateWork(snapshot: WorkSnapshot, sequence: number): PublishOutcome {
    assertWorkSnapshot(snapshot)
    return this.#work.publish(snapshot, sequence)
  }

  /** Publish the newest authoritative Go projection; older sequences are stale. */
  updateGame(notice: GameNotice, sequence: number): PublishOutcome {
    assertGameNotice(notice)
    return this.#game.publish(notice, sequence)
  }

  /** Read the current small projection without touching either source. */
  read(): CompanionBridge {
    const bridge: CompanionBridge = {}
    const work = this.#work.value
    const game = this.#game.value
    if (work !== undefined) bridge.latestWorkSnapshot = work
    if (game !== undefined) bridge.latestGameNotice = game
    return bridge
  }
}
