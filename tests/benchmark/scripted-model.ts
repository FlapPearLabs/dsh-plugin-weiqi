import type { BenchmarkFixture, ScriptedModelStepPlan, ScriptedToolCall } from './fixtures.js'

/**
 * Deterministic stand-in for DeepSeek (Spec §38 harness, WAVE-C-T10).
 *
 * The adapter has no network, no clock and no randomness: it replays the
 * fixture's fixed plan and reports synthetic token counts. The numbers come
 * from a fixed formula, not from a model provider; they exist so the harness
 * reports the §38 token fields and so the C-S01 cap has something to clamp.
 * They cannot and must not be used to calibrate production token caps.
 */
export const SCRIPTED_MODEL_ID = 'scripted-legal-move-adapter-v1'

/** A deliberately oversized per-request proposal the C-S01 cap must clamp. */
export const SCRIPTED_PROPOSED_MAX_TOKENS = 8_192

const BASE_INPUT_TOKENS = 320
const INPUT_TOKENS_PER_CALL = 48
const BASE_OUTPUT_TOKENS = 96
const OUTPUT_TOKENS_PER_CALL = 32

export type ScriptedModelStep = {
  readonly index: number
  readonly label: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly proposedMaxTokens: number
  readonly calls: readonly ScriptedToolCall[]
}

export type ScriptedModelAdapter = {
  readonly modelId: typeof SCRIPTED_MODEL_ID
  readonly stepCount: number
  next: () => ScriptedModelStep
}

function tokensFor(plan: ScriptedModelStepPlan, index: number): {
  inputTokens: number
  outputTokens: number
} {
  const calls = plan.calls.length
  return {
    inputTokens: BASE_INPUT_TOKENS + INPUT_TOKENS_PER_CALL * calls + 7 * index,
    outputTokens: BASE_OUTPUT_TOKENS + OUTPUT_TOKENS_PER_CALL * calls,
  }
}

export function createScriptedModelAdapter(fixture: BenchmarkFixture): ScriptedModelAdapter {
  let cursor = 0

  return Object.freeze({
    modelId: SCRIPTED_MODEL_ID,
    stepCount: fixture.steps.length,
    next(): ScriptedModelStep {
      const plan = fixture.steps[cursor]
      if (plan === undefined) {
        throw new Error(`Scripted adapter exhausted after ${fixture.steps.length} steps`)
      }
      const index = cursor
      cursor += 1
      return Object.freeze({
        index,
        label: plan.label,
        ...tokensFor(plan, index),
        proposedMaxTokens: SCRIPTED_PROPOSED_MAX_TOKENS,
        calls: plan.calls,
      })
    },
  })
}
