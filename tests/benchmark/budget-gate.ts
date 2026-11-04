import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
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
  // 8 §38 classes x 3 runs x up to 4 model steps = 96, plus headroom. The
  // token caps still bound real spend; this cap only bounds request count.
  maxRequests: 120,
  maxInputTokensPerRequest: 8_000,
  maxOutputTokensPerRequest: 4_000,
  maxEstimatedCostUsd: 1,
  allowRetries: false,
  allowSearchFetch: false,
} satisfies BenchmarkGateConfig)

/**
 * PLACEHOLDER prices, not a DeepSeek quote. The fake provider is local and
 * free, so the schedule only has to make the cost gate executable.
 *
 * A live run (mode `'live'`) must pass the then-current approved DeepSeek
 * price schedule explicitly: omitting it throws instead of silently applying
 * these placeholder numbers.
 *
 * Cache reads/writes are priced separately when supplied; when omitted they
 * fall back to the input rate, which over-estimates rather than under-counts.
 */
export type BenchmarkPriceSchedule = Readonly<{
  inputUsdPerMillionTokens: number
  outputUsdPerMillionTokens: number
  cacheReadUsdPerMillionTokens?: number
  cacheWriteUsdPerMillionTokens?: number
}>

export const BENCHMARK_PLACEHOLDER_PRICES = Object.freeze({
  inputUsdPerMillionTokens: 1,
  outputUsdPerMillionTokens: 2,
  cacheReadUsdPerMillionTokens: 0.5,
  cacheWriteUsdPerMillionTokens: 1,
} satisfies BenchmarkPriceSchedule)

/**
 * `'scripted'` runs a local free adapter and may fall back to the documented
 * placeholder prices. `'live'` spends real money and must supply a price
 * schedule, so a silent placeholder can never govern a paid run.
 */
export type BenchmarkGateMode = 'scripted' | 'live'

export type BenchmarkPricingSource = 'placeholder' | 'explicit'

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
  readonly reservedCostUsd: number
}>

export type CompleteRequestInput = Readonly<{
  readonly step: number
  readonly usage: TokenUsage
}>

export type BenchmarkBudgetGateSnapshot = Readonly<{
  readonly config: BenchmarkGateConfig
  readonly mode: BenchmarkGateMode
  readonly pricing: BenchmarkPriceSchedule
  readonly pricingSource: BenchmarkPricingSource
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly estimatedCostUsd: number
  readonly reservedCostUsd: number
  readonly ledgerPath: string | null
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

function roundCost(value: number): number {
  return Math.round(value * 1e12) / 1e12
}

type UsageCostInput = Readonly<{
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}>

function costOf(usage: UsageCostInput, pricing: BenchmarkPriceSchedule): number {
  const cacheReadPrice = pricing.cacheReadUsdPerMillionTokens
    ?? pricing.inputUsdPerMillionTokens
  const cacheWritePrice = pricing.cacheWriteUsdPerMillionTokens
    ?? pricing.inputUsdPerMillionTokens
  const usd = (usage.inputTokens * pricing.inputUsdPerMillionTokens)
    + (usage.outputTokens * pricing.outputUsdPerMillionTokens)
    + ((usage.cacheReadTokens ?? 0) * cacheReadPrice)
    + ((usage.cacheWriteTokens ?? 0) * cacheWritePrice)
  return roundCost(usd / 1_000_000)
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Benchmark gate ${field} must be a non-negative integer: ${String(value)}`)
  }
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Benchmark gate ${field} must be a non-negative finite number: ${String(value)}`)
  }
}

export type BenchmarkSpendLedgerState = Readonly<{
  readonly version: 1
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly settledCostUsd: number
  readonly reservedCostUsd: number
}>

export const EMPTY_BENCHMARK_SPEND_LEDGER: BenchmarkSpendLedgerState = Object.freeze({
  version: 1,
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  settledCostUsd: 0,
  reservedCostUsd: 0,
})

export class BenchmarkSpendLedgerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BenchmarkSpendLedgerError'
  }
}

function readLedgerInteger(record: Record<string, unknown>, field: string, path: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BenchmarkSpendLedgerError(
      `Benchmark spend ledger ${path} field ${field} must be a non-negative integer: ${String(value)}`,
    )
  }
  return value
}

function readLedgerAmount(record: Record<string, unknown>, field: string, path: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BenchmarkSpendLedgerError(
      `Benchmark spend ledger ${path} field ${field} must be a non-negative finite number: ${String(value)}`,
    )
  }
  return value
}

/**
 * Durable spend/request counters for one benchmark session.
 *
 * Written before dispatch (with the worst-case reservation) and again after
 * settlement. A process restart loads the same numbers, so cumulative spend
 * cannot reset to zero — and a crash between dispatch and settlement leaves
 * the reservation counted rather than forgotten. A corrupt or unreadable file
 * throws instead of silently starting over.
 */
export class BenchmarkSpendLedger {
  readonly path: string

  constructor(path: string) {
    if (path.trim() === '') {
      throw new BenchmarkSpendLedgerError('Benchmark spend ledger path must be non-empty')
    }
    this.path = path
  }

  load(): BenchmarkSpendLedgerState {
    if (!existsSync(this.path)) return EMPTY_BENCHMARK_SPEND_LEDGER

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch (error) {
      throw new BenchmarkSpendLedgerError(
        `Benchmark spend ledger ${this.path} is not readable JSON`,
        { cause: error },
      )
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BenchmarkSpendLedgerError(
        `Benchmark spend ledger ${this.path} must contain a JSON object`,
      )
    }
    const record = raw as Record<string, unknown>
    if (record.version !== 1) {
      throw new BenchmarkSpendLedgerError(
        `Benchmark spend ledger ${this.path} has unsupported version ${String(record.version)}`,
      )
    }

    return Object.freeze({
      version: 1,
      requests: readLedgerInteger(record, 'requests', this.path),
      inputTokens: readLedgerInteger(record, 'inputTokens', this.path),
      outputTokens: readLedgerInteger(record, 'outputTokens', this.path),
      cacheReadTokens: readLedgerInteger(record, 'cacheReadTokens', this.path),
      cacheWriteTokens: readLedgerInteger(record, 'cacheWriteTokens', this.path),
      settledCostUsd: readLedgerAmount(record, 'settledCostUsd', this.path),
      reservedCostUsd: readLedgerAmount(record, 'reservedCostUsd', this.path),
    })
  }

  save(state: BenchmarkSpendLedgerState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${process.pid}`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(temporary, this.path)
  }
}

/**
 * One gate instance owns one benchmark session: request and spend counters are
 * cumulative across fixtures and repeated runs, while `beginTurn()` resets only
 * the per-turn retry detection.
 */
export class BenchmarkBudgetGate {
  readonly config: BenchmarkGateConfig
  readonly mode: BenchmarkGateMode
  readonly pricing: BenchmarkPriceSchedule
  readonly pricingSource: BenchmarkPricingSource

  private requestCount = 0
  private inputTokenCount = 0
  private outputTokenCount = 0
  private cacheReadTokenCount = 0
  private cacheWriteTokenCount = 0
  private costUsd = 0
  private reservedCostUsd = 0
  private lastStep: number | undefined
  private readonly stopLog: BenchmarkBudgetStop[] = []
  private readonly reservations = new Map<number, number>()
  private readonly ledger: BenchmarkSpendLedger | undefined

  constructor(
    config: Partial<BenchmarkGateConfig> = {},
    pricing?: BenchmarkPriceSchedule,
    mode: BenchmarkGateMode = 'scripted',
    ledger?: BenchmarkSpendLedger,
  ) {
    if (mode === 'live' && pricing === undefined) {
      throw new RangeError(
        'Benchmark gate live mode requires an explicit approved price schedule; '
        + 'the placeholder prices are forbidden for a paid run',
      )
    }
    this.config = Object.freeze({ ...BENCHMARK_GATE_DEFAULTS, ...config })
    this.mode = mode
    this.pricingSource = pricing === undefined ? 'placeholder' : 'explicit'
    this.pricing = Object.freeze({ ...(pricing ?? BENCHMARK_PLACEHOLDER_PRICES) })
    assertNonNegativeInteger(this.config.maxRequests, 'maxRequests')
    assertNonNegativeInteger(this.config.maxInputTokensPerRequest, 'maxInputTokensPerRequest')
    assertNonNegativeInteger(this.config.maxOutputTokensPerRequest, 'maxOutputTokensPerRequest')
    if (!Number.isFinite(this.config.maxEstimatedCostUsd) || this.config.maxEstimatedCostUsd < 0) {
      throw new RangeError(
        `Benchmark gate maxEstimatedCostUsd must be a non-negative finite number: ${String(this.config.maxEstimatedCostUsd)}`,
      )
    }
    assertNonNegativeFinite(this.pricing.inputUsdPerMillionTokens, 'pricing.inputUsdPerMillionTokens')
    assertNonNegativeFinite(this.pricing.outputUsdPerMillionTokens, 'pricing.outputUsdPerMillionTokens')
    if (this.pricing.cacheReadUsdPerMillionTokens !== undefined) {
      assertNonNegativeFinite(
        this.pricing.cacheReadUsdPerMillionTokens,
        'pricing.cacheReadUsdPerMillionTokens',
      )
    }
    if (this.pricing.cacheWriteUsdPerMillionTokens !== undefined) {
      assertNonNegativeFinite(
        this.pricing.cacheWriteUsdPerMillionTokens,
        'pricing.cacheWriteUsdPerMillionTokens',
      )
    }

    this.ledger = ledger
    if (ledger !== undefined) {
      const persisted = ledger.load()
      this.requestCount = persisted.requests
      this.inputTokenCount = persisted.inputTokens
      this.outputTokenCount = persisted.outputTokens
      this.cacheReadTokenCount = persisted.cacheReadTokens
      this.cacheWriteTokenCount = persisted.cacheWriteTokens
      this.costUsd = persisted.settledCostUsd
      this.reservedCostUsd = persisted.reservedCostUsd
    }
  }

  beginTurn(): void {
    this.lastStep = undefined
  }

  get ledgerPath(): string | null {
    return this.ledger?.path ?? null
  }

  /**
   * Admit or refuse one provider request before dispatch. The order is fixed
   * so the first violated gate becomes the recorded reason: forbidden tools,
   * retry, request count, input tokens, then the worst-case cost reservation.
   *
   * The reservation is added to the session budget before dispatch and only
   * released when `completeRequest` settles the real usage, so a crashed or
   * failed request can never free budget it may already have spent.
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
    const reservation = costOf(
      { inputTokens: input.estimatedInputTokens, outputTokens: maxTokens },
      this.pricing,
    )
    const projected = roundCost(this.costUsd + this.reservedCostUsd + reservation)
    if (projected > this.config.maxEstimatedCostUsd) {
      throw this.stop(
        'estimated-cost',
        `projected session cost $${projected} (including $${reservation} reservation) `
        + `exceeds $${this.config.maxEstimatedCostUsd}`,
        input.step,
        projected,
        this.config.maxEstimatedCostUsd,
      )
    }

    this.requestCount += 1
    this.reservedCostUsd = roundCost(this.reservedCostUsd + reservation)
    this.reservations.set(input.step, reservation)
    this.persist()

    return {
      requestIndex: this.requestCount,
      maxTokens,
      clamped: maxTokens < input.proposedMaxTokens,
      reservedCostUsd: reservation,
    }
  }

  /**
   * Record reported usage, release this request's reservation, then stop when
   * usage breaks a per-request cap or the session budget even if the provider
   * ignored the requested `maxTokens`.
   *
   * Usage is accumulated BEFORE any check throws: the request that trips a cap
   * was still dispatched and still costs money, so the snapshot must contain
   * its real usage and the stop must be recorded in the same call.
   */
  completeRequest(input: CompleteRequestInput): void {
    const reservation = this.reservations.get(input.step)
    if (reservation === undefined) {
      throw new Error(
        `Benchmark request step ${input.step} completed without an admitted reservation`,
      )
    }
    this.reservations.delete(input.step)
    this.reservedCostUsd = roundCost(Math.max(0, this.reservedCostUsd - reservation))

    const { usage } = input
    this.inputTokenCount += usage.inputTokens
    this.outputTokenCount += usage.outputTokens
    this.cacheReadTokenCount += usage.cacheReadTokens ?? 0
    this.cacheWriteTokenCount += usage.cacheWriteTokens ?? 0
    this.costUsd = roundCost(this.costUsd + costOf(usage, this.pricing))
    this.persist()

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

    if (this.costUsd + this.reservedCostUsd > this.config.maxEstimatedCostUsd) {
      throw this.stop(
        'estimated-cost',
        `reported session cost $${roundCost(this.costUsd + this.reservedCostUsd)} `
        + `exceeds $${this.config.maxEstimatedCostUsd}`,
        input.step,
        roundCost(this.costUsd + this.reservedCostUsd),
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
      mode: this.mode,
      pricing: this.pricing,
      pricingSource: this.pricingSource,
      requests: this.requestCount,
      inputTokens: this.inputTokenCount,
      outputTokens: this.outputTokenCount,
      cacheReadTokens: this.cacheReadTokenCount,
      cacheWriteTokens: this.cacheWriteTokenCount,
      estimatedCostUsd: this.costUsd,
      reservedCostUsd: this.reservedCostUsd,
      ledgerPath: this.ledgerPath,
      stops: Object.freeze([...this.stopLog]),
    })
  }

  private persist(): void {
    this.ledger?.save({
      version: 1,
      requests: this.requestCount,
      inputTokens: this.inputTokenCount,
      outputTokens: this.outputTokenCount,
      cacheReadTokens: this.cacheReadTokenCount,
      cacheWriteTokens: this.cacheWriteTokenCount,
      settledCostUsd: this.costUsd,
      reservedCostUsd: this.reservedCostUsd,
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
