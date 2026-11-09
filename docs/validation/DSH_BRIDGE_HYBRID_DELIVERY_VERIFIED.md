# Hybrid Bridge delivery — executed evidence (WAVE-D-T03)

Issue: WAVE-D-T03 / #31

Baseline: BL-BR-05 (`NOT_IMPLEMENTED` → `IMPLEMENTED_VERIFIED`)

Spec authority: R2.4.3 §9.1 (hybrid per-direction seams; no evaluation-only wake)
and §39.6 (including the numeric long-sequence bound)

Pinned DSH: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, package line
`0.1.1-rc.2`, Node `24.11.1`, pnpm `11.7.0`, Vitest `4.1.8`

## What this record establishes

`src/bridge/delivery.ts` registers the two DSH-native seams the Spec assigns:

- the **Go** agent's own prompt scope gets one variable (`go_work_snapshot`) and
  one section (`companion-go:go-lane-work-snapshot`) whose text is the fixed
  data-boundary line plus `{{go_work_snapshot}}` while a snapshot exists and
  `''` before the first one;
- the **Work** agent's own prompt scope gets one variable (`work_game_notice`)
  and one runtime context (`companion-go:work-lane-game-notice`) whose text is
  `{{work_game_notice}}` alone while a notice exists and `''` before the first
  one; it carries no boundary line (owner decision 2026-11-09: the §39.6 bound
  counts the full entry text, and the line pushed each entry to 382 characters);
- both directions therefore put every dynamic value behind a prompt variable,
  which DSH substitutes without rescanning. Every rendered **string** field
  (`gameId`, `lastMove`, `summary`, `runningJobs[]`, `blockers[]`, `lastResult`)
  passes through `escapeBridgeField`; the remaining fields are numbers or closed
  enums (`owner`, `toPlay`, `status`) and rely on `assertGameNotice` /
  `assertWorkSnapshot` for type and domain, so a string value cannot forge a
  line or an instruction in the receiving lane's prompt (§9.1; review r2
  P1-1/P1-2, P2-3).

Both providers read `CrossLaneAwareness`, which returns a cached frozen copy of
the latest published projection, so a read is O(1) in conversation and game
length; neither provider touches Session history, the Go action log, or tool
history. `src/index.ts` binds both seams in `apply()` after the two lane agents
exist, so the wiring is a production call site, not a library export.

## Executed pinned-DSH evidence

Command (repository helper, fail-closed on the pins):

```sh
DSH_PINNED_ROOT=../dsh-plugin-weiqi-wt/DSH-PINNED \
TRACE_LOG=/tmp/bridge-delivery-trace.log \
bash tests/integration/bridge-delivery/run-bridge-delivery.sh
```

Result of the recorded local run:

```text
✓ 1. Go sees only the newest WorkSnapshot in its system slot and never a superseded one
✓ 2. twenty rapid GameNotice updates while Work is running create zero additional model requests
✓ 3. an idle lane is not woken by a Bridge change alone
✓ 3b. negative control: the no-wake request count fails on a fabricated extra request
✓ 4. the Work direction stays inside the §39.6 bound over a 400-move sequence
✓ 5. an unchanged GameNotice adds no repeated runtime context
✓ 6. a multi-line Bridge value cannot forge a prompt line in either lane
✓ 7. a Bridge value containing double braces still yields one request and stays verbatim
✓ 8. each natural request appends the newest GameNotice as the last runtime-context entry

Test Files  1 passed (1)
     Tests  9 passed (9)
```

What each assertion exercises, on the real pinned `agent-loop`, `agent`,
`system-prompt`, `session`, `llm`, and `tools` implementations:

| # | §39.6 requirement | Assertion |
|---|---|---|
| 1 | Go sees only the newest WorkSnapshot | after `1 → 2 → 3`, the second request's `system` contains `work summary 3` and neither `1` nor `2`; the Go message history contains no `work summary` at all |
| 2 | no evaluation-only wake, 20 rapid updates | the twenty `updateGame` calls run inside the first request's stream; the agent status is asserted `running` once, when the burst begins, and the status event stream must record at least one `running` transition (the gate does not assert every publish); the request count stays 1 for that turn and the next natural request adds exactly one |
| 3 | an idle lane is not woken | holder updates after the lane went idle add no request and no `running` status transition, after both drivers are flushed with `whenIdle()` |
| 3b | wake negative control | the shared request-count assertion rejects a fabricated extra request and accepts the real one, so a wake cannot pass unnoticed |
| 4 | bounded long sequence | 400 moves with one natural Work request every 20 moves: exactly 20 runtime-context entries, each measured over the section text DSH stores (the projection: header, fields, label line, group lines) and over the complete block; maximum 291 characters over those twenty, total 5810, both inside `L <= 300` / 6000; no entry contains the boundary line; the full 400-move render argmax is 296 |
| 6 | injection surface | a WorkSnapshot summary and a GameNotice `gameId` carrying a forged `SYSTEM:` line arrive escaped on their labelled line; neither lane's prompt contains that line; the Go system slot opens with the fixed boundary and the Work entry carries none |
| 7 | double braces | a `gameId` of `gate-{{x}}` and a `lastMove` of `{{go.resign}}` still produce exactly one Work request whose visible text carries both values verbatim |
| 8 | newest comes last | three natural requests append three runtime-context snapshots; each snapshot's last section is the Work notice, each entry text ends with that move's projection, and each snapshot text ends with it too |
| 5 | unchanged value adds nothing | two natural requests with one unchanged GameNotice produce exactly one runtime-context block |

R2.4.3 §39.6 states the bound as a ceiling of `L <= 300` characters and
`20 x 300 = 6000` characters so the contract does not depend on one per-move
maximum. The gate measures the actual runtime-context section text DSH stores
(the substituted projection, which is exactly what §39.6 counts), and it keeps
the block scanner for the rendered lines. Over the twenty observed entries
(moves 20, 40, ... 400) the maximum is 291 characters and the total is 5810.
Before this change each entry additionally carried the 89-character boundary
line and two newlines, which measured 382 maximum and 7630 total: the same
projection plus `89 + 2` characters per entry. The 296-character argmax of the
full 400-move render sequence (move 11) is pinned by both
`src/bridge/delivery.test.ts` and the gate as the reproducible worst case; the
frozen schema bounds field types, not string lengths, so the Spec's fixed
synthetic sequence is the worst case the bound is defined over.

## Falsifiability check

`tests/integration/bridge-delivery/run-mutation-check.sh` applies six mutants to a
throwaway copy of `src/` inside the pinned tests directory; every one must make
at least one gate test fail. A mutant is counted as killed only when the run
reports a failing test (`Tests N failed`); a compile or import error now counts
as surviving, so the script cannot pass without a real red assertion. The
three-mutant set recorded on `main` also carried `frozen-work-projection`; the
branch's `f3d87b6` replaced it with the broader `stale` mutant and added `pad`,
`noop`, and `notice-not-last`, so six mutants are current.

```sh
DSH_PINNED_ROOT=../dsh-plugin-weiqi-wt/DSH-PINNED \
bash tests/integration/bridge-delivery/run-mutation-check.sh
```

Recorded result:

```text
mutant context-seam-for-go killed by a failing test
AssertionError: expected 'You are an AI agent powered by DeepSe…' to contain 'work summary 1'
mutant no-go-registration killed by a failing test
AssertionError: expected 'You are an AI agent powered by DeepSe…' to contain 'work summary 1'
mutant pad killed by a failing test
AssertionError: expected 5291 to be 291 // Object.is equality
mutant stale killed by a failing test
AssertionError: expected 'GAME_NOTICE\ngameId: synthetic-400\nm…' to contain 'moveNumber: 21'
mutant noop killed by a failing test
AssertionError: expected '2' to contain 'moveNumber: 21'
mutant notice-not-last killed by a failing test
AssertionError: expected 'GAME_NOTICE\ngameId: synthetic-400\nm…' not to contain '[companion-go bridge data: factual ob…'
RESULT: PASS — every mutant was killed by a failing test
```

| Mutant | Change | Observed |
|---|---|---|
| `context-seam-for-go` | the Go direction registers `context(...)` instead of `section` + `variable` | cases 1 and 6 red: the system slot no longer carries the snapshot and no longer opens with the boundary |
| `no-go-registration` | the Go registrations are removed entirely | cases 1 and 6 red, same reason |
| `pad` | every rendered affected-group line gains 1000 characters | case 4 red: the complete block and the entry text measure 5291 instead of 291 |
| `stale` | the Work variable forever renders the first GameNotice it saw | cases 2, 4, and 8 red: the newest block no longer carries `moveNumber: 21` / `moveNumber: 400`, and the last entry is not the newest projection |
| `noop` | `renderGameNotice` returns an empty string, so the notice is never delivered | cases 2, 4, 5, 6, 7, and 8 red: no `GAME_NOTICE` block exists |
| `notice-not-last` | the Work entry appends the fixed boundary after the projection | cases 4, 6, and 8 red: the entry contains the boundary again and no longer ends with the newest projection |

The earlier three-mutant set on `main` also carried `frozen-work-projection`
(the Work provider cached its first render); `f3d87b6` replaced it with the
broader `stale` mutant, which keeps the variable seam but pins the first notice.

Review r2 found the gate measuring a truncated block (`affectedGroups: ` in the
scanner against a rendered `affectedGroups:`), so the `pad` mutant survived; it
also found no assertion for the newest notice's position, so a mutant that put
the boundary after the projection survived. Both gaps are closed above, and the
`pad` / `notice-not-last` rows are the mutants that prove it.

Correction: this record previously stated that the `stale` mutant was already
killed by content assertions at `27b5aa0`. That was wrong. At `27b5aa0` the gate
had five cases and two mutants (`context-seam-for-go`, `no-go-registration`); it
had no content assertion. The content assertions in cases 2 and 4 exist from
`b27f3f1`, so `stale` is first killed there. A `frozen-work-projection` mutant
did exist in the gate before `f3d87b6`.

The mutants live only under the pinned tests directory and are removed on exit;
`git -C "$DSH_PINNED_ROOT" status --porcelain` is empty afterwards.

## Repository-level evidence

- `pnpm verify` (Node `v24.11.1`, pnpm `11.7.0`): typecheck OK, **50 files /
  592 tests passed**, clean + build OK.
- `src/bridge/delivery.test.ts` pins the registration contract (one section plus
  one variable for Go, one context plus one variable for Work), the empty-render
  before the first publication, latest-only rendering, stale-sequence
  suppression, the exact 296-character maximum of the 400-move render sequence,
  the worst-case 296 / `20 x 296 <= 6000` bound, the injection surface (one
  labelled line per value), the Go boundary-first template, and the Work text
  that carries no boundary line.
- `src/index.test.ts` pins that `apply()` registers both seams on the right
  agent scopes, including the Work direction's variable.

## CI

`.github/workflows/bridge-delivery-gate.yml` runs the same helper on every pull
request that touches `src/bridge/**`, `src/index.ts`, this gate, or the DSH
pins, against the pinned checkout at `b150a551...`. A written workflow is not
proof that it ran; the executed CI conclusion for the ticket head is recorded on
the pull request.

## Not verified

- No publisher calls `BridgeRuntime.updateWork` / `updateGame` in production yet:
  the runtime is created in `apply()` and nothing feeds it until the Attention
  and game-loop tickets land. D-T03 delivers the seam, not the sources.
- The Q7 token/cache delta of one changed section value remains unmeasured (no
  provider credentials; a paid call is out of scope).
- Multi-step tool turns and mid-turn snapshot changes are not exercised.
- The Go boundary line, its absence in the Work entry, and the escaping are
  asserted in the request text and the runtime-context entry text; how a real
  DeepSeek model weighs a bounded data block against instructions is not
  measured (no provider credentials).
