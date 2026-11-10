import { describe, expect, it } from 'vitest'
import { BenchmarkBudgetGate } from './budget-gate.js'
import { getBenchmarkFixture } from './fixtures.js'
import { runFixture } from './harness.js'
import {
  BENCHMARK_LIVE_PROVIDER_ID,
  LiveBenchmarkProvider,
  type LiveBenchmarkConfig,
} from './live-provider.js'

/**
 * The live path must request the ceiling the calibration is configured to
 * exercise (WAVE-C-T10). `perRequestMaxTokens` is the measurement limit; the
 * scripted adapter's oversized 8192 proposal only exists to exercise the clamp.
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

/** Records the `max_tokens` field of every wire request; one state read, then commit. */
function createRecordingStubFetch(maxTokens: number[]): {
  fetch: (input: string, init: RequestInit) => Promise<Response>
} {
  let calls = 0
  return {
    fetch: async (_input: string, init: RequestInit): Promise<Response> => {
      calls += 1
      const body = JSON.parse(String(init.body)) as { max_tokens?: number }
      if (body.max_tokens !== undefined) maxTokens.push(body.max_tokens)

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
            tool_calls: [{ id: `call-${calls}`, type: 'function', function: toolCall }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 420, completion_tokens: 48 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }
}

describe('live benchmark per-request ceiling', () => {
  it('sends the configured perRequestMaxTokens instead of the scripted proposal', async () => {
    const sent: number[] = []
    const stub = createRecordingStubFetch(sent)
    const provider = new LiveBenchmarkProvider(LIVE_CONFIG, { fetch: stub.fetch })
    const gate = new BenchmarkBudgetGate(
      { maxOutputTokensPerRequest: 16_000 },
      LIVE_CONFIG.pricing,
      'live',
    )

    const metrics = await runFixture(FIXTURE, {
      gate,
      providerId: BENCHMARK_LIVE_PROVIDER_ID,
      model: LIVE_CONFIG.model,
      live: true,
      budget: { maxModelSteps: 4, perRequestMaxTokens: 16_000, maxTurnTokens: 128_000 },
      createProvider: () => provider,
    })

    expect(sent).toEqual([16_000, 16_000])
    expect(metrics.requestCaps).toEqual([16_000, 16_000])
    expect(metrics.requestPath.admittedRequests).toBe(2)
  })
})
