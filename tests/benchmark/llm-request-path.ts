import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  BlockAssembler,
  isAgentLoopRequest,
  markAgentLoopRequest,
  type CallId,
  type FinishReason,
  type LlmAdapter,
  type Message,
  type TokenUsage,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  BenchmarkBudgetGate,
  estimateRequestInputTokens,
  isForbiddenBenchmarkTool,
} from './budget-gate.js'
import { BENCHMARK_PROVIDER_ID } from './fake-provider.js'
import { SCRIPTED_MODEL_ID } from './scripted-model.js'
import {
  fromProviderToolName,
  toProviderMessages,
  toProviderToolSchemas,
} from './tool-name-mapping.js'

/**
 * The benchmark's model-request path through the pinned DSH LLM runtime.
 *
 * A request is assembled the way dsh-agent-loop assembles one (`markAgentLoopRequest`,
 * provider/model/maxTokens config, derived messages, tool schemas), then handed
 * to the real `LlmRuntime`: `prepareCall` binds the adapter registration, the
 * `llm/stream` waterfall runs, and the registered `LlmAdapter` streams chunks
 * that the real `BlockAssembler` turns back into tool calls and usage.
 *
 * `@deepseek-ai/dsh-agent-loop` itself is not in this package's dependency
 * surface, so the step/turn driver lives in the harness and is a documented
 * stand-in; everything below the loop (adapter registry, retry-policy capture,
 * waterfall, chunk assembly) is the pinned real implementation.
 *
 * The spend gate lives HERE, not in the harness. `openBenchmarkRequestPath`
 * requires a `BenchmarkBudgetGate`, refuses an adapter whose retry policy
 * allows retries, and admits/records every request through the gate itself, so
 * a caller holding the path object cannot dispatch a request without being
 * counted. Passing no gate is a type error and throws at runtime.
 *
 * Tool names are mapped on both sides of the wire: `go.play` leaves as
 * `go_play` (the official API rejects dots) and a returned `go_play` is mapped
 * back to `go.play` before the harness can execute it. An unknown name is a
 * hard failure, never a passthrough guess.
 */

export type BenchmarkRequestInput = Readonly<{
  readonly fixture: string
  readonly step: number
  readonly maxTokens: number
  readonly system: string
  readonly messages: readonly Message[]
  readonly tools: readonly ToolSchema[]
}>

export type BenchmarkToolCall = Readonly<{
  readonly id: CallId
  readonly name: string
  readonly rawArguments: string
}>

export type BenchmarkResponse = Readonly<{
  readonly usage: TokenUsage
  readonly toolCalls: readonly BenchmarkToolCall[]
  readonly finish: FinishReason
  /** 1-based index of this request inside the benchmark session gate. */
  readonly requestIndex: number
  /** `maxTokens` the gate admitted (the requested value, clamped to its cap). */
  readonly maxTokens: number
  readonly clamped: boolean
  /** Response model reported by the adapter envelope, or null when absent. */
  readonly reportedModel: string | null
  /** True when the reported model differs from the configured model. */
  readonly modelDrift: boolean
}>

export type BenchmarkRetryPolicyFacts = Readonly<{
  readonly mode: 'normal' | 'always'
  readonly maxRetries: number | null
}>

export type BenchmarkFailureKind =
  | 'missing-usage'
  | 'truncated-stream'
  | 'provider-timeout'
  | 'connection-interrupted'
  | 'provider-error'
  | 'model-alias-drift'
  | 'unknown-tool-name'

export type BenchmarkFailureRecord = Readonly<{
  readonly kind: BenchmarkFailureKind
  readonly step: number
  readonly detail: string
  readonly reportedModel: string | null
}>

export type BenchmarkModelObservation = Readonly<{
  readonly step: number
  readonly configured: string
  readonly reported: string | null
  readonly drifted: boolean
}>

export type BenchmarkBillingBasis = Readonly<{
  readonly inputTokensField: 'usage.inputTokens'
  readonly outputTokensField: 'usage.outputTokens'
  readonly cacheReadTokensField: 'usage.cacheReadTokens'
  readonly cacheWriteTokensField: 'usage.cacheWriteTokens'
  readonly reasoningTokensField: 'usage.reasoningTokens'
  readonly pricingSource: 'placeholder' | 'explicit'
  readonly inputUsdPerMillionTokens: number
  readonly outputUsdPerMillionTokens: number
  readonly cacheReadUsdPerMillionTokens: number
  readonly cacheWriteUsdPerMillionTokens: number
  readonly note: string
}>

export type BenchmarkRequestPathStats = Readonly<{
  readonly provider: string
  readonly model: string
  readonly configuredModel: string
  /** The seam the observed requests actually left through. */
  readonly seam: 'dsh-llm-runtime'
  /** Adapter stream invocations (prepared calls dispatched). */
  readonly llmRequests: number
  /** Attempts the adapter itself reported for those invocations. */
  readonly transportAttempts: number
  /** Requests the spend gate admitted. */
  readonly admittedRequests: number
  /** Transport attempts beyond admitted requests: retries the gate never saw. */
  readonly retryAttempts: number
  readonly loopMarkedRequests: number
  readonly streamSeamRequests: number
  readonly retryPolicy: BenchmarkRetryPolicyFacts
  readonly reportedModels: readonly string[]
  readonly modelObservations: readonly BenchmarkModelObservation[]
  readonly failures: readonly BenchmarkFailureRecord[]
  readonly billingBasis: BenchmarkBillingBasis
}>

export class BenchmarkProviderFailureError extends Error {
  readonly finish: FinishReason
  readonly kind: BenchmarkFailureKind

  constructor(finish: FinishReason, kind: BenchmarkFailureKind = 'provider-error') {
    super(`Benchmark provider call failed: ${JSON.stringify(finish)}`)
    this.name = 'BenchmarkProviderFailureError'
    this.finish = finish
    this.kind = kind
  }
}

export class BenchmarkMissingUsageError extends Error {
  constructor(step: number) {
    super(`Benchmark provider returned no usage chunk (step ${step}); refusing to record 0`)
    this.name = 'BenchmarkMissingUsageError'
  }
}

export class BenchmarkTruncatedStreamError extends Error {
  constructor(step: number) {
    super(`Benchmark adapter stream ended without a finish chunk (step ${step})`)
    this.name = 'BenchmarkTruncatedStreamError'
  }
}

export class BenchmarkModelAliasDriftError extends Error {
  readonly configured: string
  readonly reported: string

  constructor(configured: string, reported: string) {
    super(
      `Benchmark model alias drift: configured ${JSON.stringify(configured)}, `
      + `provider reported ${JSON.stringify(reported)}`,
    )
    this.name = 'BenchmarkModelAliasDriftError'
    this.configured = configured
    this.reported = reported
  }
}

/**
 * Raised before any request leaves when the registered adapter declares a
 * retry policy the gate does not allow: an adapter-internal retry would spend
 * money without an admitted request behind it.
 */
export class BenchmarkRetryPolicyError extends Error {
  readonly mode: 'normal' | 'always'
  readonly maxRetries: number | null

  constructor(mode: 'normal' | 'always', maxRetries: number | null) {
    super(
      `Benchmark provider retry policy is forbidden (mode=${mode}, maxRetries=${String(maxRetries)}); `
      + 'an adapter that retries would spend without a gated request',
    )
    this.name = 'BenchmarkRetryPolicyError'
    this.mode = mode
    this.maxRetries = maxRetries
  }
}

export type BenchmarkRequestPath = Readonly<{
  /** Admit one gated request and dispatch it through the real runtime. */
  request(input: BenchmarkRequestInput): Promise<BenchmarkResponse>
  stats(): BenchmarkRequestPathStats
  dispose(): Promise<void>
}>

function failureCodeOf(finish: FinishReason): string {
  if (finish.kind === 'error' || finish.kind === 'aborted') return finish.failure.code
  return ''
}

function failureKindOf(finish: FinishReason): BenchmarkFailureKind {
  const code = failureCodeOf(finish).toUpperCase()
  if (/TIMEOUT|ETIMEDOUT|DEADLINE/.test(code)) return 'provider-timeout'
  if (/NETWORK|CONNECT|ECONN|SOCKET|STREAM|ABORT|RESET|DISCONNECT/.test(code)) {
    return 'connection-interrupted'
  }
  return 'provider-error'
}

function reportedModelOf(assembler: BlockAssembler): string | null {
  const response = assembler.replayState?.response
  if (typeof response !== 'object' || response === null) return null
  const model = (response as { model?: unknown }).model
  return typeof model === 'string' && model !== '' ? model : null
}

export async function openBenchmarkRequestPath(
  provider: LlmAdapter,
  gate: BenchmarkBudgetGate,
): Promise<BenchmarkRequestPath> {
  if (!(gate instanceof BenchmarkBudgetGate)) {
    throw new TypeError(
      'openBenchmarkRequestPath requires a BenchmarkBudgetGate; '
      + 'dispatching benchmark requests without the spend gate is forbidden',
    )
  }

  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter([BENCHMARK_PROVIDER_ID], provider)

  let streamSeamRequests = 0
  ctx.on('llm/stream', (options, next) => {
    streamSeamRequests += 1
    if (!isAgentLoopRequest(options)) {
      throw new Error('benchmark request reached llm/stream without the AgentLoop marker')
    }
    return next()
  })

  const retryPolicy = ctx.llm.providerRetryPolicy(BENCHMARK_PROVIDER_ID)
  const retryFacts: BenchmarkRetryPolicyFacts = Object.freeze({
    mode: retryPolicy.mode,
    maxRetries: retryPolicy.mode === 'normal' ? retryPolicy.maxRetries : null,
  })
  if (!gate.config.allowRetries && (retryPolicy.mode === 'always' || retryPolicy.maxRetries > 0)) {
    await ctx.fiber.dispose()
    throw new BenchmarkRetryPolicyError(retryFacts.mode, retryFacts.maxRetries)
  }

  const modelObservations: BenchmarkModelObservation[] = []
  const failures: BenchmarkFailureRecord[] = []
  let admittedRequests = 0
  let disposed = false

  const recordFailure = (failure: BenchmarkFailureRecord): void => {
    failures.push(Object.freeze(failure))
  }

  return Object.freeze({
    async request(input: BenchmarkRequestInput): Promise<BenchmarkResponse> {
      if (disposed) throw new Error('benchmark request path is disposed')

      if (!gate.config.allowSearchFetch) {
        const forbidden = input.tools.find(tool => isForbiddenBenchmarkTool(tool.name))
        if (forbidden !== undefined) gate.assertToolCallAllowed(forbidden.name, input.step)
      }

      const providerTools = toProviderToolSchemas(input.tools)
      const providerMessages = toProviderMessages(input.messages)
      const decision = gate.beginRequest({
        step: input.step,
        estimatedInputTokens: estimateRequestInputTokens({
          system: input.system,
          messages: providerMessages,
          tools: providerTools,
        }),
        proposedMaxTokens: input.maxTokens,
        toolNames: input.tools.map(tool => tool.name),
      })
      admittedRequests += 1

      const prepared = await ctx.llm.prepareCall({
        provider: BENCHMARK_PROVIDER_ID,
        model: SCRIPTED_MODEL_ID,
        maxTokens: decision.maxTokens,
      })
      const request = markAgentLoopRequest({
        provider: BENCHMARK_PROVIDER_ID,
        model: SCRIPTED_MODEL_ID,
        maxTokens: decision.maxTokens,
        messages: providerMessages,
        system: input.system,
        tools: providerTools,
        sessionId: SessionId(`benchmark-${input.fixture}`),
      })

      const assembler = new BlockAssembler()
      let sawFinish = false
      for await (const chunk of prepared.stream(request)) {
        if (chunk.type === 'finish') sawFinish = true
        assembler.push(chunk)
      }

      const finish = assembler.finish
      const usage = assembler.usage
      const reportedModel = reportedModelOf(assembler)
      const modelDrift = reportedModel !== null && reportedModel !== SCRIPTED_MODEL_ID
      modelObservations.push(Object.freeze({
        step: input.step,
        configured: SCRIPTED_MODEL_ID,
        reported: reportedModel,
        drifted: modelDrift,
      }))

      const settle = (reported: TokenUsage): void => {
        gate.completeRequest({ step: input.step, usage: reported })
      }

      if (finish.kind === 'error' || finish.kind === 'aborted') {
        if (usage !== undefined) settle(usage)
        const kind = failureKindOf(finish)
        recordFailure({
          kind,
          step: input.step,
          detail: finish.failure.message,
          reportedModel,
        })
        throw new BenchmarkProviderFailureError(finish, kind)
      }

      if (!sawFinish) {
        if (usage !== undefined) settle(usage)
        recordFailure({
          kind: 'truncated-stream',
          step: input.step,
          detail: 'adapter stream ended without a finish chunk',
          reportedModel,
        })
        throw new BenchmarkTruncatedStreamError(input.step)
      }

      if (usage === undefined) {
        recordFailure({
          kind: 'missing-usage',
          step: input.step,
          detail: 'assembler.usage is undefined; refusing to record 0 tokens',
          reportedModel,
        })
        throw new BenchmarkMissingUsageError(input.step)
      }

      settle(usage)

      if (modelDrift) {
        recordFailure({
          kind: 'model-alias-drift',
          step: input.step,
          detail: `configured ${SCRIPTED_MODEL_ID}, provider reported ${String(reportedModel)}`,
          reportedModel,
        })
        throw new BenchmarkModelAliasDriftError(SCRIPTED_MODEL_ID, String(reportedModel))
      }

      const toolCalls: BenchmarkToolCall[] = []
      for (const block of assembler.blocks()) {
        if (block.type !== 'tool-call') continue
        gate.assertToolCallAllowed(block.name, input.step)
        let originalName: string
        try {
          originalName = fromProviderToolName(block.name)
        } catch (error) {
          recordFailure({
            kind: 'unknown-tool-name',
            step: input.step,
            detail: `${block.name}: ${error instanceof Error ? error.message : String(error)}`,
            reportedModel,
          })
          throw error
        }
        toolCalls.push(Object.freeze({
          id: block.id,
          name: originalName,
          rawArguments: block.arguments,
        }))
      }

      return Object.freeze({
        usage: Object.freeze({ ...usage }),
        toolCalls: Object.freeze(toolCalls),
        finish,
        requestIndex: decision.requestIndex,
        maxTokens: decision.maxTokens,
        clamped: decision.clamped,
        reportedModel,
        modelDrift,
      })
    },

    stats(): BenchmarkRequestPathStats {
      const transportAttempts = transportAttemptsOf(provider)
      const snapshot = gate.snapshot()
      const pricing = snapshot.pricing
      const cacheReadPrice = pricing.cacheReadUsdPerMillionTokens
        ?? pricing.inputUsdPerMillionTokens
      const cacheWritePrice = pricing.cacheWriteUsdPerMillionTokens
        ?? pricing.inputUsdPerMillionTokens
      const reportedModels = [...new Set(
        modelObservations
          .map(observation => observation.reported)
          .filter((model): model is string => model !== null),
      )]

      return Object.freeze({
        provider: BENCHMARK_PROVIDER_ID,
        model: SCRIPTED_MODEL_ID,
        configuredModel: SCRIPTED_MODEL_ID,
        seam: 'dsh-llm-runtime',
        llmRequests: physicalCallsOf(provider),
        transportAttempts,
        admittedRequests,
        retryAttempts: Math.max(0, transportAttempts - admittedRequests),
        loopMarkedRequests: loopMarkedCallsOf(provider),
        streamSeamRequests,
        retryPolicy: retryFacts,
        reportedModels: Object.freeze(reportedModels),
        modelObservations: Object.freeze([...modelObservations]),
        failures: Object.freeze([...failures]),
        billingBasis: Object.freeze({
          inputTokensField: 'usage.inputTokens',
          outputTokensField: 'usage.outputTokens',
          cacheReadTokensField: 'usage.cacheReadTokens',
          cacheWriteTokensField: 'usage.cacheWriteTokens',
          reasoningTokensField: 'usage.reasoningTokens',
          pricingSource: snapshot.pricingSource,
          inputUsdPerMillionTokens: pricing.inputUsdPerMillionTokens,
          outputUsdPerMillionTokens: pricing.outputUsdPerMillionTokens,
          cacheReadUsdPerMillionTokens: cacheReadPrice,
          cacheWriteUsdPerMillionTokens: cacheWritePrice,
          note:
            'Settled from DSH-normalized usage.inputTokens/outputTokens plus cache '
            + 'read/write tokens; reasoning tokens are assumed included in outputTokens '
            + 'and are not priced twice.',
        }),
      })
    },

    async dispose(): Promise<void> {
      disposed = true
      await ctx.fiber.dispose()
    },
  })
}

type ProviderCounters = {
  readonly physicalCalls: number
  readonly loopMarkedRequests: number
  readonly transportAttempts?: number
}

function providerCounters(provider: LlmAdapter): ProviderCounters | undefined {
  const candidate = provider as Partial<ProviderCounters>
  return typeof candidate.physicalCalls === 'number' && typeof candidate.loopMarkedRequests === 'number'
    ? candidate as ProviderCounters
    : undefined
}

function physicalCallsOf(provider: LlmAdapter): number {
  return providerCounters(provider)?.physicalCalls ?? -1
}

function loopMarkedCallsOf(provider: LlmAdapter): number {
  return providerCounters(provider)?.loopMarkedRequests ?? -1
}

/**
 * Attempts the adapter reports for its own transport (an HTTP adapter counts
 * requests it actually sent). An adapter that does not expose the counter is
 * measured by its stream invocations.
 */
function transportAttemptsOf(provider: LlmAdapter): number {
  const counters = providerCounters(provider)
  if (counters === undefined) return -1
  return typeof counters.transportAttempts === 'number' ? counters.transportAttempts : counters.physicalCalls
}
