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
}>

export type BenchmarkRetryPolicyFacts = Readonly<{
  readonly mode: 'normal' | 'always'
  readonly maxRetries: number | null
}>

export type BenchmarkRequestPathStats = Readonly<{
  readonly provider: string
  readonly model: string
  readonly llmRequests: number
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

export type BenchmarkRequestPath = Readonly<{
  request(input: BenchmarkRequestInput): Promise<BenchmarkResponse>
  stats(): BenchmarkRequestPathStats
  dispose(): Promise<void>
}>

export async function openBenchmarkRequestPath(
  provider: LlmAdapter,
): Promise<BenchmarkRequestPath> {
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

  return Object.freeze({
    async request(input: BenchmarkRequestInput): Promise<BenchmarkResponse> {
      const prepared = await ctx.llm.prepareCall({
        provider: BENCHMARK_PROVIDER_ID,
        model: SCRIPTED_MODEL_ID,
        maxTokens: input.maxTokens,
      })
      const request = markAgentLoopRequest({
        provider: BENCHMARK_PROVIDER_ID,
        model: SCRIPTED_MODEL_ID,
        maxTokens: input.maxTokens,
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

      return Object.freeze({ usage: Object.freeze({ ...usage }), toolCalls: Object.freeze(toolCalls), finish })
    },

    stats(): BenchmarkRequestPathStats {
      return Object.freeze({
        provider: BENCHMARK_PROVIDER_ID,
        model: SCRIPTED_MODEL_ID,
        llmRequests: physicalCallsOf(provider),
        loopMarkedRequests: loopMarkedCallsOf(provider),
        streamSeamRequests,
        retryPolicy: retryFacts,
      })
    },

    async dispose(): Promise<void> {
      await ctx.fiber.dispose()
    },
  })
}

type ProviderCounters = {
  readonly physicalCalls: number
  readonly loopMarkedRequests: number
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
