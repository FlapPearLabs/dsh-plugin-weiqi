# C-T10 live calibration — correction record (updated 2026-11-09)

> 文中的提交 SHA 指维护者本地分支 `task/c-t10-cal` 的逐步提交，未推送到公开仓库；公开仓库里这些内容合并为一个提交。
>
> (The commit SHAs cited below point at the step-by-step commits on the
> maintainer's local branch `task/c-t10-cal`, which was never pushed to the
> public repository; in the public repository these changes are one commit.)

The round-2 report is archived at
`docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-LIVE-CALIBRATION-run2.md`
(sha256 `dc57ef979b388a7220e8e1a8b24967d3afb30d195c6736bd72dee67e725c8e92`).

Original group summary: 2026-11-07; first correction: 2026-11-08; review
amendments: 2026-11-09. These are correction dates, not new calibration runs.

- Ticket: WAVE-C-T10 (Spec §22 budget, §38 cognition benchmark)
- Scope: offline correction of the round-1 (4000 output-token cap) record and of
  the reporting defects repeated in the round-2 record. No live or paid request
  was re-run for this correction, and no observation was edited.
- Round-1 report: `docs/validation/C-T10-LIVE-CALIBRATION.md` as committed in
  `352e971` (`docs: record the first live C-T10 calibration run against the Go entry`).
- Round-1 dataset in that commit: `docs/validation/C-T10-LIVE-CALIBRATION-RAW.json`,
  sha256 `4c05ada4a649de3db33893e761abc6add0452a26cd04f1ce0da00ab4e6891175`.
- Copy of that dataset added later in `7d095fc`:
  `docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-RAW-run1-4000cap.json`,
  byte-identical to the file above (same sha256). The copy did not exist when
  `352e971` was committed; it is a faithful copy of the same observation, not a
  new run.
- Round-2 report and dataset: `7d095fc`.

## Retracted claims

The round-1 summary said the 23 failed turns were mainly caused by the 4000
output-token ceiling ("stuck on the output cap, not the model"), that the run
proved at least 8000 output tokens were required, and that the step cap also
had to be relaxed. The round-1 report carried the matching candidate and
formula. The failure attribution and both capacity conclusions do not follow
from the data.

| Claim | Status | Correct reading |
|---|---|---|
| "77 live requests, all HTTP 200" | incomplete | 80 requests were dispatched: 77 returned HTTP 200 with usage and 3 never settled. `session.gate.requests = 80`, `session.gate.unsettledRequests = 3`, `requests[]` has 77 rows. |
| "23 turns failed, mainly on the output cap, not the model" | wrong attribution | By `turns[].error`: 17 `Cognition benchmark enforcement bypass` (harness counting false positive, see below), 3 `Go turn budget exhausted: maxModelSteps (6/6)`, 3 provider network errors (2 × ECONNRESET, 1 × UND_ERR_CONNECT_TIMEOUT). Truncation cannot explain the 17 counting false positives or the 3 network errors; whether it contributed to the 3 step exhaustions cannot be settled from this run — those turns contain 5/5/4 truncated responses (14 of the 16). |
| "P95 = 4000 shows at least 8000 is needed" | not supported | 16 of 77 responses ended `finish=length` with `completion_tokens = 4000`, so the per-request output distribution is right-censored at the cap. P95 = 4000 proves that requests hit the ceiling in this run; it does not measure how much headroom production needs. |
| "8000 is the 1.5× margin" | inconsistent report formula | The emitted candidate is `requestedMaxTokens × 2` (censoring branch, `tests/benchmark/live-calibration.ts:484-501`): 8000 = 4000 × 2. `4000 × 1.5 = 6000`, rounded up to 64 = 6016. The formula cell is hard-coded at `tests/benchmark/live-calibration.ts:746` and never matched the emitted value. 8000 is an exploratory candidate. |
| "the step cap must be relaxed" | not established | 3 turns did exhaust 6/6 steps, but the round-1 report's own `maxModelSteps` candidate is **3** (largest completed turn took 3 steps). `stepExhausted` searches for the substring `within` (`tests/benchmark/live-calibration.ts:502-503`), which never matches `maxModelSteps (6/6)`, so the step-exhaustion headroom warning never fired. This run does not establish that 6 is too low for production. |
| "spend ¥0.91" | gate estimate, not a bill | ¥0.9063 is the gate estimate from settled usage at the recorded prices ($0.127646 × 7.1). It excludes the 3 unsettled reservations (¥0.1168), and no provider invoice was consulted. |

## Why 17 of the 23 failures are a counting false positive

Each turn builds a fresh benchmark request path, while the live provider is
created once per run and reused by every turn:

- `tests/benchmark/llm-request-path.ts:308` — `admittedRequests` is declared
  on the request path and restarts at 0 for each turn.
- `tests/benchmark/llm-request-path.ts:486`, `:507` — `stats()` reads
  `transportAttempts` from the shared provider and returns
  `retryAttempts = max(0, transportAttempts - admittedRequests)`.
- `tests/benchmark/run-live-calibration.paid.test.ts:218`, `:262` — one
  `LiveBenchmarkProvider` is constructed before the 24-turn loop and handed to
  every turn through `createProvider: () => provider`.
- `tests/benchmark/harness.ts:436`, `:440-445` — after each turn `path.stats()`
  is checked, and `retryAttempts > 0` raises `CognitionBenchmarkBypassError`.

The recorded error strings expose the cumulative counter: the first failed turn
(T02) reports `7 transport attempts for 4 admitted requests`, which is T01's 3
plus T02's 4; the last (T24) reports `80 transport attempts for 3 admitted
requests`, and 80 is exactly `session.gate.requests`. Round 2 drifts the same
way (`8` after T01's 5 plus T02's 3, up to `78` at T23, which equals the 78
settled requests in T01–T23; T24 adds one settled row and the single unsettled
reservation, accounting for the gate's remaining 2 dispatches and total 80).
These counters are consistent with one adapter transport attempt per admitted
request. The adapter declares `maxRetries: 0` and calls `fetchImpl` once per
`stream()` (`tests/benchmark/live-provider.ts:199-205`, `:770-786`); this is
adapter-level evidence, not a measurement of retries inside the HTTP client.
There is no final round-2 T24 transport counter in the dataset.

The per-turn `retryAttempts` field is not independent retry evidence:
`failedTurnRecord` (`tests/benchmark/run-live-calibration.paid.test.ts:113`)
writes a literal `0`; the completed T01 takes a computed value from the same
scope-mismatched statistic (it is zero because it is the first turn). The
guard subtracted a per-turn denominator from a lifetime numerator and labelled
17 turns as failed after per-turn execution (`harness.ts:436-445`), not
necessarily before they could act. The fallback record also replaces step,
latency and committed-action metrics with placeholders, so those failed-turn
fields cannot reconstruct actual outcomes. This is why "retry attempts: 0"
next to "failed turns: 23" misstates the run: the 23 is a coarse `failureKinds`
tally (`["run-failed"]` on every failed turn,
`tests/benchmark/live-calibration.ts:377`, `:730`), not a cause breakdown or a
measured real failure rate.

## Same defects in the round-2 record (7d095fc)

Round 2 configured `perRequestMaxTokens` 16000 and `maxModelSteps` 10. The
effective per-request ceiling did rise from round 1's 4000 to 8192, but not to
the configured 16000: all 79 requests asked for 8192 tokens, because
`tests/benchmark/harness.ts:361` always proposes `SCRIPTED_PROPOSED_MAX_TOKENS`
(`tests/benchmark/scripted-model.ts:15` = 8192) and
`tests/benchmark/budget-gate.ts:534` only clamps down with `Math.min`. Thus
8192 was exercised and remained censored; 16000 and the 16384 candidate were
not exercised. `maxModelSteps` also rose from 6 to 10. No step exhaustion was
recorded in round 2; with both limits changed and the counting defect still
present, this proves neither that 6 or 10 is a sufficient production limit nor
which change affected step exhaustion. The equal count of 23 failed records
does not imply identical causes:

- dispatch: `session.gate.requests = 80`; 79 rows with HTTP 200; 1 unsettled;
- failures: 22 `Cognition benchmark enforcement bypass` + 1 provider network
  error (T24); 0 step exhaustion;
- truncation: 7 of 79 responses ended `finish=length` at the effective 8192
  ceiling (`completion_tokens = 8192`); no request asked for the configured
  16000;
- report: the `perRequestMaxTokens` candidate is 16384 = 8192 × 2, while the
  formula cell still prints the 1.5× formula, which would give 12288;
- spend: ¥1.3923 gate estimate plus 1 unsettled reservation (¥0.0750).

The round-2 report now carries the breakdown and points at this record; its
observations were not changed.

## Report amendments

`docs/validation/C-T10-LIVE-CALIBRATION.md` was edited as report text only (no
dataset changes) to: point at this record; distinguish dispatched from settled
requests; break `run-failed × 23` down into the recorded error causes; state the
censoring branch for `perRequestMaxTokens` and limit the 1.5× margin statement
to `maxTurnTokens`. The renderer overwrites these manual edits on the next
`run-live-calibration.sh render` until the code defects are fixed — see the
follow-up engineering ticket.

## Not fixed here (follow-up engineering ticket)

- Counting scope: `tests/benchmark/llm-request-path.ts:307-308`, `:486`, `:507`;
  `tests/benchmark/harness.ts:440-445`;
  `tests/benchmark/run-live-calibration.paid.test.ts:113` (literal
  `retryAttempts: 0`), `:218`, `:262`.
- Effective per-request ceiling: `tests/benchmark/harness.ts:361` always
  proposes `SCRIPTED_PROPOSED_MAX_TOKENS` and
  `tests/benchmark/scripted-model.ts:15` sets it to 8192;
  `tests/benchmark/budget-gate.ts:534` only clamps down, so a configured
  `perRequestMaxTokens` above 8192 is never requested and the 16384 candidate
  cannot be measured until this is fixed.
- Report derivation/wording: `tests/benchmark/live-calibration.ts:502-503`
  (`stepExhausted` substring), `:730` (coarse `failureKinds` tally), `:746`
  (hard-coded 1.5× formula), `:650` (headline counts settled rows only), `:582`
  (reads `prompt_cache_hit_tokens` while this provider reports
  `prompt_tokens_details.cached_tokens`, so the raw cache-hit column is `—` on
  all 79 rows).

## Offline reproduction

```text
node docs/validation/verify-c-t10-correction.mjs
```

The script asserts dataset hashes, aggregate counts and the selected operands
below. Source-code citations and causal interpretations still require manual
review; a script PASS is not an independent review of the prose. It exits 0 only when both datasets match; round 1
must print `dispatched 80`, `settled 77`, `unsettled 3`, `http200 77`, 24 turns
(1 completed / 23 failed: 17 retry-guard false positives, 3 step-exhausted,
3 network), `finishLength 16`, `lengthAndAtCap 16`, `estimatedCostCny
0.9062867136`, `unsettledCostCny 0.11683476`, the transport counters
`T02 7/4` and `T24 80/3`, and `caps.maxOutputTokensPerRequest 4000` with
`turnBudget.perRequestMaxTokens 4000`. Round 2 must print `80 / 79 / 1`,
`finishLength 7`, `lengthAndAtCap 7`, the transport counters `T02 8/3` and
`T23 78/4`, and the configured-versus-effective pair
`turnBudget.perRequestMaxTokens 16000` / `requestedMaxTokens [8192]`.

The script also asserts that the count of all at-cap rows equals the
`lengthAndAtCap` count and no `finish=length` row is off-cap; it checks that
every recorded `retryAttempts` value is `0` (a literal default on failed
turns, a computed value on T01, not independent retry evidence). Adapter-call
accounting is consistent (round 1: T24 equals `gate.requests`; round 2: T23
equals settled rows through T23, with later rows/reservations accounting for
the remaining dispatches). This does not measure HTTP-client-internal retries.
Each dataset is scored separately; even an unreadable or malformed one prints
FAIL without preventing the other dataset's result.

The round-1 bytes asserted by the script can be checked against the commit that
first recorded them:

```text
git show 352e971:docs/validation/C-T10-LIVE-CALIBRATION-RAW.json | shasum -a 256
# 4c05ada4a649de3db33893e761abc6add0452a26cd04f1ce0da00ab4e6891175
```
