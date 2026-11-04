import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/**
 * Benchmark-only spend and request gate (WAVE-C-T10, zero-cost slice).
 *
 * Kept out of `src/budget/` on purpose: the Spec §22 turn budget owns
 * per-request / per-turn caps, while this gate owns benchmark-session spend
 * (total requests and estimated cost). It is only ever wired by
 * `tests/benchmark/`, and every violation is a hard stop recorded as a
 * `budget_stop` — never a silent continue.
 */

export type BenchmarkGateConfig = Readonly<{
  maxRequests: number
  maxInputTokensPerRequest: number
  maxOutputTokensPerRequest: number
  maxEstimatedCostUsd: number
  allowRetries: boolean
  allowSearchFetch: boolean
}>

export const BENCHMARK_GATE_DEFAULTS = Object.freeze({
  maxRequests: 96,
  maxInputTokensPerRequest: 8_000,
  maxOutputTokensPerRequest: 4_000,
  maxEstimatedCostUsd: 1,
  allowRetries: false,
  allowSearchFetch: false,
} satisfies BenchmarkGateConfig)

/**
 * PLACEHOLDER prices, not a DeepSeek quote. The fake provider is local and
 * free, so the schedule only has to make the cost gate executable; a real run
 * must pass the then-current approved DeepSeek price schedule instead.
 */
export type BenchmarkPriceSchedule = Readonly<{
  inputUsdPerMillionTokens: number
  outputUsdPerMillionTokens: number
}>

export const BENCHMARK_PLACEHOLDER_PRICES = Object.freeze({
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 2,
} satisfies BenchmarkPriceSchedule)

export type BenchmarkBudgetStopGate =
  | 'max-requests'
  | 'request-input-tokens'
  | 'request-output-tokens'
  | 'estimated-cost'
  | 'retries-forbidden'
  | 'search-fetch-forbidden'

export type BenchmarkBudgetStop = Readonly<{
  readonly kind: 'budget_stop'
  readonly gate: BenchmarkBudgetStopGate
  readonly detail: string
  readonly requestIndex: number
  readonly step: number
  readonly observed: number | null
  readonly limit: number | null
}>

export class BenchmarkBudgetStopError extends Error {
  readonly stop: BenchmarkBudgetStop

  constructor(stop: BenchmarkBudgetStop) {
    super(`Benchmark budget stop: ${stop.gate}: ${stop.detail}`)
    this.name = 'BenchmarkBudgetStopError'
    this.stop = stop
  }
}

export type BeginRequestInput = Readonly<{
  readonly step: number
  readonly estimatedInputTokens: number
  readonly proposedMaxTokens: number
  readonly toolNames: readonly string[]
}>

export type BeginRequestDecision = Readonly<{
  readonly requestIndex: number
  readonly maxTokens: number
  readonly clamped: boolean
}>

export type CompleteRequestInput = Readonly<{
  readonly step: number
  readonly usage: TokenUsage
}>

export type BenchmarkBudgetGateSnapshot = Readonly<{
  readonly config: BenchmarkGateConfig
  readonly pricing: BenchmarkPriceSchedule
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly estimatedCostUsd: number
  readonly stops: readonly BenchmarkBudgetStop[]
}>

export function isForbiddenBenchmarkTool(name: string): boolean {
  return /^(search|fetch|web_?search|web_?fetch|http)/i.test(name)
}

/**
 * Cheap pre-dispatch estimate (~4 characters per token) used only to stop an
 * obviously oversized request before it leaves the process. The authoritative
 * count is the provider's reported `usage.inputTokens`, checked again after
 * the request completes.
 */
export function estimateRequestInputTokens(request: Readonly<{
  readonly system?: string
  readonly messages: readonly unknown[]
  readonly tools?: readonly unknown[]
}>): number {
  const characters = (request.system?.length ?? 0)
    + JSON.stringify(request.messages).length
    + JSON.stringify(request.tools ?? []).length
  return Math.ceil(characters / 4)
}

function costOf(
  inputTokens: number,
  outputTokens: number,
  pricing: BenchmarkPriceSchedule,
): number {
  const usd = (inputTokens * pricing.inputUsdPerMillionTokens)
    + (outputTokens * pricing.outputUsdPerMillionTokens)
  return Math.round((usd / 1_000_000) * 1e12) / 1e12
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Benchmark gate ${field} must be a non-negative integer: ${String(value)}`)
  }
}

/**
 * One gate instance owns one benchmark session: request and spend counters are
 * cumulative across fixtures and repeated runs, while `beginTurn()` resets only
 * the per-turn retry detection.
 */
export class BenchmarkBudgetGate {
  readonly config: BenchmarkGateConfig
  readonly pricing: BenchmarkPriceSchedule

  private requestCount = 0
  private inputTokenCount = 0
  private outputTokenCount = 0
  private costUsd = 0
  private lastStep: number | undefined
  private readonly stopLog: BenchmarkBudgetStop[] = []

  constructor(
    config: Partial<BenchmarkGateConfig> = {},
    pricing: BenchmarkPriceSchedule = BENCHMARK_PLACEHOLDER_PRICES,
  ) {
    this.config = Object.freeze({ ...BENCHMARK_GATE_DEFAULTS, ...config })
    this.pricing = Object.freeze({ ...pricing })
    assertNonNegativeInteger(this.config.maxRequests, 'maxRequests')
    assertNonNegativeInteger(this.config.maxInputTokensPerRequest, 'maxInputTokensPerRequest')
    assertNonNegativeInteger(this.config.maxOutputTokensPerRequest, 'maxOutputTokensPerRequest')
    if (!Number.isFinite(this.config.maxEstimatedCostUsd) || this.config.maxEstimatedCostUsd < 0) {
      throw new RangeError(
        `Benchmark gate maxEstimatedCostUsd must be a non-negative finite number: ${String(this.config.maxEstimatedCostUsd)}`,
      )
    }
  }

  beginTurn(): void {
    this.lastStep = undefined
  }

  /**
   * Admit or refuse one provider request before dispatch. The order is fixed
   * so the first violated gate becomes the recorded reason: forbidden tools,
   * retry, request count, input tokens, projected cost.
   */
  beginRequest(input: BeginRequestInput): BeginRequestDecision {
    const forbidden = input.toolNames.find(isForbiddenBenchmarkTool)
    if (forbidden !== undefined && !this.config.allowSearchFetch) {
      throw this.stop(
        'search-fetch-forbidden',
        `request declares forbidden tool ${forbidden}`,
        input.step,
        null,
        null,
      )
    }

    if (!this.config.allowRetries && input.step === this.lastStep) {
      throw this.stop(
        'retries-forbidden',
        `step ${input.step} requested a second time; automatic retries are forbidden`,
        input.step,
        null,
        null,
      )
    }
    this.lastStep = input.step

    if (this.requestCount >= this.config.maxRequests) {
      throw this.stop(
        'max-requests',
        `request ${this.requestCount + 1} exceeds maxRequests ${this.config.maxRequests}`,
        input.step,
        this.requestCount + 1,
        this.config.maxRequests,
      )
    }

    if (input.estimatedInputTokens > this.config.maxInputTokensPerRequest) {
      throw this.stop(
        'request-input-tokens',
        `estimated input ${input.estimatedInputTokens} exceeds ${this.config.maxInputTokensPerRequest}`,
        input.step,
        input.estimatedInputTokens,
        this.config.maxInputTokensPerRequest,
      )
    }

    const maxTokens = Math.min(input.proposedMaxTokens, this.config.maxOutputTokensPerRequest)
    const projected = this.costUsd + costOf(input.estimatedInputTokens, maxTokens, this.pricing)
    if (projected > this.config.maxEstimatedCostUsd) {
      throw this.stop(
        'estimated-cost',
        `projected session cost $${projected} exceeds $${this.config.maxEstimatedCostUsd}`,
        input.step,
        projected,
        this.config.maxEstimatedCostUsd,
      )
    }

    this.requestCount += 1
    return {
      requestIndex: this.requestCount,
      maxTokens,
      clamped: maxTokens < input.proposedMaxTokens,
    }
  }

  /**
   * Record reported usage and stop when it breaks a per-request cap or the
   * session budget even if the provider ignored the requested `maxTokens`.
   */
  completeRequest(input: CompleteRequestInput): void {
    const { usage } = input
    if (usage.inputTokens > this.config.maxInputTokensPerRequest) {
      throw this.stop(
        'request-input-tokens',
        `actual input ${usage.inputTokens} exceeds ${this.config.maxInputTokensPerRequest}`,
        input.step,
        usage.inputTokens,
        this.config.maxInputTokensPerRequest,
      )
    }
    if (usage.outputTokens > this.config.maxOutputTokensPerRequest) {
      throw this.stop(
        'request-output-tokens',
        `actual output ${usage.outputTokens} exceeds ${this.config.maxOutputTokensPerRequest}`,
        input.step,
        usage.outputTokens,
        this.config.maxOutputTokensPerRequest,
      )
    }

    this.inputTokenCount += usage.inputTokens
    this.outputTokenCount += usage.outputTokens
    this.costUsd = Math.round(
      (this.costUsd + costOf(usage.inputTokens, usage.outputTokens, this.pricing)) * 1e12,
    ) / 1e12

    if (this.costUsd > this.config.maxEstimatedCostUsd) {
      throw this.stop(
        'estimated-cost',
        `reported session cost $${this.costUsd} exceeds $${this.config.maxEstimatedCostUsd}`,
        input.step,
        this.costUsd,
        this.config.maxEstimatedCostUsd,
      )
    }
  }

  assertToolCallAllowed(name: string, step: number): void {
    if (!this.config.allowSearchFetch && isForbiddenBenchmarkTool(name)) {
      throw this.stop(
        'search-fetch-forbidden',
        `tool call ${name} is forbidden in a cognition benchmark`,
        step,
        null,
        null,
      )
    }
  }

  snapshot(): BenchmarkBudgetGateSnapshot {
    return Object.freeze({
      config: this.config,
      pricing: this.pricing,
      requests: this.requestCount,
      inputTokens: this.inputTokenCount,
      outputTokens: this.outputTokenCount,
      estimatedCostUsd: this.costUsd,
      stops: Object.freeze([...this.stopLog]),
    })
  }

  private stop(
    gate: BenchmarkBudgetStopGate,
    detail: string,
    step: number,
    observed: number | null,
    limit: number | null,
  ): BenchmarkBudgetStopError {
    const recorded: BenchmarkBudgetStop = Object.freeze({
      kind: 'budget_stop',
      gate,
      detail,
      requestIndex: this.requestCount,
      step,
      observed,
      limit,
    })
    this.stopLog.push(recorded)
    return new BenchmarkBudgetStopError(recorded)
  }
}
