import type {
  BoardSize,
  Player,
  Point,
  SettlementConfirmation,
} from '../contracts/rules.js'

/**
 * Canonical game persistence boundary (Spec §28).
 *
 * The record stores only our own plain data. It never stores a Tenuki game,
 * and it never stores a derived result: `status`, `winner`, `reason`, score
 * and board snapshots stay owned by `GoRulesPort` and are recomputed by replay.
 */

export type PlayAction = {
  readonly type: 'play'
  readonly by: Player
  readonly point: Point
}

export type PassAction = {
  readonly type: 'pass'
  readonly by: Player
}

export type ResignAction = {
  readonly type: 'resign'
  readonly by: Player
}

export type GameAction = PlayAction | PassAction | ResignAction

/**
 * The confirmed dead-stone input of an accepted settlement. The derived score
 * and winner are deliberately not part of the record.
 */
export type SettlementRecord = SettlementConfirmation

export type CanonicalGameRecord = {
  readonly boardSize: BoardSize
  readonly scoring: 'area'
  readonly koRule: 'positional-superko'
  readonly komi: 7.5
  readonly actions: readonly GameAction[]
  readonly settlement?: SettlementRecord
}

const CANONICAL_TOP_LEVEL_KEYS = [
  'boardSize',
  'scoring',
  'koRule',
  'komi',
  'actions',
  'settlement',
] as const

const ACTION_KEYS: Readonly<Record<GameAction['type'], readonly string[]>> = {
  play: ['type', 'by', 'point'],
  pass: ['type', 'by'],
  resign: ['type', 'by'],
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} unknown key ${key}`)
  }
}

function parsePlayer(value: unknown, label: string): Player {
  if (value !== 'user' && value !== 'deepseek') {
    throw new Error(`${label} by must be "user" or "deepseek"`)
  }
  return value
}

function parsePoint(value: unknown, label: string): Point {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`)
  assertExactKeys(value, ['x', 'y'], label)
  const { x, y } = value
  if (
    typeof x !== 'number' ||
    !Number.isInteger(x) ||
    typeof y !== 'number' ||
    !Number.isInteger(y)
  ) {
    throw new Error(`${label} must contain integer x and y`)
  }
  return Object.freeze({ x, y })
}

function freezeAction(action: GameAction): GameAction {
  switch (action.type) {
    case 'play':
      return Object.freeze({
        type: 'play',
        by: action.by,
        point: Object.freeze({ x: action.point.x, y: action.point.y }),
      })
    case 'pass':
      return Object.freeze({ type: 'pass', by: action.by })
    case 'resign':
      return Object.freeze({ type: 'resign', by: action.by })
  }
}

function parseAction(value: unknown, index: number): GameAction {
  const label = `canonical action ${index + 1}:`
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`)

  const type = value.type
  if (type !== 'play' && type !== 'pass' && type !== 'resign') {
    throw new Error(`${label} unknown type`)
  }
  assertExactKeys(value, ACTION_KEYS[type], label)

  if (type === 'play') {
    return freezeAction({
      type,
      by: parsePlayer(value.by, label),
      point: parsePoint(value.point, `canonical action ${index + 1}: point`),
    })
  }
  return freezeAction({ type, by: parsePlayer(value.by, label) })
}

function parseSettlement(value: unknown): SettlementRecord {
  const label = 'canonical settlement:'
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`)
  assertExactKeys(value, ['deadStones', 'agreed'], label)

  if (value.agreed !== true) {
    throw new Error(`${label} agreed must be true (an unaccepted settlement is not persisted)`)
  }
  if (!Array.isArray(value.deadStones)) {
    throw new Error(`${label} deadStones must be an array`)
  }
  const deadStones = value.deadStones.map((point, index) =>
    parsePoint(point, `canonical settlement: point ${index + 1}`),
  )
  return Object.freeze({ deadStones: Object.freeze(deadStones), agreed: true })
}

export function validateCanonicalGameRecord(value: unknown): CanonicalGameRecord {
  if (!isPlainObject(value)) throw new Error('canonical game record must be a JSON object')
  assertExactKeys(value, CANONICAL_TOP_LEVEL_KEYS, 'canonical game record:')

  const { boardSize } = value
  if (boardSize !== 9 && boardSize !== 13 && boardSize !== 19) {
    throw new Error('canonical game record boardSize must be 9, 13 or 19')
  }
  if (value.scoring !== 'area') {
    throw new Error('canonical game record scoring must be "area"')
  }
  if (value.koRule !== 'positional-superko') {
    throw new Error('canonical game record koRule must be "positional-superko"')
  }
  if (value.komi !== 7.5) {
    throw new Error('canonical game record komi must be 7.5')
  }
  if (!Array.isArray(value.actions)) {
    throw new Error('canonical game record actions must be an array')
  }

  let resigned = false
  const actions = value.actions.map((action, index) => {
    if (resigned) throw new Error(`canonical action ${index + 1} follows a resignation`)
    const parsed = parseAction(action, index)
    if (parsed.type === 'resign') resigned = true
    return parsed
  })

  const settlement =
    value.settlement === undefined ? undefined : parseSettlement(value.settlement)
  if (settlement !== undefined && resigned) {
    throw new Error('canonical settlement follows a resignation')
  }

  return Object.freeze({
    boardSize,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    actions: Object.freeze(actions),
    ...(settlement === undefined ? {} : { settlement }),
  })
}

function toPlainRecord(record: CanonicalGameRecord): Record<string, unknown> {
  const canonical = validateCanonicalGameRecord(record)
  return {
    boardSize: canonical.boardSize,
    scoring: canonical.scoring,
    koRule: canonical.koRule,
    komi: canonical.komi,
    actions: canonical.actions.map(action =>
      action.type === 'play'
        ? {
            type: 'play',
            by: action.by,
            point: { x: action.point.x, y: action.point.y },
          }
        : action.type === 'pass'
          ? { type: 'pass', by: action.by }
          : { type: 'resign', by: action.by },
    ),
    ...(canonical.settlement === undefined
      ? {}
      : {
          settlement: {
            deadStones: canonical.settlement.deadStones.map(point => ({
              x: point.x,
              y: point.y,
            })),
            agreed: true as const,
          },
        }),
  }
}

export function serializeCanonicalGameRecord(record: CanonicalGameRecord): string {
  return JSON.stringify(toPlainRecord(record))
}

export function parseCanonicalGameRecord(json: string): CanonicalGameRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('canonical game record is not valid JSON')
  }
  return validateCanonicalGameRecord(parsed)
}
