# C-T10 live calibration — real model token and latency record

- Ticket: WAVE-C-T10 (Spec §22 budget, §38 cognition benchmark)
- Status: **measured against the live endpoint** (no scripted stand-in)
- Generated at (UTC): 2026-11-06T16:35:20.372Z
- Endpoint: `https://opencode.ai/inference/go/openai/v1/chat/completions`
- Model: `deepseek-v4.1-flash`
- Raw dataset: `docs/validation/C-T10-LIVE-CALIBRATION-RAW.json`
- Runner: `tests/benchmark/run-live-calibration.sh full`
- Report renderer: `C_T10_RENDER_REPORT=1 pnpm exec vitest run tests/benchmark/render-live-calibration.test.ts`
- Price schedule used for the spend gate (USD per million tokens): input 0.3, output 1.2, cache read 0.006
- Session gate: 120 requests, 8000 input tokens/request, 16000 output tokens/request (gate configuration; the effective per-request ask was 8192 — see the caveat), ¥6.16 at ¥7.1/USD
- Turn enforcement during measurement: maxModelSteps 10 (+1 §23 boost), maxInspectCalls 8, maxTryMoves 6, perRequestMaxTokens 16000 configured / 8192 effective, maxTurnTokens 128000. The harness always proposes 8192 (`tests/benchmark/harness.ts:361`, `tests/benchmark/scripted-model.ts:15`) and the gate only clamps down, so 16000 never reached a request. These are measurement limits, not the candidate under calibration; the candidate is derived below.

## Correction of the round-1 failure attribution (original 2026-11-07; updated 2026-11-09)

The round-1 (4000-cap) run was summarised as showing that the 23 failed turns
were mainly caused by the output ceiling, that at least 8000 output tokens were
needed, and that the step cap had to be relaxed. Those causal and capacity
claims do not follow from the data: 17 of the 23 failures are a harness
retry-count false positive (lifetime `transportAttempts` compared with a
per-turn `admittedRequests`), 3 are recorded 6/6 step exhaustions and 3 are provider
network errors. The P95 = 4000 was right-censored at the cap, and the 8000
candidate is a doubling of that censored ceiling, not a 1.5× measurement.
Round 2's effective ceiling rose from 4000 to 8192, not to the configured
16000: all 79 requests asked for 8192 because the harness always proposes that
value and the gate only clamps down. Neither run exercised a ceiling above
8192. Round 2 also raised `maxModelSteps` from 6 to 10; its zero recorded step
exhaustions establish neither 6 nor 10 as sufficient for production, and the
effect of either change cannot be isolated from these runs.
The same reporting defects appear in the figures below; they are broken out in
`docs/validation/C-T10-LIVE-CALIBRATION-CORRECTION.md`, which also records why
no observation was changed and which code fix is still open.

## What ran

Each turn is one §38 fixture position and is one complete DeepSeek move
decision: the harness builds the position on the real Tenuki `GoRulesPort`,
registers the real eight `go.*` tools behind `GoCapabilityGuard`, drives
`createGoTurnEnforcement` (C-T07/C-T08) and the `agent/request` cap (C-S01),
and sends each model step through the real pinned `@deepseek-ai/dsh-llm`
runtime to `LiveBenchmarkProvider` (one adapter fetch call per stream,
`maxRetries: 0`; HTTP-client-internal retries are not measured).

Per-request `usage` below is the provider's own object, recorded verbatim.
The mapped input is `prompt_tokens - cached prompt tokens`, read from
`prompt_tokens_details.cached_tokens` on this entry (or
`prompt_cache_hit_tokens` elsewhere), and the mapped
output is `completion_tokens`, matching the disjoint fields DSH charges; the
turn budget charges mapped input + output, so cache reads are reported
separately and are not folded into the turn total.

Requests: **79** responses recorded across **24** turns (1 completed, 23 failed, 0 budget stops). The gate dispatched **80** requests: the 79 rows below plus **1** request that never settled.
Wall clock: **1722.6 s**. Gate-estimated spend: **$0.196094** (¥1.3923 at ¥7.1/USD), an estimate from settled usage, not a provider bill.
Recorded per-turn `retryAttempts` values are **0**, but failed turns contain a literal default (`tests/benchmark/run-live-calibration.paid.test.ts:113`); T01's computed zero uses the same scope-mismatched statistic. Neither is independent retry evidence. The cumulative `transportAttempts` at T23 is 78, equal to the 78 settled requests in T01–T23; the remaining 2 gate dispatches are accounted for by T24's 1 settled row + 1 unsettled reservation. No final T24 transport counter is recorded. These counts are consistent with one adapter attempt per admitted request; the adapter declares `maxRetries: 0` and calls fetch once per stream (`live-provider.ts:199-205`, `:770-786`), but retries inside the HTTP client are not measured. The post-turn guard labelled 22 turns failed on a cumulative-vs-per-turn mismatch; that is a harness counting defect, not a measured real failure rate. Failed-turn step/latency/action fields are fallback placeholders, not full measurements.
Unsettled reservations (dispatched without usage, counted against the cap): **1** request(s), $0.010566 (¥0.0750).

## Correction of the earlier BLOCKED record

The earlier record at this path reported HTTP 402 and 429 from
`https://opencode.ai/zen/v1/chat/completions`. That URL is the ordinary Zen
entry, not the OpenCode Go entry this ticket configures. Those responses did
not prove the Go subscription had no balance, and the earlier "actual spend
¥0.00" claim cannot be asserted without a provider bill. This run used the
official Go row for `deepseek-v4.1-flash`
(`https://opencode.ai/inference/go/openai/v1/chat/completions`, official Go
table captured 2026-11-06, SHA256
`5483c3cacaf5e72fdfb22e7b5f126daf79b55c1930f4c946092f273af24992d8`).
The spend figures below are gate estimates from the reported usage at the
recorded assumptions; no invoice was consulted, so they are not a final bill.

## Per-request raw usage

Every row is one entry in `requests[]` of the raw dataset; the raw columns
are copied from the provider response without transformation.

| request | fixture | step | # | wire | req max | raw prompt | raw completion | raw cache hit | mapped input | mapped output | cache read | latency ms | finish |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| T01-S1 | opening-spread | 1 | 1 | sse | 8192 | 1287 | 49 | — | 7 | 49 | 1280 | 5007.0 | tool_calls |
| T01-S2 | opening-spread | 2 | 2 | sse | 8192 | 1515 | 8192 | — | 107 | 8192 | 1408 | 106521.0 | length |
| T01-S3 | opening-spread | 3 | 3 | sse | 8192 | 1517 | 88 | — | 109 | 88 | 1408 | 3769.0 | tool_calls |
| T01-S4 | opening-spread | 4 | 4 | sse | 8192 | 2147 | 1581 | — | 739 | 1581 | 1408 | 23488.6 | tool_calls |
| T01-S5 | opening-spread | 5 | 5 | sse | 8192 | 2313 | 915 | — | 265 | 915 | 2048 | 15125.2 | tool_calls |
| T02-S1 | opening-spread | 1 | 6 | sse | 8192 | 1287 | 54 | — | 7 | 54 | 1280 | 4158.0 | tool_calls |
| T02-S2 | opening-spread | 2 | 7 | sse | 8192 | 1515 | 3150 | — | 107 | 3150 | 1408 | 44986.8 | tool_calls |
| T02-S3 | opening-spread | 3 | 8 | sse | 8192 | 2289 | 1625 | — | 753 | 1625 | 1536 | 23868.9 | tool_calls |
| T03-S1 | opening-spread | 1 | 9 | sse | 8192 | 1287 | 144 | — | 7 | 144 | 1280 | 4491.6 | tool_calls |
| T03-S2 | opening-spread | 2 | 10 | sse | 8192 | 2131 | 1834 | — | 83 | 1834 | 2048 | 25870.1 | tool_calls |
| T03-S3 | opening-spread | 3 | 11 | sse | 8192 | 2281 | 873 | — | 105 | 873 | 2176 | 14130.7 | tool_calls |
| T04-S1 | simple-capture-single-stone | 1 | 12 | sse | 8192 | 1303 | 123 | — | 23 | 123 | 1280 | 2342.2 | tool_calls |
| T04-S2 | simple-capture-single-stone | 2 | 13 | sse | 8192 | 1734 | 116 | — | 454 | 116 | 1280 | 1383.3 | tool_calls |
| T05-S1 | simple-capture-single-stone | 1 | 14 | sse | 8192 | 1303 | 187 | — | 23 | 187 | 1280 | 1525.7 | tool_calls |
| T05-S2 | simple-capture-single-stone | 2 | 15 | sse | 8192 | 1854 | 83 | — | 446 | 83 | 1408 | 1333.3 | tool_calls |
| T06-S1 | simple-capture-single-stone | 1 | 16 | sse | 8192 | 1303 | 194 | — | 23 | 194 | 1280 | 1631.3 | tool_calls |
| T06-S2 | simple-capture-single-stone | 2 | 17 | sse | 8192 | 1854 | 110 | — | 62 | 110 | 1792 | 1534.7 | tool_calls |
| T07-S1 | escape-from-atari | 1 | 18 | sse | 8192 | 1309 | 51 | — | 29 | 51 | 1280 | 1406.9 | tool_calls |
| T07-S2 | escape-from-atari | 2 | 19 | sse | 8192 | 1573 | 426 | — | 293 | 426 | 1280 | 5442.6 | tool_calls |
| T07-S3 | escape-from-atari | 3 | 20 | sse | 8192 | 1834 | 106 | — | 298 | 106 | 1536 | 2883.6 | tool_calls |
| T08-S1 | escape-from-atari | 1 | 21 | sse | 8192 | 1309 | 133 | — | 29 | 133 | 1280 | 1895.5 | tool_calls |
| T08-S2 | escape-from-atari | 2 | 22 | sse | 8192 | 1991 | 335 | — | 71 | 335 | 1920 | 3792.5 | tool_calls |
| T08-S3 | escape-from-atari | 3 | 23 | sse | 8192 | 2135 | 514 | — | 87 | 514 | 2048 | 4767.0 | tool_calls |
| T09-S1 | escape-from-atari | 1 | 24 | sse | 8192 | 1309 | 132 | — | 29 | 132 | 1280 | 4720.0 | tool_calls |
| T09-S2 | escape-from-atari | 2 | 25 | sse | 8192 | 2183 | 153 | — | 7 | 153 | 2176 | 5960.1 | tool_calls |
| T09-S3 | escape-from-atari | 3 | 26 | sse | 8192 | 2327 | 182 | — | 23 | 182 | 2304 | 2935.8 | tool_calls |
| T10-S1 | local-fight-contact | 1 | 27 | sse | 8192 | 1299 | 130 | — | 19 | 130 | 1280 | 1853.3 | tool_calls |
| T10-S2 | local-fight-contact | 2 | 28 | sse | 8192 | 2082 | 8192 | — | 34 | 8192 | 2048 | 65478.5 | length |
| T10-S3 | local-fight-contact | 3 | 29 | sse | 8192 | 2082 | 5147 | — | 34 | 5147 | 2048 | 41883.9 | tool_calls |
| T10-S4 | local-fight-contact | 4 | 30 | sse | 8192 | 2512 | 3040 | — | 336 | 3040 | 2176 | 27867.8 | tool_calls |
| T11-S1 | local-fight-contact | 1 | 31 | sse | 8192 | 1299 | 179 | — | 19 | 179 | 1280 | 4649.3 | tool_calls |
| T11-S2 | local-fight-contact | 2 | 32 | sse | 8192 | 2082 | 8192 | — | 34 | 8192 | 2048 | 66426.5 | length |
| T11-S3 | local-fight-contact | 3 | 33 | sse | 8192 | 2082 | 8192 | — | 34 | 8192 | 2048 | 64478.0 | length |
| T11-S4 | local-fight-contact | 4 | 34 | sse | 8192 | 2086 | 5248 | — | 38 | 5248 | 2048 | 42803.8 | tool_calls |
| T11-S5 | local-fight-contact | 5 | 35 | sse | 8192 | 2662 | 2554 | — | 614 | 2554 | 2048 | 22895.8 | tool_calls |
| T12-S1 | local-fight-contact | 1 | 36 | sse | 8192 | 1299 | 130 | — | 19 | 130 | 1280 | 2429.6 | tool_calls |
| T12-S2 | local-fight-contact | 2 | 37 | sse | 8192 | 2082 | 5818 | — | 34 | 5818 | 2048 | 46555.3 | tool_calls |
| T12-S3 | local-fight-contact | 3 | 38 | sse | 8192 | 2502 | 2028 | — | 454 | 2028 | 2048 | 18458.8 | tool_calls |
| T13-S1 | ko-immediate-recapture | 1 | 39 | sse | 8192 | 1304 | 135 | — | 24 | 135 | 1280 | 4674.8 | tool_calls |
| T13-S2 | ko-immediate-recapture | 2 | 40 | sse | 8192 | 2065 | 7955 | — | 17 | 7955 | 2048 | 95078.8 | tool_calls |
| T13-S3 | ko-immediate-recapture | 3 | 41 | sse | 8192 | 2581 | 8192 | — | 533 | 8192 | 2048 | 107884.3 | length |
| T13-S4 | ko-immediate-recapture | 4 | 42 | sse | 8192 | 2586 | 2963 | — | 26 | 2963 | 2560 | 23361.9 | tool_calls |
| T14-S1 | ko-immediate-recapture | 1 | 43 | sse | 8192 | 1304 | 136 | — | 24 | 136 | 1280 | 3735.2 | tool_calls |
| T14-S2 | ko-immediate-recapture | 2 | 44 | sse | 8192 | 2065 | 4013 | — | 17 | 4013 | 2048 | 50401.2 | tool_calls |
| T14-S3 | ko-immediate-recapture | 3 | 45 | sse | 8192 | 2491 | 517 | — | 443 | 517 | 2048 | 16832.4 | tool_calls |
| T14-S4 | ko-immediate-recapture | 4 | 46 | sse | 8192 | 3006 | 7240 | — | 574 | 7240 | 2432 | 77671.2 | tool_calls |
| T15-S1 | ko-immediate-recapture | 1 | 47 | sse | 8192 | 1304 | 184 | — | 24 | 184 | 1280 | 4699.6 | tool_calls |
| T15-S2 | ko-immediate-recapture | 2 | 48 | sse | 8192 | 2065 | 8192 | — | 17 | 8192 | 2048 | 95535.9 | length |
| T15-S3 | ko-immediate-recapture | 3 | 49 | sse | 8192 | 2070 | 4184 | — | 22 | 4184 | 2048 | 41560.9 | tool_calls |
| T15-S4 | ko-immediate-recapture | 4 | 50 | sse | 8192 | 2467 | 4611 | — | 419 | 4611 | 2048 | 43902.0 | tool_calls |
| T15-S5 | ko-immediate-recapture | 5 | 51 | sse | 8192 | 2714 | 8192 | — | 282 | 8192 | 2432 | 57114.4 | length |
| T15-S6 | ko-immediate-recapture | 6 | 52 | sse | 8192 | 2719 | 5613 | — | 31 | 5613 | 2688 | 55906.6 | tool_calls |
| T16-S1 | large-group-pressure | 1 | 53 | sse | 8192 | 1299 | 118 | — | 1299 | 118 | 0 | 3826.4 | tool_calls |
| T16-S2 | large-group-pressure | 2 | 54 | sse | 8192 | 1778 | 5310 | — | 498 | 5310 | 1280 | 48608.8 | tool_calls |
| T16-S3 | large-group-pressure | 3 | 55 | sse | 8192 | 2475 | 5744 | — | 811 | 5744 | 1664 | 52103.0 | tool_calls |
| T16-S4 | large-group-pressure | 4 | 56 | sse | 8192 | 2769 | 533 | — | 337 | 533 | 2432 | 7599.2 | tool_calls |
| T17-S1 | large-group-pressure | 1 | 57 | sse | 8192 | 1299 | 128 | — | 19 | 128 | 1280 | 6087.8 | tool_calls |
| T17-S2 | large-group-pressure | 2 | 58 | sse | 8192 | 2319 | 5401 | — | 1039 | 5401 | 1280 | 50689.6 | tool_calls |
| T17-S3 | large-group-pressure | 3 | 59 | sse | 8192 | 2752 | 3267 | — | 448 | 3267 | 2304 | 29257.0 | tool_calls |
| T18-S1 | large-group-pressure | 1 | 60 | sse | 8192 | 1299 | 111 | — | 19 | 111 | 1280 | 2818.2 | tool_calls |
| T18-S2 | large-group-pressure | 2 | 61 | sse | 8192 | 1778 | 418 | — | 114 | 418 | 1664 | 4929.2 | tool_calls |
| T18-S3 | large-group-pressure | 3 | 62 | sse | 8192 | 2808 | 519 | — | 1016 | 519 | 1792 | 8249.8 | tool_calls |
| T19-S1 | endgame-dame-fill | 1 | 63 | sse | 8192 | 1307 | 133 | — | 27 | 133 | 1280 | 3263.6 | tool_calls |
| T19-S2 | endgame-dame-fill | 2 | 64 | sse | 8192 | 2313 | 144 | — | 9 | 144 | 2304 | 3312.3 | tool_calls |
| T19-S3 | endgame-dame-fill | 3 | 65 | sse | 8192 | 2483 | 128 | — | 51 | 128 | 2432 | 4696.4 | tool_calls |
| T20-S1 | endgame-dame-fill | 1 | 66 | sse | 8192 | 1307 | 52 | — | 27 | 52 | 1280 | 3010.1 | tool_calls |
| T20-S2 | endgame-dame-fill | 2 | 67 | sse | 8192 | 1638 | 166 | — | 102 | 166 | 1536 | 2899.6 | tool_calls |
| T20-S3 | endgame-dame-fill | 3 | 68 | sse | 8192 | 2227 | 83 | — | 51 | 83 | 2176 | 3041.2 | tool_calls |
| T21-S1 | endgame-dame-fill | 1 | 69 | sse | 8192 | 1307 | 52 | — | 27 | 52 | 1280 | 3715.1 | tool_calls |
| T21-S2 | endgame-dame-fill | 2 | 70 | sse | 8192 | 1638 | 144 | — | 102 | 144 | 1536 | 7234.1 | tool_calls |
| T21-S3 | endgame-dame-fill | 3 | 71 | sse | 8192 | 1808 | 171 | — | 16 | 171 | 1792 | 4680.7 | tool_calls |
| T22-S1 | ambiguous-wide-board | 1 | 72 | sse | 8192 | 1302 | 59 | — | 1302 | 59 | 0 | 2989.8 | tool_calls |
| T22-S2 | ambiguous-wide-board | 2 | 73 | sse | 8192 | 1564 | 1167 | — | 284 | 1167 | 1280 | 17446.1 | tool_calls |
| T22-S3 | ambiguous-wide-board | 3 | 74 | sse | 8192 | 1852 | 240 | — | 316 | 240 | 1536 | 10128.8 | tool_calls |
| T23-S1 | ambiguous-wide-board | 1 | 75 | sse | 8192 | 1302 | 73 | — | 22 | 73 | 1280 | 6589.0 | tool_calls |
| T23-S2 | ambiguous-wide-board | 2 | 76 | sse | 8192 | 1564 | 334 | — | 28 | 334 | 1536 | 5142.8 | tool_calls |
| T23-S3 | ambiguous-wide-board | 3 | 77 | sse | 8192 | 2548 | 1250 | — | 1012 | 1250 | 1536 | 16375.5 | tool_calls |
| T23-S4 | ambiguous-wide-board | 4 | 78 | sse | 8192 | 2836 | 186 | — | 404 | 186 | 2432 | 5259.9 | tool_calls |
| T24-S1 | ambiguous-wide-board | 1 | 79 | sse | 8192 | 1302 | 62 | — | 22 | 62 | 1280 | 4212.7 | tool_calls |

## Per-turn totals

Turn totals are the sums of the request rows above. `input` excludes cache
reads; `total` is `input + output`.

| turn | fixture | class | outcome | requests | steps | input | output | cache read | total | latency ms | committed |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| T01 | opening-spread | opening | completed | 5 | 5 | 1227 | 10825 | 7552 | 12052 | 153934.2 | play |
| T02 | opening-spread | opening | failed | 3 | 0 | 867 | 4829 | 4224 | 5696 | 0 | — |
| T03 | opening-spread | opening | failed | 3 | 0 | 195 | 2851 | 5504 | 3046 | 0 | — |
| T04 | simple-capture-single-stone | simple capture | failed | 2 | 0 | 477 | 239 | 2560 | 716 | 0 | — |
| T05 | simple-capture-single-stone | simple capture | failed | 2 | 0 | 469 | 270 | 2688 | 739 | 0 | — |
| T06 | simple-capture-single-stone | simple capture | failed | 2 | 0 | 85 | 304 | 3072 | 389 | 0 | — |
| T07 | escape-from-atari | escape | failed | 3 | 0 | 620 | 583 | 4096 | 1203 | 0 | — |
| T08 | escape-from-atari | escape | failed | 3 | 0 | 187 | 982 | 5248 | 1169 | 0 | — |
| T09 | escape-from-atari | escape | failed | 3 | 0 | 59 | 467 | 5760 | 526 | 0 | — |
| T10 | local-fight-contact | local fight | failed | 4 | 0 | 423 | 16509 | 7552 | 16932 | 0 | — |
| T11 | local-fight-contact | local fight | failed | 5 | 0 | 739 | 24365 | 9472 | 25104 | 0 | — |
| T12 | local-fight-contact | local fight | failed | 3 | 0 | 507 | 7976 | 5376 | 8483 | 0 | — |
| T13 | ko-immediate-recapture | ko | failed | 4 | 0 | 600 | 19245 | 7936 | 19845 | 0 | — |
| T14 | ko-immediate-recapture | ko | failed | 4 | 0 | 1058 | 11906 | 7808 | 12964 | 0 | — |
| T15 | ko-immediate-recapture | ko | failed | 6 | 0 | 795 | 30976 | 12544 | 31771 | 0 | — |
| T16 | large-group-pressure | large-group pressure | failed | 4 | 0 | 2945 | 11705 | 5376 | 14650 | 0 | — |
| T17 | large-group-pressure | large-group pressure | failed | 3 | 0 | 1506 | 8796 | 4864 | 10302 | 0 | — |
| T18 | large-group-pressure | large-group pressure | failed | 3 | 0 | 1149 | 1048 | 4736 | 2197 | 0 | — |
| T19 | endgame-dame-fill | endgame | failed | 3 | 0 | 87 | 405 | 6016 | 492 | 0 | — |
| T20 | endgame-dame-fill | endgame | failed | 3 | 0 | 180 | 301 | 4992 | 481 | 0 | — |
| T21 | endgame-dame-fill | endgame | failed | 3 | 0 | 145 | 367 | 4608 | 512 | 0 | — |
| T22 | ambiguous-wide-board | ambiguous position | failed | 3 | 0 | 1902 | 1466 | 2816 | 3368 | 0 | — |
| T23 | ambiguous-wide-board | ambiguous position | failed | 4 | 0 | 1466 | 1843 | 6784 | 3309 | 0 | — |
| T24 | ambiguous-wide-board | ambiguous position | failed | 1 | 0 | 22 | 62 | 1280 | 84 | 0 | — |

## Distributions

Percentiles are nearest-rank order statistics over the rows above.

### Per completed turn (the unit a budget must cover)

| metric | n | mean | p50 | p95 | min | max |
|---|---:|---:|---:|---:|---:|---:|
| input tokens | 1 | 1227 | 1227 | 1227 | 1227 | 1227 |
| output tokens | 1 | 10825 | 10825 | 10825 | 10825 | 10825 |
| total tokens | 1 | 12052 | 12052 | 12052 | 12052 | 12052 |
| cache-read tokens | 1 | 7552 | 7552 | 7552 | 7552 | 7552 |
| latency ms | 1 | 153934.2 | 153934.2 | 153934.2 | 153934.2 | 153934.2 |
| requests | 1 | 5 | 5 | 5 | 5 | 5 |

### Per request

| metric | n | mean | p50 | p95 | min | max |
|---|---:|---:|---:|---:|---:|---:|
| input tokens | 79 | 224.18 | 51 | 1016 | 7 | 1302 |
| output tokens | 79 | 2004.05 | 334 | 8192 | 49 | 8192 |
| total tokens | 79 | 2228.23 | 590 | 8226 | 56 | 8725 |
| cache-read tokens | 79 | 1681.82 | 1536 | 2432 | 0 | 2688 |
| latency ms | 79 | 21737.7 | 5960.1 | 95078.8 | 1333.3 | 107884.3 |

### Failures, retries and finish reasons

- Failed turns: 23
- Budget stops: 0
- Recorded `retryAttempts`: 0 (failed-turn default, not an independent counter). Adapter-level policy is `maxRetries: 0` with one fetch per stream. T23's cumulative 78 matches the 78 settled rows through T23, and T24's 1 settled + 1 unsettled account for the remaining gate dispatches; no final T24 transport counter or HTTP-client-internal retry trace was recorded
- Failure kinds (recorded): run-failed × 23 — by `turns[].error`: 22 retry-guard false positives, 1 provider network error, 0 step exhaustion
- Finish reasons: length × 7, tool_calls × 72
- Reported model ids: `deepseek-v4.1-flash`

## Mechanically generated `GoTurnBudget` candidates (UNVALIDATED; NOT applied)

The candidate derivation uses the one turn still labelled completed, except
that the per-request ceiling uses all recorded requests. The completed label
set is polluted by the counting defect and failed-turn metrics contain
placeholders. These unchanged values describe the old algorithm's output;
they are not supported production recommendations. In particular the turn
candidate is below several failed-record usage totals. Fix the harness before
re-deriving or validating candidates. Production defaults in `src/` were not
changed by this ticket.

| field | observed basis | formula | candidate |
|---|---|---|---:|
| `perRequestMaxTokens` | largest output 8192 tokens/request; effective request ceiling 8192 (configured 16000) | max(512, request_ceiling × 2), rounded up to 64 (censoring branch; 1.5× would give 12288) | 16384 |
| `maxTurnTokens` | largest completed turn total 12052 tokens (failed turns excluded; e.g. T15 31771, T11 25104, T13 19845) | max(1024, ceil(max_turn_total × 1.5)), rounded up to 256 | 18176 |
| `maxModelSteps` | largest completed turn took 5 steps | max(3, observed + step-exhaustion headroom) | 5 |
| `maxInspectCalls` | largest 1 | max(4, observed + 1) | 4 |
| `maxTryMoves` | largest 1 | max(3, observed + 1) | 3 |

Safety margin: **1.5×** on `maxTurnTokens`. `perRequestMaxTokens` comes from
the censoring branch (2× the censored ceiling), not from the 1.5× margin. The
margin covers the same position being inspected with slightly different
arguments; it is not a probability claim about the tail.

### Warnings

- At least one response hit its `max_tokens` ceiling or finished with `length`; per-request output measurements are censored. The candidate doubles the observed ceiling and the run must be repeated with the higher cap before a production default is frozen. In this run the effective ceiling was 8192; the configured 16000 was never requested.
- 23 turn(s) failed; failed turns are excluded from the per-turn distributions but their requests remain in the session totals.
- Only 1 completed turns; the P95 is a small-sample order statistic, not a tail estimate.

## Caveats

- This run used the official OpenCode Go chat-completions entry
  (`https://opencode.ai/inference/go/openai/v1`), not the ordinary Zen entry.
  Token counts are the endpoint's counts; if production calls the official
  DeepSeek API directly, prices and cache behaviour must be converted from
  the official price page before freezing a cost model.
- The price schedule is a conservative accounting assumption taken from the
  `/models` listing observed on 2026-11-06 (input $0.30/M, output $1.20/M,
  cache read $0.006/M). It is not an official Go/DeepSeek quote and not the
  final bill.
- The smoke and full caps are separate processes: smoke ¥0.5, full ¥6.16,
  together inside the approved ¥6.66 round envelope. A released reservation
  stays in the session snapshot as unsettled spend instead of becoming zero.
- The configured C-S01 per-request cap and session-gate output cap were
  16000, but the actual requested ceiling was 8192. The harness always proposes
  8192 (`tests/benchmark/harness.ts:361`, `tests/benchmark/scripted-model.ts:15`)
  and `tests/benchmark/budget-gate.ts:534` only clamps down, so no request asked
  for more than 8192. Responses that reached 8192 are censored; see the warnings.
- Known renderer limitation: the raw cache-hit column reads only
  `prompt_cache_hit_tokens`, so its 79 `—` entries do not mean zero cache
  usage. All 79 raw records contain `prompt_tokens_details.cached_tokens`;
  mapped cache-read usage is reported separately. The renderer fix is deferred.
- The sample is 8 fixed §38 positions × 3 runs. It measures this harness's
  prompt and tool surface, not the full distribution of production games.
- The benchmark gate's price schedule is a conservative accounting input,
  not a quote. Estimated spend is derived from reported usage at those prices.
- No API key, authorization header or environment file content is recorded in
  this report or the raw dataset.

