/**
 * Per-lane awareness projections over the latest-value Bridge.
 *
 * Each lane reads only the counterpart projection produced for it, as a frozen
 * copy of the allowlisted contract fields. The projection never reads session
 * history, never re-projects another projection, and never forwards a handoff
 * message.
 */
import type {
  AffectedGroupDelta,
  GameNotice,
  WorkSnapshot,
} from '../contracts/bridge.js'
import type { BridgeRuntime } from './runtime.js'

/** What the Work lane may know about the Go lane. */
export type WorkLaneAwareness = { readonly latestGameNotice?: GameNotice }

/** What the Go lane may know about the Work lane. */
export type GoLaneAwareness = { readonly latestWorkSnapshot?: WorkSnapshot }

function copyDelta(delta: AffectedGroupDelta): AffectedGroupDelta {
  return Object.freeze({
    owner: delta.owner,
    stones: delta.stones,
    libertiesBefore: delta.libertiesBefore,
    libertiesAfter: delta.libertiesAfter,
  })
}

function copyNotice(notice: GameNotice): GameNotice {
  const copy: GameNotice = {
    gameId: notice.gameId,
    ...(notice.lastMove === undefined ? {} : { lastMove: notice.lastMove }),
    moveNumber: notice.moveNumber,
    toPlay: notice.toPlay,
    captures: notice.captures,
    status: notice.status,
  }

  if (notice.affectedGroups !== undefined) {
    const groups: AffectedGroupDelta[] = notice.affectedGroups.map(copyDelta)
    Object.freeze(groups)
    copy.affectedGroups = groups
  }

  return Object.freeze(copy)
}

function copySnapshot(snapshot: WorkSnapshot): WorkSnapshot {
  const runningJobs = [...snapshot.runningJobs]
  const blockers = [...snapshot.blockers]
  Object.freeze(runningJobs)
  Object.freeze(blockers)

  const copy: WorkSnapshot = {
    summary: snapshot.summary,
    runningJobs,
    blockers,
    ...(snapshot.lastResult === undefined ? {} : { lastResult: snapshot.lastResult }),
  }

  return Object.freeze(copy)
}

const NO_GAME_AWARENESS: WorkLaneAwareness = Object.freeze({})
const NO_WORK_AWARENESS: GoLaneAwareness = Object.freeze({})

/**
 * The only way one lane learns about the other lane.
 *
 * Reads are effectively O(1) with respect to conversation and game history: the
 * published payload is copied once and the copy is reused until that lane
 * publishes a new latest value.
 */
export class CrossLaneAwareness {
  readonly #runtime: BridgeRuntime
  #workView: { readonly source: GameNotice; readonly view: WorkLaneAwareness } | undefined
  #goView: { readonly source: WorkSnapshot; readonly view: GoLaneAwareness } | undefined

  constructor(runtime: BridgeRuntime) {
    this.#runtime = runtime
  }

  /** The frozen latest GameNotice, for the Work lane only. */
  forWorkLane(): WorkLaneAwareness {
    const notice = this.#runtime.latestGameNotice
    if (notice === undefined) return NO_GAME_AWARENESS
    if (this.#workView?.source !== notice) {
      this.#workView = {
        source: notice,
        view: Object.freeze({ latestGameNotice: copyNotice(notice) }),
      }
    }
    return this.#workView.view
  }

  /** The frozen latest WorkSnapshot, for the Go lane only. */
  forGoLane(): GoLaneAwareness {
    const snapshot = this.#runtime.latestWorkSnapshot
    if (snapshot === undefined) return NO_WORK_AWARENESS
    if (this.#goView?.source !== snapshot) {
      this.#goView = {
        source: snapshot,
        view: Object.freeze({ latestWorkSnapshot: copySnapshot(snapshot) }),
      }
    }
    return this.#goView.view
  }
}
