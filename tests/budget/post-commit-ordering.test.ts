/**
 * Spec §24 post-commit ordering regression (C-T09 follow-up).
 *
 * §24 ends the Go turn at a successful authoritative action: after a committed
 * play / pass / resign the same turn must not perform another. The tool layer
 * must therefore reject a second commit *before* it reaches `GoRulesPort`; a
 * rejected action that still mutates the port is state drift (§40).
 *
 * These cases were red before the preflight gate in `go-tools.ts`: `go.resign`
 * after a committed play/pass flipped the port to `over` and only then threw
 * `GoTurnAnalysisEndedError`. A repeated resignation after a resignation stays
 * a `game-over` rejection by contract (`src/tools/go/go-tools.test.ts` pins it),
 * so the terminal case is intentionally not re-gated here.
 */
import { describe, expect, it } from 'vitest'
import {
  GoTurnAnalysisEndedError,
  createGoTurnEnforcement,
} from '../../src/budget/enforcement.js'
import type { GameConfig, GameState, GoRulesPort } from '../../src/contracts/rules.js'
import { GoCapabilityGuard } from '../../src/runtime/go-capability-guard.js'
import { registerGoTools } from '../../src/tools/go/go-tool-registry.js'
import type { GoToolRegistry } from '../../src/tools/go/types.js'
import { createStubGoRulesPort } from '../rules/stub-port.js'

const BUDGET = {
  maxModelSteps: 5,
  maxInspectCalls: 5,
  maxTryMoves: 5,
  perRequestMaxTokens: 300,
  maxTurnTokens: 1_000,
} as const

const DEEPSEEK_FIRST_COLORS: GameConfig['colors'] = { user: 'white', deepseek: 'black' }

type Harness = Readonly<{
  readonly gameId: string
  readonly registry: GoToolRegistry
  readonly enforcement: ReturnType<typeof createGoTurnEnforcement>
  readonly calls: string[]
  readonly port: GoRulesPort
}>

function createHarness(): Harness {
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
  const enforcement = createGoTurnEnforcement(BUDGET)
  const registry = registerGoTools({ port, enforcement, guard: new GoCapabilityGuard() })
  const gameId = 'ordering-game'
  port.createGame({
    gameId,
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: DEEPSEEK_FIRST_COLORS,
  })
  return { gameId, registry, enforcement, calls, port }
}

function invoke(harness: Harness, toolPath: string, args: unknown = {}): unknown {
  return harness.registry.invoke(toolPath, args)
}

function rejectionOf(attempt: () => unknown): GoTurnAnalysisEndedError {
  let admitted = false
  let caught: unknown
  try {
    attempt()
    admitted = true
  } catch (error) {
    caught = error
  }
  if (admitted) {
    throw new Error('ordering: the post-commit action was admitted')
  }
  if (!(caught instanceof GoTurnAnalysisEndedError)) {
    const detail = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)
    throw new Error(`ordering: unexpected rejection: ${detail}`)
  }
  return caught
}

function commitPlay(harness: Harness): void {
  invoke(harness, 'go.play', { gameId: harness.gameId, point: { x: 4, y: 4 } })
}

function commitPass(harness: Harness): void {
  invoke(harness, 'go.pass', { gameId: harness.gameId })
}

function assertRejectedWithoutPortEffect(
  harness: Harness,
  committedAction: 'play' | 'pass',
  attempt: () => unknown,
): void {
  const stateBefore: GameState = harness.port.getState(harness.gameId)
  const callsBefore = harness.calls.length
  const snapshotBefore = harness.enforcement.snapshot()

  const rejection = rejectionOf(attempt)

  expect(rejection).toMatchObject({
    action: 'commit',
    committedAction,
    gameTerminal: false,
  })
  expect(harness.calls.length).toBe(callsBefore)
  expect(harness.port.getState(harness.gameId)).toEqual(stateBefore)
  expect(harness.enforcement.snapshot()).toEqual(snapshotBefore)
  expect(harness.enforcement.snapshot().gameTerminal).toBe(false)
  expect(stateBefore.outcome).toBeNull()
}

describe('Spec §24 second authoritative action is rejected before the port', () => {
  it('does not let a resign after a committed play reach the port', () => {
    const harness = createHarness()
    commitPlay(harness)

    assertRejectedWithoutPortEffect(harness, 'play', () =>
      invoke(harness, 'go.resign', { gameId: harness.gameId }),
    )
    expect(harness.calls).not.toContain('resign')
    expect(harness.port.getState(harness.gameId).status).toBe('playing')
  })

  it('does not let a resign after a committed pass reach the port', () => {
    const harness = createHarness()
    commitPass(harness)

    assertRejectedWithoutPortEffect(harness, 'pass', () =>
      invoke(harness, 'go.resign', { gameId: harness.gameId }),
    )
    expect(harness.calls).not.toContain('resign')
    expect(harness.port.getState(harness.gameId).status).toBe('playing')
  })

  it('does not let a pass after a committed play reach the port', () => {
    const harness = createHarness()
    commitPlay(harness)

    assertRejectedWithoutPortEffect(harness, 'play', () => commitPass(harness))
    expect(harness.calls).not.toContain('pass')
  })

  it('does not let a play after a committed pass reach the port', () => {
    const harness = createHarness()
    commitPass(harness)

    assertRejectedWithoutPortEffect(harness, 'pass', () => commitPlay(harness))
  })
})
