import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BenchmarkBudgetGate,
  BenchmarkSpendLedger,
  BenchmarkSpendLedgerError,
  EMPTY_BENCHMARK_SPEND_LEDGER,
  type BenchmarkPriceSchedule,
} from './budget-gate.js'

const PRICES: BenchmarkPriceSchedule = {
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 2,
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'benchmark-spend-ledger-'))
}

describe('durable benchmark spend ledger (WAVE-C-T10)', () => {
  it('starts at zero when the file is absent and round-trips a saved state', () => {
    const dir = tempDir()
    try {
      const ledger = new BenchmarkSpendLedger(join(dir, '.state', 'spend.json'))
      expect(ledger.load()).toEqual(EMPTY_BENCHMARK_SPEND_LEDGER)

      ledger.save({
        version: 1,
        requests: 3,
        inputTokens: 1_200,
        outputTokens: 400,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        settledCostUsd: 0.0021,
        reservedCostUsd: 0.0004,
        unsettledRequests: 0,
        unsettledCostUsd: 0,
      })

      expect(ledger.load()).toEqual({
        version: 1,
        requests: 3,
        inputTokens: 1_200,
        outputTokens: 400,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        settledCostUsd: 0.0021,
        reservedCostUsd: 0.0004,
        unsettledRequests: 0,
        unsettledCostUsd: 0,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists the worst-case reservation before dispatch and releases it after settlement', () => {
    const dir = tempDir()
    try {
      const ledgerPath = join(dir, 'spend.json')
      const gate = new BenchmarkBudgetGate(
        {},
        PRICES,
        'scripted',
        new BenchmarkSpendLedger(ledgerPath),
      )

      const decision = gate.beginRequest({
        step: 1,
        estimatedInputTokens: 1_000,
        proposedMaxTokens: 100,
        toolNames: ['go.state'],
      })
      expect(decision.reservedCostUsd).toBeCloseTo(0.0012, 12)

      const afterBegin = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>
      expect(afterBegin).toMatchObject({ requests: 1, reservedCostUsd: 0.0012 })

      gate.completeRequest({ step: 1, usage: { inputTokens: 1_000, outputTokens: 100 } })

      const afterSettlement = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>
      expect(afterSettlement).toMatchObject({
        requests: 1,
        inputTokens: 1_000,
        outputTokens: 100,
        reservedCostUsd: 0,
      })
      expect(afterSettlement.settledCostUsd).toBeCloseTo(0.0012, 12)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accumulates requests and spend across processes through the same ledger file', () => {
    const dir = tempDir()
    try {
      const ledgerPath = join(dir, '.state', 'spend.json')
      const scriptPath = join(dir, 'child.mjs')
      const gateModule = pathToFileURL(
        resolve(process.cwd(), 'tests/benchmark/budget-gate.ts'),
      ).href

      writeFileSync(scriptPath, [
        `import { BenchmarkBudgetGate, BenchmarkSpendLedger } from ${JSON.stringify(gateModule)}`,
        'const step = Number(process.argv[2])',
        'const ledgerPath = process.argv[3]',
        'const gate = new BenchmarkBudgetGate(',
        '  {},',
        '  { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },',
        "  'scripted',",
        '  new BenchmarkSpendLedger(ledgerPath),',
        ')',
        'gate.beginRequest({',
        '  step,',
        '  estimatedInputTokens: 1000,',
        '  proposedMaxTokens: 100,',
        "  toolNames: ['go.state'],",
        '})',
        'gate.completeRequest({ step, usage: { inputTokens: 1000, outputTokens: 100 } })',
        'process.stdout.write(JSON.stringify(gate.snapshot()))',
        '',
      ].join('\n'), 'utf8')

      const runChild = (step: number): Record<string, unknown> => {
        const output = execFileSync(
          process.execPath,
          ['--experimental-strip-types', scriptPath, String(step), ledgerPath],
          { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        )
        return JSON.parse(output) as Record<string, unknown>
      }

      expect(runChild(1)).toMatchObject({ requests: 1, inputTokens: 1000, outputTokens: 100 })
      expect(runChild(2)).toMatchObject({ requests: 2, inputTokens: 2000, outputTokens: 200 })

      const restored = new BenchmarkBudgetGate(
        {},
        PRICES,
        'scripted',
        new BenchmarkSpendLedger(ledgerPath),
      )
      const snapshot = restored.snapshot()
      expect(snapshot.requests).toBe(2)
      expect(snapshot.inputTokens).toBe(2_000)
      expect(snapshot.outputTokens).toBe(200)
      expect(snapshot.estimatedCostUsd).toBeCloseTo(0.0024, 12)
      expect(snapshot.reservedCostUsd).toBe(0)
      expect(snapshot.ledgerPath).toBe(ledgerPath)

      restored.beginRequest({
        step: 3,
        estimatedInputTokens: 500,
        proposedMaxTokens: 50,
        toolNames: ['go.state'],
      })
      restored.completeRequest({
        step: 3,
        usage: { inputTokens: 500, outputTokens: 50 },
      })

      const persisted = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>
      expect(persisted).toMatchObject({
        version: 1,
        requests: 3,
        inputTokens: 2_500,
        outputTokens: 250,
        reservedCostUsd: 0,
      })
      expect(persisted.settledCostUsd).toBeCloseTo(0.003, 12)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a corrupt ledger instead of silently resetting spend to zero', () => {
    const dir = tempDir()
    try {
      const ledgerPath = join(dir, 'spend.json')
      writeFileSync(ledgerPath, '{ not json', 'utf8')

      expect(() => new BenchmarkSpendLedger(ledgerPath).load()).toThrow(BenchmarkSpendLedgerError)
      expect(() => new BenchmarkBudgetGate(
        {},
        PRICES,
        'scripted',
        new BenchmarkSpendLedger(ledgerPath),
      )).toThrow(BenchmarkSpendLedgerError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a ledger with a negative counter', () => {
    const dir = tempDir()
    try {
      const ledgerPath = join(dir, 'spend.json')
      writeFileSync(ledgerPath, JSON.stringify({
        version: 1,
        requests: -1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        settledCostUsd: 0,
        reservedCostUsd: 0,
      }), 'utf8')

      expect(() => new BenchmarkSpendLedger(ledgerPath).load()).toThrow(/negative integer/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
