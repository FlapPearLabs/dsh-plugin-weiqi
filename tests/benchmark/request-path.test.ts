import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  CallId,
  LlmAdapter,
  LlmError,
  createAssistantMessage,
  createUserMessage,
  isAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { GO_TOOL_DEFINITIONS, GO_TOOL_NAMES } from '../../src/tools/go/go-tools.js'
import {
  BenchmarkBudgetGate,
  BenchmarkBudgetStopError,
} from './budget-gate.js'
import { ScriptedLlmProvider } from './fake-provider.js'
import {
  BenchmarkProviderFailureError,
  BenchmarkRetryPolicyError,
  openBenchmarkRequestPath,
  type BenchmarkRequestInput,
} from './llm-request-path.js'
import { getBenchmarkFixture } from './fixtures.js'
import { SCRIPTED_MODEL_ID } from './scripted-model.js'
import {
  PROVIDER_TOOL_NAME_PATTERN,
  fromProviderToolName,
  toProviderToolName,
} from './tool-name-mapping.js'

function requestInput(step: number, maxTokens = 256): BenchmarkRequestInput {
  return {
    fixture: 'opening-spread',
    step,
    maxTokens,
    system: 'You are the DeepSeek Go lane of a companion Go game.',
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: 'Position: white to play.' }],
        source: { kind: 'user' },
      }),
    ],
    tools: [],
  }
}

/**
 * Wire-level stand-in for the real DeepSeek adapter: it performs a real HTTP
 * POST with `fetch` and, like a provider-owned adapter, may retry internally.
 * Its `attempts` counter is the ground truth for "how many times did this
 * request touch the wire".
 */
class HttpTransportProvider extends LlmAdapter {
  attempts = 0
  private streams = 0
  private markedStreams = 0
  private readonly endpoint: string
  private readonly retryLimit: number

  constructor(endpoint: string, retryLimit = 0) {
    super()
    this.endpoint = endpoint
    this.retryLimit = retryLimit
  }

  get physicalCalls(): number {
    return this.streams
  }

  get loopMarkedRequests(): number {
    return this.markedStreams
  }

  get transportAttempts(): number {
    return this.attempts
  }

  override providerRetryPolicy() {
    return {
      mode: 'normal' as const,
      maxRetries: this.retryLimit,
      retryableCodes: ['RATE_LIMIT'],
      initialDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streams += 1
    if (isAgentLoopRequest(options)) this.markedStreams += 1
    for (let attempt = 0; attempt <= this.retryLimit; attempt += 1) {
      this.attempts += 1
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: options.provider, model: options.model }),
      })
      await response.text()
      if (attempt === this.retryLimit) {
        throw new LlmError(
          `wire provider returned ${response.status}`,
          'RATE_LIMIT',
          { status: response.status },
        )
      }
    }
  }
}

async function startRateLimitedServer(): Promise<{
  url: string
  hits: () => number
  close: () => Promise<void>
}> {
  let hits = 0
  const server = createServer((request, response) => {
    hits += 1
    request.resume()
    request.on('end', () => {
      response.writeHead(429, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'rate limited' }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/chat/completions`,
    hits: () => hits,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => (error === undefined ? resolve() : reject(error)))
    }),
  }
}

describe('benchmark request path enforces the spend gate (WAVE-C-T10)', () => {
  it('refuses to open the path without a BenchmarkBudgetGate', async () => {
    const provider = new ScriptedLlmProvider(getBenchmarkFixture('opening-spread'), 'gate-bypass')

    // @ts-expect-error - the spend gate is a required argument; omitting it must not compile.
    await expect(openBenchmarkRequestPath(provider)).rejects.toBeInstanceOf(TypeError)
    await expect(
      openBenchmarkRequestPath(provider, undefined as unknown as BenchmarkBudgetGate),
    ).rejects.toThrow(/BenchmarkBudgetGate/)

    expect(provider.physicalCalls).toBe(0)
  })

  it('stops a request that declares a forbidden search tool before dispatch', async () => {
    const gate = new BenchmarkBudgetGate()
    const provider = new ScriptedLlmProvider(
      getBenchmarkFixture('opening-spread'),
      'forbidden-tool',
    )
    const path = await openBenchmarkRequestPath(provider, gate)

    try {
      const forbidden: ToolSchema = {
        name: 'web_search',
        description: 'search the web',
        parameters: { type: 'object' },
      }
      await expect(path.request({
        ...requestInput(1),
        tools: [forbidden],
      })).rejects.toBeInstanceOf(BenchmarkBudgetStopError)

      expect(gate.snapshot().stops.at(-1)?.gate).toBe('search-fetch-forbidden')
      expect(gate.snapshot().requests).toBe(0)
      expect(provider.physicalCalls).toBe(0)
    } finally {
      await path.dispose()
    }
  })

  it('admits and records every request inside the path, and refuses a repeated step', async () => {
    const gate = new BenchmarkBudgetGate()
    const provider = new ScriptedLlmProvider(getBenchmarkFixture('opening-spread'), 'gated-path')
    const path = await openBenchmarkRequestPath(provider, gate)

    try {
      const first = await path.request(requestInput(1))
      expect(first.requestIndex).toBe(1)
      const second = await path.request(requestInput(2))
      expect(second.requestIndex).toBe(2)

      expect(gate.snapshot().requests).toBe(2)
      expect(gate.snapshot().inputTokens).toBe(first.usage.inputTokens + second.usage.inputTokens)
      expect(path.stats().admittedRequests).toBe(2)
      expect(path.stats().llmRequests).toBe(2)

      await expect(path.request(requestInput(2))).rejects.toBeInstanceOf(BenchmarkBudgetStopError)
      expect(gate.snapshot().requests).toBe(2)
      expect(provider.physicalCalls).toBe(2)
      expect(gate.snapshot().stops.at(-1)?.gate).toBe('retries-forbidden')
    } finally {
      await path.dispose()
    }
  })

  it('maps every outbound tool name to the provider alphabet and restores tool calls', async () => {
    const gate = new BenchmarkBudgetGate()
    const provider = new ScriptedLlmProvider(
      getBenchmarkFixture('opening-spread'),
      'tool-name-round-trip',
    )
    const path = await openBenchmarkRequestPath(provider, gate)

    const tools: ToolSchema[] = GO_TOOL_DEFINITIONS.map(definition => ({
      name: definition.name,
      description: definition.description,
      parameters: { ...definition.parameters },
    }))
    const input = requestInput(1)

    try {
      const response = await path.request({
        ...input,
        tools,
        messages: [
          ...input.messages,
          createAssistantMessage({
            content: [{
              type: 'tool-call',
              id: CallId('prior-call'),
              name: 'go.state',
              arguments: '{}',
            }],
            source: { provider: 'benchmark-scripted', model: SCRIPTED_MODEL_ID },
          }),
        ],
      })

      const observed = provider.observedToolNames
      expect(observed).toHaveLength(tools.length)
      for (const name of observed) {
        expect(name).toMatch(PROVIDER_TOOL_NAME_PATTERN)
      }
      expect(observed).toContain('go_state')
      expect(observed).not.toContain('go.state')

      expect(provider.observedMessageToolCallNames).toEqual(['go_state'])

      expect(response.toolCalls.map(call => call.name)).toEqual([
        'go.state',
        'go.inspect_region',
        'go.try_move',
      ])
      for (const call of response.toolCalls) {
        expect(fromProviderToolName(toProviderToolName(call.name))).toBe(call.name)
        expect(GO_TOOL_NAMES).toContain(call.name)
      }
      expect(response.reportedModel).toBe(SCRIPTED_MODEL_ID)
      expect(response.modelDrift).toBe(false)
    } finally {
      await path.dispose()
    }
  })

  it('makes exactly one HTTP attempt when the transport fails, and counts no retry', async () => {
    const server = await startRateLimitedServer()
    const gate = new BenchmarkBudgetGate()
    const provider = new HttpTransportProvider(server.url)
    const path = await openBenchmarkRequestPath(provider, gate)

    try {
      await expect(path.request(requestInput(1))).rejects.toBeInstanceOf(BenchmarkProviderFailureError)

      expect(server.hits()).toBe(1)
      expect(provider.attempts).toBe(1)
      expect(path.stats().transportAttempts).toBe(1)
      expect(path.stats().admittedRequests).toBe(1)
      expect(path.stats().retryAttempts).toBe(0)
      expect(gate.snapshot().requests).toBe(1)
      expect(gate.snapshot().inputTokens).toBe(0)
    } finally {
      await path.dispose()
      await server.close()
    }
  })

  it('refuses an adapter that declares retries before any request leaves', async () => {
    const server = await startRateLimitedServer()
    const provider = new HttpTransportProvider(server.url, 3)
    const gate = new BenchmarkBudgetGate()

    try {
      await expect(openBenchmarkRequestPath(provider, gate)).rejects.toBeInstanceOf(
        BenchmarkRetryPolicyError,
      )
      expect(server.hits()).toBe(0)
      expect(provider.attempts).toBe(0)
      expect(gate.snapshot().requests).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('refuses a live-mode gate that has no explicit price schedule', async () => {
    const fixture = getBenchmarkFixture('opening-spread')
    await expect(
      (async () => {
        const gate = new BenchmarkBudgetGate({}, undefined, 'live')
        const path = await openBenchmarkRequestPath(
          new ScriptedLlmProvider(fixture, 'live-no-prices'),
          gate,
        )
        await path.dispose()
      })(),
    ).rejects.toThrow(/price schedule/)
  })
})
