import type { GoTurnBudget } from '../../src/contracts/budget.js'
import type { GameConfig, Player, Point } from '../../src/contracts/rules.js'

/**
 * WAVE-C-T10 — Spec §38 fixture classes and scripted scenarios.
 *
 * Every fixture owns:
 * - a fixed setup script replayed through the real `GoRulesPort` until it is
 *   DeepSeek's turn (the "position");
 * - a fixed scripted model plan: which `go.*` tool the scripted adapter calls
 *   in which model step. The plan is deterministic and contains no clock,
 *   randomness or wall-clock wait, so the same fixture yields the same
 *   structural metrics on every run.
 *
 * The scripted adapter is NOT DeepSeek. Its token accounting is synthetic (see
 * `scripted-model.ts`); only the latency metric is actually measured, and it
 * measures local harness overhead, not model latency.
 */

export const SPEC_38_CLASSES = [
  'opening',
  'simple capture',
  'escape',
  'local fight',
  'ko',
  'large-group pressure',
  'endgame',
  'ambiguous position',
] as const

export type Spec38FixtureClass = (typeof SPEC_38_CLASSES)[number]

export type SetupStep = {
  readonly by: Player
  readonly point: Point | null
}

export type ScriptedToolCall =
  | { readonly tool: 'go.state' }
  | { readonly tool: 'go.inspect_group'; readonly point: Point }
  | { readonly tool: 'go.inspect_region'; readonly point: Point; readonly radius?: number }
  | { readonly tool: 'go.try_move'; readonly point: Point }
  | { readonly tool: 'go.request_deep_think' }
  | { readonly tool: 'go.play'; readonly point: Point }
  | { readonly tool: 'go.pass' }
  | { readonly tool: 'go.resign' }

export type ScriptedModelStepPlan = {
  readonly label: string
  readonly calls: readonly ScriptedToolCall[]
}

export type ScriptedFinalAction =
  | { readonly kind: 'play'; readonly point: Point }
  | { readonly kind: 'pass' }

export type BenchmarkFixture = {
  readonly name: string
  readonly class: Spec38FixtureClass
  readonly position: string
  readonly setup: readonly SetupStep[]
  readonly steps: readonly ScriptedModelStepPlan[]
  readonly expectedFinalAction: ScriptedFinalAction
  readonly expectedIllegalAttempts: number
}

/**
 * Budget under test. This is a CANDIDATE, not applied to any production
 * configuration: `src/budget/` deliberately carries no numeric defaults and
 * this ticket must not freeze them without a real DeepSeek run.
 *
 * Values are structural: they bound the scripted plan (below) with one unit of
 * headroom. They are not token-calibrated; see the validation summary.
 */
export const CANDIDATE_BUDGET = {
  maxModelSteps: 3,
  maxInspectCalls: 4,
  maxTryMoves: 3,
  perRequestMaxTokens: 1024,
  maxTurnTokens: 4096,
} as const satisfies GoTurnBudget

export function benchmarkGameConfig(gameId: string): GameConfig {
  return {
    gameId,
    boardSize: 9,
    scoring: 'area',
    koRule: 'positional-superko',
    komi: 7.5,
    colors: { user: 'black', deepseek: 'white' },
  }
}

const at = (x: number, y: number): Point => ({ x, y })

const move = (by: Player, x: number, y: number): SetupStep => ({ by, point: at(x, y) })
const pass = (by: Player): SetupStep => ({ by, point: null })

/**
 * Fixed ko from Spec §31 / B-T05: after black's (2,1) captures white's stone at
 * (1,1), the immediate white recapture at (1,1) recreates the previous position
 * and is refused by positional superko.
 */
const KO_POSITION: readonly SetupStep[] = [
  move('user', 1, 0),
  move('deepseek', 2, 0),
  move('user', 0, 1),
  move('deepseek', 3, 1),
  move('user', 1, 2),
  move('deepseek', 2, 2),
  move('user', 8, 8),
  move('deepseek', 1, 1),
  move('user', 2, 1),
]

const FIXTURES: readonly BenchmarkFixture[] = [
  {
    name: 'opening-spread',
    class: 'opening',
    position: 'Three-move opening: black (3,3) and (5,3), white (5,5); White to play.',
    setup: [move('user', 3, 3), move('deepseek', 5, 5), move('user', 5, 3)],
    steps: [
      {
        label: 'read the state and the nearby region, then probe a move',
        calls: [
          { tool: 'go.state' },
          { tool: 'go.inspect_region', point: at(3, 3), radius: 2 },
          { tool: 'go.try_move', point: at(2, 4) },
        ],
      },
      {
        label: 'probe a second candidate, then commit',
        calls: [
          { tool: 'go.try_move', point: at(4, 2) },
          { tool: 'go.play', point: at(2, 4) },
        ],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(2, 4) },
    expectedIllegalAttempts: 0,
  },
  {
    name: 'simple-capture-single-stone',
    class: 'simple capture',
    position:
      'Black (1,1) is surrounded by white (2,1), (1,0), (0,1); its only liberty is (1,2); White to play.',
    setup: [
      move('user', 1, 1),
      move('deepseek', 2, 1),
      move('user', 7, 7),
      move('deepseek', 1, 0),
      move('user', 6, 7),
      move('deepseek', 0, 1),
      pass('user'),
    ],
    steps: [
      {
        label: 'confirm the group’s liberties',
        calls: [
          { tool: 'go.state' },
          { tool: 'go.inspect_group', point: at(1, 1) },
          { tool: 'go.try_move', point: at(1, 2) },
        ],
      },
      {
        label: 'play the capture',
        calls: [{ tool: 'go.play', point: at(1, 2) }],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(1, 2) },
    expectedIllegalAttempts: 0,
  },
  {
    name: 'escape-from-atari',
    class: 'escape',
    position:
      'White (4,4) is in atari: black (4,3), (3,4), (5,4); its only liberty is (4,5); White to play.',
    setup: [
      move('user', 4, 3),
      move('deepseek', 4, 4),
      move('user', 3, 4),
      move('deepseek', 8, 8),
      move('user', 5, 4),
    ],
    steps: [
      {
        label: 'read the atari and probe the escape point',
        calls: [
          { tool: 'go.inspect_group', point: at(4, 4) },
          { tool: 'go.try_move', point: at(4, 5) },
        ],
      },
      {
        label: 'extend out of atari',
        calls: [{ tool: 'go.play', point: at(4, 5) }],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(4, 5) },
    expectedIllegalAttempts: 0,
  },
  {
    name: 'local-fight-contact',
    class: 'local fight',
    position:
      'Contact fight in the lower-left: black (2,2), (3,2), (1,3); white (2,3), (3,3); White to play.',
    setup: [
      move('user', 2, 2),
      move('deepseek', 2, 3),
      move('user', 3, 2),
      move('deepseek', 3, 3),
      move('user', 1, 3),
    ],
    steps: [
      {
        label: 'read the local fight from two angles',
        calls: [
          { tool: 'go.inspect_region', point: at(3, 3), radius: 2 },
          { tool: 'go.try_move', point: at(4, 3) },
          { tool: 'go.try_move', point: at(3, 1) },
        ],
      },
      {
        label: 'connect on the outside',
        calls: [{ tool: 'go.play', point: at(4, 3) }],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(4, 3) },
    expectedIllegalAttempts: 0,
  },
  {
    name: 'ko-immediate-recapture',
    class: 'ko',
    position:
      'After black (2,1) captured white (1,1), the immediate white recapture at (1,1) is superko; White to play.',
    setup: KO_POSITION,
    steps: [
      {
        label: 'read the ko shape and probe the forbidden recapture',
        calls: [
          { tool: 'go.inspect_region', point: at(1, 1), radius: 1 },
          { tool: 'go.try_move', point: at(1, 1) },
        ],
      },
      {
        label: 'attempt the recapture, then play a legal ko threat',
        calls: [
          { tool: 'go.play', point: at(1, 1) },
          { tool: 'go.play', point: at(6, 6) },
        ],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(6, 6) },
    expectedIllegalAttempts: 1,
  },
  {
    name: 'large-group-pressure',
    class: 'large-group pressure',
    position:
      'A four-stone white chain (1,3), (1,4), (1,5), (2,4) pressed against a black wall with three liberties; White to play.',
    setup: [
      move('user', 0, 3),
      move('deepseek', 1, 3),
      move('user', 0, 4),
      move('deepseek', 1, 4),
      move('user', 0, 5),
      move('deepseek', 1, 5),
      move('user', 1, 2),
      move('deepseek', 2, 4),
      move('user', 1, 6),
    ],
    steps: [
      {
        label: 'read the pressured chain and ask for the bounded boost',
        calls: [
          { tool: 'go.state' },
          { tool: 'go.inspect_group', point: at(1, 4) },
          { tool: 'go.request_deep_think' },
        ],
      },
      {
        label: 'probe the connecting point',
        calls: [
          { tool: 'go.inspect_region', point: at(2, 4), radius: 2 },
          { tool: 'go.try_move', point: at(2, 3) },
        ],
      },
      {
        label: 're-probe after the boost is granted',
        calls: [{ tool: 'go.try_move', point: at(2, 3) }],
      },
      {
        label: 'play on the boosted extra step',
        calls: [{ tool: 'go.play', point: at(2, 3) }],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(2, 3) },
    expectedIllegalAttempts: 0,
  },
  {
    name: 'endgame-dame-fill',
    class: 'endgame',
    position:
      'Endgame boundary: black fills y=4, white fills y=5 up to x=3, with the last boundary point (4,5) open; White to play.',
    setup: [
      move('user', 0, 4),
      move('deepseek', 0, 5),
      move('user', 1, 4),
      move('deepseek', 1, 5),
      move('user', 2, 4),
      move('deepseek', 2, 5),
      move('user', 3, 4),
      move('deepseek', 3, 5),
      move('user', 4, 4),
    ],
    steps: [
      {
        label: 'read the boundary',
        calls: [
          { tool: 'go.state' },
          { tool: 'go.inspect_region', point: at(4, 4), radius: 1 },
        ],
      },
      {
        label: 'take the last boundary point',
        calls: [{ tool: 'go.play', point: at(4, 5) }],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(4, 5) },
    expectedIllegalAttempts: 0,
  },
  {
    name: 'ambiguous-wide-board',
    class: 'ambiguous position',
    position:
      'Balanced scattered position: black (2,6), (6,6), (4,7); white (6,2), (2,2); no urgent local fight; White to play.',
    setup: [
      move('user', 2, 6),
      move('deepseek', 6, 2),
      move('user', 6, 6),
      move('deepseek', 2, 2),
      move('user', 4, 7),
    ],
    steps: [
      {
        label: 'read the whole board twice before choosing',
        calls: [
          { tool: 'go.state' },
          { tool: 'go.inspect_region', point: at(4, 4), radius: 3 },
          { tool: 'go.try_move', point: at(4, 4) },
        ],
      },
      {
        label: 'widen the read and play the neutral center point',
        calls: [
          { tool: 'go.inspect_region', point: at(4, 4), radius: 4 },
          { tool: 'go.play', point: at(4, 4) },
        ],
      },
    ],
    expectedFinalAction: { kind: 'play', point: at(4, 4) },
    expectedIllegalAttempts: 0,
  },
]

export const BENCHMARK_FIXTURES: readonly BenchmarkFixture[] = Object.freeze(FIXTURES)

export function getBenchmarkFixture(name: string): BenchmarkFixture {
  const fixture = BENCHMARK_FIXTURES.find(candidate => candidate.name === name)
  if (fixture === undefined) throw new Error(`Unknown benchmark fixture: ${name}`)
  return fixture
}
