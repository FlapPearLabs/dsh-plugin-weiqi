/**
 * Runtime guards for the frozen Bridge payloads.
 *
 * The Bridge is awareness-only: these guards reject any payload that carries a
 * field outside the Spec §10/§11 shapes, so a command, ranking, danger label,
 * win rate, or invented Work progress cannot enter the latest-value runtime.
 */
import type {
  AffectedGroupDelta,
  GameNotice,
  WorkSnapshot,
} from '../contracts/bridge.js'

/** A Bridge payload violates the frozen factual shape. */
export class BridgeSchemaError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeSchemaError'
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BridgeSchemaError(`${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function assertKnownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new BridgeSchemaError(`${label} must not carry "${key}"`)
    }
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new BridgeSchemaError(`${label} must be a string`)
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assertString(value, label)
  if (value.length === 0) {
    throw new BridgeSchemaError(`${label} must not be empty`)
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new BridgeSchemaError(`${label} must be an array of strings`)
  }
  for (const [index, entry] of value.entries()) {
    assertString(entry, `${label}[${index}]`)
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BridgeSchemaError(`${label} must be a non-negative integer`)
  }
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BridgeSchemaError(`${label} must be one of ${allowed.join(', ')}`)
  }
}

const WORK_SNAPSHOT_KEYS = ['summary', 'runningJobs', 'blockers', 'lastResult'] as const
const GAME_NOTICE_KEYS = [
  'gameId',
  'lastMove',
  'moveNumber',
  'toPlay',
  'captures',
  'status',
  'affectedGroups',
] as const
const AFFECTED_GROUP_DELTA_KEYS = [
  'owner',
  'stones',
  'libertiesBefore',
  'libertiesAfter',
] as const

const OWNERS = ['user', 'deepseek'] as const
const STATUSES = ['playing', 'over'] as const

function assertAffectedGroupDelta(
  value: unknown,
  label: string,
): asserts value is AffectedGroupDelta {
  const record = asRecord(value, label)
  assertKnownKeys(record, AFFECTED_GROUP_DELTA_KEYS, label)
  assertOneOf(record.owner, OWNERS, `${label}.owner`)
  assertNonNegativeInteger(record.stones, `${label}.stones`)
  assertNonNegativeInteger(record.libertiesBefore, `${label}.libertiesBefore`)
  assertNonNegativeInteger(record.libertiesAfter, `${label}.libertiesAfter`)
}

/** Assert that a value is a factual Work projection with no derived state. */
export function assertWorkSnapshot(value: unknown): asserts value is WorkSnapshot {
  const record = asRecord(value, 'WorkSnapshot')
  assertKnownKeys(record, WORK_SNAPSHOT_KEYS, 'WorkSnapshot')
  assertNonEmptyString(record.summary, 'WorkSnapshot.summary')
  assertStringArray(record.runningJobs, 'WorkSnapshot.runningJobs')
  assertStringArray(record.blockers, 'WorkSnapshot.blockers')
  if ('lastResult' in record) {
    assertString(record.lastResult, 'WorkSnapshot.lastResult')
  }
}

/** Assert that a value is an objective GameNotice with no strategic judgement. */
export function assertGameNotice(value: unknown): asserts value is GameNotice {
  const record = asRecord(value, 'GameNotice')
  assertKnownKeys(record, GAME_NOTICE_KEYS, 'GameNotice')
  assertNonEmptyString(record.gameId, 'GameNotice.gameId')
  if ('lastMove' in record) {
    assertString(record.lastMove, 'GameNotice.lastMove')
  }
  assertNonNegativeInteger(record.moveNumber, 'GameNotice.moveNumber')
  assertOneOf(record.toPlay, OWNERS, 'GameNotice.toPlay')
  assertNonNegativeInteger(record.captures, 'GameNotice.captures')
  assertOneOf(record.status, STATUSES, 'GameNotice.status')
  if ('affectedGroups' in record) {
    const groups = record.affectedGroups
    if (!Array.isArray(groups)) {
      throw new BridgeSchemaError('GameNotice.affectedGroups must be an array')
    }
    for (const [index, group] of groups.entries()) {
      assertAffectedGroupDelta(group, `GameNotice.affectedGroups[${index}]`)
    }
  }
}
