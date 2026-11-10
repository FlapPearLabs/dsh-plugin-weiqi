import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_FIXTURES,
  SPEC_38_CLASSES,
  type BenchmarkFixture,
} from './fixtures.js'
import { buildBenchmarkRecord } from './harness.js'
import {
  BENCHMARK_LIVE_PROVIDER_ID,
  BenchmarkLiveConfigError,
  type BenchmarkEnv,
} from './live-provider.js'

/**
 * Live record driver (WAVE-C-T10).
 *
 * These tests never touch the network: they inject a stub `fetch` through the
 * documented `liveFetch` seam, while the provider mode and price schedule come
 * from the same environment variables a paid run uses. Everything above the
 * HTTP transport — `LlmRuntime`, the `llm/stream` waterfall, the spend gate,
 * token mapping, `BlockAssembler`, the real `go.*` registry and the real
 * turn enforcement — is the production path.
 */

const STUB_CREDENTIAL = 'stub-credential-not-a-real-key'
const STUB_MODEL = 'stub-deepseek-chat'

const LIVE_ENV: BenchmarkEnv = Object.freeze({
  BENCHMARK_PROVIDER: 'live',
  BENCHMARK_BASE_URL: 'http://127.0.0.1:9/v1/',
  BENCHMARK_API_KEY: STUB_CREDENTIAL,
  BENCHMARK_MODEL: STUB_MODEL,
  BENCHMARK_PRICING_JSON: JSON.stringify({
    inputUsdPerMillionTokens: 0.27,
    outputUsdPerMillionTokens: 1.1,
  }),
})

type WireBody = Readonly<{
  messages: readonly { readonly role: string; readonly content: string | null }[]
}>

function wireBodyOf(init: RequestInit): WireBody {
  return JSON.parse(String(init.body)) as WireBody
}

/** Identify the fixture from the position text the harness put in the request. */
function fixtureOf(body: WireBody): BenchmarkFixture {
  const user = body.messages.find(message => message.role === 'user')
  const content = user?.content ?? ''
  const fixture = BENCHMARK_FIXTURES.find(candidate => content.startsWith(candidate.position))
  if (fixture === undefined) {
    throw new Error(`live stub could not identify the fixture from ${String(user?.content)}`)
  }
  return fixture
}

/** The harness must hand a live model the authoritative game id. */
function gameIdOf(body: WireBody): string {
  const user = body.messages.find(message => message.role === 'user')
  const match = /Authoritative gameId: (\S+)\./.exec(user?.content ?? '')
  if (match?.[1] === undefined) {
    throw new Error('live stub found no authoritative gameId in the user message')
  }
  return match[1]
}

/**
 * Deterministic live-model stand-in: each run first reads the board, then
 * commits the fixture's expected legal action. Responses are plain JSON, so
 * both the JSON and SSE translation paths are already covered by
 * `live-provider.test.ts`; here the point is the step/turn driver.
 */
function createStubFetch(): {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  calls: () => number
} {
  const callsPerFixture = new Map<string, number>()
  let calls = 0

  return {
    calls: () => calls,
    fetch: async (_input: string, init: RequestInit): Promise<Response> => {
      calls += 1
      const body = wireBodyOf(init)
      const fixture = fixtureOf(body)
      const gameId = gameIdOf(body)
      if (gameId !== `benchmark-${fixture.name}`) {
        throw new Error(`live stub received gameId ${gameId} for fixture ${fixture.name}`)
      }
      const call = (callsPerFixture.get(fixture.name) ?? 0) + 1
      callsPerFixture.set(fixture.name, call)

      const action = fixture.expectedFinalAction
      const toolCall = call % 2 === 1
        ? { name: 'go_state', arguments: JSON.stringify({ gameId }) }
        : action.kind === 'play'
          ? { name: 'go_play', arguments: JSON.stringify({ gameId, point: action.point }) }
          : { name: 'go_pass', arguments: JSON.stringify({ gameId }) }

      return new Response(JSON.stringify({
        model: STUB_MODEL,
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: `call-${fixture.name}-${call}`,
              type: 'function',
              function: toolCall,
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 420, completion_tokens: 48 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }
}

describe('live benchmark record driver (WAVE-C-T10)', () => {
  it('runs all eight §38 classes through the live adapter selected by env alone', async () => {
    const stub = createStubFetch()
    const record = await buildBenchmarkRecord({
      runs: 3,
      env: LIVE_ENV,
      liveFetch: stub.fetch,
      now: () => new Date('2026-11-04T00:00:00.000Z'),
    })

    // Environment selected the live adapter; the record says so honestly.
    expect(record.model).toMatchObject({
      kind: 'live-model',
      providerMode: 'live',
      provider: BENCHMARK_LIVE_PROVIDER_ID,
      id: STUB_MODEL,
      isDeepSeek: true,
      requestPath: 'dsh-llm-runtime',
      reportedModel: STUB_MODEL,
      reportedModels: [STUB_MODEL],
    })
    expect(record.model.disclosure).toContain('Live mode')
    expect(JSON.stringify(record)).not.toContain(STUB_CREDENTIAL)

    expect(record.classes.map(entry => entry.class)).toEqual([...SPEC_38_CLASSES])
    expect(record.runsPerFixture).toBe(3)

    const runs = record.classes.flatMap(entry => entry.fixtures.flatMap(fixture => fixture.runs))
    expect(runs).toHaveLength(SPEC_38_CLASSES.length * 3)
    for (const entry of record.classes) {
      for (const fixtureRecord of entry.fixtures) {
        expect(fixtureRecord.runs).toHaveLength(3)
        expect(fixtureRecord.variation.identicalStructuralMetrics).toBe(true)
      }
    }
    for (const run of runs) {
      // The live adapter really drove each step: no scripted step count.
      expect(run.outcome).toBe('completed')
      expect(run.modelSteps).toBe(2)
      expect(run.requestPath.provider).toBe(BENCHMARK_LIVE_PROVIDER_ID)
      expect(run.requestPath.llmRequests).toBe(2)
      expect(run.requestPath.admittedRequests).toBe(2)
      expect(run.requestPath.transportAttempts).toBe(2)
      expect(run.requestPath.retryAttempts).toBe(0)
      expect(run.requestPath.failures).toEqual([])
      expect(run.committedAction).toBe('play')
    }

    // Eight fixtures x three runs x two model steps = 48 stub HTTP requests.
    expect(stub.calls()).toBe(48)
    expect(record.budgetGate.requests).toBe(48)
    expect(record.budgetGate.stops).toEqual([])
  })

  it('records the USD estimate, the CNY cap and the rate used for the comparison', async () => {
    const stub = createStubFetch()
    const record = await buildBenchmarkRecord({
      runs: 1,
      env: LIVE_ENV,
      liveFetch: stub.fetch,
    })

    expect(record.budgetGate.maxEstimatedCostCny).toBe(6.66)
    expect(record.budgetGate.usdToCnyRate).toBe(7.1)
    expect(record.budgetGate.estimatedCostUsd).toBeGreaterThan(0)
    expect(record.budgetGate.estimatedCostCny).toBeCloseTo(
      record.budgetGate.estimatedCostUsd * 7.1,
      9,
    )
    expect(record.budgetGate.estimatedCostCny).toBeLessThan(6.66)
    expect(record.budgetGate.pricingSource).toBe('explicit')
  })

  it('fails closed on a half-configured live run instead of writing a scripted record', async () => {
    await expect(buildBenchmarkRecord({
      runs: 1,
      env: { BENCHMARK_PROVIDER: 'live' },
    })).rejects.toBeInstanceOf(BenchmarkLiveConfigError)
  })

  it('stays scripted when no environment snapshot is supplied', async () => {
    const record = await buildBenchmarkRecord({ runs: 1 })
    expect(record.model.providerMode).toBe('scripted')
    expect(record.model.kind).toBe('scripted-deterministic')
    expect(record.model.isDeepSeek).toBe(false)
  })
})
