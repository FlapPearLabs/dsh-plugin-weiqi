# Spec §38 automated cognition benchmark — scripted run (WAVE-C-T10)

- Ticket: WAVE-C-T10 / BL-BUD-06
- Status: **scripted harness complete; production calibration NOT final**
- Raw record: `docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json`
- Harness: `tests/benchmark/`
- Record regenerated with: `tests/benchmark/run-cognition-benchmark.sh`
- Budget candidate under test: `docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json` → `budgetUnderTest`

## What actually ran

**The model is scripted, not DeepSeek.** No DeepSeek request was made, no
credentials were used, and no spend was incurred. The scripted adapter
(`tests/benchmark/scripted-model.ts`) replays a fixed plan per fixture and
reports token counts from a fixed formula. Those counts exercise the §38 token
fields and the C-S01 clamp; they are **not** a measurement of DeepSeek token
usage and cannot calibrate a production token cap.

Each run composes the real production surfaces:

1. the real `GoRulesPort` (Tenuki adapter, B-S01) creates the position from a
   fixed setup script;
2. the real eight `go.*` tools (C-T02) are registered behind
   `GoCapabilityGuard` (C-T01/C-T04);
3. every model step passes through `createGoTurnEnforcement` (C-T07) and the
   `agent/request` token cap (C-S01);
4. the large-group fixture requests `go.request_deep_think` and consumes the
   bounded one-step boost (C-T08) on its fourth model step.

Enforcement is checked per call: an inspect/try_move/deep-think execution that
does not advance its counter, a read that changes a gated counter, or a
committed action the enforcement did not record raises
`CognitionBenchmarkBypassError`. A test injects a pass-through enforcement to
prove that this failure path is real.

## Per-class results (first of three runs)

Latency is local harness wall-clock in milliseconds, not model latency.
Input/output tokens are the scripted adapter's synthetic accounting.

| §38 class | latency ms | input tok | output tok | model steps | inspect | try_move | deep-think | illegal | final move | latency range (3 runs) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| opening | 0.72 | 887 | 352 | 2 | 1 | 2 | 0 | 0 | play (2,4) | 0.63 |
| simple capture | 0.18 | 839 | 320 | 2 | 1 | 1 | 0 | 0 | play (1,2) | 0.10 |
| escape | 0.05 | 791 | 288 | 2 | 1 | 1 | 0 | 0 | play (4,5) | 0.01 |
| local fight | 0.10 | 839 | 320 | 2 | 1 | 2 | 0 | 0 | play (4,3) | 0.09 |
| ko | 0.17 | 839 | 320 | 2 | 1 | 1 | 0 | 1 | play (6,6) | 0.09 |
| large-group pressure | 0.12 | 1658 | 608 | 4 | 2 | 2 | 1 | 0 | play (2,3) | 0.04 |
| endgame | 0.05 | 791 | 288 | 2 | 1 | 0 | 0 | 0 | play (4,5) | 0.01 |
| ambiguous position | 0.09 | 887 | 352 | 2 | 2 | 1 | 0 | 0 | play (4,4) | 0.01 |

Variation across the three runs: every structural metric above is identical in
all three runs for every fixture (`identicalStructuralMetrics: true`); only
wall-clock latency varies, and its range is the last column.

The ko fixture deliberately attempts the immediate recapture at (1,1) and the
authoritative port rejects it with `superko`; the run counts that as one illegal
attempt and still commits a legal ko threat at (6,6).

## Candidate numeric defaults (NOT applied)

`src/budget/` production defaults were **not changed**. The contract
(`src/contracts/budget.ts`) deliberately carries no defaults, and
`src/budget/config.ts` only validates injected values. This ticket therefore
has **no config diff to apply**: the values below are a calibration proposal,
recorded here and in the raw record, and remain unapplied until a real DeepSeek
run is approved.

| Field | Candidate | Basis | Calibrated? |
|---|---:|---|---|
| `maxModelSteps` | 3 | scripted maximum without boost was 2; one step of headroom, plus the single §23 boost step (effective ceiling 4) | structural only |
| `maxInspectCalls` | 4 | scripted maximum was 2; two steps of headroom for real perception | structural only |
| `maxTryMoves` | 3 | scripted maximum was 2; one step of headroom | structural only |
| `perRequestMaxTokens` | 1024 | **placeholder**; scripted output per request never exceeded 192 tokens, and scripted counts cannot size a real request | NO |
| `maxTurnTokens` | 4096 | **placeholder**; scripted turn maximum was 2266 tokens, and scripted counts cannot size a real turn | NO |

All five fields are **hard caps** at runtime, not suggestions:

- `perRequestMaxTokens` is the §22.1 absolute per-request hard cap applied to
  the resolved request config by the C-S01 listener; a proposal above it is
  clamped, never rejected.
- `maxTurnTokens` is the §22.2 turn ceiling; once exhausted, no further model
  step, inspect, try_move or deep-think may start.
- `maxModelSteps`, `maxInspectCalls` and `maxTryMoves` are per-turn counters
  that deny the next execution on exhaustion.

The counter values are defensible from the scripted structural maxima. The two
token caps are **not** calibrated: any number here is a placeholder until a
real DeepSeek run measures actual input/output usage per class.

## What remains pending owner approval

1. A real "ask DeepSeek for one move" benchmark run over the same eight
   fixtures, with credentials and spend approved, to replace the synthetic token
   accounting.
2. Only after that run may this record be used to **apply** production
   `GoTurnBudget` numeric defaults (BL-BUD-06 / C-T10 config step).
3. Until then the candidate values above must not be cited as production
   calibration.

## Non-goals respected

No Spec change, no new dependency, no `src/budget/` default change, no
KataGo/solver/second agent, no strength optimization, no long-term telemetry.
