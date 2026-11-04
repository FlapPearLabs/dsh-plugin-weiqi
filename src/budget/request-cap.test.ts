import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { createGoRequestTokenCap, type GoRequestTokenCapListener } from './request-cap.js'

/**
 * TEST FIXTURE ONLY. `257` / `8_192` are the diagnostic values recorded by the
 * C-S01 executed proof; they are NOT production calibration. BL-BUD-06 /
 * WAVE-C-T10 owns benchmark-derived budget numbers.
 */
const FIXTURE_CAP = 257
const FIXTURE_OVERSIZED = 8_192
const REQUEST = { turn: 1, step: 1 } as const

function config(maxTokens?: number): LlmCallConfig {
  return maxTokens === undefined
    ? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    : { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens }
}

async function applyCap(
  listener: GoRequestTokenCapListener,
  resolved: LlmCallConfig,
): Promise<LlmCallConfig> {
  return listener(REQUEST, async () => resolved)
}

describe('createGoRequestTokenCap', () => {
  it('allows a resolved request exactly at the cap boundary', async () => {
    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), config(FIXTURE_CAP))

    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('clamps a request one token over the boundary', async () => {
    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), config(FIXTURE_CAP + 1))

    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('clamps an oversized request instead of rejecting it', async () => {
    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), config(FIXTURE_OVERSIZED))

    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('does not raise a request already below the cap', async () => {
    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), config(64))

    expect(capped.maxTokens).toBe(64)
  })

  it('clamps the awaited waterfall result rather than a caller proposal', async () => {
    const listener = createGoRequestTokenCap(FIXTURE_CAP)
    let nextCalls = 0

    const capped = await listener(REQUEST, async () => {
      nextCalls += 1
      // A later waterfall contributor raised the proposal; only clamping the
      // awaited result keeps the absolute ceiling.
      return config(FIXTURE_OVERSIZED)
    })

    expect(nextCalls).toBe(1)
    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('installs the cap when the resolved request carries no maxTokens', async () => {
    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), config())

    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('enforces a zero cap', async () => {
    const capped = await applyCap(createGoRequestTokenCap(0), config(FIXTURE_OVERSIZED))

    expect(capped.maxTokens).toBe(0)
  })

  it('stays capped when another contributor with a higher cap runs outside it', async () => {
    const outer = createGoRequestTokenCap(4_096)
    const inner = createGoRequestTokenCap(FIXTURE_CAP)

    const capped = await outer(REQUEST, () => inner(REQUEST, async () => config(FIXTURE_OVERSIZED)))

    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('is idempotent when the same request is clamped twice', async () => {
    const listener = createGoRequestTokenCap(FIXTURE_CAP)

    const once = await applyCap(listener, config(FIXTURE_OVERSIZED))
    const twice = await applyCap(listener, once)

    expect(twice.maxTokens).toBe(FIXTURE_CAP)
    expect(twice).toEqual(once)
  })

  it('preserves every other request field', async () => {
    const resolved: LlmCallConfig = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      temperature: 0.2,
      maxTokens: FIXTURE_OVERSIZED,
      stop: ['<stop>'],
    }

    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), resolved)

    expect(capped).toEqual({ ...resolved, maxTokens: FIXTURE_CAP })
  })

  it('leaves the resolved config object untouched', async () => {
    const resolved = config(FIXTURE_OVERSIZED)

    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), resolved)

    expect(resolved.maxTokens).toBe(FIXTURE_OVERSIZED)
    expect(capped).not.toBe(resolved)
  })

  it('matches the verified agent/request waterfall shape', async () => {
    type VerifiedRequestPayload = {
      agent: unknown
      turn: number
      step: number
      signal: AbortSignal
    }
    const onRequest: (
      payload: VerifiedRequestPayload,
      next: () => Promise<LlmCallConfig>,
    ) => Promise<LlmCallConfig> = createGoRequestTokenCap(FIXTURE_CAP)

    const capped = await onRequest(
      { agent: {}, turn: 3, step: 2, signal: new AbortController().signal },
      async () => config(FIXTURE_OVERSIZED),
    )

    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('rejects a cap that is not a non-negative integer', () => {
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createGoRequestTokenCap(value)).toThrow(RangeError)
    }
  })
})

describe('createGoRequestTokenCap with a live turn budget', () => {
  it('caps a request at the one remaining turn token', async () => {
    const capped = await applyCap(createGoRequestTokenCap(FIXTURE_CAP, () => 1), config(FIXTURE_OVERSIZED))

    expect(capped.maxTokens).toBe(1)
  })

  it('caps a request at the remaining turn budget below the per-request cap', async () => {
    const capped = await applyCap(
      createGoRequestTokenCap(FIXTURE_CAP, () => 100),
      config(FIXTURE_OVERSIZED),
    )

    expect(capped.maxTokens).toBe(100)
  })

  it('keeps the per-request cap while the turn budget exceeds it', async () => {
    const capped = await applyCap(
      createGoRequestTokenCap(FIXTURE_CAP, () => 400),
      config(FIXTURE_OVERSIZED),
    )

    expect(capped.maxTokens).toBe(FIXTURE_CAP)
  })

  it('returns a zero cap once the turn budget is exhausted', async () => {
    const capped = await applyCap(
      createGoRequestTokenCap(FIXTURE_CAP, () => 0),
      config(FIXTURE_OVERSIZED),
    )

    expect(capped.maxTokens).toBe(0)
  })

  it('reads the remaining budget for every request instead of caching the first value', async () => {
    let remaining = FIXTURE_CAP + 100
    const listener = createGoRequestTokenCap(FIXTURE_CAP, () => remaining)

    const first = await applyCap(listener, config(FIXTURE_OVERSIZED))
    remaining = 64
    const second = await applyCap(listener, config(FIXTURE_OVERSIZED))

    expect(first.maxTokens).toBe(FIXTURE_CAP)
    expect(second.maxTokens).toBe(64)
  })

  it('falls back to the effective cap for a NaN or negative upstream maxTokens', async () => {
    for (const maxTokens of [Number.NaN, -1]) {
      const absolute = await applyCap(createGoRequestTokenCap(FIXTURE_CAP), config(maxTokens))
      const budgeted = await applyCap(
        createGoRequestTokenCap(FIXTURE_CAP, () => 100),
        config(maxTokens),
      )

      expect(absolute.maxTokens).toBe(FIXTURE_CAP)
      expect(budgeted.maxTokens).toBe(100)
    }
  })

  it('fails closed when the remaining budget reads as NaN or negative', async () => {
    for (const remaining of [Number.NaN, -1]) {
      const capped = await applyCap(
        createGoRequestTokenCap(FIXTURE_CAP, () => remaining),
        config(FIXTURE_OVERSIZED),
      )

      expect(capped.maxTokens).toBe(0)
    }
  })
})
