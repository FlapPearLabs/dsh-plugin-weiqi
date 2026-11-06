import {
  CallId,
  LlmAdapter,
  LlmError,
  isAgentLoopRequest,
  type ContentBlock,
  type FinishReason,
  type GenerateOptions,
  type Message,
  type StreamChunk,
  type TokenUsage,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { BenchmarkPriceSchedule } from './budget-gate.js'
import { fromProviderToolName, isKnownToolName, toProviderToolName } from './tool-name-mapping.js'

/**
 * Live benchmark provider entry (WAVE-C-T10).
 *
 * The scripted stand-in (`fake-provider.ts`) proves the request path without
 * network or credentials. This adapter is the real-model entry beside it: the
 * same pinned `LlmAdapter` contract, the same `StreamChunk` vocabulary, but the
 * request leaves as an HTTP `POST {base}/chat/completions` and the response —
 * plain JSON or SSE — is translated back into chunks. Nothing else changes:
 * `LlmRuntime`, the `llm/stream` waterfall, `BlockAssembler`, the request
 * path's spend gate and inbound/outbound tool-name mapping all still apply.
 *
 * Three deliberate properties:
 *
 * 1. **Environment gated, never downgraded.** `loadLiveBenchmarkConfig()` needs
 *    all five `BENCHMARK_*` variables and throws `BenchmarkLiveConfigError`
 *    when any is missing. There is no path that silently runs the scripted
 *    provider instead of a misconfigured live run.
 * 2. **Zero retries.** `providerRetryPolicy()` declares `maxRetries: 0`, and
 *    `stream()` performs exactly one HTTP attempt. The benchmark spend gate
 *    refuses adapters that retry, because an internal retry spends money
 *    without an admitted request behind it.
 * 3. **Server truth.** `usage` comes from the provider response (`prompt_tokens`
 *    / `completion_tokens` / cache-hit counters), never from a local estimate;
 *    when the response carries no usage, no usage chunk is emitted and the
 *    request path fails closed instead of recording zero.
 *
 * The API key stays in this object only. It is never logged, serialized into a
 * record, or included in an error message.
 */

export const BENCHMARK_LIVE_PROVIDER_ID = 'benchmark-live'

/** Every variable a live run must define; none has a fallback. */
export const LIVE_BENCHMARK_ENV_VARS = [
  'BENCHMARK_PROVIDER',
  'BENCHMARK_BASE_URL',
  'BENCHMARK_API_KEY',
  'BENCHMARK_MODEL',
  'BENCHMARK_PRICING_JSON',
] as const

export type LiveBenchmarkEnvVar = (typeof LIVE_BENCHMARK_ENV_VARS)[number]

export type BenchmarkEnv = Readonly<Record<string, string | undefined>>

export type BenchmarkProviderMode = 'scripted' | 'live'

export class BenchmarkLiveConfigError extends Error {
  readonly missing: readonly LiveBenchmarkEnvVar[]
  readonly variable: LiveBenchmarkEnvVar | null

  constructor(
    message: string,
    options: Readonly<{
      missing?: readonly LiveBenchmarkEnvVar[]
      variable?: LiveBenchmarkEnvVar
    }> = {},
  ) {
    super(message)
    this.name = 'BenchmarkLiveConfigError'
    this.missing = Object.freeze([...(options.missing ?? [])])
    this.variable = options.variable ?? null
  }
}

export type LiveBenchmarkConfig = Readonly<{
  readonly provider: 'live'
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly pricing: BenchmarkPriceSchedule
}>

function trimmed(env: BenchmarkEnv, name: LiveBenchmarkEnvVar): string {
  return (env[name] ?? '').trim()
}

/**
 * Explicit provider mode. An unset or `scripted` value selects the local
 * fixture-driven provider; `live` selects the HTTP adapter; anything else is a
 * configuration error, never a silent fallback.
 */
export function benchmarkProviderMode(env: BenchmarkEnv): BenchmarkProviderMode {
  const raw = trimmed(env, 'BENCHMARK_PROVIDER')
  if (raw === '' || raw === 'scripted') return 'scripted'
  if (raw === 'live') return 'live'
  throw new BenchmarkLiveConfigError(
    `BENCHMARK_PROVIDER must be "scripted" or "live", received ${JSON.stringify(raw)}`,
    { variable: 'BENCHMARK_PROVIDER' },
  )
}

function readPrice(
  record: Record<string, unknown>,
  field: 'inputUsdPerMillionTokens' | 'outputUsdPerMillionTokens' | 'cacheReadUsdPerMillionTokens' | 'cacheWriteUsdPerMillionTokens',
  required: boolean,
): number | undefined {
  const value = record[field]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BenchmarkLiveConfigError(
      `BENCHMARK_PRICING_JSON.${field} must be a non-negative finite number; `
      + `the placeholder schedule is forbidden for a paid run`,
      { variable: 'BENCHMARK_PRICING_JSON' },
    )
  }
  return value
}

/** Parse the approved price schedule a paid run must supply explicitly. */
export function parseBenchmarkPricing(raw: string): BenchmarkPriceSchedule {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BenchmarkLiveConfigError(
      'BENCHMARK_PRICING_JSON is not valid JSON',
      { variable: 'BENCHMARK_PRICING_JSON' },
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BenchmarkLiveConfigError(
      'BENCHMARK_PRICING_JSON must contain a JSON object',
      { variable: 'BENCHMARK_PRICING_JSON' },
    )
  }
  const record = parsed as Record<string, unknown>
  const input = readPrice(record, 'inputUsdPerMillionTokens', true) as number
  const output = readPrice(record, 'outputUsdPerMillionTokens', true) as number
  const cacheRead = readPrice(record, 'cacheReadUsdPerMillionTokens', false)
  const cacheWrite = readPrice(record, 'cacheWriteUsdPerMillionTokens', false)
  return Object.freeze({
    inputUsdPerMillionTokens: input,
    outputUsdPerMillionTokens: output,
    ...(cacheRead === undefined ? {} : { cacheReadUsdPerMillionTokens: cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWriteUsdPerMillionTokens: cacheWrite }),
  })
}

/**
 * Read the live entry from the environment.
 *
 * All five variables are required. Missing any (including
 * `BENCHMARK_PROVIDER` itself) throws with every missing name and no values,
 * so a half-configured run cannot fall back to the free scripted provider.
 */
export function loadLiveBenchmarkConfig(env: BenchmarkEnv = process.env): LiveBenchmarkConfig {
  const missing = LIVE_BENCHMARK_ENV_VARS.filter(name => trimmed(env, name) === '')
  if (missing.length > 0) {
    throw new BenchmarkLiveConfigError(
      `live benchmark provider requires ${missing.join(', ')}; `
      + 'refusing to fall back to the scripted provider',
      { missing },
    )
  }

  if (benchmarkProviderMode(env) !== 'live') {
    throw new BenchmarkLiveConfigError(
      'BENCHMARK_PROVIDER must be "live" when loading the live provider config',
      { variable: 'BENCHMARK_PROVIDER' },
    )
  }

  return Object.freeze({
    provider: 'live' as const,
    baseUrl: trimmed(env, 'BENCHMARK_BASE_URL').replace(/\/+$/, ''),
    apiKey: trimmed(env, 'BENCHMARK_API_KEY'),
    model: trimmed(env, 'BENCHMARK_MODEL'),
    pricing: parseBenchmarkPricing(env.BENCHMARK_PRICING_JSON ?? ''),
  })
}

export type LiveBenchmarkFetch = (input: string, init: RequestInit) => Promise<Response>

export const LIVE_BENCHMARK_RETRY_POLICY = Object.freeze({
  mode: 'normal' as const,
  maxRetries: 0,
  retryableCodes: [] as readonly string[],
  initialDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
})

type WireToolCall = Readonly<{
  readonly id: string
  readonly name: string
  readonly arguments: string
}>

type Completion = Readonly<{
  readonly text: string
  readonly reasoning: string
  readonly toolCalls: readonly WireToolCall[]
  readonly usage: TokenUsage | undefined
  readonly finishReason: string | null
  readonly model: string | null
}>

function textOf(blocks: readonly ContentBlock[]): string {
  let text = ''
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        text += block.text
        break
      case 'reasoning':
      case 'tool-call':
        break
      case 'tool-result':
        text += textOf(block.content)
        break
      default:
        throw new LlmError(
          `live benchmark provider cannot serialize ${block.type} content`,
          'UNSUPPORTED_CONTENT',
        )
    }
  }
  return text
}

type WireToolFunction = Readonly<{
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}>

type WireTool = Readonly<{ readonly type: 'function'; readonly function: WireToolFunction }>

function buildWireTools(tools: readonly ToolSchema[]): readonly WireTool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      // Idempotent: the request path already sent provider-safe names, and a
      // direct caller may still hold the product names (`go.play`).
      name: toProviderToolName(tool.name),
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

type WireMessage =
  | Readonly<{ role: 'system' | 'user'; content: string }>
  | Readonly<{
    role: 'assistant'
    content: string | null
    tool_calls?: readonly Readonly<{
      id: string
      type: 'function'
      function: Readonly<{ name: string; arguments: string }>
    }>[]
  }>
  | Readonly<{ role: 'tool'; tool_call_id: string; content: string }>

function buildWireMessages(options: GenerateOptions): readonly WireMessage[] {
  const wire: WireMessage[] = []
  if (options.system !== undefined && options.system.trim() !== '') {
    wire.push({ role: 'system', content: options.system })
  }

  for (const message of options.messages) {
    if (message.source.kind === 'tool') {
      const result = message.content.find(block => block.type === 'tool-result')
      if (result === undefined) {
        throw new LlmError(
          'live benchmark provider received a tool message without a tool-result block',
          'INVALID_MESSAGE',
        )
      }
      wire.push({
        role: 'tool',
        tool_call_id: String(result.toolCallId),
        content: textOf(result.content),
      })
      continue
    }

    if (message.role === 'assistant' || message.source.kind === 'model') {
      const calls = message.content
        .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
        .map(block => ({
          id: String(block.id),
          type: 'function' as const,
          function: { name: toProviderToolName(block.name), arguments: block.arguments },
        }))
      const text = textOf(message.content)
      wire.push(
        calls.length === 0
          ? { role: 'assistant', content: text }
          : { role: 'assistant', content: text === '' ? null : text, tool_calls: calls },
      )
      continue
    }

    wire.push({ role: message.role === 'system' ? 'system' : 'user', content: textOf(message.content) })
  }

  return wire
}

function asTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Map provider usage onto DSH's disjoint token fields.
 *
 * `prompt_tokens` folds cache hits in; DSH wants uncached input separate from
 * `cacheReadTokens`. A missing or malformed count returns `undefined` so the
 * request path fails closed instead of recording a fabricated zero.
 */
export function usageFromProvider(reported: unknown): TokenUsage | undefined {
  if (typeof reported !== 'object' || reported === null || Array.isArray(reported)) return undefined
  const record = reported as Record<string, unknown>
  const prompt = asTokenCount(record.prompt_tokens)
  const completion = asTokenCount(record.completion_tokens)
  if (prompt === undefined || completion === undefined) return undefined

  const cacheRead = asTokenCount(record.prompt_cache_hit_tokens)
  const inputTokens = Math.max(0, prompt - (cacheRead ?? 0))
  return cacheRead === undefined
    ? { inputTokens, outputTokens: completion }
    : { inputTokens, outputTokens: completion, cacheReadTokens: cacheRead }
}

function finishReasonOf(reason: string | null, hasToolCalls: boolean): FinishReason {
  switch (reason) {
    case 'length':
      return { kind: 'max-tokens' }
    case 'tool_calls':
      return { kind: 'tool-calls' }
    case 'stop':
      return { kind: 'stop' }
    default:
      return hasToolCalls ? { kind: 'tool-calls' } : { kind: 'stop' }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function toolCallsFrom(value: unknown): readonly WireToolCall[] {
  if (!Array.isArray(value)) return []
  const calls: WireToolCall[] = []
  for (const [position, entry] of value.entries()) {
    const record = asRecord(entry)
    const fn = asRecord(record?.function)
    const rawName = asString(fn?.name)
    if (rawName === null) {
      throw new LlmError(
        'live benchmark provider received a tool call without a function name',
        'INVALID_RESPONSE',
      )
    }
    calls.push(Object.freeze({
      id: asString(record?.id) ?? `call-${position}`,
      // Inbound restoration is the mapping table's job; an unknown name is a
      // hard failure, never a passthrough guess.
      name: fromProviderToolName(rawName),
      arguments: typeof fn?.arguments === 'string' ? fn.arguments : '',
    }))
  }
  return Object.freeze(calls)
}

function completionFromJson(payload: unknown): Completion {
  const record = asRecord(payload)
  if (record === undefined) {
    throw new LlmError('live benchmark provider returned a non-object JSON body', 'INVALID_RESPONSE')
  }
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = asRecord(choices[0])
  const message = asRecord(first?.message)
  return Object.freeze({
    text: asString(message?.content) ?? '',
    reasoning: asString(message?.reasoning_content) ?? '',
    toolCalls: toolCallsFrom(message?.tool_calls),
    usage: usageFromProvider(record.usage),
    finishReason: asString(first?.finish_reason),
    model: asString(record.model),
  })
}

function* chunksFromCompletion(completion: Completion): Generator<StreamChunk> {
  let index = 0
  if (completion.reasoning !== '') {
    yield { type: 'block-start', index, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index, text: completion.reasoning }
    yield { type: 'block-end', index, block: { type: 'reasoning', text: completion.reasoning } }
    index += 1
  }
  if (completion.text !== '') {
    yield { type: 'block-start', index, blockType: 'text' }
    yield { type: 'text-delta', index, text: completion.text }
    yield { type: 'block-end', index, block: { type: 'text', text: completion.text } }
    index += 1
  }
  for (const call of completion.toolCalls) {
    const id = CallId(call.id)
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments }
    yield {
      type: 'block-end',
      index,
      block: { type: 'tool-call', id, name: call.name, arguments: call.arguments },
    }
    index += 1
  }
  if (completion.usage !== undefined) yield { type: 'usage', usage: completion.usage }
  yield {
    type: 'finish',
    reason: finishReasonOf(completion.finishReason, completion.toolCalls.length > 0),
    replayState: { response: { model: completion.model } },
  }
}

/** Yield the `data:` payloads of one SSE body, one event at a time. */
async function* ssePayloads(response: Response): AsyncGenerator<string> {
  const body = response.body
  if (body === null) {
    throw new LlmError('live benchmark provider returned an empty SSE body', 'EMPTY_RESPONSE')
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  const consumeLine = (raw: string): string | undefined => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line === '') {
      if (dataLines.length === 0) return undefined
      const payload = dataLines.join('\n')
      dataLines = []
      return payload
    }
    if (line.startsWith(':')) return undefined
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
    return undefined
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const payload = consumeLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (payload !== undefined) yield payload
      }
    }
    buffer += decoder.decode()
    if (buffer !== '') {
      const payload = consumeLine(buffer)
      if (payload !== undefined) yield payload
    }
    if (dataLines.length > 0) yield dataLines.join('\n')
  } finally {
    reader.releaseLock()
  }
}

type OpenToolBlock = {
  readonly index: number
  rawName: string
  id: string | null
  arguments: string
}

/**
 * Translate one SSE body into chunks incrementally.
 *
 * Indexes are allocated in first-seen order, so interleaved text, reasoning and
 * tool-call deltas assemble in the same order the provider streamed them.
 */
async function* chunksFromSse(response: Response): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textIndex: number | null = null
  let text = ''
  let reasoningIndex: number | null = null
  let reasoning = ''
  const openTools = new Map<number, OpenToolBlock>()
  let usage: TokenUsage | undefined
  let finishReason: string | null = null
  let model: string | null = null

  for await (const payload of ssePayloads(response)) {
    if (payload === '[DONE]') break
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      throw new LlmError('live benchmark provider sent a non-JSON SSE payload', 'INVALID_RESPONSE')
    }
    const event = asRecord(parsed)
    if (event === undefined) continue
    model = asString(event.model) ?? model
    const reportedUsage = usageFromProvider(event.usage)
    if (reportedUsage !== undefined) usage = reportedUsage

    const choices = Array.isArray(event.choices) ? event.choices : []
    const choice = asRecord(choices[0])
    if (choice === undefined) continue
    const delta = asRecord(choice.delta)

    const reasoningDelta = asString(delta?.reasoning_content)
    if (reasoningDelta !== null) {
      if (reasoningIndex === null) {
        reasoningIndex = nextIndex
        nextIndex += 1
        yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
      }
      reasoning += reasoningDelta
      yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoningDelta }
    }

    const textDelta = asString(delta?.content)
    if (textDelta !== null) {
      if (textIndex === null) {
        textIndex = nextIndex
        nextIndex += 1
        yield { type: 'block-start', index: textIndex, blockType: 'text' }
      }
      text += textDelta
      yield { type: 'text-delta', index: textIndex, text: textDelta }
    }

    const deltas = Array.isArray(delta?.tool_calls) ? delta.tool_calls : []
    for (const [position, entry] of deltas.entries()) {
      const record = asRecord(entry)
      if (record === undefined) continue
      const providerIndex = typeof record.index === 'number' ? record.index : position
      let open = openTools.get(providerIndex)
      if (open === undefined) {
        open = { index: nextIndex, rawName: '', id: null, arguments: '' }
        nextIndex += 1
        openTools.set(providerIndex, open)
        yield { type: 'block-start', index: open.index, blockType: 'tool-call' }
      }
      const fn = asRecord(record.function)
      const nameChunk = asString(fn?.name)
      if (nameChunk !== null) {
        // Providers either stream the name in fragments (`go_` then `play`) or
        // repeat the name accumulated so far on every delta. Replace only when
        // the new chunk extends the accumulator, otherwise append. Mapping
        // happens below, once the accumulated name is known.
        open.rawName = nameChunk.startsWith(open.rawName) ? nameChunk : open.rawName + nameChunk
      }
      open.id = asString(record.id) ?? open.id
      const argumentChunk = typeof fn?.arguments === 'string' ? fn.arguments : ''
      open.arguments += argumentChunk
      // A fragment (`go_`) is not a tool name: emitting it would either throw or
      // guess. Only a complete table name is mapped and emitted mid-stream; an
      // unknown or still-incomplete name fails at block end instead.
      const completeName = isKnownToolName(open.rawName)
        ? fromProviderToolName(open.rawName)
        : null
      yield {
        type: 'tool-call-delta',
        index: open.index,
        id: CallId(open.id ?? `call-${providerIndex}`),
        ...(completeName === null ? {} : { name: completeName }),
        argumentsDelta: argumentChunk,
      }
    }

    finishReason = asString(choice.finish_reason) ?? finishReason
  }

  if (reasoningIndex !== null) {
    yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
  }
  if (textIndex !== null) {
    yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
  }
  for (const open of openTools.values()) {
    if (open.rawName === '') {
      throw new LlmError(
        'live benchmark provider ended a tool call without a function name',
        'INVALID_RESPONSE',
      )
    }
    yield {
      type: 'block-end',
      index: open.index,
      block: {
        type: 'tool-call',
        id: CallId(open.id ?? `call-${open.index}`),
        name: fromProviderToolName(open.rawName),
        arguments: open.arguments,
      },
    }
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  yield {
    type: 'finish',
    reason: finishReasonOf(finishReason, openTools.size > 0),
    replayState: { response: { model } },
  }
}

function statusCodeOf(status: number): string {
  if (status === 401 || status === 403) return 'INVALID_CREDENTIAL'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 408 || status === 504) return 'TIMEOUT'
  if (status >= 500) return 'PROVIDER_ERROR'
  return 'HTTP_ERROR'
}

/**
 * HTTP adapter for one approved live run. It has no retry loop, no fallback
 * model and no local token estimate: one `stream()` call is one request.
 */
export class LiveBenchmarkProvider extends LlmAdapter {
  readonly config: LiveBenchmarkConfig
  private readonly fetchImpl: LiveBenchmarkFetch
  private streamCount = 0
  private loopMarkedCount = 0
  private transportAttemptCount = 0

  constructor(config: LiveBenchmarkConfig, options: Readonly<{ fetch?: LiveBenchmarkFetch }> = {}) {
    super()
    this.config = config
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
  }

  get endpoint(): string {
    return `${this.config.baseUrl}/chat/completions`
  }

  get physicalCalls(): number {
    return this.streamCount
  }

  get loopMarkedRequests(): number {
    return this.loopMarkedCount
  }

  get transportAttempts(): number {
    return this.transportAttemptCount
  }

  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'Benchmark live provider (HTTP, single attempt)' }
  }

  override providerRetryPolicy() {
    return LIVE_BENCHMARK_RETRY_POLICY
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.streamCount += 1
    if (isAgentLoopRequest(options)) this.loopMarkedCount += 1

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: buildWireMessages(options),
      stream: true,
      stream_options: { include_usage: true },
    }
    if (options.tools !== undefined && options.tools.length > 0) body.tools = buildWireTools(options.tools)
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.stop !== undefined && options.stop.length > 0) body.stop = [...options.stop]

    this.transportAttemptCount += 1
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      throw new LlmError(
        'live benchmark provider transport failed',
        'NETWORK',
        { cause: error },
      )
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new LlmError(
        `live benchmark provider returned HTTP ${response.status}`
        + (detail === '' ? '' : `: ${detail.slice(0, 200)}`),
        statusCodeOf(response.status),
        { status: response.status },
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream')) {
      yield* chunksFromSse(response)
      return
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      throw new LlmError(
        'live benchmark provider returned a non-JSON body',
        'INVALID_RESPONSE',
        { cause: error },
      )
    }
    yield* chunksFromCompletion(completionFromJson(payload))
  }
}
