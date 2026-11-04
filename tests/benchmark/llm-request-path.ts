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
import { BenchmarkBudgetGate, estimateRequestInputTokens } from './budget-gate.js'
import { BENCHMARK_PROVIDER_ID } from './fake-provider.js'
import { SCRIPTED_MODEL_ID } from './scripted-model.js'

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
}>

export type BenchmarkRetryPolicyFacts = Readonly<{
  readonly mode: 'normal' | 'always'
  readonly maxRetries: number | null
}>

export type BenchmarkRequestPathStats = Readonly<{
  readonly provider: string
  readonly model: string
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
}>

export class BenchmarkProviderFailureError extends Error {
  readonly finish: FinishReason

  constructor(finish: FinishReason) {
    super(`Benchmark provider call failed: ${JSON.stringify(finish)}`)
    this.name = 'BenchmarkProviderFailureError'
    this.finish = finish
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

  let admittedRequests = 0
  let disposed = false

  return Object.freeze({
    async request(input: BenchmarkRequestInput): Promise<BenchmarkResponse> {
      if (disposed) throw new Error('benchmark request path is disposed')
      const decision = gate.beginRequest({
        step: input.step,
        estimatedInputTokens: estimateRequestInputTokens({
          system: input.system,
          messages: input.messages,
          tools: input.tools,
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
        messages: [...input.messages],
        system: input.system,
        tools: [...input.tools],
        sessionId: SessionId(`benchmark-${input.fixture}`),
      })

      const assembler = new BlockAssembler()
      for await (const chunk of prepared.stream(request)) assembler.push(chunk)

      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        throw new BenchmarkProviderFailureError(finish)
      }
      const usage = assembler.usage
      if (usage === undefined) {
        throw new Error(`benchmark provider returned no usage chunk (step ${input.step})`)
      }

      gate.completeRequest({ step: input.step, usage })

      const toolCalls: BenchmarkToolCall[] = []
      for (const block of assembler.blocks()) {
        if (block.type === 'tool-call') {
          toolCalls.push(Object.freeze({
            id: block.id,
            name: block.name,
            rawArguments: block.arguments,
          }))
        }
      }

      return Object.freeze({
        usage: Object.freeze({ ...usage }),
        toolCalls: Object.freeze(toolCalls),
        finish,
        requestIndex: decision.requestIndex,
        maxTokens: decision.maxTokens,
        clamped: decision.clamped,
      })
    },

    stats(): BenchmarkRequestPathStats {
      const transportAttempts = transportAttemptsOf(provider)
      return Object.freeze({
        provider: BENCHMARK_PROVIDER_ID,
        model: SCRIPTED_MODEL_ID,
        seam: 'dsh-llm-runtime',
        llmRequests: physicalCallsOf(provider),
        transportAttempts,
        admittedRequests,
        retryAttempts: Math.max(0, transportAttempts - admittedRequests),
        loopMarkedRequests: loopMarkedCallsOf(provider),
        streamSeamRequests,
        retryPolicy: retryFacts,
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
