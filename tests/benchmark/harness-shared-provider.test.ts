import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { BenchmarkBudgetGate } from './budget-gate.js'
import { getBenchmarkFixture } from './fixtures.js'
import { CognitionBenchmarkBypassError, runFixture } from './harness.js'
import {
  BENCHMARK_LIVE_PROVIDER_ID,
  LiveBenchmarkProvider,
  type LiveBenchmarkConfig,
} from './live-provider.js'

/**
 * Per-turn accounting when one adapter serves several turns (WAVE-C-T10).
 *
 * The paid calibration runner constructs one `LiveBenchmarkProvider` before
 * the 24-turn loop and hands it to every turn through `createProvider`. The
 * adapter's dispatch counters are lifetime totals, so a request path that
 * subtracts only its own admitted requests from them reports every turn after
 * the first as an adapter retry (`CognitionBenchmarkBypassError`).
 *
 * These tests are offline: the stub `fetch` below answers with plain JSON and
 * never touches the network.
 */

const LIVE_CONFIG: LiveBenchmarkConfig = {
  provider: 'live',
  baseUrl: 'http://127.0.0.1:9/v1',
  apiKey: 'stub-key-not-real',
  model: 'stub-model',
  pricing: {
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 1.2,
  },
}

const FIXTURE = getBenchmarkFixture('opening-spread')
const GAME_ID = `benchmark-${FIXTURE.name}`

/** One `go.state` probe, then the fixture's legal commit, per turn. */
function createStubFetch(): {
  fetch: (input: string, init: RequestInit) => Promise<Response>
  calls: () => number
} {
  let calls = 0
  return {
    calls: () => calls,
    fetch: async (_input: string, _init: RequestInit): Promise<Response> => {
      calls += 1
      const action = FIXTURE.expectedFinalAction
      const toolCall = calls % 2 === 1
        ? { name: 'go_state', arguments: JSON.stringify({ gameId: GAME_ID }) }
        : action.kind === 'play'
          ? { name: 'go_play', arguments: JSON.stringify({ gameId: GAME_ID, point: action.point }) }
          : { name: 'go_pass', arguments: JSON.stringify({ gameId: GAME_ID }) }

      return new Response(JSON.stringify({
        model: LIVE_CONFIG.model,
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: `call-${calls}`,
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

/** Simulates one adapter-internal extra transport attempt during the turn. */
class ExtraTransportProvider extends LiveBenchmarkProvider {
  private injectedExtraAttempt = false
  private extraTransportAttempts = 0

  override get transportAttempts(): number {
    return super.transportAttempts + this.extraTransportAttempts
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* super.stream(options)
    if (!this.injectedExtraAttempt) {
      this.injectedExtraAttempt = true
      this.extraTransportAttempts = 1
    }
  }
}

/**
 * Injects one extra transport attempt in the next turn after `armNextTurn`,
 * not in the first turn the provider ever serves. That is what separates a
 * real in-turn retry (must still fail) from a lifetime counter carried over
 * from an earlier turn (must not).
 */
class DeferredExtraTransportProvider extends LiveBenchmarkProvider {
  private armed = false
  private extraTransportAttempts = 0

  override get transportAttempts(): number {
    return super.transportAttempts + this.extraTransportAttempts
  }

  armNextTurn(): void {
    this.armed = true
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* super.stream(options)
    if (this.armed) {
      this.armed = false
      this.extraTransportAttempts += 1
    }
  }
}

function runTurn(
  provider: LiveBenchmarkProvider,
  gate: BenchmarkBudgetGate,
): ReturnType<typeof runFixture> {
  return runFixture(FIXTURE, {
    gate,
    providerId: BENCHMARK_LIVE_PROVIDER_ID,
    model: LIVE_CONFIG.model,
    live: true,
    budget: { maxModelSteps: 4 },
    createProvider: () => provider,
  })
}

describe('benchmark request-path accounting per turn', () => {
  it('reports zero retries when one provider serves two turns', async () => {
    const stub = createStubFetch()
    const provider = new LiveBenchmarkProvider(LIVE_CONFIG, { fetch: stub.fetch })
    const gate = new BenchmarkBudgetGate()

    const first = await runTurn(provider, gate)
    const second = await runTurn(provider, gate)

    for (const metrics of [first, second]) {
      expect(metrics.requestPath.admittedRequests).toBe(2)
      expect(metrics.requestPath.llmRequests).toBe(2)
      expect(metrics.requestPath.transportAttempts).toBe(2)
      expect(metrics.requestPath.retryAttempts).toBe(0)
    }
    expect(stub.calls()).toBe(4)
    expect(gate.snapshot().requests).toBe(4)
  })

  it('still blocks a turn that really dispatches one extra transport attempt', async () => {
    const stub = createStubFetch()
    const provider = new ExtraTransportProvider(LIVE_CONFIG, { fetch: stub.fetch })
    const gate = new BenchmarkBudgetGate()

    const failure = await runTurn(provider, gate).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CognitionBenchmarkBypassError)
    expect((failure as Error).message).toMatch(/3 transport attempts for 2 admitted requests/)
  })

  it('blocks an extra attempt in the middle turn and still reports zero in the next', async () => {
    const stub = createStubFetch()
    const provider = new DeferredExtraTransportProvider(LIVE_CONFIG, { fetch: stub.fetch })
    const gate = new BenchmarkBudgetGate()

    const first = await runTurn(provider, gate)
    expect(first.requestPath.retryAttempts).toBe(0)

    provider.armNextTurn()
    const failure = await runTurn(provider, gate).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CognitionBenchmarkBypassError)
    expect((failure as Error).message).toMatch(/3 transport attempts for 2 admitted requests/)

    const third = await runTurn(provider, gate)
    expect(third.requestPath.retryAttempts).toBe(0)
    expect(third.requestPath.transportAttempts).toBe(2)
    expect(third.requestPath.admittedRequests).toBe(2)
    expect(stub.calls()).toBe(6)
  })
})
