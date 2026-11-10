import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * Offline contract for the live-calibration launcher (WAVE-C-T10).
 *
 * The real runner ends by invoking `pnpm exec vitest`, so each case puts a
 * stub `pnpm` first on PATH. The stub records the environment the script
 * exported and exits without running anything: no network, no credential
 * beyond the fake literal, no paid request.
 */

const SCRIPT = resolve(process.cwd(), 'tests/benchmark/run-live-calibration.sh')
const OFFICIAL_GO_BASE_URL = 'https://opencode.ai/inference/go/openai/v1'
const APPROVED_MODEL = 'deepseek-v4.1-flash'
const DEFAULT_PRICING = {
  inputUsdPerMillionTokens: 0.3,
  outputUsdPerMillionTokens: 1.2,
  cacheReadUsdPerMillionTokens: 0.006,
}

type RunnerResult = Readonly<{
  readonly status: number | null
  readonly stderr: string
  readonly dump: Readonly<Record<string, string>>
}>

function parseDump(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const separator = line.indexOf('=')
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return values
}

function runRunner(env: Readonly<Record<string, string>>, mode = 'smoke'): RunnerResult {
  const dir = mkdtempSync(join(tmpdir(), 'c-t10-runner-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const dumpPath = join(dir, 'env.txt')
  const stub = join(bin, 'pnpm')
  writeFileSync(stub, [
    '#!/bin/sh',
    '{',
    '  printf \'PROVIDER=%s\\n\' "${BENCHMARK_PROVIDER-}"',
    '  printf \'BASE_URL=%s\\n\' "${BENCHMARK_BASE_URL-}"',
    '  printf \'API_KEY=%s\\n\' "${BENCHMARK_API_KEY-}"',
    '  printf \'MODEL=%s\\n\' "${BENCHMARK_MODEL-}"',
    '  printf \'PRICING=%s\\n\' "${BENCHMARK_PRICING_JSON-}"',
    '  printf \'MODE=%s\\n\' "${C_T10_LIVE_CALIBRATION-}"',
    '  printf \'ARGS=%s\\n\' "$*"',
    '} > "$DUMP_FILE"',
    'exit 0',
    '',
  ].join('\n'), 'utf8')
  chmodSync(stub, 0o755)

  const result = spawnSync('/bin/bash', [SCRIPT, mode], {
    cwd: resolve(process.cwd()),
    env: {
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: dir,
      DUMP_FILE: dumpPath,
      ...env,
    },
    encoding: 'utf8',
    timeout: 20_000,
  })

  let dump: Record<string, string> = {}
  try {
    dump = parseDump(readFileSync(dumpPath, 'utf8'))
  } catch {
    dump = {}
  }
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    dump,
  }
}

describe('live calibration runner configuration', () => {
  it('defaults to the official OpenCode Go chat-completions entry', () => {
    const result = runRunner({ OPENCODE_GO_API_KEY: 'test-key-not-real' })

    expect(result.status).toBe(0)
    expect(result.dump).toMatchObject({
      PROVIDER: 'live',
      BASE_URL: OFFICIAL_GO_BASE_URL,
      MODEL: APPROVED_MODEL,
      API_KEY: 'test-key-not-real',
      MODE: 'smoke',
    })
    expect(JSON.parse(result.dump.PRICING ?? '')).toEqual(DEFAULT_PRICING)
    expect(result.dump.ARGS).toContain('tests/benchmark/run-live-calibration.paid.test.ts')
  })

  it('preserves an explicitly supplied base URL, key, model and price schedule', () => {
    const explicitPricing = '{"inputUsdPerMillionTokens":9,"outputUsdPerMillionTokens":18,"cacheReadUsdPerMillionTokens":0.09}'
    const result = runRunner({
      OPENCODE_GO_API_KEY: 'ignored-when-explicit-key-is-set',
      BENCHMARK_BASE_URL: 'https://example.invalid/custom/v1',
      BENCHMARK_API_KEY: 'explicit-key-not-real',
      BENCHMARK_MODEL: 'explicit-model',
      BENCHMARK_PRICING_JSON: explicitPricing,
    })

    expect(result.status).toBe(0)
    expect(result.dump).toMatchObject({
      BASE_URL: 'https://example.invalid/custom/v1',
      API_KEY: 'explicit-key-not-real',
      MODEL: 'explicit-model',
      PRICING: explicitPricing,
    })
  })

  it('refuses a live run with no credential instead of calling an unauthenticated endpoint', () => {
    const result = runRunner({})

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('OPENCODE_GO_API_KEY is unset')
  })
})
