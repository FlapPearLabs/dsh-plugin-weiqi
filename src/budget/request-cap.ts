import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

/**
 * The request fields this listener reads from the `agent/request` waterfall
 * payload. The pinned event also carries `agent` and `signal`; a listener that
 * needs neither stays compatible with the verified seam.
 */
export type GoRequestWaterfallPayload = Readonly<{
  turn: number
  step: number
}>

/**
 * The exact shape of the C-S01-verified `agent/request` waterfall listener:
 * resolve `next()`, then return a replacement `LlmCallConfig` (Spec §22.1).
 */
export type GoRequestTokenCapListener = (
  payload: GoRequestWaterfallPayload,
  next: () => Promise<LlmCallConfig>,
) => Promise<LlmCallConfig>

/**
 * Create the Go-agent request listener that applies the absolute token cap.
 *
 * The cap is applied to the config `next()` resolves, not to a proposal, so no
 * later waterfall contributor can raise it. A resolved request exactly at the
 * cap is allowed; anything above it (or a missing `maxTokens`) is clamped.
 */
export function createGoRequestTokenCap(maxTokens: number): GoRequestTokenCapListener {
  if (!Number.isInteger(maxTokens) || maxTokens < 0) {
    throw new RangeError(
      `Go request token cap must be a non-negative integer: ${String(maxTokens)}`,
    )
  }

  return async (_payload, next) => {
    const resolved = await next()
    const capped = Math.min(resolved.maxTokens ?? maxTokens, maxTokens)
    return resolved.maxTokens === capped ? resolved : { ...resolved, maxTokens: capped }
  }
}
