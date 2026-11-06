/**
 * DSH-native delivery for the two Bridge projections.
 *
 * The two directions use different seams because their cost shapes differ
 * (Spec §9.1). The Go lane reads `latestWorkSnapshot` through a dynamic system
 * section that resolves a variable, so the request's system slot always carries
 * the newest snapshot and a superseded one never enters history. The Work lane
 * reads `latestGameNotice` through native runtime context, which appends one
 * snapshot per natural request that observes a change and lets DSH mark the
 * older one as superseded.
 *
 * Both providers only read the already-computed projection behind
 * `CrossLaneAwareness`; neither rescans Session history, the Go action log, or
 * tool history, so a read stays O(1) in conversation length. Delivery never
 * wakes a model and never queues a value.
 */
import type { GameNotice, WorkSnapshot } from '../contracts/bridge.js'
import type { CrossLaneAwareness } from './awareness.js'

export interface PromptSeam {
  section(section: {
    readonly name: string
    readonly order: number
    readonly text: string | ((context: unknown) => string)
  }): () => void
  variable(name: string, provider: (context: unknown) => string | undefined): () => void
  context(context: {
    readonly name: string
    readonly order: number
    readonly text: string | ((context: unknown) => string)
  }): () => void
}

export interface DeliveryTargets {
  readonly go: PromptSeam
  readonly work: PromptSeam
}

export const GO_SNAPSHOT_SECTION = 'companion-go:go-lane-work-snapshot'
export const GO_SNAPSHOT_VARIABLE = 'go_work_snapshot'
export const WORK_NOTICE_CONTEXT = 'companion-go:work-lane-game-notice'

export const GO_SNAPSHOT_ORDER = 40

export const WORK_NOTICE_ORDER = 40

export function renderWorkSnapshot(snapshot: WorkSnapshot): string {
  const lines = [
    'WORK_SNAPSHOT',
    `summary: ${snapshot.summary}`,
    `runningJobs: ${snapshot.runningJobs.join(', ')}`,
    `blockers: ${snapshot.blockers.join(', ')}`,
  ]
  if (snapshot.lastResult !== undefined) lines.push(`lastResult: ${snapshot.lastResult}`)
  return lines.join('\n')
}

export function renderGameNotice(notice: GameNotice): string {
  const lines = [
    'GAME_NOTICE',
    `gameId: ${notice.gameId}`,
    `moveNumber: ${notice.moveNumber}`,
    `toPlay: ${notice.toPlay}`,
    `captures: ${notice.captures}`,
    `status: ${notice.status}`,
  ]
  if (notice.lastMove !== undefined) lines.push(`lastMove: ${notice.lastMove}`)
  if (notice.affectedGroups !== undefined && notice.affectedGroups.length > 0) {
    lines.push('affectedGroups:')
    for (const group of notice.affectedGroups) {
      lines.push(
        `- ${group.owner} stones=${group.stones} liberties ${group.libertiesBefore}->${group.libertiesAfter}`,
      )
    }
  }
  return lines.join('\n')
}

export function bindBridgeDelivery(targets: DeliveryTargets, awareness: CrossLaneAwareness): void {
  targets.go.variable(GO_SNAPSHOT_VARIABLE, () => {
    const snapshot = awareness.forGoLane().latestWorkSnapshot
    return snapshot === undefined ? undefined : renderWorkSnapshot(snapshot)
  })
  targets.go.section({
    name: GO_SNAPSHOT_SECTION,
    order: GO_SNAPSHOT_ORDER,
    text: () => (awareness.forGoLane().latestWorkSnapshot === undefined ? '' : `{{${GO_SNAPSHOT_VARIABLE}}}`),
  })
  targets.work.context({
    name: WORK_NOTICE_CONTEXT,
    order: WORK_NOTICE_ORDER,
    text: () => {
      const notice = awareness.forWorkLane().latestGameNotice
      return notice === undefined ? '' : renderGameNotice(notice)
    },
  })
}
