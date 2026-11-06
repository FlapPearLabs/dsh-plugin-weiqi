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
  one section (`companion-go:go-lane-work-snapshot`) whose text is only
  `{{go_work_snapshot}}` while a snapshot exists and `''` before the first one;
- the **Work** agent's own prompt scope gets one runtime context
  (`companion-go:work-lane-game-notice`).

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
✓ 2. twenty rapid GameNotice updates create zero additional model requests
✓ 3. an idle lane is not woken by a Bridge change alone
✓ 4. the Work direction stays inside the §39.6 bound over a 400-move sequence
✓ 5. an unchanged GameNotice adds no repeated runtime context

Test Files  1 passed (1)
     Tests  5 passed (5)
```

What each assertion exercises, on the real pinned `agent-loop`, `agent`,
`system-prompt`, `session`, `llm`, and `tools` implementations:

| # | §39.6 requirement | Assertion |
|---|---|---|
| 1 | Go sees only the newest WorkSnapshot | after `1 → 2 → 3`, the second request's `system` contains `work summary 3` and neither `1` nor `2`; the Go message history contains no `work summary` at all |
| 2 | no evaluation-only wake, 20 rapid updates | 20 `updateGame` calls between two natural requests leave the request count unchanged; the next natural request adds exactly one |
| 3 | an idle lane is not woken | holder updates after the lane went idle add no request and no `running` status transition, after both drivers are flushed with `whenIdle()` |
| 4 | bounded long sequence | 400 moves with one natural Work request every 20 moves: at most 20 runtime-context blocks, each ≤ 296 characters, total ≤ 5920 |

Assertion 4 is deliberately tighter than the contract: R2.4.3 §39.6 states the
bound as a ceiling of `L <= 300` characters and `20 x 300 = 6000` characters so
the contract does not depend on one per-move maximum, while this gate asserts the
measured maximum of 296 and the resulting 5920, which sits inside that ceiling.
| 5 | unchanged value adds nothing | two natural requests with one unchanged GameNotice produce exactly one runtime-context block |

## Falsifiability check

`tests/integration/bridge-delivery/run-mutation-check.sh` applies three mutants to a
throwaway copy of `src/` inside the pinned tests directory; both must turn the
guard assertions red, and a surviving mutant makes the script exit non-zero.

```sh
DSH_PINNED_ROOT=../dsh-plugin-weiqi-wt/DSH-PINNED \
bash tests/integration/bridge-delivery/run-mutation-check.sh
```

Recorded result:

```text
mutant context-seam-for-go killed by an assertion
AssertionError: expected 'You are an AI agent powered by DeepSe…' to contain 'work summary 1'
mutant no-go-registration killed by an assertion
AssertionError: expected 'You are an AI agent powered by DeepSe…' to contain 'work summary 1'
RESULT: PASS — every mutant was killed by an assertion
```

| Mutant | Change | Observed |
|---|---|---|
| `context-seam-for-go` | the Go direction registers `context(...)` instead of `section` + `variable` | assertion 1 red: the system slot no longer carries the snapshot |
| `no-go-registration` | the Go registrations are removed entirely | assertion 1 red |
| `frozen-work-projection` | the Work provider renders once and then returns the cached text | assertions 2 and 4 red: the newest block no longer carries `moveNumber: 21` / `moveNumber: 400` |
| `frozen-work-projection` | the Work provider renders once and then returns the cached text, so later GameNotices never reach the model | assertions 2 and 4 red: the newest block no longer carries `moveNumber: 21` / `moveNumber: 400` |

The `frozen-work-projection` mutant exists because review r1 found it surviving the
first version of this gate: the "newest last" property was asserted only in the
repository unit test, not in the pinned gate. It is now asserted in both, and the
mutant proves the gate can fail for it.

The mutants live only under the pinned tests directory and are removed on exit;
`git -C "$DSH_PINNED_ROOT" status --porcelain` is empty afterwards.

## Repository-level evidence

- `pnpm verify` (Node `v24.11.1`, pnpm `11.7.0`): typecheck OK, **50 files /
  588 tests passed**, clean + build OK.
- `src/bridge/delivery.test.ts` pins the registration contract (one section plus
  one variable for Go, one context for Work), the empty-render before the first
  publication, latest-only rendering, stale-sequence suppression, and the exact
  296-character maximum of the 400-move render sequence.
- `src/index.test.ts` pins that `apply()` registers both seams on the right
  agent scopes.

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
