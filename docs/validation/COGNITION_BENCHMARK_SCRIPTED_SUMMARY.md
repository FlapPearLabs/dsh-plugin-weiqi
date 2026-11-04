# Spec §38 automated cognition benchmark — scripted run (WAVE-C-T10)

- Ticket: WAVE-C-T10 / BL-BUD-06
- Status: **scripted harness complete; production calibration NOT final**
- Raw record: `docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json`
- Harness: `tests/benchmark/`
- Record regenerated with: `tests/benchmark/run-cognition-benchmark.sh`
- Budget candidate under test: `docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json` → `budgetUnderTest`

## What actually ran

**The model is scripted, not DeepSeek.** No DeepSeek request was made, no
credentials were used, and no spend was incurred. The scripted provider
(`tests/benchmark/fake-provider.ts` + `tests/benchmark/scripted-model.ts`)
implements the pinned `LlmAdapter` interface, replays a fixed plan per fixture,
and reports token counts from a fixed formula. Those counts exercise the §38
token fields and the C-S01 clamp; they are **not** a measurement of DeepSeek
token usage and cannot calibrate a production token cap.

Each run composes the real production surfaces:

1. the real `GoRulesPort` (Tenuki adapter, B-S01) creates the position from a
   fixed setup script;
2. the real eight `go.*` tools (C-T02) are registered behind
   `GoCapabilityGuard` (C-T01/C-T04);
3. every model request leaves through the real pinned
   `@deepseek-ai/dsh-llm` runtime: `markAgentLoopRequest` → `prepareCall` →
   `llm/stream` waterfall → the registered `LlmAdapter.stream`; the real
   `BlockAssembler` turns the chunks back into tool calls and usage;
4. every model step passes through `createGoTurnEnforcement` (C-T07) and the
   `agent/request` token cap (C-S01);
5. the large-group fixture requests `go.request_deep_think` and consumes the
   bounded one-step boost (C-T08) on its fourth model step.

**One layer is a documented stand-in.** `@deepseek-ai/dsh-agent-loop` is not in
this package's dependency surface (only `cordis`, `dsh-agent`, `dsh-llm` and
`dsh-session` are installed), so the step/turn driver in
`tests/benchmark/harness.ts` assembles the request itself: it marks the request
as an AgentLoop request, applies the production `agent/request` cap, and streams
through `LlmRuntime`. Everything below the loop is the pinned real
implementation; nothing above the adapter registry is simulated inside
dsh-llm.

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
| opening | 1.82 | 887 | 352 | 2 | 1 | 2 | 0 | 0 | play (2,4) | 1.38 |
| simple capture | 0.41 | 839 | 320 | 2 | 1 | 1 | 0 | 0 | play (1,2) | 0.12 |
| escape | 0.25 | 791 | 288 | 2 | 1 | 1 | 0 | 0 | play (4,5) | 0.40 |
| local fight | 0.26 | 839 | 320 | 2 | 1 | 2 | 0 | 0 | play (4,3) | 0.04 |
| ko | 0.28 | 839 | 320 | 2 | 1 | 1 | 0 | 1 | play (6,6) | 0.05 |
| large-group pressure | 0.45 | 1658 | 608 | 4 | 2 | 2 | 1 | 0 | play (2,3) | 0.14 |
| endgame | 0.22 | 791 | 288 | 2 | 1 | 0 | 0 | 0 | play (4,5) | 0.04 |
| ambiguous position | 0.23 | 887 | 352 | 2 | 2 | 1 | 0 | 0 | play (4,4) | 0.03 |

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

## Benchmark spend / request gates

`tests/benchmark/budget-gate.ts` is a benchmark-only gate (it never touches
`src/budget/` or the production `GoTurnBudget` defaults). It guards a whole
benchmark session — all fixtures and repeated runs — and every violation stops
the session and is recorded as `budget_stop` in the run metrics and in
`record.budgetGate.stops`.

| Gate | Default | Enforced |
|---|---:|---|
| Total provider requests | 96 | checked before dispatch |
| Input tokens per request | 8000 | pre-flight estimate and reported usage |
| Output tokens per request | 4000 | request clamped, reported usage re-checked |
| Estimated session cost | $1.00 | projected before dispatch and accumulated after |
| Automatic retries | forbidden | adapter policy `maxRetries: 0`; a repeated step request stops |
| Search / fetch tools | forbidden | request tool list and every streamed tool call |

Observed on the regenerated record (placeholder price schedule, not a DeepSeek
quote): 54 requests, estimated `$0.039681`, zero stops. The `budget-gate` test
file proves each gate trips in isolation (max requests, input, output, cost,
retry, search/fetch) and that the default path commits all eight classes
without a false stop. The price schedule is a placeholder; a real run must pass
the approved DeepSeek schedule to `BenchmarkBudgetGate`.

## What remains pending owner approval

1. A real "ask DeepSeek for one move" benchmark run over the same eight
   fixtures, with credentials and spend approved, to replace the synthetic token
   accounting.
2. The real model call still needs the published `@deepseek-ai/dsh-llm-deepseek`
   adapter (or an equivalent `LlmAdapter` implementation) registered for a
   real provider id, plus an approved price schedule for the cost gate.
3. The `@deepseek-ai/dsh-agent-loop` package is not installed here; before a
   real run either add that pinned package (a dependency decision for the owner)
   or keep the documented loop stand-in and record it as such.
4. Only after that run may this record be used to **apply** production
   `GoTurnBudget` numeric defaults (BL-BUD-06 / C-T10 config step).
5. Until then the candidate values above must not be cited as production
   calibration.

## Non-goals respected

No Spec change, no new dependency, no `src/budget/` default change, no
KataGo/solver/second agent, no strength optimization, no long-term telemetry.
