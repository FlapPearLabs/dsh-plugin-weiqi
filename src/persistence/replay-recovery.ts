import type { GameState, GoRulesPort, Player, PlayerColors } from '../contracts/rules.js'
import type { CanonicalGameRecord, ResignAction } from '../rules/canonical-record.js'
import { parseCanonicalGameRecord, validateCanonicalGameRecord } from '../rules/canonical-record.js'
import { replayCanonicalGame } from '../rules/replay.js'

export type ReplayRecoveryRequest = {
  readonly gameId: string
  readonly colors: PlayerColors
}

export type RecoveredGame = {
  readonly record: CanonicalGameRecord
  readonly state: GameState
  readonly resignation: {
    readonly resignedBy: Player
    readonly winner: Player
  } | null
}

function parsePersistedRecord(persisted: unknown): CanonicalGameRecord {
  return typeof persisted === 'string'
    ? parseCanonicalGameRecord(persisted)
    : validateCanonicalGameRecord(persisted)
}

function finalResignation(record: CanonicalGameRecord): ResignAction | null {
  const last = record.actions[record.actions.length - 1]
  return last !== undefined && last.type === 'resign' ? last : null
}

function assertTerminalResignation(state: GameState, resignation: ResignAction): void {
  const winner = resignation.by === 'user' ? 'deepseek' : 'user'
  const outcome = state.outcome
  const consistent =
    state.status === 'over' &&
    outcome !== null &&
    outcome.reason === 'resignation' &&
    outcome.winner === winner &&
    outcome.loser === resignation.by
  if (!consistent) {
    throw new Error(
      `canonical resignation by ${resignation.by} is not terminal in the restored state: ` +
        `status ${state.status}, outcome ${JSON.stringify(outcome)}`,
    )
  }
}

/**
 * Restores a persisted canonical game through `GoRulesPort` (Spec §28/§36).
 *
 * The canonical record is the only persisted truth: play/pass replay through
 * the port, a final resign delegates to `port.resign` so the board is not
 * mutated and winner/reason come from the authoritative state, and a port that
 * fails to keep the replayed game terminal is rejected rather than trusted.
 */
export function restoreFromCanonicalRecord(
  persisted: unknown,
  port: GoRulesPort,
  request: ReplayRecoveryRequest,
): RecoveredGame {
  const record = parsePersistedRecord(persisted)
  const state = replayCanonicalGame(port, record, request)
  const resignation = finalResignation(record)

  if (resignation === null) {
    return { record, state, resignation: null }
  }

  assertTerminalResignation(state, resignation)
  return {
    record,
    state,
    resignation: {
      resignedBy: resignation.by,
      winner: resignation.by === 'user' ? 'deepseek' : 'user',
    },
  }
}
