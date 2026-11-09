# Handoff — WAVE-D-T03 (hybrid Bridge delivery)

## Baseline

- Ticket: WAVE-D-T03 / issue #31, Baseline IDs BL-BR-05 (and the BL-BR-03 seam it consumes)
- Code baseline SHA (branch point): `f8bdd1e` on `main`
- Spec authority: `docs/spec/SPEC_LEAN_V0.1_R2.4.3_VERIFIED.md` §9.1 and §39.6 (PR #113)
- D-S01 evidence (this ticket's dependency): PR #64, `Closes #28`

## Changed files

| File | Change |
|---|---|
| `src/bridge/delivery.ts` | new: `bindBridgeDelivery`, `renderWorkSnapshot`, `renderGameNotice`, `PromptSeam`, `DeliveryTargets`, name/order constants |
| `src/bridge/delivery.test.ts` | new: registration contract, empty-render, latest-only, stale suppression, 296-character bound |
| `src/bridge/index.ts` | re-exports the delivery surface |
| `src/index.ts` | `apply()` binds both seams on the two lane agents |
| `src/index.test.ts` | the lane factory supplies a `systemPrompt` recorder; new test pins that `apply()` registers one section + one variable on Go and one context on Work |
| `tests/integration/bridge-delivery/bridge-delivery.fixture.ts` | new: nine pinned-DSH assertions from §39.6, including a competing `order` 115 runtime-context contributor |
| `tests/integration/bridge-delivery/run-bridge-delivery.sh` | new: fail-closed pin-checking runner |
| `.github/workflows/bridge-delivery-gate.yml` | new: runs the runner on PRs touching the delivery surface |
| `docs/validation/DSH_BRIDGE_HYBRID_DELIVERY_VERIFIED.md` | new: executed evidence record |

## Red → green

Red (fixture created before the implementation, module absent):

```text
 FAIL  src/bridge/delivery.test.ts [ src/bridge/delivery.test.ts ]
Error: Failed to resolve import "./delivery.js"
 Test Files  1 failed | 49 passed (50)
```

Green after the implementation:

```text
pnpm test  ->  50 files / 591 tests passed
pnpm verify -> typecheck OK, 50 files / 591 tests passed, clean + build OK
```

## Pinned-DSH gate

```sh
DSH_PINNED_ROOT=../dsh-plugin-weiqi-wt/DSH-PINNED \
TRACE_LOG=/tmp/bridge-delivery-trace.log \
bash tests/integration/bridge-delivery/run-bridge-delivery.sh
```

Result: `Test Files 1 passed (1)`, `Tests 9 passed (9)`. The pinned tree was
left clean.

Falsifiability: `run-mutation-check.sh` applies six mutants — `context-seam-for-go`,
`no-go-registration`, `pad`, `stale`, `noop`, and `notice-not-last` — and every one
must turn an assertion red; a surviving mutant exits non-zero. The gate grew from
five cases and two mutants after review r1 proved the first version let a frozen
Work projection pass 5/5; it now asserts the newest block's `moveNumber` after the
twenty-update burst and at the end of the 400-move sequence, and case 8 asserts the
newest notice is the last runtime-context entry against a competing order-115
contributor. Recorded result: `RESULT: PASS — every mutant was killed by a failing
test`. Logs and method are in the validation record.

The three-mutant set recorded on `main` also carried `frozen-work-projection`
(the Work provider cached its first render); the branch's `f3d87b6` replaced it
with the broader `stale` mutant and added `pad`, `noop`, and `notice-not-last`.

## Regression surface

`src/index.test.ts` had to grow a `systemPrompt` service on its stand-in agent
context, because `apply()` now registers prompt contributions. The three
existing entry tests still pass unchanged in intent (lane identity, preset
header, Go capability scope, collision propagation).

## Review

- r1 (deepseek-v4.1-flash): **APPROVE**, no P0/P1. One P2 — the frozen-projection
  mutant survived — fixed in `b27f3f1` together with the two new assertions.
- r2: see `.omo/reviews/bridge-dt03/`.

## Not verified / known gaps

- Nothing publishes to `BridgeRuntime` in production yet; the runtime is created
  in `apply()` and stays empty until the Attention / game-loop tickets feed it.
  D-T03's scope is the delivery seam.
- Q7 token cost per changed section value remains unmeasured.
- Multi-step tool turns and mid-turn snapshot changes are not covered.
- The gate's CI conclusion is recorded on the PR; this handoff records only the
  local run.
