import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SPEC_38_CLASSES } from './fixtures.js'
import { buildBenchmarkRecord } from './harness.js'

const DEFAULT_OUT = 'docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json'

describe('cognition benchmark record emission', () => {
  it('builds a complete record and writes it only when an output path is requested', async () => {
    const record = await buildBenchmarkRecord({ runs: 3 })

    expect(record.classes.map(entry => entry.class)).toEqual([...SPEC_38_CLASSES])
    expect(record.runsPerFixture).toBe(3)
    for (const entry of record.classes) {
      for (const fixtureRecord of entry.fixtures) {
        expect(fixtureRecord.runs).toHaveLength(3)
        expect(fixtureRecord.variation.identicalStructuralMetrics).toBe(true)
      }
    }

    const out = process.env.COGNITION_BENCHMARK_OUT ?? ''
    if (out === '') return

    const path = resolve(process.cwd(), out === 'default' ? DEFAULT_OUT : out)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  })
})
