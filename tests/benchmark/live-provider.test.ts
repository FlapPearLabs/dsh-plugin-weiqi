import { describe, expect, it } from 'vitest'
import { createUserMessage, type ToolSchema } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createGoTurnEnforcement } from '../../src/budget/enforcement.js'
import { GoCapabilityGuard } from '../../src/runtime/go-capability-guard.js'
import { createTenukiGoRulesPort } from '../../src/rules/tenuki-adapter.js'
import { GO_TOOL_DEFINITIONS, GO_TOOL_NAMES } from '../../src/tools/go/go-tools.js'
import { registerGoTools } from '../../src/tools/go/go-tool-registry.js'
import { BenchmarkBudgetGate } from './budget-gate.js'
import { CANDIDATE_BUDGET, benchmarkGameConfig } from './fixtures.js'
import {
  BENCHMARK_LIVE_PROVIDER_ID,
  BenchmarkLiveConfigError,
  LIVE_BENCHMARK_ENV_VARS,
  LiveBenchmarkProvider,
  benchmarkProviderMode,
  type LiveRequestObservation,
  loadLiveBenchmarkConfig,
  usageFromProvider,
  type BenchmarkEnv,
  type LiveBenchmarkConfig,
} from './live-provider.js'
import { openBenchmarkRequestPath, type BenchmarkRequestInput } from './llm-request-path.js'
import { PROVIDER_TOOL_NAME_PATTERN } from './tool-name-mapping.js'

const STUB_CREDENTIAL = 'stub-credential-not-a-real-key'
const STUB_MODEL = 'stub-deepseek-chat'

const LIVE_ENV: BenchmarkEnv = {
  BENCHMARK_PROVIDER: 'live',
  BENCHMARK_BASE_URL: 'http://127.0.0.1:9/v1/',
  BENCHMARK_API_KEY: STUB_CREDENTIAL,
  BENCHMARK_MODEL: STUB_MODEL,
  BENCHMARK_PRICING_JSON: JSON.stringify({
    inputUsdPerMillionTokens: 0.27,
    outputUsdPerMillionTokens: 1.1,
  }),
}

function liveConfig(): LiveBenchmarkConfig {
  return loadLiveBenchmarkConfig(LIVE_ENV)
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function userMessage(): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text: 'Position: white to play.' }],
    source: { kind: 'user' },
  })
}

function goToolSchemas(): readonly ToolSchema[] {
  return GO_TOOL_DEFINITIONS.map(definition => ({
    name: definition.name,
    description: definition.description,
    parameters: { ...definition.parameters },
  }))
}

function requestInput(step = 1): BenchmarkRequestInput {
  return {
    fixture: 'live-stub',
    step,
    maxTokens: 256,
    system: 'You are the DeepSeek Go lane of a companion Go game.',
    messages: [userMessage()],
    tools: goToolSchemas(),
  }
}

describe('live benchmark provider entry (WAVE-C-T10)', () => {
  it('requires every live env variable and never falls back to scripted', () => {
    for (const variable of LIVE_BENCHMARK_ENV_VARS) {
      const env: Record<string, string | undefined> = { ...LIVE_ENV }
      delete env[variable]

      let caught: unknown
      try {
        loadLiveBenchmarkConfig(env)
      } catch (error) {
        caught = error
      }

      expect(caught, `missing ${variable} must fail`).toBeInstanceOf(BenchmarkLiveConfigError)
      expect((caught as BenchmarkLiveConfigError).missing).toContain(variable)
      expect(String(caught)).not.toContain(STUB_CREDENTIAL)
    }

    expect(benchmarkProviderMode({})).toBe('scripted')
    expect(benchmarkProviderMode({ BENCHMARK_PROVIDER: 'scripted' })).toBe('scripted')
    expect(benchmarkProviderMode({ BENCHMARK_PROVIDER: 'live' })).toBe('live')
    expect(() => benchmarkProviderMode({ BENCHMARK_PROVIDER: 'auto' })).toThrow(
      BenchmarkLiveConfigError,
    )
  })

  it('sends only provider-safe tool names in the live request body', async () => {
    const captured: { url: string; body: Record<string, unknown> }[] = []
    const provider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async (input, init) => {
        captured.push({ url: input, body: JSON.parse(String(init.body)) as Record<string, unknown> })
        return jsonResponse({
          model: STUB_MODEL,
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        })
      },
    })

    const chunks = []
    for await (const chunk of provider.stream({
      provider: BENCHMARK_LIVE_PROVIDER_ID,
      model: STUB_MODEL,
      messages: [userMessage()],
      tools: [...goToolSchemas()],
    })) {
      chunks.push(chunk)
    }

    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe('http://127.0.0.1:9/v1/chat/completions')
    expect(chunks.some(chunk => chunk.type === 'finish')).toBe(true)

    const body = (captured[0]?.body ?? {}) as {
      tools?: { function: { name: string } }[]
      stream?: boolean
    }
    const names = (body.tools ?? []).map(tool => tool.function.name)
    expect(names).toEqual(GO_TOOL_NAMES.map(name => name.replace(/\./g, '_')))
    expect(names).toContain('go_play')
    for (const name of names) {
      expect(name).toMatch(PROVIDER_TOOL_NAME_PATTERN)
    }
    expect(body.stream).toBe(true)
  })

  it('sends the Go session header and a benchmark-specific user agent', async () => {
    const captured: Record<string, string>[] = []
    const provider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async (_input, init) => {
        captured.push({ ...(init.headers as Record<string, string>) })
        return jsonResponse({
          model: STUB_MODEL,
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        })
      },
    })

    const chunks = []
    for await (const chunk of provider.stream({
      provider: BENCHMARK_LIVE_PROVIDER_ID,
      model: STUB_MODEL,
      messages: [userMessage()],
      sessionId: SessionId('benchmark-live-stub'),
    })) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBeGreaterThan(0)
    expect(captured).toHaveLength(1)
    expect(captured[0]?.['x-opencode-session']).toBe('benchmark-live-stub')
    expect(captured[0]?.['user-agent']).toMatch(/^dsh-plugin-weiqi-benchmark\//)
  })

  it('surfaces the transport cause without leaking the credential', async () => {
    const provider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async () => {
        const cause = Object.assign(new Error('Connect Timeout Error'), {
          code: 'UND_ERR_CONNECT_TIMEOUT',
        })
        throw new TypeError('fetch failed', { cause })
      },
    })

    let caught: unknown
    try {
      for await (const chunk of provider.stream({
        provider: BENCHMARK_LIVE_PROVIDER_ID,
        model: STUB_MODEL,
        messages: [userMessage()],
      })) {
        void chunk
      }
    } catch (error) {
      caught = error
    }

    expect(String(caught)).toContain('UND_ERR_CONNECT_TIMEOUT')
    expect(String(caught)).not.toContain(STUB_CREDENTIAL)
  })

  it('restores provider tool names and dispatches them through the real Go registry', async () => {
    const toolCallArguments = JSON.stringify({
      gameId: 'live-stub-game',
      point: { x: 2, y: 4 },
    })
    const completion = {
      model: STUB_MODEL,
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call-live-1',
            type: 'function',
            function: { name: 'go_play', arguments: toolCallArguments },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 40, completion_tokens: 8 },
    }

    const provider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async () => jsonResponse(completion),
    })

    const blocks = []
    for await (const chunk of provider.stream({
      provider: BENCHMARK_LIVE_PROVIDER_ID,
      model: STUB_MODEL,
      messages: [userMessage()],
      tools: [...goToolSchemas()],
    })) {
      if (chunk.type === 'block-end') blocks.push(chunk.block)
    }
    const toolBlock = blocks.find(block => block.type === 'tool-call')
    expect(toolBlock).toMatchObject({ name: 'go.play', arguments: toolCallArguments })

    const config = liveConfig()
    const gate = new BenchmarkBudgetGate({ maxRequests: 4 }, config.pricing, 'live')
    const path = await openBenchmarkRequestPath(provider, gate, {
      providerId: BENCHMARK_LIVE_PROVIDER_ID,
      model: config.model,
    })

    try {
      const response = await path.request(requestInput())
      const call = response.toolCalls[0]
      expect(call?.name).toBe('go.play')
      expect(GO_TOOL_NAMES).toContain(call?.name)

      const port = createTenukiGoRulesPort()
      const gameId = 'live-stub-game'
      port.createGame(benchmarkGameConfig(gameId))
      const opening = port.play(gameId, 'user', { x: 8, y: 8 })
      expect(opening.ok).toBe(true)

      const enforcement = createGoTurnEnforcement(CANDIDATE_BUDGET)
      enforcement.beginModelStep()
      const registry = registerGoTools({ port, enforcement, guard: new GoCapabilityGuard() })
      const dispatched = registry.invoke(call?.name ?? '', JSON.parse(call?.rawArguments ?? '{}'))
      expect(dispatched).toMatchObject({ ok: true })
      expect(enforcement.snapshot().committedAction).toBe('play')
    } finally {
      await path.dispose()
    }
  })

  it('waits for the complete streamed tool name before mapping it', async () => {
    // Two provider habits at once: fragments (`go_` + `play`) and a cumulative
    // name repeated on every delta (`go_` then `go_pass`). Mapping the first
    // fragment would throw and fail the whole turn.
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-split","function":{"name":"go_","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"play","arguments":"{\\"gameId\\":\\"g\\",\\"point\\":{\\"x\\":2,\\"y\\":4}}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call-cumulative","function":{"name":"go_","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"go_pass","arguments":"{\\"gameId\\":\\"g\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":30,"completion_tokens":8}}',
      'data: [DONE]',
      '',
    ].join('\n\n')

    const provider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async () => new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    })

    const nameDeltas: string[] = []
    const blocks = []
    for await (const chunk of provider.stream({
      provider: BENCHMARK_LIVE_PROVIDER_ID,
      model: STUB_MODEL,
      messages: [userMessage()],
      tools: [...goToolSchemas()],
    })) {
      if (chunk.type === 'tool-call-delta' && chunk.name !== undefined) nameDeltas.push(chunk.name)
      if (chunk.type === 'block-end') blocks.push(chunk.block)
    }

    // A partial fragment is never emitted, so no mapping error can escape.
    expect(nameDeltas).toEqual(['go.play', 'go.pass'])
    const toolBlocks = blocks.filter(block => block.type === 'tool-call')
    expect(toolBlocks.map(block => (block as { name: string }).name)).toEqual(['go.play', 'go.pass'])
  })

  it('observes every request with the provider usage object verbatim', async () => {
    const rawUsage = {
      prompt_tokens: 1234,
      completion_tokens: 567,
      prompt_cache_hit_tokens: 34,
    }
    const sse = [
      'data: {"model":"stub-deepseek-chat","choices":[{"delta":{"content":"reading"}}]}',
      `data: {"model":"stub-deepseek-chat","choices":[{"delta":{},"finish_reason":"stop"}],`
      + `"usage":${JSON.stringify(rawUsage)}}`,
      'data: [DONE]',
      '',
    ].join('\n\n')

    const observations: LiveRequestObservation[] = []
    const provider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async () => new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
      observe: observation => observations.push(observation),
    })

    for await (const _chunk of provider.stream({
      provider: BENCHMARK_LIVE_PROVIDER_ID,
      model: STUB_MODEL,
      messages: [userMessage()],
      tools: [...goToolSchemas()],
      maxTokens: 1024,
    })) {
      // Drain the stream so the observer fires.
    }

    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      wireFormat: 'sse',
      httpStatus: 200,
      requestedMaxTokens: 1024,
      reportedModel: STUB_MODEL,
      finishReason: 'stop',
      rawUsage,
      usage: { inputTokens: 1200, outputTokens: 567, cacheReadTokens: 34 },
    })
    expect(observations[0]?.durationMs).toBeGreaterThanOrEqual(0)

    const jsonObservations: LiveRequestObservation[] = []
    const jsonProvider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async () => jsonResponse({
        model: STUB_MODEL,
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: rawUsage,
      }),
      observe: observation => jsonObservations.push(observation),
    })

    for await (const _chunk of jsonProvider.stream({
      provider: BENCHMARK_LIVE_PROVIDER_ID,
      model: STUB_MODEL,
      messages: [userMessage()],
      maxTokens: 256,
    })) {
      // Drain the stream so the observer fires.
    }

    expect(jsonObservations).toHaveLength(1)
    expect(jsonObservations[0]).toMatchObject({
      wireFormat: 'json',
      requestedMaxTokens: 256,
      rawUsage,
      usage: { inputTokens: 1200, outputTokens: 567, cacheReadTokens: 34 },
    })
  })

  it('maps the Go endpoint cache-hit field onto the disjoint DSH tokens', () => {
    // The official Go entry reports cache hits under
    // `prompt_tokens_details.cached_tokens` rather than
    // `prompt_cache_hit_tokens`; treating them as uncached input would inflate
    // every turn total the calibration is trying to measure.
    expect(usageFromProvider({
      prompt_tokens: 1234,
      completion_tokens: 567,
      prompt_tokens_details: { cached_tokens: 1200 },
    })).toEqual({ inputTokens: 34, outputTokens: 567, cacheReadTokens: 1200 })

    expect(usageFromProvider({
      prompt_tokens: 1234,
      completion_tokens: 567,
      prompt_cache_hit_tokens: 34,
      prompt_tokens_details: { cached_tokens: 1200 },
    })).toEqual({ inputTokens: 1200, outputTokens: 567, cacheReadTokens: 34 })
  })

  it('reports usage exactly as the server returned it', async () => {
    const sse = [
      'data: {"model":"stub-deepseek-chat","choices":[{"delta":{"content":"reading"}}]}',
      'data: {"model":"stub-deepseek-chat","choices":[{"delta":{},"finish_reason":"stop"}],'
      + '"usage":{"prompt_tokens":1234,"completion_tokens":567,"prompt_cache_hit_tokens":34}}',
      'data: [DONE]',
      '',
    ].join('\n\n')

    const provider = new LiveBenchmarkProvider(liveConfig(), {
      fetch: async () => new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    })

    const config = liveConfig()
    const gate = new BenchmarkBudgetGate({ maxRequests: 4 }, config.pricing, 'live')
    const path = await openBenchmarkRequestPath(provider, gate, {
      providerId: BENCHMARK_LIVE_PROVIDER_ID,
      model: config.model,
    })

    try {
      const response = await path.request(requestInput())
      expect(response.usage).toEqual({
        inputTokens: 1200,
        outputTokens: 567,
        cacheReadTokens: 34,
      })
      expect(response.reportedModel).toBe(STUB_MODEL)

      const snapshot = gate.snapshot()
      expect(snapshot.inputTokens).toBe(1200)
      expect(snapshot.outputTokens).toBe(567)
      expect(snapshot.cacheReadTokens).toBe(34)
      expect(snapshot.requests).toBe(1)
    } finally {
      await path.dispose()
    }
  })
})
