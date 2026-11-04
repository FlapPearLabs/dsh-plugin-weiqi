/**
 * Strict argument reading for model-facing tools.
 *
 * Unknown keys are refused instead of ignored: the same object also carries no
 * place for an evaluative argument (`best`, `winRate`, …) to slip through, and
 * a malformed call is rejected before any budget charge or port access.
 */
import type { Point } from '../../contracts/rules.js'
import { GoToolArgumentError } from './errors.js'

export function readArguments(
  toolPath: string,
  args: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  const record = asRecord(toolPath, args)
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new GoToolArgumentError(toolPath, `unknown argument "${key}"`)
    }
  }
  return record
}

export function readGameId(toolPath: string, record: Record<string, unknown>): string {
  const gameId = record.gameId
  if (typeof gameId !== 'string' || gameId.length === 0) {
    throw new GoToolArgumentError(toolPath, 'arguments.gameId must be a non-empty string')
  }
  return gameId
}

export function readPoint(toolPath: string, value: unknown, label: string): Point {
  const point = asRecord(toolPath, value, label)
  return { x: readInteger(toolPath, point.x, `${label}.x`), y: readInteger(toolPath, point.y, `${label}.y`) }
}

export function readRadius(toolPath: string, value: unknown): number | undefined {
  if (value === undefined) return undefined
  const radius = readInteger(toolPath, value, 'arguments.radius')
  if (radius < 0) throw new GoToolArgumentError(toolPath, 'arguments.radius must be >= 0')
  return radius
}

function readInteger(toolPath: string, value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new GoToolArgumentError(toolPath, `${label} must be an integer`)
  }
  return value
}

function asRecord(toolPath: string, args: unknown, label = 'arguments'): Record<string, unknown> {
  if (args === undefined) return {}
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new GoToolArgumentError(toolPath, `${label} must be a plain object`)
  }
  return args as Record<string, unknown>
}
