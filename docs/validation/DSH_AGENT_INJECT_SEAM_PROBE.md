# Pinned DSH `agent.inject()` fallback behavior record

Status: **FAIL — `agent.inject()` does not satisfy latest-only delivery**

Still current: R2.4.3 §9.1 (PR #113, 2026-11-06) states explicitly that
`agent.inject()` is not a Bridge delivery seam. Its remaining allowance for
non-Bridge one-shot sourced context is unaffected by this record.

Issue: WAVE-D-S01 / #28

Pinned DSH: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Pinned package line: `0.1.1-rc.2` (agent / agent-loop / llm / session /
system-prompt / scope / tools)

Runtime used for the recorded execution: local Node `v26.10.0` against the
exact pinned checkout. The pinned gate runner enforces Node `v24.11.1` and
pnpm `11.7.0`; the recorded run bypassed only that version-equality preflight
(DSH `engines` accepts `^22.19.0 || >=24.0.0`). CI remains the authoritative
toolchain; see "Execution basis" for the exact divergence.

## Corrected conclusion

`agent.inject()` exists on the public `Agent`, but it is **not** a viable
fallback for the frozen Bridge delivery contract:

- `Agent.inject(message: UserMessage): void` stages a durable user-role
  message in the `next-step` inbox and does not wake an idle driver.
- The next natural request claims it once, in the same pre-step as the waking
  prompt, without an extra model step.
- When the held value changes from `A0` to `B1`, the next natural request
  contains both `WORK_SNAPSHOT=A0` and `WORK_SNAPSHOT=B1`. The earlier
  snapshot is already durable `user/message` history and is never replaced.
- Several injections before one request are not coalesced: all of them are
  delivered. Re-injecting an unchanged value re-materializes it every time
  (no value-level dedup).
- Pending injections can be removed through the public `agent.inbox`, but a
  claimed message cannot be removed from durable history.
- Injecting while a turn is running can force an extra model step (and thus
  an extra model request) inside that same turn.
- 20 rapid idle injections wake nothing, but the next natural request carries
  all 20 snapshots, not only the newest.

This reproduces the same §39.6 failure as `ctx.systemPrompt.context`: durable
model-facing history grows per changed value, so the next natural request
never sees only the newest snapshot. `agent.inject()` is no better than the
rejected context seam for the frozen Bridge delivery acceptance.

## Execution basis

`tests/upgrade-gates/agent-inject/agent-inject.spec.ts` is self-contained and
is copied unchanged into `packages/core/agent-loop/tests/` of the pinned DSH
checkout, next to the pinned `mock-adapter.ts`. It exercises the real pinned
`agent-loop`, `agent`, `system-prompt`, `session`, `llm`, `tools`, and `scope`
implementations. No production code, Bridge code, DSH patch, or frozen
document is touched.

Reproducible gate command (requires the pinned Node and pnpm versions):

```sh
DSH_PINNED_ROOT=/path/to/pinned-deepseek-harness \
TRACE_LOG=/tmp/agent-inject-trace.log \
bash tests/upgrade-gates/agent-inject/run-agent-inject.sh
```

The runner is fail-closed on the plugin-repository DSH pins (the same
`0.1.1-rc.2` peer + dev equality check as the `system-prompt-context` gate),
the pinned checkout commit, and the pinned package line.

For this record the same fixture copy and vitest invocation were executed
directly against the pinned checkout, bypassing only the runner's Node
version-equality check because Node `v24.11.1` was not installed on the
recording host:

```sh
cp tests/upgrade-gates/agent-inject/agent-inject.spec.ts \
   "$DSH_PINNED_ROOT/packages/core/agent-loop/tests/agent-inject.spike.spec.ts"
cd "$DSH_PINNED_ROOT"
./node_modules/.bin/vitest run --no-file-parallelism --reporter=verbose \
   packages/core/agent-loop/tests/agent-inject.spike.spec.ts
```

Observed toolchain and checkout:

```text
node --version            -> v26.10.0
git rev-parse HEAD        -> b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
vitest                    -> 4.1.8
```

The copied fixture was removed after the run; the pinned checkout reported a
clean `git status --porcelain` afterwards.

## Exact API observed at runtime

```text
typeof agent.inject        -> "function"
agent.inject.length        -> 1
"inbox" in agent           -> true
```

The public declaration is:

```ts
inject(message: UserMessage): void
```

Source corroboration (not the verdict basis): `Agent.inject()` calls
`send(input, 'next-step', false)` in `packages/core/agent-loop/src/agent.ts`;
`Inbox.claim()` consumes the complete `next-step` batch before at most one
`next-turn` message.

## Probe design

- `A` proves the API shape, public `inbox`, idle no-wake staging, and that an
  injection is not durable until claimed.
- `B` proves one idle injection reaches the next natural request exactly once
  in the same single step.
- `C` is the decisive latest-only check across two natural turns: `A0`,
  request, idle update to `B1`, request. It records both snapshots on the
  second model-facing request.
- `D` proves multiple pending injections are not coalesced by value.
- `E` proves an unchanged value injected three times is materialized three
  times.
- `F` proves a mid-turn injection forces a second model step in the same turn.
- `G` proves pending removal works before claim, and that a claimed message
  cannot be removed from durable history.
- `H` mirrors the D-T03 smoke shape: 20 rapid idle updates, zero requests and
  turns before the natural request, then all 20 messages in that request.

## Raw executed trace

```text
DSH_INJECT_PROBE A-api-and-idle-no-wake {"isFunction":true,"declaredArity":1,"inboxIsPublic":true,"statusBefore":"idle","statusAfterInject":"idle","requestsAfterInject":0,"turnsAfterInject":0,"stepsAfterInject":0,"durableUserMessagesAfterInject":0,"pendingNextStepIds":["e3f30c21-4117-4fc8-ad9c-08eef029a21b"],"pendingNextTurnIds":[],"stagedMessageId":"e3f30c21-4117-4fc8-ad9c-08eef029a21b","lastDurableEventType":"agent/inbox/spliced"}
DSH_INJECT_PROBE B-initial-injection-single-step {"requests":1,"turns":1,"steps":1,"durable":["WORK_SNAPSHOT=A0"],"requestOneMarkerCount":1,"requestOneTexts":["WORK_SNAPSHOT=A0","start"]}
DSH_INJECT_PROBE C-latest-only-fails-durable-accumulation {"requests":2,"turns":2,"steps":2,"durable":["WORK_SNAPSHOT=A0","WORK_SNAPSHOT=B1"],"requestTwoA0Count":1,"requestTwoB1Count":1,"requestTwoTexts":["WORK_SNAPSHOT=A0","start","ack-1","WORK_SNAPSHOT=B1","next"]}
DSH_INJECT_PROBE D-pending-injections-not-coalesced {"requests":1,"steps":1,"durable":["WORK_SNAPSHOT=A0","WORK_SNAPSHOT=B1"],"requestA0Count":1,"requestB1Count":1}
DSH_INJECT_PROBE E-unchanged-value-rematerialized {"requests":1,"durable":["WORK_SNAPSHOT=A0","WORK_SNAPSHOT=A0","WORK_SNAPSHOT=A0"],"requestA0Count":3}
DSH_INJECT_PROBE F-mid-turn-injection-extra-step {"requests":2,"turns":1,"steps":2,"requestOneHasN1":0,"requestTwoHasN1":1,"durableNotices":["GAME_NOTICE=N1"]}
DSH_INJECT_PROBE G-pending-removal-vs-durable-history {"removedWhilePending":true,"removedAfterClaim":false,"requestOneA0Count":0,"requestOneB1Count":1,"requestTwoB1Count":1,"durable":["WORK_SNAPSHOT=B1"]}
DSH_INJECT_PROBE H-dt03-smoke-zero-wake-but-unbounded-delivery {"beforeNatural":{"status":"idle","requests":0,"turns":0,"steps":0,"pending":20},"requestsAfter":1,"turnsAfter":1,"stepsAfter":1,"durableNoticeCount":20,"requestNoticeCount":20,"requestHasNewest":1,"requestHasOldest":1}
```

```text
Test Files  1 passed (1)
     Tests  8 passed (8)
  Duration  399ms
```

A passing suite means the observed pinned behavior is reproducibly
established, not that the behavior satisfies latest-only delivery.

## Spike-question answers

| Question | Executable answer | Full-contract consequence |
|---|---|---|
| Does `agent.inject` exist on pinned DSH? | Yes: `Agent.inject(message: UserMessage): void`, public | Exists, but shape is append-only |
| API shape / placement | Stages a durable user-role message in the `next-step` inbox; no wake | Passive staging only |
| Idle inject wakes the driver? | No (`A`, `H`: 0 requests / 0 turns) | Satisfies no-Bridge-only-wake |
| Next request after one idle inject | Sees `A0` exactly once, same single step | Correct for one-shot context |
| Next request after `A0` then `B1` | Sees both `A0` and `B1` (`C`) | **Violates §39.6 latest-only** |
| Multiple pending injections | Not coalesced; all delivered (`D`) | Unbounded per update |
| Unchanged value repeated | Materialized on every inject (`E`) | **Violates no repeated prompt material** |
| Extra model step / message | No extra step for idle inject; mid-turn inject forces an extra step (`F`) | Can add model requests |
| Pending coalescing | Possible via public `agent.inbox.remove/replace` before claim (`G`) | Cannot undo claimed history |
| 20 rapid updates | Zero wake; all 20 land in the next request (`H`) | Unbounded delivery |
| Can it serve as the frozen delivery fallback? | **No** | Same failure mode as `ctx.systemPrompt.context` |

## Impact on WAVE-D-T03

WAVE-D-T03 requires, per §39.6, that the next natural Work request sees only
the newest relevant snapshot, that Bridge changes never create
evaluation-only wakes, and that unchanged snapshots add no repeated prompt
material.

Against those acceptance clauses:

- **Zero evaluation-only wake**: `agent.inject()` satisfies this. `A` and `H`
  show zero requests and zero turns while idle.
- **Idle lane not woken**: satisfied.
- **Next natural request sees the newest snapshot**: **not satisfied**. `C`
  and `H` show every changed value remains in durable model-facing history;
  the request sees old and new snapshots together.
- **Unchanged snapshots add no repeated prompt material**: **not satisfied**.
  `E` shows each injection re-materializes the same value.
- **No extra model request caused by delivery**: not guaranteed. `F` shows a
  running-turn injection can force an extra model step in the same turn.

`agent.inject()` can serve a one-shot, sourced passive-fact preamble. It
cannot serve a repeatedly-updated latest-value snapshot. Consuming it for
D-T03 would require an additional mechanism (durable history pruning /
compaction, or a non-durable context seam) that the frozen authority does not
provide and this Spike must not invent.

## Baseline and dependency consequence

```text
BL-BR-03 remains NEEDS_SPIKE.
WAVE-D-S01 does not advance to VERIFIED_FACT_NOT_INTEGRATED.
WAVE-D-T03 remains BLOCKED.
```

Both the primary `ctx.systemPrompt.context` seam and the predeclared
`agent.inject()` fallback fail the frozen §39.6 latest-only acceptance.
Ticket Decomposition Contract Rule 6 forbids dependent implementation until
its Spike has PASSED, and the frozen authority defines no PASS transition for
a fallback. Therefore:

```text
ESCALATION_REQUIRED
```

No Ticket Graph, Baseline, Spec, DSH source, Bridge production code, or new
mechanism is changed by this probe.
