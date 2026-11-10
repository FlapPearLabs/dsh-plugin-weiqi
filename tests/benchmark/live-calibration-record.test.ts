import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCalibrationDataset,
  formatRequestRow,
  summarizeCalibration,
  type CalibrationDataset,
} from './live-calibration.js'

const RAW = resolve(process.cwd(), 'docs/validation/C-T10-LIVE-CALIBRATION-RAW.json')
const REPORT = resolve(process.cwd(), 'docs/validation/C-T10-LIVE-CALIBRATION.md')
const HAS_RECORD = existsSync(RAW)

function load(): CalibrationDataset {
  return JSON.parse(readFileSync(RAW, 'utf8')) as CalibrationDataset
}

function rawNumber(raw: Record<string, unknown> | null, field: string): number | null {
  const value = raw?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

describe.runIf(HAS_RECORD)('committed live calibration record', () => {
  it('maps every raw provider usage row onto the disjoint DSH token fields', () => {
    const dataset = load()
    expect(dataset.schema).toBe('c-t10-live-calibration')
    expect(dataset.providerMode).toBe('live')
    expect(dataset.requests.length).toBeGreaterThan(0)

    for (const request of dataset.requests) {
      const raw = request.rawUsage
      const prompt = rawNumber(raw, 'prompt_tokens')
      const completion = rawNumber(raw, 'completion_tokens')
      if (prompt !== null) {
        const details = raw?.prompt_tokens_details
        const cache = rawNumber(raw, 'prompt_cache_hit_tokens')
          ?? rawNumber(
            typeof details === 'object' && details !== null
              ? details as Record<string, unknown>
              : null,
            'cached_tokens',
          )
          ?? 0
        expect(request.usage.inputTokens, `${request.id} input`).toBe(Math.max(0, prompt - cache))
      }
      if (completion !== null) {
        expect(request.usage.outputTokens, `${request.id} output`).toBe(completion)
      }
      expect(request.usage.totalTokens, `${request.id} total`).toBe(
        request.usage.inputTokens + request.usage.outputTokens,
      )
      expect(request.endpoint).toBe(dataset.endpoint)
      expect(request.configuredModel).toBe(dataset.model)
    }
  })

  it('keeps the dataset consistent and re-derivable from its own rows', () => {
    const dataset = load()
    const rebuilt = buildCalibrationDataset({
      generatedAt: dataset.generatedAt,
      endpoint: dataset.endpoint,
      model: dataset.model,
      priceSchedule: dataset.priceSchedule,
      turnBudget: dataset.turnBudget,
      caps: dataset.caps,
      session: dataset.session,
      turns: dataset.turns,
      requests: dataset.requests,
    })
    expect(rebuilt.turns).toHaveLength(dataset.turns.length)
    expect(rebuilt.requests).toHaveLength(dataset.requests.length)

    const summary = summarizeCalibration(dataset)
    expect(summary.session.requests).toBe(dataset.requests.length)
    expect(summary.session.inputTokens).toBe(
      dataset.requests.reduce((total, request) => total + request.usage.inputTokens, 0),
    )
    expect(summary.session.outputTokens).toBe(
      dataset.requests.reduce((total, request) => total + request.usage.outputTokens, 0),
    )
    expect(summary.completedTurns + summary.failedTurns + summary.budgetStops).toBe(
      dataset.turns.length,
    )
  })

  it('has a generated report that carries every raw request row verbatim', () => {
    expect(existsSync(REPORT)).toBe(true)
    const markdown = readFileSync(REPORT, 'utf8')
    const dataset = load()
    for (const request of dataset.requests) {
      expect(markdown).toContain(formatRequestRow(request))
    }
    expect(markdown).toContain(dataset.generatedAt)
    expect(markdown).toContain(dataset.endpoint)
    expect(markdown).toContain(dataset.model)
  })

  it('records no bearer credential or api key value', () => {
    const source = readFileSync(RAW, 'utf8') + readFileSync(REPORT, 'utf8')
    expect(source).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/)
    expect(source).not.toMatch(/api[_-]?key["']?\s*[:=]\s*["'][^"']{8,}/i)
  })
})
