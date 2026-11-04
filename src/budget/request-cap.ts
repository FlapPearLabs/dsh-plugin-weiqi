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
 * Reads the turn-level token budget still available. The request listener calls
 * it for every request, so the effective cap shrinks as usage is recorded.
 */
export type GoRemainingTurnTokens = () => number

/**
 * Create the Go-agent request listener that applies the absolute token cap.
 *
 * The cap is applied to the config `next()` resolves, not to a proposal, so no
 * later waterfall contributor registered inside this listener can raise it. A
 * resolved request exactly at the cap is allowed; anything above it (or a
 * missing `maxTokens`) is clamped.
 *
 * When `remainingTurnTokens` is supplied, the effective cap of one request is
 * `min(maxTokens, remainingTurnTokens())`, read after `next()` resolves so the
 * most recently recorded usage is honored (Spec §22.1: one long reasoning
 * request must not consume an unbounded turn before counters update). A
 * non-finite or negative reading fails closed to 0. The listener always
 * returns a config and never rejects; §22.2 step denial belongs to
 * `beginModelStep`, keeping this seam's verified clamp-only shape.
 */
export function createGoRequestTokenCap(
  maxTokens: number,
  remainingTurnTokens?: GoRemainingTurnTokens,
): GoRequestTokenCapListener {
  if (!Number.isInteger(maxTokens) || maxTokens < 0) {
    throw new RangeError(
      `Go request token cap must be a non-negative integer: ${String(maxTokens)}`,
    )
  }

  function effectiveCap(): number {
    if (remainingTurnTokens === undefined) return maxTokens
    const remaining = remainingTurnTokens()
    if (!Number.isFinite(remaining) || remaining < 0) return 0
    return Math.min(maxTokens, Math.floor(remaining))
  }

  return async (_payload, next) => {
    const resolved = await next()
    const cap = effectiveCap()
    const proposed = resolved.maxTokens
    // An upstream NaN/negative `maxTokens` must not leak into the request
    // config; fall back to the deterministic effective cap instead.
    const capped =
      typeof proposed === 'number' && Number.isFinite(proposed) && proposed >= 0
        ? Math.min(proposed, cap)
        : cap
    return resolved.maxTokens === capped ? resolved : { ...resolved, maxTokens: capped }
  }
}
