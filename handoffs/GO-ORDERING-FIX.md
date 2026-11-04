# Follow-up fix: post-commit Go actions must not reach the rules port

Ticket: none (regression found by WAVE-C-T09; split out per that ticket's explicit
"no enforcement changes" non-goal and its `tests/`-only expected surface).
Parent ticket: WAVE-C-T09 (#26), Baseline BL-BUD-05. Split rationale: C-T09's
Expected Surfaces are `tests/` + CI only, so its product fix ships as this
standalone follow-up PR; the ticket's own diff stays tests-only (#105).
Baseline: `48e51b5` (main after the C-T08/B-T05/F-T01/F-T02 sync).
Branch: `fix/post-commit-ordering`.

## Defect

`runPlay` / `runPass` / `runResign` in `src/tools/go/go-tools.ts` executed
`runtime.port.play/pass/resign` *before* `enforcement.recordCommittedAction(...)`.
A second authoritative action in the same Go turn was therefore applied to the
rules port and only then rejected, so the port reached `status: over` while
`enforcement.snapshot()` still reported `gameTerminal: false`, and the Bridge
never received the terminal notice.

Reproduction recorded by C-T09 (stub port):

```text
go.resign({gameId:'probe'})  -> GoTurnAnalysisEndedError: "...committed play; commit is not permitted"
port.getState('probe')       -> status: 'over', outcome: { winner: 'user', loser: 'deepseek', reason: 'resignation' }
enforcement.snapshot()       -> committedAction: 'play', gameTerminal: false
```

## Fix

- `f50c8c2` `test: pin post-commit rejection before the port (WAVE-C-T09)` — four
  cases (resign after play, resign after pass, pass after play, play after pass)
  asserting the rejected action never touches the port.
- `ec0454c` `fix: reject post-commit go actions before the port (WAVE-C-T09)` —
  `src/tools/go/go-tools.ts` imports `GoTurnAnalysisEndedError` as a value and
  adds `assertCommitOpen(enforcement)`, called before `port.play/pass/resign` in
  all three paths. The downstream `recordCommittedAction` gate is unchanged, and
  the terminal (`gameTerminal === true`) path still returns the port's
  `game-over` per the C-T02 contract (no state change).

Diff surface: `src/tools/go/go-tools.ts` +18/-1, `tests/budget/post-commit-ordering.test.ts` +162.

## Verification

| Stage | Command | Result |
| --- | --- | --- |
| Red | `pnpm exec vitest run tests/budget/post-commit-ordering.test.ts` (before the fix) | 4/4 failed: `expected 4 to be 3`, `ordering: the post-commit action was admitted` |
| Green (focused) | same file | 4/4 pass |
| Green (package) | `pnpm verify` | exit 0; **35 files / 442 tests** (this branch) |
| Regression scope | `pnpm exec vitest run tests/budget src/tools/go src/budget` | **7 files / 115 tests** (this branch) |
| Existing contract | C-T02 "second resignation is game-over" tests | unchanged and green |

Evidence note: the cherry-picked fix commit's message quotes 8 files / 141 tests
and 33 files / 433 tests, which were measured on the original
`work/c-t09-budget-bypass` tree before the split. The numbers above are the
measurements for this branch at HEAD.

Local Node v26.10.0 (repo pin 24.11.1) — engine warning only; CI is authoritative.

## Not covered

- The regression test uses `tests/rules/stub-port.ts`; the real Tenuki port's
  resign behavior has its own tests, but this ordering case is not repeated
  against the adapter.
- No real pinned-DSH AgentLoop execution (same production-wiring gap C-T09
  records).
