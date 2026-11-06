/**
 * Spec §39.4 budget bypass suite (BL-BUD-05).
 *
 * Every case here is an adversarial attempt to spend more Go-turn budget than
 * Spec §22 allows. Attempts run through the real `createGoTurnEnforcement`
 * boundary and, where the attack would arrive from a model tool call, through
 * the real registered `go.*` tool surface (`registerGoTools` over the
 * `GoCapabilityGuard`). Nothing is mocked: the suite observes the counters,
 * the rejection class and whether the rules port was actually touched.
 *
 * Bypass classes covered (Spec §39.4):
 * - many `try_move` calls;
 * - many inspect calls (both inspect tools share one counter);
 * - multiple model steps / repeated oversized reasoning requests;
 * - a later waterfall contributor that tries to raise `maxTokens`;
 * - aggregated tool paths that fan one wrapper out into several executions;
 * - any analysis request after a committed play / pass / resign;
 * - a deep-think boost attempt after exhaustion or after the single grant;
 * - mixing the tool path with the direct enforcement path.
 *
 * A failed assertion here means a real bypass. There is no "expected bypass"
 * case: if an attack is admitted, the helper below throws and the test fails
 * loudly instead of recording a pass.
 *
 * Fixture budget: TEST VALUES ONLY, not production calibration. BL-BUD-06 /
 * WAVE-C-T10 owns the benchmark-derived §22 numbers.
 */
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  GoDeepThinkAlreadyRequestedError,
  GoTurnAnalysisEndedError,
  GoTurnBudgetExhaustedError,
  createGoTurnEnforcement,
  type GoTurnAnalysisAction,
  type GoTurnCommit,
  type GoTurnEnforcement,
} from '../../src/budget/enforcement.js'
import type { GoTurnBudget } from '../../src/contracts/budget.js'
import type { GameConfig, GoRulesPort } from '../../src/contracts/rules.js'
import { GoCapabilityGuard } from '../../src/runtime/go-capability-guard.js'
import { registerGoTools } from '../../src/tools/go/go-tool-registry.js'
import type { GoToolRegistry } from '../../src/tools/go/types.js'
import { createStubGoRulesPort } from '../rules/stub-port.js'

/** TEST FIXTURE ONLY. Not production calibration; WAVE-C-T10 owns §38 values. */
const BYPASS_BUDGET = {
  maxModelSteps: 2,
  maxInspectCalls: 3,
  maxTryMoves: 2,
  perRequestMaxTokens: 300,
  maxTurnTokens: 1_000,
} as const satisfies GoTurnBudget

/** `deepseek` moves first, so the Go lane may commit without a user move. */
const DEEPSEEK_FIRST_COLORS: GameConfig['colors'] = { user: 'white', deepseek: 'black' }
const CATEGORICAL_COLORS: GameConfig['colors'] = { user: 'black', deepseek: 'white' }

const REQUEST = { turn: 1, step: 1 } as const
const OVERSIZED_REQUEST = 10_000_000

type BypassHarness = Readonly<{
  readonly gameId: string
  readonly enforcement: GoTurnEnforcement
  readonly registry: GoToolRegistry
  readonly calls: string[]
  readonly port: GoRulesPort
}>

type HarnessOptions = Readonly<{
  readonly budget?: Partial<GoTurnBudget>
  readonly colors?: GameConfig['colors']
}>

/**
 * One Go turn's real enforcement plus the real registered tool surface, backed
 * by a recording rules port so a rejected attempt can be proven not to have
 * executed.
 */
function createBypassHarness(options: HarnessOptions = {}): BypassHarness {
  const calls: string[] = []
  const stub = createStubGoRulesPort()
  const port = new Proxy(stub, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        calls.push(String(property))
        return (value as (...inner: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as GoRulesPort

  const enforcement = createGoTurnEnforcement({ ...BYPASS_BUDGET, ...options.budget })
  const registry = registerGoTools({ port, enforcement, guard: new GoCapabilityGuard() })
  const gameId = 'bypass-game'
  port.createGame({
    gameId,
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: options.colors ?? CATEGORICAL_COLORS,
  })

  return { gameId, enforcement, registry, calls, port }
}

function invoke<T = { ok: boolean }>(
  harness: BypassHarness,
  toolPath: string,
  args: unknown = {},
): T {
  return harness.registry.invoke(toolPath, args) as T
}

function countCalls(harness: BypassHarness, method: string): number {
  return harness.calls.filter(call => call === method).length
}

type ErrorConstructor<T extends Error> = new (...args: any[]) => T

/**
 * An admitted attempt fails the test outright; a rejection only counts when it
 * is the expected budget/analysis error class (a TypeError from broken code
 * must not be read as a successful denial).
 */
function rejectionOf<T extends Error>(attempt: () => unknown, expected: ErrorConstructor<T>): T {
  let admitted = false
  let caught: unknown
  try {
    attempt()
    admitted = true
  } catch (error) {
    caught = error
  }

  if (admitted) {
    throw new Error('budget bypass: the attempt was admitted instead of hitting its limit')
  }
  if (!(caught instanceof expected)) {
    const detail = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)
    throw new Error(`budget bypass: attempt threw an unexpected rejection: ${detail}`)
  }
  return caught
}

function resolvedRequest(maxTokens?: number): LlmCallConfig {
  return maxTokens === undefined
    ? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    : { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens }
}

async function applyRequest(
  harness: BypassHarness,
  maxTokens?: number,
): Promise<LlmCallConfig> {
  return harness.enforcement.requestTokenCap(REQUEST, async () => resolvedRequest(maxTokens))
}

const ANALYSIS_TOOL_ATTEMPTS: readonly Readonly<{
  readonly action: GoTurnAnalysisAction
  readonly toolPath: string
  readonly args: (gameId: string) => unknown
}>[] = [
  {
    action: 'inspect',
    toolPath: 'go.inspect_group',
    args: gameId => ({ gameId, point: { x: 4, y: 4 } }),
  },
  {
    action: 'inspect',
    toolPath: 'go.inspect_region',
    args: gameId => ({ gameId, point: { x: 4, y: 4 }, radius: 1 }),
  },
  {
    action: 'try_move',
    toolPath: 'go.try_move',
    args: gameId => ({ gameId, point: { x: 4, y: 4 } }),
  },
  {
    action: 'deep_think',
    toolPath: 'go.request_deep_think',
    args: () => ({}),
  },
]

function commitThroughTool(commit: GoTurnCommit): BypassHarness {
  const harness = createBypassHarness({ colors: DEEPSEEK_FIRST_COLORS })
  if (commit === 'play') {
    expect(invoke(harness, 'go.play', { gameId: harness.gameId, point: { x: 4, y: 4 } }))
      .toMatchObject({ ok: true })
  } else if (commit === 'pass') {
    expect(invoke(harness, 'go.pass', { gameId: harness.gameId })).toMatchObject({ ok: true })
  } else {
    expect(invoke(harness, 'go.resign', { gameId: harness.gameId })).toMatchObject({ ok: true })
  }
  return harness
}

describe('Spec §39.4 many try_move calls', () => {
  it('admits exactly maxTryMoves and neither executes nor charges later calls', () => {
    const harness = createBypassHarness({ colors: DEEPSEEK_FIRST_COLORS })
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }

    for (let index = 0; index < BYPASS_BUDGET.maxTryMoves; index += 1) {
      expect(invoke(harness, 'go.try_move', args)).toMatchObject({ ok: true, legal: true })
    }
    expect(harness.enforcement.snapshot().tryMoves).toBe(BYPASS_BUDGET.maxTryMoves)
    const executions = countCalls(harness, 'getState')

    const boundary = rejectionOf(
      () => invoke(harness, 'go.try_move', args),
      GoTurnBudgetExhaustedError,
    )
    expect(boundary).toMatchObject({ counter: 'maxTryMoves', limit: 2, used: 2 })
    expect(countCalls(harness, 'getState')).toBe(executions)

    for (let index = 0; index < 50; index += 1) {
      expect(rejectionOf(() => invoke(harness, 'go.try_move', args), GoTurnBudgetExhaustedError))
        .toMatchObject({ counter: 'maxTryMoves', limit: 2, used: 2 })
    }
    expect(harness.enforcement.snapshot().tryMoves).toBe(BYPASS_BUDGET.maxTryMoves)
    expect(countCalls(harness, 'getState')).toBe(executions)
    expect(stubState(harness).stones).toEqual([])
  })
})

describe('Spec §39.4 many inspect calls', () => {
  it('shares maxInspectCalls across both inspect tools and denies the one past it', () => {
    const harness = createBypassHarness()
    const at = (x: number, y: number) => ({ gameId: harness.gameId, point: { x, y } })

    expect(invoke(harness, 'go.inspect_group', at(4, 4))).toMatchObject({ ok: true })
    expect(invoke(harness, 'go.inspect_region', { ...at(4, 4), radius: 1 }))
      .toMatchObject({ ok: true })
    expect(invoke(harness, 'go.inspect_group', at(0, 0))).toMatchObject({ ok: true })
    expect(harness.enforcement.snapshot().inspectCalls).toBe(BYPASS_BUDGET.maxInspectCalls)
    const executions = countCalls(harness, 'inspectGroup') + countCalls(harness, 'getState')

    const boundary = rejectionOf(
      () => invoke(harness, 'go.inspect_region', { ...at(2, 2), radius: 1 }),
      GoTurnBudgetExhaustedError,
    )
    expect(boundary).toMatchObject({ counter: 'maxInspectCalls', limit: 3, used: 3 })

    for (let index = 0; index < 50; index += 1) {
      expect(
        rejectionOf(
          () => invoke(harness, 'go.inspect_group', at(4, 4)),
          GoTurnBudgetExhaustedError,
        ),
      ).toMatchObject({ counter: 'maxInspectCalls', limit: 3, used: 3 })
    }
    expect(harness.enforcement.snapshot().inspectCalls).toBe(BYPASS_BUDGET.maxInspectCalls)
    expect(countCalls(harness, 'inspectGroup') + countCalls(harness, 'getState')).toBe(executions)
  })
})

describe('Spec §39.4 multiple model steps', () => {
  it('admits exactly maxModelSteps steps and denies a burst of further steps', () => {
    const harness = createBypassHarness()

    harness.enforcement.beginModelStep()
    harness.enforcement.beginModelStep()
    expect(harness.enforcement.snapshot().modelSteps).toBe(BYPASS_BUDGET.maxModelSteps)

    const boundary = rejectionOf(
      () => harness.enforcement.beginModelStep(),
      GoTurnBudgetExhaustedError,
    )
    expect(boundary).toMatchObject({ counter: 'maxModelSteps', limit: 2, used: 2 })

    for (let index = 0; index < 50; index += 1) {
      expect(
        rejectionOf(() => harness.enforcement.beginModelStep(), GoTurnBudgetExhaustedError),
      ).toMatchObject({ counter: 'maxModelSteps', limit: 2, used: 2 })
    }
    expect(harness.enforcement.snapshot().modelSteps).toBe(BYPASS_BUDGET.maxModelSteps)
  })

  it('cannot buy a model step by issuing requests through the seam', async () => {
    const harness = createBypassHarness()

    for (let index = 0; index < 50; index += 1) {
      const capped = await applyRequest(harness, OVERSIZED_REQUEST)
      expect(capped.maxTokens).toBe(BYPASS_BUDGET.perRequestMaxTokens)
    }

    expect(harness.enforcement.snapshot()).toMatchObject({ modelSteps: 0, turnTokens: 0 })
    expect(harness.enforcement.remainingTurnTokens()).toBe(BYPASS_BUDGET.maxTurnTokens)
  })
})

describe('Spec §39.4 a single oversized reasoning request', () => {
  it('clamps the oversized request to the absolute per-request cap at the exact boundary', async () => {
    const harness = createBypassHarness()

    expect((await applyRequest(harness, OVERSIZED_REQUEST)).maxTokens).toBe(300)
    expect((await applyRequest(harness, BYPASS_BUDGET.perRequestMaxTokens)).maxTokens).toBe(300)
    expect((await applyRequest(harness, BYPASS_BUDGET.perRequestMaxTokens + 1)).maxTokens).toBe(300)
    expect((await applyRequest(harness, 64)).maxTokens).toBe(64)
    expect((await applyRequest(harness)).maxTokens).toBe(300)
  })

  it('cannot be raised by a later contributor inside the waterfall', async () => {
    const harness = createBypassHarness()

    const capped = await harness.enforcement.requestTokenCap(REQUEST, async () => {
      const earlier = resolvedRequest(BYPASS_BUDGET.perRequestMaxTokens)
      return { ...earlier, maxTokens: (earlier.maxTokens ?? 0) * 1_000 }
    })

    expect(capped.maxTokens).toBe(BYPASS_BUDGET.perRequestMaxTokens)
  })

  it('shrinks to the turn tokens still available after every recorded step', async () => {
    const harness = createBypassHarness({ budget: { maxModelSteps: 5 } })

    for (let index = 0; index < 3; index += 1) {
      harness.enforcement.beginModelStep().complete({ tokens: 300 })
    }
    expect(harness.enforcement.remainingTurnTokens()).toBe(100)
    expect((await applyRequest(harness, OVERSIZED_REQUEST)).maxTokens).toBe(100)

    harness.enforcement.beginModelStep().complete({ tokens: 100 })
    expect(harness.enforcement.remainingTurnTokens()).toBe(0)
    expect((await applyRequest(harness, OVERSIZED_REQUEST)).maxTokens).toBe(0)
  })

  it('fails closed on a non-finite or negative contributor proposal', async () => {
    const harness = createBypassHarness()

    for (const maxTokens of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect((await applyRequest(harness, maxTokens)).maxTokens).toBe(300)
    }
  })

  it('does not spend turn tokens merely by clamping requests', async () => {
    const harness = createBypassHarness()

    await Promise.all(
      Array.from({ length: 50 }, async () => applyRequest(harness, OVERSIZED_REQUEST)),
    )

    expect(harness.enforcement.snapshot().turnTokens).toBe(0)
    expect(harness.enforcement.remainingTurnTokens()).toBe(1_000)
  })
})

describe('Spec §39.4 aggregated tool paths', () => {
  it('charges every execution a single wrapper performs and stops the wrapper at the cap', () => {
    const harness = createBypassHarness()
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }
    let completed = 0

    const boundary = rejectionOf(() => {
      for (let index = 0; index < 25; index += 1) {
        invoke(harness, 'go.inspect_group', args)
        completed += 1
      }
    }, GoTurnBudgetExhaustedError)

    expect(boundary).toMatchObject({ counter: 'maxInspectCalls', limit: 3, used: 3 })
    expect(completed).toBe(3)
    expect(harness.enforcement.snapshot().inspectCalls).toBe(3)
    expect(countCalls(harness, 'inspectGroup')).toBe(3)
  })

  it('charges every try_move a single wrapper performs without mutating the board', () => {
    const harness = createBypassHarness({ colors: DEEPSEEK_FIRST_COLORS })
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }
    const executions = countCalls(harness, 'getState')
    let completed = 0

    const boundary = rejectionOf(() => {
      for (let index = 0; index < 25; index += 1) {
        invoke(harness, 'go.try_move', args)
        completed += 1
      }
    }, GoTurnBudgetExhaustedError)

    expect(boundary).toMatchObject({ counter: 'maxTryMoves', limit: 2, used: 2 })
    expect(completed).toBe(2)
    expect(countCalls(harness, 'getState')).toBe(executions + 2)
    expect(stubState(harness).stones).toEqual([])
  })

  it('cannot aggregate one direct call and one tool call into a single charge', () => {
    const harness = createBypassHarness()
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }

    harness.enforcement.beginInspect()
    invoke(harness, 'go.inspect_group', args)
    harness.enforcement.beginInspect()
    expect(harness.enforcement.snapshot().inspectCalls).toBe(3)

    const executions = countCalls(harness, 'inspectGroup') + countCalls(harness, 'getState')
    expect(
      rejectionOf(() => invoke(harness, 'go.inspect_group', args), GoTurnBudgetExhaustedError),
    ).toMatchObject({ counter: 'maxInspectCalls', limit: 3, used: 3 })
    expect(countCalls(harness, 'inspectGroup') + countCalls(harness, 'getState')).toBe(executions)
  })
})

describe('Spec §39.4 requests and analysis after a committed action', () => {
  for (const commit of ['play', 'pass', 'resign'] as const) {
    it(`denies every analysis path after a committed ${commit}`, async () => {
      const harness = commitThroughTool(commit)
      const expectedTerminal = commit === 'resign'
      const committedState = stubState(harness)

      expect(harness.enforcement.snapshot()).toMatchObject({
        committedAction: commit,
        gameTerminal: expectedTerminal,
        modelSteps: 0,
      })
      const callsAfterCommit = harness.calls.length

      for (const attempt of ANALYSIS_TOOL_ATTEMPTS) {
        const rejection = rejectionOf(
          () => invoke(harness, attempt.toolPath, attempt.args(harness.gameId)),
          GoTurnAnalysisEndedError,
        )
        expect(rejection).toMatchObject({
          action: attempt.action,
          committedAction: commit,
          gameTerminal: expectedTerminal,
        })
      }
      expect(
        rejectionOf(() => harness.enforcement.beginModelStep(), GoTurnAnalysisEndedError),
      ).toMatchObject({ action: 'model_step', committedAction: commit })

      expect(harness.calls.length).toBe(callsAfterCommit)
      expect(stubState(harness)).toEqual(committedState)

      // §22.1 binds the seam itself: it stays a clamp, not an admission gate.
      const capped = await applyRequest(harness, OVERSIZED_REQUEST)
      expect(capped.maxTokens).toBe(BYPASS_BUDGET.perRequestMaxTokens)
      expect(harness.enforcement.snapshot().modelSteps).toBe(0)
    })
  }
})

describe('Spec §39.4 deep-think boost attempts', () => {
  it('grants the single boost once and rejects a burst of repeated requests', () => {
    const harness = createBypassHarness()

    expect(invoke(harness, 'go.request_deep_think')).toMatchObject({ ok: true, applied: true })
    expect(harness.enforcement.snapshot()).toMatchObject({
      deepThinkRequests: 1,
      deepThinkBoost: { pendingModelSteps: 1, grantedModelSteps: 1, consumedModelSteps: 0 },
    })

    for (let index = 0; index < 50; index += 1) {
      rejectionOf(
        () => invoke(harness, 'go.request_deep_think'),
        GoDeepThinkAlreadyRequestedError,
      )
    }
    expect(harness.enforcement.snapshot()).toMatchObject({
      deepThinkRequests: 1,
      deepThinkBoost: { pendingModelSteps: 1, grantedModelSteps: 1, consumedModelSteps: 0 },
    })
  })

  it('cannot raise the per-request cap or the overall turn ceiling', async () => {
    const harness = createBypassHarness({ budget: { maxModelSteps: 1 } })

    harness.enforcement.beginModelStep().complete({ tokens: 300 })
    invoke(harness, 'go.request_deep_think')

    const capped = await applyRequest(harness, OVERSIZED_REQUEST)
    expect(capped.maxTokens).toBe(300)
    expect(harness.enforcement.snapshot().limits).toEqual({ ...BYPASS_BUDGET, maxModelSteps: 1 })
    expect(harness.enforcement.remainingTurnTokens()).toBe(700)

    harness.enforcement.beginModelStep().complete({ tokens: 300 })
    expect(
      rejectionOf(() => harness.enforcement.beginModelStep(), GoTurnBudgetExhaustedError),
    ).toMatchObject({ counter: 'maxModelSteps', limit: 2, used: 2 })
    expect(harness.enforcement.snapshot().turnTokens).toBe(600)
  })

  it('refuses a boost attempt once the turn tokens are exhausted', () => {
    const harness = createBypassHarness({ budget: { maxModelSteps: 5 } })
    harness.enforcement.beginModelStep().complete({ tokens: 500 })
    harness.enforcement.beginModelStep().complete({ tokens: 500 })

    const boundary = rejectionOf(
      () => invoke(harness, 'go.request_deep_think'),
      GoTurnBudgetExhaustedError,
    )
    expect(boundary).toMatchObject({ counter: 'maxTurnTokens', limit: 1_000, used: 1_000 })
    expect(harness.enforcement.snapshot()).toMatchObject({
      deepThinkRequests: 0,
      deepThinkBoost: { pendingModelSteps: 0, grantedModelSteps: 0 },
    })
  })

  it('cannot spend a granted boost through an exhausted turn ceiling', () => {
    const harness = createBypassHarness({ budget: { maxModelSteps: 1 } })
    harness.enforcement.beginDeepThink()
    harness.enforcement.beginModelStep().complete({ tokens: 1_000 })

    expect(
      rejectionOf(() => harness.enforcement.beginModelStep(), GoTurnBudgetExhaustedError),
    ).toMatchObject({ counter: 'maxTurnTokens', limit: 1_000, used: 1_000 })
    expect(harness.enforcement.snapshot()).toMatchObject({
      modelSteps: 1,
      turnTokens: 1_000,
      deepThinkBoost: { pendingModelSteps: 1, consumedModelSteps: 0 },
    })
  })

  it('cannot spend a granted boost after a committed action', () => {
    const harness = createBypassHarness({ budget: { maxModelSteps: 2 } })
    harness.enforcement.beginDeepThink()
    harness.enforcement.recordCommittedAction('play')

    expect(
      rejectionOf(() => harness.enforcement.beginModelStep(), GoTurnAnalysisEndedError),
    ).toMatchObject({ action: 'model_step', committedAction: 'play' })
    expect(harness.enforcement.snapshot().deepThinkBoost).toMatchObject({
      pendingModelSteps: 1,
      consumedModelSteps: 0,
    })
  })
})

describe('Spec §39.4 total turn-token exhaustion', () => {
  it('denies every analysis path but still permits the authoritative action', async () => {
    const harness = createBypassHarness({
      colors: DEEPSEEK_FIRST_COLORS,
      budget: { maxModelSteps: 5 },
    })
    harness.enforcement.beginModelStep().complete({ tokens: 500 })
    harness.enforcement.beginModelStep().complete({ tokens: 500 })
    expect(harness.enforcement.remainingTurnTokens()).toBe(0)

    expect(
      rejectionOf(() => harness.enforcement.beginModelStep(), GoTurnBudgetExhaustedError),
    ).toMatchObject({ counter: 'maxTurnTokens', limit: 1_000, used: 1_000 })
    for (const attempt of ANALYSIS_TOOL_ATTEMPTS) {
      expect(
        rejectionOf(
          () => invoke(harness, attempt.toolPath, attempt.args(harness.gameId)),
          GoTurnBudgetExhaustedError,
        ),
      ).toMatchObject({ counter: 'maxTurnTokens', limit: 1_000, used: 1_000 })
    }
    expect((await applyRequest(harness, OVERSIZED_REQUEST)).maxTokens).toBe(0)

    // §22.4: DeepSeek must choose using the current information, so the
    // authoritative commit must remain available after exhaustion. Drive the
    // real go.play tool (not just the enforcement recorder) so the claim
    // covers the tool path the model actually uses.
    expect(harness.enforcement.snapshot().committedAction).toBeUndefined()
    expect(invoke(harness, 'go.play', { gameId: harness.gameId, point: { x: 4, y: 4 } }))
      .toMatchObject({ ok: true })
    expect(harness.enforcement.snapshot().committedAction).toBe('play')
  })
})

describe('Spec §39.4 tool path and enforcement path share one budget', () => {
  it('shares one inspect counter between the tool path and a direct beginInspect', () => {
    const harness = createBypassHarness()
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }

    harness.enforcement.beginInspect()
    invoke(harness, 'go.inspect_group', args)
    harness.enforcement.beginInspect()
    expect(harness.enforcement.snapshot().inspectCalls).toBe(3)
    expect(
      rejectionOf(() => harness.enforcement.beginInspect(), GoTurnBudgetExhaustedError),
    ).toMatchObject({ counter: 'maxInspectCalls', limit: 3, used: 3 })
    expect(harness.enforcement.snapshot().inspectCalls).toBe(3)
  })

  it('shares one try_move counter between the tool path and a direct beginTryMove', () => {
    const harness = createBypassHarness({ colors: DEEPSEEK_FIRST_COLORS })
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }

    harness.enforcement.beginTryMove()
    invoke(harness, 'go.try_move', args)
    expect(harness.enforcement.snapshot().tryMoves).toBe(2)
    expect(
      rejectionOf(() => invoke(harness, 'go.try_move', args), GoTurnBudgetExhaustedError),
    ).toMatchObject({ counter: 'maxTryMoves', limit: 2, used: 2 })
    expect(harness.enforcement.snapshot().tryMoves).toBe(2)
  })

  it('shares the commit state: a direct commit closes the tool path', () => {
    const harness = createBypassHarness()
    harness.enforcement.recordCommittedAction('pass')

    expect(
      rejectionOf(
        () => invoke(harness, 'go.try_move', { gameId: harness.gameId, point: { x: 4, y: 4 } }),
        GoTurnAnalysisEndedError,
      ),
    ).toMatchObject({ action: 'try_move', committedAction: 'pass' })
    expect(harness.enforcement.snapshot().tryMoves).toBe(0)
  })

  it('shares the deep-think grant: a tool grant rejects a direct duplicate', () => {
    const harness = createBypassHarness()
    invoke(harness, 'go.request_deep_think')

    expect(() => harness.enforcement.beginDeepThink()).toThrowError(
      GoDeepThinkAlreadyRequestedError,
    )
    expect(harness.enforcement.snapshot().deepThinkRequests).toBe(1)
  })
})

describe('Spec §39.4 anti-vacuity control', () => {
  it('admits one attempt through every path under an ample budget', () => {
    const harness = createBypassHarness({
      colors: DEEPSEEK_FIRST_COLORS,
      budget: { maxModelSteps: 5, maxInspectCalls: 5, maxTryMoves: 5 },
    })
    const args = { gameId: harness.gameId, point: { x: 4, y: 4 } }

    expect(invoke(harness, 'go.inspect_group', args)).toMatchObject({ ok: true })
    expect(invoke(harness, 'go.try_move', args)).toMatchObject({ ok: true, legal: true })
    expect(invoke(harness, 'go.request_deep_think')).toMatchObject({ ok: true })
    harness.enforcement.beginModelStep()

    expect(harness.enforcement.snapshot()).toMatchObject({
      modelSteps: 1,
      inspectCalls: 1,
      tryMoves: 1,
      deepThinkRequests: 1,
    })
    // The same surface still commits: refusals above are limits, not a
    // blanket denial of the Go lane.
    expect(invoke(harness, 'go.play', args)).toMatchObject({ ok: true })
    expect(harness.enforcement.snapshot().committedAction).toBe('play')
  })
})

function stubState(harness: BypassHarness) {
  return harness.port.getState(harness.gameId)
}
