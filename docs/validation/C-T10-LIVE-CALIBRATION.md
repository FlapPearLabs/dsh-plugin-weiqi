# C-T10 live calibration — real model token and latency record

- Ticket: WAVE-C-T10 (Spec §22 budget, §38 cognition benchmark)
- Status: **measured against the live endpoint** (no scripted stand-in)
- Generated at (UTC): 2026-11-09T07:50:20.658Z
- Endpoint: `https://opencode.ai/inference/go/openai/v1/chat/completions`
- Model: `deepseek-v4.1-flash`
- Raw dataset: `docs/validation/C-T10-LIVE-CALIBRATION-RAW.json`
- Runner: `tests/benchmark/run-live-calibration.sh full`
- Report renderer: `C_T10_RENDER_REPORT=1 pnpm exec vitest run tests/benchmark/render-live-calibration.test.ts`
- Price schedule used for the spend gate (USD per million tokens): input 0.3, output 1.2, cache read 0.006
- Session gate: 120 requests, 8000 input tokens/request, 16000 output tokens/request, ¥6.16 at ¥7.1/USD
- Turn enforcement during measurement: maxModelSteps 10 (+1 §23 boost), maxInspectCalls 8, maxTryMoves 6, perRequestMaxTokens 16000, maxTurnTokens 128000. These are measurement limits, not the candidate under calibration; the candidate is derived below.

## What ran

Each turn is one §38 fixture position and is one complete DeepSeek move
decision: the harness builds the position on the real Tenuki `GoRulesPort`,
registers the real eight `go.*` tools behind `GoCapabilityGuard`, drives
`createGoTurnEnforcement` (C-T07/C-T08) and the `agent/request` cap (C-S01),
and sends each model step through the real pinned `@deepseek-ai/dsh-llm`
runtime to `LiveBenchmarkProvider` (single HTTP attempt, no retries).

Per-request `usage` below is the provider's own object, recorded verbatim.
The mapped input is `prompt_tokens - cached prompt tokens`, read from
`prompt_tokens_details.cached_tokens` on this entry (or
`prompt_cache_hit_tokens` elsewhere), and the mapped
output is `completion_tokens`, matching the disjoint fields DSH charges; the
turn budget charges mapped input + output, so cache reads are reported
separately and are not folded into the turn total.

Requests: **81 settled** of **81 dispatched** (0 unsettled, counted against the session cap) across **24** turns (23 completed, 1 failed, 0 budget stops), **0** retries (1 turn(s) recorded no retry statistic).
Wall clock: **1723.7 s**. Gate-estimated spend: **$0.246911** (¥1.7531 at ¥7.1/USD).
Unsettled reservations (dispatched without usage, counted against the cap): **0** request(s), $0 (¥0).

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
| T01-S1 | opening-spread | 1 | 1 | sse | 16000 | 1287 | 164 | 0 | 1287 | 164 | 0 | 3572.0 | tool_calls |
| T01-S2 | opening-spread | 2 | 2 | sse | 16000 | 2387 | 2658 | 1280 | 1107 | 2658 | 1280 | 25230.4 | tool_calls |
| T01-S3 | opening-spread | 3 | 3 | sse | 16000 | 2692 | 857 | 2304 | 388 | 857 | 2304 | 10253.8 | tool_calls |
| T02-S1 | opening-spread | 1 | 4 | sse | 16000 | 1287 | 57 | 1280 | 7 | 57 | 1280 | 2660.7 | tool_calls |
| T02-S2 | opening-spread | 2 | 5 | sse | 16000 | 1515 | 3857 | 1280 | 235 | 3857 | 1280 | 36095.0 | tool_calls |
| T02-S3 | opening-spread | 3 | 6 | sse | 16000 | 2537 | 430 | 0 | 2537 | 430 | 0 | 6626.0 | tool_calls |
| T02-S4 | opening-spread | 4 | 7 | sse | 16000 | 2687 | 1343 | 2432 | 255 | 1343 | 2432 | 10834.9 | tool_calls |
| T03-S1 | opening-spread | 1 | 8 | sse | 16000 | 1287 | 62 | 1280 | 7 | 62 | 1280 | 2089.0 | tool_calls |
| T03-S2 | opening-spread | 2 | 9 | sse | 16000 | 1515 | 14031 | 1408 | 107 | 14031 | 1408 | 109922.7 | tool_calls |
| T03-S3 | opening-spread | 3 | 10 | sse | 16000 | 2537 | 1947 | 1536 | 1001 | 1947 | 1536 | 19044.2 | tool_calls |
| T03-S4 | opening-spread | 4 | 11 | sse | 16000 | 2823 | 1508 | 2432 | 391 | 1508 | 2432 | 15656.5 | tool_calls |
| T04-S1 | simple-capture-single-stone | 1 | 12 | sse | 16000 | 1303 | 131 | 1152 | 151 | 131 | 1152 | 2197.8 | tool_calls |
| T04-S2 | simple-capture-single-stone | 2 | 13 | sse | 16000 | 1734 | 219 | 1280 | 454 | 219 | 1280 | 1858.1 | tool_calls |
| T05-S1 | simple-capture-single-stone | 1 | 14 | sse | 16000 | 1303 | 199 | 1280 | 23 | 199 | 1280 | 2045.5 | tool_calls |
| T05-S2 | simple-capture-single-stone | 2 | 15 | sse | 16000 | 1854 | 99 | 1280 | 574 | 99 | 1280 | 1664.1 | tool_calls |
| T06-S1 | simple-capture-single-stone | 1 | 16 | sse | 16000 | 1303 | 146 | 1280 | 23 | 146 | 1280 | 1502.8 | tool_calls |
| T06-S2 | simple-capture-single-stone | 2 | 17 | sse | 16000 | 1734 | 89 | 1664 | 70 | 89 | 1664 | 1823.2 | tool_calls |
| T07-S1 | escape-from-atari | 1 | 18 | sse | 16000 | 1309 | 131 | 0 | 1309 | 131 | 0 | 1917.5 | tool_calls |
| T07-S2 | escape-from-atari | 2 | 19 | sse | 16000 | 1991 | 286 | 1280 | 711 | 286 | 1280 | 3113.3 | tool_calls |
| T07-S3 | escape-from-atari | 3 | 20 | sse | 16000 | 2135 | 191 | 1920 | 215 | 191 | 1920 | 3338.0 | tool_calls |
| T08-S1 | escape-from-atari | 1 | 21 | sse | 16000 | 1309 | 115 | 1280 | 29 | 115 | 1280 | 2964.8 | tool_calls |
| T08-S2 | escape-from-atari | 2 | 22 | sse | 16000 | 1690 | 216 | 1280 | 410 | 216 | 1280 | 2849.0 | tool_calls |
| T08-S3 | escape-from-atari | 3 | 23 | sse | 16000 | 2252 | 147 | 1664 | 588 | 147 | 1664 | 2379.5 | tool_calls |
| T09-S1 | escape-from-atari | 1 | 24 | sse | 16000 | 1309 | 117 | 1280 | 29 | 117 | 1280 | 2404.3 | tool_calls |
| T09-S2 | escape-from-atari | 2 | 25 | sse | 16000 | 1690 | 88 | 1664 | 26 | 88 | 1664 | 2330.3 | tool_calls |
| T09-S3 | escape-from-atari | 3 | 26 | sse | 16000 | 1834 | 85 | 1664 | 170 | 85 | 1664 | 2761.4 | tool_calls |
| T10-S1 | local-fight-contact | 1 | 27 | sse | 16000 | 1299 | 130 | 0 | 1299 | 130 | 0 | 2141.1 | tool_calls |
| T10-S2 | local-fight-contact | 2 | 28 | sse | 16000 | 2186 | 1853 | 1280 | 906 | 1853 | 1280 | 13382.7 | tool_calls |
| T10-S3 | local-fight-contact | 3 | 29 | sse | 16000 | 2754 | 8164 | 2176 | 578 | 8164 | 2176 | 61688.6 | tool_calls |
| T10-S4 | local-fight-contact | 4 | 30 | sse | 16000 | 3034 | 2693 | 2688 | 346 | 2693 | 2688 | 24506.2 | tool_calls |
| T11-S1 | local-fight-contact | 1 | 31 | sse | 16000 | 1299 | 130 | 1280 | 19 | 130 | 1280 | 2573.4 | tool_calls |
| T11-S2 | local-fight-contact | 2 | 32 | sse | 16000 | 2082 | 8765 | 1408 | 674 | 8765 | 1408 | 63925.1 | tool_calls |
| T11-S3 | local-fight-contact | 3 | 33 | sse | 16000 | 2378 | 4352 | 2048 | 330 | 4352 | 2048 | 33284.5 | tool_calls |
| T12-S1 | local-fight-contact | 1 | 34 | sse | 16000 | 1299 | 130 | 1280 | 19 | 130 | 1280 | 2746.9 | tool_calls |
| T12-S2 | local-fight-contact | 2 | 35 | sse | 16000 | 2186 | 10254 | 2176 | 10 | 10254 | 2176 | 77233.2 | tool_calls |
| T12-S3 | local-fight-contact | 3 | 36 | sse | 16000 | 2735 | 4778 | 2176 | 559 | 4778 | 2176 | 37307.3 | tool_calls |
| T13-S1 | ko-immediate-recapture | 1 | 37 | sse | 16000 | 1304 | 135 | 0 | 1304 | 135 | 0 | 3763.4 | tool_calls |
| T13-S2 | ko-immediate-recapture | 2 | 38 | sse | 16000 | 2065 | 7286 | 1280 | 785 | 7286 | 1280 | 50977.8 | tool_calls |
| T13-S3 | ko-immediate-recapture | 3 | 39 | sse | 16000 | 2610 | 7904 | 2048 | 562 | 7904 | 2048 | 54245.7 | tool_calls |
| T13-S4 | ko-immediate-recapture | 4 | 40 | sse | 16000 | 2876 | 6208 | 2560 | 316 | 6208 | 2560 | 55044.2 | tool_calls |
| T13-S5 | ko-immediate-recapture | 5 | 41 | sse | 16000 | 3031 | 3859 | 2816 | 215 | 3859 | 2816 | 28881.7 | tool_calls |
| T13-S6 | ko-immediate-recapture | 6 | 42 | sse | 16000 | 3165 | 4052 | 2944 | 221 | 4052 | 2944 | 30740.2 | tool_calls |
| T13-S7 | ko-immediate-recapture | 7 | 43 | sse | 16000 | 3431 | 9403 | 3072 | 359 | 9403 | 3072 | 73491.4 | tool_calls |
| T14-S1 | ko-immediate-recapture | 1 | 44 | sse | 16000 | 1304 | 135 | 1280 | 24 | 135 | 1280 | 5285.1 | tool_calls |
| T14-S2 | ko-immediate-recapture | 2 | 45 | sse | 16000 | 1985 | 8436 | 1280 | 705 | 8436 | 1280 | 63788.8 | tool_calls |
| T14-S3 | ko-immediate-recapture | 3 | 46 | sse | 16000 | 2259 | 5833 | 1920 | 339 | 5833 | 1920 | 43617.8 | tool_calls |
| T14-S4 | ko-immediate-recapture | 4 | 47 | sse | 16000 | 2553 | 6436 | 2176 | 377 | 6436 | 2176 | 54023.1 | tool_calls |
| T15-S1 | ko-immediate-recapture | 1 | 48 | sse | 16000 | 1304 | 213 | 1280 | 24 | 213 | 1280 | 4705.0 | tool_calls |
| T15-S2 | ko-immediate-recapture | 2 | 49 | sse | 16000 | 2184 | 16000 | 1280 | 904 | 16000 | 1280 | 124122.4 | length |
| T15-S3 | ko-immediate-recapture | 3 | 50 | sse | 16000 | 2189 | 16000 | 2176 | 13 | 16000 | 2176 | 189699.6 | length |
| T15-S4 | ko-immediate-recapture | 4 | 51 | sse | 16000 | 2194 | 8102 | 2176 | 18 | 8102 | 2176 | 72945.8 | tool_calls |
| T15-S5 | ko-immediate-recapture | 5 | 52 | sse | 16000 | 2726 | 10916 | 2176 | 550 | 10916 | 2176 | 95329.0 | tool_calls |
| T16-S1 | large-group-pressure | 1 | 53 | sse | 16000 | 1299 | 127 | 0 | 1299 | 127 | 0 | 5592.1 | tool_calls |
| T16-S2 | large-group-pressure | 2 | 54 | sse | 16000 | 1778 | 272 | 1280 | 498 | 272 | 1280 | 6137.6 | tool_calls |
| T16-S3 | large-group-pressure | 3 | 55 | sse | 16000 | 2560 | 1853 | 1664 | 896 | 1853 | 1664 | 15069.6 | tool_calls |
| T16-S4 | large-group-pressure | 4 | 56 | sse | 16000 | 2854 | 427 | 2432 | 422 | 427 | 2432 | 5557.5 | tool_calls |
| T17-S1 | large-group-pressure | 1 | 57 | sse | 16000 | 1299 | 113 | 1280 | 19 | 113 | 1280 | 3903.6 | tool_calls |
| T17-S2 | large-group-pressure | 2 | 58 | sse | 16000 | 1778 | 441 | 1664 | 114 | 441 | 1664 | 3612.5 | tool_calls |
| T17-S3 | large-group-pressure | 3 | 59 | sse | 16000 | 2808 | 1629 | 1792 | 1016 | 1629 | 1792 | 12822.6 | tool_calls |
| T18-S1 | large-group-pressure | 1 | 60 | sse | 16000 | 1299 | 130 | 1280 | 19 | 130 | 1280 | 4908.2 | tool_calls |
| T18-S2 | large-group-pressure | 2 | 61 | sse | 16000 | 2167 | 2564 | 1280 | 887 | 2564 | 1280 | 19116.4 | tool_calls |
| T18-S3 | large-group-pressure | 3 | 62 | sse | 16000 | 2597 | 1486 | 2048 | 549 | 1486 | 2048 | 14039.9 | tool_calls |
| T19-S1 | endgame-dame-fill | 1 | 63 | sse | 16000 | 1307 | 52 | 0 | 1307 | 52 | 0 | 2467.5 | tool_calls |
| T19-S2 | endgame-dame-fill | 2 | 64 | sse | 16000 | 1638 | 245 | 1280 | 358 | 245 | 1280 | 3685.2 | tool_calls |
| T19-S3 | endgame-dame-fill | 3 | 65 | sse | 16000 | 1808 | 101 | 1536 | 272 | 101 | 1536 | 2188.4 | tool_calls |
| T20-S1 | endgame-dame-fill | 1 | 66 | sse | 16000 | 1307 | 133 | 1280 | 27 | 133 | 1280 | 3910.6 | tool_calls |
| T20-S2 | endgame-dame-fill | 2 | 67 | sse | 16000 | 2497 | 176 | 1280 | 1217 | 176 | 1280 | 3173.0 | tool_calls |
| T20-S3 | endgame-dame-fill | 3 | 68 | sse | 16000 | 2667 | 86 | 2432 | 235 | 86 | 2432 | 2624.4 | tool_calls |
| T21-S1 | endgame-dame-fill | 1 | 69 | sse | 16000 | 1307 | 52 | 1280 | 27 | 52 | 1280 | 2041.1 | tool_calls |
| T21-S2 | endgame-dame-fill | 2 | 70 | sse | 16000 | 1638 | 174 | 1536 | 102 | 174 | 1536 | 2108.2 | tool_calls |
| T21-S3 | endgame-dame-fill | 3 | 71 | sse | 16000 | 2227 | 94 | 1536 | 691 | 94 | 1536 | 2524.9 | tool_calls |
| T22-S1 | ambiguous-wide-board | 1 | 72 | sse | 16000 | 1302 | 130 | 1152 | 150 | 130 | 1152 | 4512.0 | tool_calls |
| T22-S2 | ambiguous-wide-board | 2 | 73 | sse | 16000 | 2533 | 1055 | 1280 | 1253 | 1055 | 1280 | 20134.2 | tool_calls |
| T22-S3 | ambiguous-wide-board | 3 | 74 | sse | 16000 | 2837 | 864 | 2432 | 405 | 864 | 2432 | 11652.1 | tool_calls |
| T23-S1 | ambiguous-wide-board | 1 | 75 | sse | 16000 | 1302 | 66 | 1280 | 22 | 66 | 1280 | 4871.9 | tool_calls |
| T23-S2 | ambiguous-wide-board | 2 | 76 | sse | 16000 | 1564 | 610 | 1280 | 284 | 610 | 1280 | 6940.5 | tool_calls |
| T23-S3 | ambiguous-wide-board | 3 | 77 | sse | 16000 | 2252 | 94 | 1536 | 716 | 94 | 1536 | 1695.6 | tool_calls |
| T24-S1 | ambiguous-wide-board | 1 | 78 | sse | 16000 | 1302 | 52 | 1280 | 22 | 52 | 1280 | 840.7 | tool_calls |
| T24-S2 | ambiguous-wide-board | 2 | 79 | sse | 16000 | 1564 | 326 | 1536 | 28 | 326 | 1536 | 2329.2 | tool_calls |
| T24-S3 | ambiguous-wide-board | 3 | 80 | sse | 16000 | 2687 | 747 | 1536 | 1151 | 747 | 1536 | 5711.2 | tool_calls |
| T24-S4 | ambiguous-wide-board | 4 | 81 | sse | 16000 | 2975 | 205 | 2560 | 415 | 205 | 2560 | 2666.9 | tool_calls |

## Per-turn totals

Turn totals are the sums of the request rows above. `input` excludes cache
reads; `total` is `input + output`.

| turn | fixture | class | outcome | requests | steps | input | output | cache read | total | latency ms | committed |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| T01 | opening-spread | opening | completed | 3 | 3 | 2782 | 3679 | 3584 | 6461 | 39083.6 | play |
| T02 | opening-spread | opening | completed | 4 | 4 | 3034 | 5687 | 4992 | 8721 | 56227.2 | play |
| T03 | opening-spread | opening | completed | 4 | 4 | 1506 | 17548 | 6656 | 19054 | 146720.5 | play |
| T04 | simple-capture-single-stone | simple capture | completed | 2 | 2 | 605 | 350 | 2432 | 955 | 4060.8 | play |
| T05 | simple-capture-single-stone | simple capture | completed | 2 | 2 | 597 | 298 | 2560 | 895 | 3714.4 | play |
| T06 | simple-capture-single-stone | simple capture | completed | 2 | 2 | 93 | 235 | 2944 | 328 | 3329.8 | play |
| T07 | escape-from-atari | escape | completed | 3 | 3 | 2235 | 608 | 3200 | 2843 | 8375.2 | play |
| T08 | escape-from-atari | escape | completed | 3 | 3 | 1027 | 478 | 4224 | 1505 | 8199.4 | play |
| T09 | escape-from-atari | escape | completed | 3 | 3 | 225 | 290 | 4608 | 515 | 7502.1 | play |
| T10 | local-fight-contact | local fight | completed | 4 | 4 | 3129 | 12840 | 6144 | 15969 | 101729.4 | play |
| T11 | local-fight-contact | local fight | completed | 3 | 3 | 1023 | 13247 | 4736 | 14270 | 99790.6 | play |
| T12 | local-fight-contact | local fight | completed | 3 | 3 | 588 | 15162 | 5632 | 15750 | 117293.8 | play |
| T13 | ko-immediate-recapture | ko | failed | 7 | 0 | 3762 | 38847 | 14720 | 42609 | 0 | — |
| T14 | ko-immediate-recapture | ko | completed | 4 | 4 | 1445 | 20840 | 6656 | 22285 | 166725.9 | play |
| T15 | ko-immediate-recapture | ko | completed | 5 | 5 | 1509 | 51231 | 9088 | 52740 | 486814.6 | play |
| T16 | large-group-pressure | large-group pressure | completed | 4 | 4 | 3115 | 2679 | 5376 | 5794 | 32365.6 | play |
| T17 | large-group-pressure | large-group pressure | completed | 3 | 3 | 1149 | 2183 | 4736 | 3332 | 20344.8 | play |
| T18 | large-group-pressure | large-group pressure | completed | 3 | 3 | 1455 | 4180 | 4608 | 5635 | 38070.9 | play |
| T19 | endgame-dame-fill | endgame | completed | 3 | 3 | 1937 | 398 | 2816 | 2335 | 8347.4 | play |
| T20 | endgame-dame-fill | endgame | completed | 3 | 3 | 1479 | 395 | 4992 | 1874 | 9713.9 | play |
| T21 | endgame-dame-fill | endgame | completed | 3 | 3 | 820 | 320 | 4352 | 1140 | 6679.3 | play |
| T22 | ambiguous-wide-board | ambiguous position | completed | 3 | 3 | 1808 | 2049 | 4864 | 3857 | 36304.0 | play |
| T23 | ambiguous-wide-board | ambiguous position | completed | 3 | 3 | 1022 | 770 | 4096 | 1792 | 13514.8 | play |
| T24 | ambiguous-wide-board | ambiguous position | completed | 4 | 4 | 1616 | 1330 | 6912 | 2946 | 11557.0 | play |

## Distributions

Percentiles are nearest-rank order statistics over the rows above.

### Per completed turn (the unit a budget must cover)

| metric | n | mean | p50 | p95 | min | max |
|---|---:|---:|---:|---:|---:|---:|
| input tokens | 23 | 1486.91 | 1455 | 3115 | 93 | 3129 |
| output tokens | 23 | 6817.26 | 2049 | 20840 | 235 | 51231 |
| total tokens | 23 | 8304.17 | 3332 | 22285 | 328 | 52740 |
| cache-read tokens | 23 | 4791.65 | 4736 | 6912 | 2432 | 9088 |
| latency ms | 23 | 62020.2 | 20344.8 | 166725.9 | 3329.8 | 486814.6 |
| requests | 23 | 3.22 | 3 | 4 | 2 | 5 |

### Per request

| metric | n | mean | p50 | p95 | min | max |
|---|---:|---:|---:|---:|---:|---:|
| input tokens | 81 | 468.65 | 358 | 1299 | 7 | 2537 |
| output tokens | 81 | 2415.36 | 272 | 10254 | 52 | 16000 |
| total tokens | 81 | 2884.01 | 1269 | 10264 | 64 | 16904 |
| cache-read tokens | 81 | 1542.32 | 1280 | 2560 | 0 | 3072 |
| latency ms | 81 | 21276.8 | 4908.2 | 77233.2 | 840.7 | 189699.6 |

### Failures, retries and finish reasons

- Failed turns: 1
- Budget stops: 0
- Retry attempts: 0 (1 turn(s) recorded no retry statistic)
- Failure kinds: run-failed × 1
- Failed turn causes (from `error`): budget exhausted: maxTryMoves × 1
- Finish reasons: length × 2, tool_calls × 79
- Reported model ids: `deepseek-v4.1-flash`

## Suggested `GoTurnBudget` values (NOT applied)

The recommendation is derived from the completed turns above. Production
defaults in `src/` were not changed by this ticket; the candidate must pass
independent review before it is frozen.

| field | observed basis | formula | candidate |
|---|---|---|---:|
| `perRequestMaxTokens` | largest output 16000 tokens/request; request ceiling 16000 | max(max_request_ceiling × 2, max_output × 2), rounded up to 64 | 32000 |
| `maxTurnTokens` | largest turn total 52740 tokens | max(1024, ceil(max_turn_total × 1.5)), rounded up to 256 | 79360 |
| `maxModelSteps` | largest observed 7 steps (T13 has no step record; its 7 requests are one step each) | max(3, observed + headroom), headroom 1 for a step exhaustion or a failed-turn maximum | 8 |
| `maxInspectCalls` | largest 4 | max(4, observed + 1) | 5 |
| `maxTryMoves` | largest 4 | max(3, observed + 1), at least the exhausted ceiling 6 + 1 | 7 |

Safety margin: **2×** on `perRequestMaxTokens` and **1.5×** on `maxTurnTokens`. It
covers the same position being inspected with slightly different arguments;
it is not a probability claim about the tail.

### Warnings

- At least one response hit its `max_tokens` ceiling or finished with `length`; per-request output measurements are censored. The candidate doubles the observed ceiling and the run must be repeated with the higher cap before a production default is frozen.
- `maxTryMoves` was exhausted at its 6/6 ceiling; the observed value is censored by that ceiling and the field must be re-measured with a higher limit.
- 1 turn(s) failed; failed turns are excluded from the per-turn distributions but their requests remain in the session totals.

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
- The per-request output ceiling was the C-S01 clamp in force during the run.
  Any response that reached it is censored; see the warnings above.
- The sample is 8 fixed §38 positions × 3 runs. It measures this harness's
  prompt and tool surface, not the full distribution of production games.
- The benchmark gate's price schedule is a conservative accounting input,
  not a quote. Estimated spend is derived from reported usage at those prices.
- No API key, authorization header or environment file content is recorded in
  this report or the raw dataset.

