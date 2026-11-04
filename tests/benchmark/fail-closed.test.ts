import { describe, expect, it } from 'vitest'
import {
  CallId,
  LlmAdapter,
  LlmError,
  createUserMessage,
  isAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { BenchmarkBudgetGate } from './budget-gate.js'
import { BENCHMARK_PROVIDER_RETRY_POLICY } from './fake-provider.js'
import {
  BenchmarkAdapterCounterError,
  BenchmarkModelAliasDriftError,
  BenchmarkMissingUsageError,
  BenchmarkProviderFailureError,
  BenchmarkTruncatedStreamError,
  openBenchmarkRequestPath,
  type BenchmarkRequestInput,
} from './llm-request-path.js'
import { SCRIPTED_MODEL_ID } from './scripted-model.js'
import { BenchmarkToolNameError } from './tool-name-mapping.js'

class ProbeProvider extends LlmAdapter {
  attempts = 0
  private streams = 0
  private marked = 0
  private readonly produce: () => AsyncIterable<StreamChunk>

  constructor(produce: () => AsyncIterable<StreamChunk>) {
    super()
    this.produce = produce
  }

  get physicalCalls(): number {
    return this.streams
  }

  get loopMarkedRequests(): number {
    return this.marked
  }

  get transportAttempts(): number {
    return this.attempts
  }

  override providerRetryPolicy() {
    return BENCHMARK_PROVIDER_RETRY_POLICY
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streams += 1
    this.attempts += 1
    if (isAgentLoopRequest(options)) this.marked += 1
    yield* this.produce()
  }
}

/**
 * Streams a perfectly good response but exposes none of the audit counters the
 * benchmark reads, which is exactly the adapter D1 used to let through with
 * `llmRequests/-1` and a zero retry count.
 */
class UnmeteredProvider extends LlmAdapter {
  attempts = 0

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.attempts += 1
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/**
 * Counts stream invocations (so `physicalCalls` looks healthy) but exposes no
 * real transport counter; a stream-derived fallback would report zero retries
 * for an adapter that retried internally.
 */
class StreamCountedProvider extends LlmAdapter {
  attempts = 0
  private streams = 0
  private marked = 0

  get physicalCalls(): number {
    return this.streams
  }

  get loopMarkedRequests(): number {
    return this.marked
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streams += 1
    this.attempts += 1
    if (isAgentLoopRequest(options)) this.marked += 1
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function requestInput(step = 1): BenchmarkRequestInput {
  return {
    fixture: 'opening-spread',
    step,
    maxTokens: 256,
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

async function withPath(
  provider: LlmAdapter,
  body: (
    path: Awaited<ReturnType<typeof openBenchmarkRequestPath>>,
    gate: BenchmarkBudgetGate,
  ) => Promise<void>,
): Promise<void> {
  const gate = new BenchmarkBudgetGate()
  const path = await openBenchmarkRequestPath(provider, gate)
  try {
    await body(path, gate)
  } finally {
    await path.dispose()
  }
}

describe('benchmark fail-closed response handling (WAVE-C-T10)', () => {
  it('stops when the response has no usage and records no tokens', async () => {
    const provider = new ProbeProvider(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    await withPath(provider, async (path, gate) => {
      await expect(path.request(requestInput())).rejects.toBeInstanceOf(
        BenchmarkMissingUsageError,
      )

      expect(provider.attempts).toBe(1)
      expect(path.stats().retryAttempts).toBe(0)
      expect(path.stats().failures.map(failure => failure.kind)).toEqual(['missing-usage'])
      expect(gate.snapshot().requests).toBe(1)
      expect(gate.snapshot().inputTokens).toBe(0)
      expect(gate.snapshot().outputTokens).toBe(0)
      expect(gate.snapshot().reservedCostUsd).toBeGreaterThan(0)
    })
  })

  it('stops on a provider timeout without retrying', async () => {
    const provider = new ProbeProvider(async function* () {
      throw new LlmError('provider timed out', 'TIMEOUT')
    })

    await withPath(provider, async (path, gate) => {
      await expect(path.request(requestInput())).rejects.toBeInstanceOf(
        BenchmarkProviderFailureError,
      )

      const [failure] = path.stats().failures
      expect(failure?.kind).toBe('provider-timeout')
      expect(provider.attempts).toBe(1)
      expect(path.stats().retryAttempts).toBe(0)
      expect(gate.snapshot().requests).toBe(1)
      expect(gate.snapshot().inputTokens).toBe(0)
      expect(gate.snapshot().outputTokens).toBe(0)
    })
  })

  it('stops on a connection interruption mid-stream without retrying', async () => {
    const provider = new ProbeProvider(async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial response' }
      throw new LlmError('connection reset by peer', 'NETWORK_INTERRUPTED')
    })

    await withPath(provider, async (path, gate) => {
      await expect(path.request(requestInput())).rejects.toBeInstanceOf(
        BenchmarkProviderFailureError,
      )

      const [failure] = path.stats().failures
      expect(failure?.kind).toBe('connection-interrupted')
      expect(provider.attempts).toBe(1)
      expect(path.stats().retryAttempts).toBe(0)
      expect(gate.snapshot().requests).toBe(1)
      expect(gate.snapshot().inputTokens).toBe(0)
    })
  })

  it('stops and records a failure when the stream ends without a finish chunk', async () => {
    const provider = new ProbeProvider(async function* () {
      yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 30 } }
    })

    await withPath(provider, async (path, gate) => {
      await expect(path.request(requestInput())).rejects.toBeInstanceOf(
        BenchmarkTruncatedStreamError,
      )

      expect(path.stats().failures.map(failure => failure.kind)).toEqual(['truncated-stream'])
      expect(provider.attempts).toBe(1)
      expect(path.stats().retryAttempts).toBe(0)
      expect(gate.snapshot().requests).toBe(1)
      expect(gate.snapshot().inputTokens).toBe(120)
      expect(gate.snapshot().outputTokens).toBe(30)
      expect(gate.snapshot().reservedCostUsd).toBe(0)
    })
  })

  it('stops on model alias drift and records the reported model', async () => {
    const driftedModel = 'deepseek-alias-drift-v9'
    const provider = new ProbeProvider(async function* () {
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: { response: { model: driftedModel } },
      }
    })

    await withPath(provider, async (path, gate) => {
      let caught: unknown
      try {
        await path.request(requestInput())
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(BenchmarkModelAliasDriftError)
      expect((caught as BenchmarkModelAliasDriftError).configured).toBe(SCRIPTED_MODEL_ID)
      expect((caught as BenchmarkModelAliasDriftError).reported).toBe(driftedModel)

      expect(path.stats().modelObservations).toEqual([{
        step: 1,
        configured: SCRIPTED_MODEL_ID,
        reported: driftedModel,
        drifted: true,
      }])
      expect(path.stats().failures.map(failure => failure.kind)).toEqual(['model-alias-drift'])
      expect(gate.snapshot().inputTokens).toBe(100)
      expect(gate.snapshot().outputTokens).toBe(10)
      expect(gate.snapshot().reservedCostUsd).toBe(0)
    })
  })

  it('fails closed when the model returns an unknown tool name', async () => {
    const id = CallId('unknown-tool-call')
    const provider = new ProbeProvider(async function* () {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id,
        name: 'go_teleport',
        argumentsDelta: '{}',
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: 'go_teleport', arguments: '{}' },
      }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield {
        type: 'finish',
        reason: { kind: 'tool-calls' },
        replayState: { response: { model: SCRIPTED_MODEL_ID } },
      }
    })

    await withPath(provider, async (path, gate) => {
      await expect(path.request(requestInput())).rejects.toBeInstanceOf(BenchmarkToolNameError)

      expect(path.stats().failures.map(failure => failure.kind)).toEqual(['unknown-tool-name'])
      expect(gate.snapshot().requests).toBe(1)
      expect(gate.snapshot().inputTokens).toBe(100)
      expect(gate.snapshot().outputTokens).toBe(10)
    })
  })

  it('refuses an adapter that does not expose the dispatch and retry counters', async () => {
    const provider = new UnmeteredProvider()
    const gate = new BenchmarkBudgetGate()

    let caught: unknown
    try {
      await openBenchmarkRequestPath(provider, gate)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(BenchmarkAdapterCounterError)
    expect((caught as BenchmarkAdapterCounterError).counter).toBe('physicalCalls')
    expect(provider.attempts).toBe(0)
    expect(gate.snapshot().requests).toBe(0)
    expect(gate.snapshot().stops).toEqual([])
  })

  it('refuses a stream-counted adapter that has no real transport counter', async () => {
    const provider = new StreamCountedProvider()
    const gate = new BenchmarkBudgetGate()

    let caught: unknown
    try {
      await openBenchmarkRequestPath(provider, gate)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(BenchmarkAdapterCounterError)
    expect((caught as BenchmarkAdapterCounterError).counter).toBe('transportAttempts')
    expect(provider.attempts).toBe(0)
    expect(gate.snapshot().requests).toBe(0)
  })
})
