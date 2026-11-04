import { describe, expect, it } from 'vitest'
import type { GoTurnBudget } from '../contracts/budget.js'
import { GoTurnBudgetConfigError } from './config.js'
import {
  GoTurnAnalysisEndedError,
  GoTurnBudgetExhaustedError,
  GoTurnUsageError,
  createGoTurnEnforcement,
  runAccountedGoTool,
  type GoTurnAnalysisAction,
  type GoTurnEnforcement,
} from './enforcement.js'

/**
 * TEST FIXTURE ONLY. These numbers are injected by the test and are NOT
 * production calibration; BL-BUD-06 / WAVE-C-T10 owns benchmark-derived values.
 */
const NON_PRODUCTION_BUDGET = {
  maxModelSteps: 3,
  maxInspectCalls: 2,
  maxTryMoves: 2,
  perRequestMaxTokens: 257,
  maxTurnTokens: 100,
} as const satisfies GoTurnBudget

const ANALYSIS_ACTIONS: readonly GoTurnAnalysisAction[] = [
  'model_step',
  'inspect',
  'try_move',
  'deep_think',
]

function budgetWith(overrides: Partial<GoTurnBudget>): GoTurnBudget {
  return { ...NON_PRODUCTION_BUDGET, ...overrides }
}

function runAction(enforcement: GoTurnEnforcement, action: GoTurnAnalysisAction): void {
  switch (action) {
    case 'model_step':
      enforcement.beginModelStep()
      return
    case 'inspect':
      enforcement.beginInspect()
      return
    case 'try_move':
      enforcement.beginTryMove()
      return
    case 'deep_think':
      enforcement.beginDeepThink()
      return
  }
}

async function captureExhaustion(run: () => unknown): Promise<GoTurnBudgetExhaustedError> {
  try {
    await run()
  } catch (error) {
    if (!(error instanceof GoTurnBudgetExhaustedError)) throw error
    return error
  }
  throw new Error('expected GoTurnBudgetExhaustedError')
}

async function captureEnded(run: () => unknown): Promise<GoTurnAnalysisEndedError> {
  try {
    await run()
  } catch (error) {
    if (!(error instanceof GoTurnAnalysisEndedError)) throw error
    return error
  }
  throw new Error('expected GoTurnAnalysisEndedError')
}

async function captureUsage(run: () => unknown): Promise<GoTurnUsageError> {
  try {
    await run()
  } catch (error) {
    if (!(error instanceof GoTurnUsageError)) throw error
    return error
  }
  throw new Error('expected GoTurnUsageError')
}

describe('createGoTurnEnforcement per-request cap', () => {
  it('applies the budget per-request cap through the verified request seam', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    const capped = await enforcement.requestTokenCap({ turn: 1, step: 1 }, async () => ({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: 8_192,
    }))

    expect(capped.maxTokens).toBe(NON_PRODUCTION_BUDGET.perRequestMaxTokens)
  })
})

describe('createGoTurnEnforcement model steps', () => {
  it('allows exactly maxModelSteps model steps and denies the next one', () => {
    const enforcement = createGoTurnEnforcement(budgetWith({ maxModelSteps: 2 }))

    enforcement.beginModelStep()
    enforcement.beginModelStep()

    expect(enforcement.snapshot().modelSteps).toBe(2)
    return expect(captureExhaustion(() => enforcement.beginModelStep())).resolves.toMatchObject({
      counter: 'maxModelSteps',
      limit: 2,
      used: 2,
    })
  })

  it('denies a new model step once turn tokens are exactly exhausted', () => {
    const enforcement = createGoTurnEnforcement(
      budgetWith({ maxModelSteps: 10, maxTurnTokens: 100 }),
    )

    enforcement.beginModelStep().complete({ tokens: 60 })
    enforcement.beginModelStep().complete({ tokens: 39 })
    enforcement.beginModelStep().complete({ tokens: 1 })

    expect(enforcement.snapshot().turnTokens).toBe(100)
    return expect(captureExhaustion(() => enforcement.beginModelStep())).resolves.toMatchObject({
      counter: 'maxTurnTokens',
      limit: 100,
      used: 100,
    })
  })

  it('denies the first model step under a zero turn token cap', () => {
    const enforcement = createGoTurnEnforcement(budgetWith({ maxTurnTokens: 0 }))

    return expect(captureExhaustion(() => enforcement.beginModelStep())).resolves.toMatchObject({
      counter: 'maxTurnTokens',
      limit: 0,
      used: 0,
    })
  })

  it('charges one model step once when its usage is reported twice', () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)
    const step = enforcement.beginModelStep()

    step.complete({ tokens: 40 })
    step.complete({ tokens: 40 })

    expect(enforcement.snapshot().turnTokens).toBe(40)
  })

  it('rejects a second, conflicting usage report for the same model step', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)
    const step = enforcement.beginModelStep()
    step.complete({ tokens: 40 })

    const error = await captureUsage(() => step.complete({ tokens: 41 }))

    expect(error.reason).toBe('already-recorded')
    expect(enforcement.snapshot().turnTokens).toBe(40)
  })

  it('rejects invalid model-step usage instead of corrupting the turn total', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)
    const step = enforcement.beginModelStep()

    for (const tokens of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await captureUsage(() => step.complete({ tokens }))
      expect(error.reason).toBe('not-a-non-negative-integer')
    }
    expect(enforcement.snapshot().turnTokens).toBe(0)
  })
})

describe('createGoTurnEnforcement tool accounting', () => {
  it('counts every inspect execution and denies the one past the cap', async () => {
    const enforcement = createGoTurnEnforcement(budgetWith({ maxInspectCalls: 2 }))

    await runAccountedGoTool(enforcement, 'inspect', async () => 'first')
    await runAccountedGoTool(enforcement, 'inspect', async () => 'second')

    expect(enforcement.snapshot().inspectCalls).toBe(2)
    await expect(
      captureExhaustion(() => runAccountedGoTool(enforcement, 'inspect', async () => 'third')),
    ).resolves.toMatchObject({ counter: 'maxInspectCalls', limit: 2, used: 2 })
  })

  it('counts an aggregated wrapper two executions as two charges', async () => {
    const enforcement = createGoTurnEnforcement(budgetWith({ maxInspectCalls: 3 }))
    const aggregate = async (): Promise<string[]> => [
      await runAccountedGoTool(enforcement, 'inspect', async () => 'first'),
      await runAccountedGoTool(enforcement, 'inspect', async () => 'second'),
    ]

    await aggregate()

    expect(enforcement.snapshot().inspectCalls).toBe(2)
    await runAccountedGoTool(enforcement, 'inspect', async () => 'third')
    await expect(
      captureExhaustion(() => runAccountedGoTool(enforcement, 'inspect', async () => 'fourth')),
    ).resolves.toMatchObject({ counter: 'maxInspectCalls' })
  })

  it('charges an execution that throws after it started', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    await expect(
      runAccountedGoTool(enforcement, 'try_move', async () => {
        throw new Error('rules port failed')
      }),
    ).rejects.toThrow('rules port failed')

    expect(enforcement.snapshot().tryMoves).toBe(1)
  })

  it('keeps try_move separate from inspect budget', async () => {
    const enforcement = createGoTurnEnforcement(budgetWith({ maxTryMoves: 1, maxInspectCalls: 5 }))

    await runAccountedGoTool(enforcement, 'try_move', async () => 'played')
    await expect(
      captureExhaustion(() => runAccountedGoTool(enforcement, 'try_move', async () => 'again')),
    ).resolves.toMatchObject({ counter: 'maxTryMoves', limit: 1, used: 1 })

    expect(enforcement.snapshot().inspectCalls).toBe(0)
  })

  it('treats a zero tool cap as forbidding the operation', async () => {
    const enforcement = createGoTurnEnforcement(
      budgetWith({ maxInspectCalls: 0, maxTryMoves: 0 }),
    )

    await expect(
      captureExhaustion(() => runAccountedGoTool(enforcement, 'inspect', async () => 'x')),
    ).resolves.toMatchObject({ counter: 'maxInspectCalls', limit: 0, used: 0 })
    await expect(
      captureExhaustion(() => runAccountedGoTool(enforcement, 'try_move', async () => 'x')),
    ).resolves.toMatchObject({ counter: 'maxTryMoves', limit: 0, used: 0 })
  })

  it('shares one counter between the wrapper and the direct call path', async () => {
    const enforcement = createGoTurnEnforcement(budgetWith({ maxInspectCalls: 2 }))

    enforcement.beginInspect()
    await runAccountedGoTool(enforcement, 'inspect', async () => 'second')

    expect(enforcement.snapshot().inspectCalls).toBe(2)
    await expect(
      captureExhaustion(() => enforcement.beginInspect()),
    ).resolves.toMatchObject({ counter: 'maxInspectCalls' })
  })

  it('counts deep-think requests without imposing a §22 cap', () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    enforcement.beginDeepThink()
    enforcement.beginDeepThink()

    expect(enforcement.snapshot().deepThinkRequests).toBe(2)
  })
})

describe('createGoTurnEnforcement post-move no-analysis-loop', () => {
  it('denies every analysis action after a committed play', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    enforcement.recordCommittedAction('play')

    const snapshot = enforcement.snapshot()
    expect(snapshot.committedAction).toBe('play')
    expect(snapshot.gameTerminal).toBe(false)
    for (const action of ANALYSIS_ACTIONS) {
      await expect(captureEnded(() => runAction(enforcement, action))).resolves.toMatchObject({
        action,
        committedAction: 'play',
        gameTerminal: false,
      })
    }
  })

  it('denies every analysis action after a committed pass', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    enforcement.recordCommittedAction('pass')

    for (const action of ANALYSIS_ACTIONS) {
      await expect(captureEnded(() => runAction(enforcement, action))).resolves.toMatchObject({
        action,
        committedAction: 'pass',
      })
    }
  })

  it('makes the game terminal after resign and denies every further action', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    enforcement.recordCommittedAction('resign')

    const snapshot = enforcement.snapshot()
    expect(snapshot.committedAction).toBe('resign')
    expect(snapshot.gameTerminal).toBe(true)
    for (const action of ANALYSIS_ACTIONS) {
      await expect(captureEnded(() => runAction(enforcement, action))).resolves.toMatchObject({
        action,
        committedAction: 'resign',
        gameTerminal: true,
      })
    }
    await expect(
      captureEnded(() => enforcement.recordCommittedAction('play')),
    ).resolves.toMatchObject({ action: 'commit', committedAction: 'resign', gameTerminal: true })
  })

  it('rejects a second committed action within the same turn', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    enforcement.recordCommittedAction('play')

    await expect(
      captureEnded(() => enforcement.recordCommittedAction('pass')),
    ).resolves.toMatchObject({ action: 'commit', committedAction: 'play', gameTerminal: false })
  })

  it('still records usage for a model step that started before the commit', () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)
    const step = enforcement.beginModelStep()

    enforcement.recordCommittedAction('play')
    step.complete({ tokens: 30 })

    expect(enforcement.snapshot().turnTokens).toBe(30)
  })

  it('runs a deterministic play sequence and stops analysis at the commit', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    const first = enforcement.beginModelStep()
    first.complete({ tokens: 20 })
    await runAccountedGoTool(enforcement, 'inspect', async () => 'a')
    await runAccountedGoTool(enforcement, 'try_move', async () => 'b')
    const second = enforcement.beginModelStep()
    second.complete({ tokens: 20 })
    enforcement.recordCommittedAction('play')

    expect(enforcement.snapshot()).toMatchObject({
      modelSteps: 2,
      inspectCalls: 1,
      tryMoves: 1,
      turnTokens: 40,
      committedAction: 'play',
      gameTerminal: false,
    })
    await expect(captureEnded(() => enforcement.beginModelStep())).resolves.toMatchObject({
      action: 'model_step',
    })
    await expect(
      captureEnded(() => runAccountedGoTool(enforcement, 'inspect', async () => 'c')),
    ).resolves.toMatchObject({ action: 'inspect' })
  })

  it('runs a deterministic resign sequence with no further permitted action', async () => {
    const enforcement = createGoTurnEnforcement(NON_PRODUCTION_BUDGET)

    const step = enforcement.beginModelStep()
    step.complete({ tokens: 10 })
    await runAccountedGoTool(enforcement, 'inspect', async () => 'position')
    await runAccountedGoTool(enforcement, 'try_move', async () => 'legal')
    enforcement.beginDeepThink()
    enforcement.recordCommittedAction('resign')

    expect(enforcement.snapshot()).toMatchObject({
      modelSteps: 1,
      inspectCalls: 1,
      tryMoves: 1,
      deepThinkRequests: 1,
      turnTokens: 10,
      committedAction: 'resign',
      gameTerminal: true,
    })
    for (const action of ANALYSIS_ACTIONS) {
      await expect(captureEnded(() => runAction(enforcement, action))).resolves.toMatchObject({
        gameTerminal: true,
      })
    }
  })
})

describe('createGoTurnEnforcement budget injection', () => {
  it('rejects an invalid injected budget instead of enforcing unvalidated limits', () => {
    expect(() => createGoTurnEnforcement(budgetWith({ maxModelSteps: 0 }))).toThrow(
      GoTurnBudgetConfigError,
    )
  })
})
