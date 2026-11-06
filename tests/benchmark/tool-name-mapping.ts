import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { GO_TOOL_NAMES } from '../../src/tools/go/go-tools.js'

/**
 * Bidirectional provider-name mapping for the benchmark request path
 * (WAVE-C-T10, zero-cost slice).
 *
 * The official DeepSeek API rejects a tool name that does not match
 * `^[a-zA-Z0-9_-]+$`, while the product's Go tools are named `go.play`,
 * `go.inspect_group`, and so on. The mapping therefore has two hard rules:
 *
 * 1. every provider-facing name matches {@link PROVIDER_TOOL_NAME_PATTERN};
 * 2. the table is a bijection built from the real `GO_TOOL_NAMES`, so two
 *    product names can never share one provider name.
 *
 * An unknown name is never guessed at: both directions throw
 * {@link BenchmarkToolNameError}. A future product tool whose encoded name
 * collides with an existing entry fails at module load with
 * {@link BenchmarkToolNameCollisionError} instead of silently shadowing one.
 */

export const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export type BenchmarkToolNameEntry = Readonly<{
  readonly original: string
  readonly provider: string
}>

export class BenchmarkToolNameError extends Error {
  readonly direction: 'outbound' | 'inbound'
  readonly toolName: string

  constructor(direction: 'outbound' | 'inbound', toolName: string, detail: string) {
    super(
      `Benchmark tool name ${direction} mapping refused ${JSON.stringify(toolName)}: ${detail}`,
    )
    this.name = 'BenchmarkToolNameError'
    this.direction = direction
    this.toolName = toolName
  }
}

export class BenchmarkToolNameCollisionError extends Error {
  readonly first: string
  readonly second: string
  readonly provider: string

  constructor(first: string, second: string, provider: string) {
    super(
      `Benchmark tool name mapping collision: ${JSON.stringify(first)} and `
      + `${JSON.stringify(second)} both encode to ${JSON.stringify(provider)}`,
    )
    this.name = 'BenchmarkToolNameCollisionError'
    this.first = first
    this.second = second
    this.provider = provider
  }
}

/**
 * Dot-to-underscore is the documented encoding (`go.play` -> `go_play`).
 * Other characters are left as-is so an unclean name fails the pattern check
 * instead of being silently rewritten into a different tool.
 */
export function encodeProviderToolName(original: string): string {
  return original.replace(/\./g, '_')
}

/**
 * Build and validate one bijective name table. Exported so tests can prove the
 * collision and non-compliant-name guards instead of trusting the fixed table.
 */
export function createBenchmarkToolNameTable(
  originals: readonly string[],
): readonly BenchmarkToolNameEntry[] {
  const entries: BenchmarkToolNameEntry[] = []
  const byProvider = new Map<string, string>()

  for (const original of originals) {
    const provider = encodeProviderToolName(original)
    if (!PROVIDER_TOOL_NAME_PATTERN.test(provider)) {
      throw new BenchmarkToolNameError(
        'outbound',
        original,
        `encoded name ${JSON.stringify(provider)} does not match ${PROVIDER_TOOL_NAME_PATTERN}`,
      )
    }
    const prior = byProvider.get(provider)
    if (prior !== undefined) {
      throw new BenchmarkToolNameCollisionError(prior, original, provider)
    }
    byProvider.set(provider, original)
    entries.push(Object.freeze({ original, provider }))
  }

  return Object.freeze(entries)
}

/** The table the benchmark path actually uses, derived from the product registry. */
export const BENCHMARK_TOOL_NAME_TABLE: readonly BenchmarkToolNameEntry[] =
  createBenchmarkToolNameTable(GO_TOOL_NAMES)

const BY_ORIGINAL = new Map<string, string>(
  BENCHMARK_TOOL_NAME_TABLE.map(entry => [entry.original, entry.provider] as const),
)
const BY_PROVIDER = new Map<string, string>(
  BENCHMARK_TOOL_NAME_TABLE.map(entry => [entry.provider, entry.original] as const),
)

/**
 * True when `name` is a complete provider tool name (or an already-product
 * name). Used to defer streaming-name mapping until the fragments form a name
 * the table knows; it never throws.
 */
export function isKnownToolName(name: string): boolean {
  return BY_PROVIDER.has(name) || BY_ORIGINAL.has(name)
}

/**
 * Outbound mapping. A name already carrying its provider form is returned
 * unchanged (idempotent), so mapping a message twice cannot double-encode it.
 * Anything outside the table is refused.
 */
export function toProviderToolName(original: string): string {
  const provider = BY_ORIGINAL.get(original)
  if (provider !== undefined) return provider
  if (BY_PROVIDER.has(original)) return original
  throw new BenchmarkToolNameError(
    'outbound',
    original,
    'not present in the benchmark tool name table',
  )
}

/**
 * Inbound mapping for a name the model returned. A name already carrying its
 * product form is returned unchanged (idempotent); anything outside the table
 * is refused instead of being guessed at or passed through.
 */
export function fromProviderToolName(provider: string): string {
  const original = BY_PROVIDER.get(provider)
  if (original !== undefined) return original
  if (BY_ORIGINAL.has(provider)) return provider
  throw new BenchmarkToolNameError(
    'inbound',
    provider,
    'not present in the benchmark tool name table',
  )
}

/** Map a request's tool schemas to their provider-safe names. */
export function toProviderToolSchemas(tools: readonly ToolSchema[]): ToolSchema[] {
  return tools.map(tool => ({ ...tool, name: toProviderToolName(tool.name) }))
}

/**
 * Map every assistant tool-call block in a request history to its
 * provider-safe name. Tool-result blocks correlate by call id and carry no
 * tool name, so they pass through unchanged.
 */
export function toProviderMessages(messages: readonly Message[]): Message[] {
  return messages.map(message => ({
    ...message,
    content: message.content.map(block => (
      block.type === 'tool-call'
        ? { ...block, name: toProviderToolName(block.name) }
        : block
    )),
  }))
}
