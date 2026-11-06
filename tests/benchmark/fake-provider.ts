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
import { PROVIDER_TOOL_NAME_PATTERN, toProviderToolName } from './tool-name-mapping.js'

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
 *   the post-request gate is proven not to trust the request field;
 * - tool names: it emits the provider-safe names it received (`go_play`), like a
 *   real model echoing its tool catalog, so inbound restoration is exercised.
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

function wireToolNameOf(original: string): string {
  if (original === 'web_search') return original
  return toProviderToolName(original)
}

export class ScriptedLlmProvider extends LlmAdapter {
  private readonly adapter: ScriptedModelAdapter
  private readonly gameId: string
  private readonly requestLog: ProviderRequestRecord[] = []
  private readonly observedToolNameLog: string[] = []
  private readonly observedMessageToolNameLog: string[] = []
  private readonly reportedModelOverride: string | undefined
  private loopMarkedCount = 0

  constructor(fixture: BenchmarkFixture, gameId: string, reportedModel?: string) {
    super()
    this.adapter = createScriptedModelAdapter(fixture)
    this.gameId = gameId
    this.reportedModelOverride = reportedModel
  }

  get observedToolNames(): readonly string[] {
    return this.observedToolNameLog
  }

  get observedMessageToolCallNames(): readonly string[] {
    return this.observedMessageToolNameLog
  }

  get reportedModel(): string {
    return this.reportedModelOverride ?? SCRIPTED_MODEL_ID
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

  /** The no-network adapter sends exactly one transport attempt per stream(). */
  get transportAttempts(): number {
    return this.requestLog.length
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

    for (const tool of options.tools ?? []) {
      if (!PROVIDER_TOOL_NAME_PATTERN.test(tool.name)) {
        throw new Error(`Benchmark provider received a non-compliant tool name: ${tool.name}`)
      }
      this.observedToolNameLog.push(tool.name)
    }
    for (const message of options.messages) {
      for (const block of message.content) {
        if (block.type === 'tool-call') this.observedMessageToolNameLog.push(block.name)
      }
    }

    for (let index = 0; index < step.calls.length; index += 1) {
      const call = step.calls[index]
      if (call === undefined) continue
      const id = CallId(`benchmark-${step.index}-${index}`)
      const wireName = wireToolNameOf(call.tool)
      const rawArguments = JSON.stringify(benchmarkToolArguments(this.gameId, call))
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index,
        id,
        name: wireName,
        argumentsDelta: rawArguments,
      }
      yield {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id, name: wireName, arguments: rawArguments },
      }
    }

    yield {
      type: 'usage',
      usage: { inputTokens: step.inputTokens, outputTokens: step.outputTokens },
    }
    yield {
      type: 'finish',
      reason: step.calls.length > 0 ? { kind: 'tool-calls' } : { kind: 'stop' },
      replayState: { response: { model: this.reportedModel } },
    }
  }
}

export { SCRIPTED_MODEL_ID }
