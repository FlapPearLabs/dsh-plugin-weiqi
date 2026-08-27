/** Latest factual Work projection visible to the Go lane. */
export type WorkSnapshot = {
  summary: string
  runningJobs: string[]
  blockers: string[]
  lastResult?: string
}

/** Objective change to a group directly affected by the latest move. */
export type AffectedGroupDelta = {
  owner: 'user' | 'deepseek'
  stones: number
  libertiesBefore: number
  libertiesAfter: number
}

/** Latest factual Go projection visible to the Work lane. */
export type GameNotice = {
  gameId: string
  lastMove?: string
  moveNumber: number
  toPlay: 'user' | 'deepseek'
  captures: number
  status: 'playing' | 'over'
  affectedGroups?: AffectedGroupDelta[]
}

/** Latest-value awareness bridge; never an operational-command queue. */
export type CompanionBridge = {
  latestWorkSnapshot?: WorkSnapshot
  latestGameNotice?: GameNotice
}
