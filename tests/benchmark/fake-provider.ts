import {
  CallId,
  LlmAdapter,
  isAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { BenchmarkFixture, ScriptedToolCall } from './fixtures.js'
import {
  SCRIPTED_MODEL_ID,
  createScriptedModelAdapter,
  type ScriptedModelAdapter,
} from './scripted-model.js'

/**
 * Zero-network stand-in for the DeepSeek provider (WAVE-C-T10).
 *
 * It implements the same abstract `LlmAdapter` contract the real provider
 * adapter implements — `stream()` yields the harness `StreamChunk` vocabulary —
 * and nothing else. `LlmRuntime` cannot tell it apart from a wire adapter, so
 * the benchmark exercises the real request path while making no network call
 * and reading no credential.
 *
 * The request-shaped differences from the real DeepSeek adapter are:
 * - transport: no HTTP fetch, no `attributionHeaders`, no serialization;
 * - usage: scripted synthetic counts instead of provider-reported usage;
 * - `maxTokens`: ignored on purpose (it reports the scripted output anyway), so
 *   the post-request gate is proven not to trust the request field.
 */
export const BENCHMARK_PROVIDER_ID = 'benchmark-scripted'

export const BENCHMARK_PROVIDER_RETRY_POLICY = Object.freeze({
  mode: 'normal' as const,
  maxRetries: 0,
  retryableCodes: [] as readonly string[],
  initialDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
})

export function benchmarkToolArguments(gameId: string, call: ScriptedToolCall): unknown {
  switch (call.tool) {
    case 'go.state':
    case 'go.pass':
    case 'go.resign':
    case 'go.request_deep_think':
      return call.tool === 'go.request_deep_think' ? {} : { gameId }
    case 'go.inspect_group':
    case 'go.try_move':
    case 'go.play':
      return { gameId, point: call.point }
    case 'go.inspect_region':
      return call.radius === undefined
        ? { gameId, point: call.point }
        : { gameId, point: call.point, radius: call.radius }
    case 'web_search':
      return { query: call.query }
  }
}

export type ProviderRequestRecord = Readonly<{
  readonly index: number
  readonly step: number
  readonly maxTokens: number
  readonly loopMarked: boolean
}>

export class ScriptedLlmProvider extends LlmAdapter {
  private readonly adapter: ScriptedModelAdapter
  private readonly gameId: string
  private readonly requestLog: ProviderRequestRecord[] = []
  private loopMarkedCount = 0

  constructor(fixture: BenchmarkFixture, gameId: string) {
    super()
    this.adapter = createScriptedModelAdapter(fixture)
    this.gameId = gameId
  }

  get stepCount(): number {
    return this.adapter.stepCount
  }

  get physicalCalls(): number {
    return this.requestLog.length
  }

  get loopMarkedRequests(): number {
    return this.loopMarkedCount
  }

  get requests(): readonly ProviderRequestRecord[] {
    return this.requestLog
  }

  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'Benchmark scripted provider (local, no network)' }
  }

  override providerRetryPolicy() {
    return BENCHMARK_PROVIDER_RETRY_POLICY
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = this.adapter.next()
    const loopMarked = isAgentLoopRequest(options)
    this.requestLog.push(Object.freeze({
      index: this.requestLog.length + 1,
      step: step.index + 1,
      maxTokens: options.maxTokens ?? 0,
      loopMarked,
    }))
    if (loopMarked) this.loopMarkedCount += 1

    for (let index = 0; index < step.calls.length; index += 1) {
      const call = step.calls[index]
      if (call === undefined) continue
      const id = CallId(`benchmark-${step.index}-${index}`)
      const rawArguments = JSON.stringify(benchmarkToolArguments(this.gameId, call))
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index,
        id,
        name: call.tool,
        argumentsDelta: rawArguments,
      }
      yield {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id, name: call.tool, arguments: rawArguments },
      }
    }

    yield {
      type: 'usage',
      usage: { inputTokens: step.inputTokens, outputTokens: step.outputTokens },
    }
    yield {
      type: 'finish',
      reason: step.calls.length > 0 ? { kind: 'tool-calls' } : { kind: 'stop' },
    }
  }
}

export { SCRIPTED_MODEL_ID }
