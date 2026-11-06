import type { Session, SessionStore } from '@deepseek-ai/dsh-session'
import { loadLatestCompanionState } from '../companion/persistence.js'
import type { AttentionMode, CompanionState } from '../contracts/companion.js'
import type { Lane, RuntimeFocusState } from '../contracts/focus.js'
import type { GoRulesPort, PlayerColors } from '../contracts/rules.js'
import { laneSessionId, resolveLaneSession } from '../runtime/lane-session.js'
import type { RecoveredGame } from './replay-recovery.js'
import { restoreFromCanonicalRecord } from './replay-recovery.js'

const ATTENTION_MODES = [
  'mofish',
  'normal',
  'strict',
  'manual',
] as const satisfies readonly AttentionMode[]

export type RecoveryGame = {
  readonly gameId: string
  readonly colors: PlayerColors
  readonly canonicalRecord: unknown
}

export type RecoveryInput = {
  readonly sessions: Pick<SessionStore, 'get'>
  readonly companionStatePath: string
  readonly game?: RecoveryGame
}

export type RestoredCompanion = {
  readonly state: CompanionState
  readonly attentionMode: AttentionMode
}

export type RecoveredRuntime = {
  readonly sessions: Readonly<Record<Lane, Session>>
  readonly focus: RuntimeFocusState
  readonly companion: RestoredCompanion | null
  readonly game: RecoveredGame | null
}

function requireLaneSession(sessions: Pick<SessionStore, 'get'>, lane: Lane): Session {
  const session = resolveLaneSession(sessions, lane)
  if (session === undefined) {
    throw new Error(`lane session ${laneSessionId(lane)} (${lane}) was not restored`)
  }
  return session
}

function assertAttentionMode(state: CompanionState): AttentionMode {
  const mode = state.attentionMode
  if (!ATTENTION_MODES.some(candidate => candidate === mode)) {
    throw new Error(`persisted CompanionState has an unknown attentionMode "${String(mode)}"`)
  }
  return mode
}

function restoreCompanion(state: CompanionState | undefined): RestoredCompanion | null {
  if (state === undefined) return null
  if (typeof state !== 'object') {
    throw new Error('persisted CompanionState snapshot is not an object')
  }
  return { state, attentionMode: assertAttentionMode(state) }
}

/**
 * Crash / resume recovery (Spec §36).
 *
 * Restores the two lane Sessions, the latest CompanionState with its attention
 * mode, and the authoritative board by replaying the persisted canonical record
 * through `GoRulesPort`. Focus always returns to Work: no transactional focus
 * recovery and no pending-command durability are added.
 */
export async function restoreCompanionRuntime(
  input: RecoveryInput,
  port: GoRulesPort,
): Promise<RecoveredRuntime> {
  const sessions = {
    work: requireLaneSession(input.sessions, 'work'),
    go: requireLaneSession(input.sessions, 'go'),
  }

  const companion = restoreCompanion(await loadLatestCompanionState(input.companionStatePath))

  const game =
    input.game === undefined
      ? null
      : restoreFromCanonicalRecord(input.game.canonicalRecord, port, {
          gameId: input.game.gameId,
          colors: input.game.colors,
        })

  return {
    sessions,
    focus: { activeLane: 'work', llmRunning: false },
    companion,
    game,
  }
}
