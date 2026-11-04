# Pinned DSH dynamic system section + variable behavior record

Status: **PASS for latest-only delivery, no-wake, and history isolation; Q7
token cost NOT MEASURED (no provider credentials in this environment)**

Spike: pre-A, follows WAVE-D-S01 (rejected `systemPrompt.context` and
`agent.inject`)

Pinned DSH: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Pinned package line: `0.1.1-rc.2` (agent / agent-loop / llm / session /
system-prompt / scope / tools)

Runtime used for the recorded execution: local Node `v26.10.0` against the
exact pinned checkout (pnpm `11.7.0`). No Node `v24.11.1` exists on this
machine, so the gate runner's version-equality preflight was not executed;
the same vitest command the runner uses was executed directly. DSH `engines`
accepts `^22.19.0 || >=24.0.0`. CI (Ubuntu, Node `24.11.1`) remains the
authoritative toolchain for this fixture.

## Conclusion

`agent.ctx.systemPrompt.section({ text: (ctx) => ... })` combined with
`agent.ctx.systemPrompt.variable(name, provider)` satisfies the three
requirements that both WAVE-D-S01 candidates failed:

- **latest-only in the system slot**: `agent.ts` `step()` calls
  `renderPrompt(assembly)` for every step, so a function `text` is
  re-evaluated per assembly and the model sees only the newest value;
- **no wake**: updating the Runtime-held value is a plain assignment; 20 rapid
  updates produced zero additional requests, turns, steps, or `request/header`
  events;
- **no history pollution**: sections are rendered into the request's `system`
  field; `session.deriveMessages()` supplies the model-visible history, so no
  durable `user/message` snapshot appears and the next request's message list
  never contains the superseded value.

Two properties of the mechanism that the design must respect:

- **Double braces are only safe through a variable.** `renderPrompt()`
  interpolates `{{name}}` strictly in section text and does not rescan
  substituted values, so a value containing `{{x}}`, `{{}}`, or a dangling
  `{{` reaches the model literally. The same text written directly into a
  section renders an `unknown prompt variable` error.
- **Every changed value prevents a full match with the previous request's
  prefix unit** in the request that observes it. The section is placed before all
  tool schemas and messages, so the old system text is early in the request; how
  much of that the provider can still serve from other persisted prefix units is
  best-effort and unobserved here. Absolute token cost requires provider usage
  records (Q7 below, not measured here).

## Execution basis

`tests/upgrade-gates/system-prompt-section/system-prompt-section.spec.ts` is
self-contained and is copied unchanged into
`packages/core/agent-loop/tests/` of the pinned DSH checkout, next to the
pinned `mock-adapter.ts`. It exercises the real pinned `agent-loop`, `agent`,
`system-prompt`, `session`, `llm`, and `tools` implementations. No production
code, Bridge code, DSH patch, or frozen document is touched.

Reproducible gate command (requires the pinned Node and pnpm versions):

```sh
DSH_PINNED_ROOT=/path/to/pinned-deepseek-harness \
TRACE_LOG=/tmp/system-prompt-section-trace.log \
bash tests/upgrade-gates/system-prompt-section/run-system-prompt-section.sh
```

Executed here (version preflight bypassed, see above):

```sh
cp tests/upgrade-gates/system-prompt-section/system-prompt-section.spec.ts \
   "$DSH_PINNED_ROOT/packages/core/agent-loop/tests/system-prompt-section.spike.spec.ts"
cd "$DSH_PINNED_ROOT"
corepack pnpm@11.7.0 exec vitest run --no-file-parallelism --reporter=verbose \
  packages/core/agent-loop/tests/system-prompt-section.spike.spec.ts
```

## Raw executed trace

Fixture under test registers one variable and one section per agent:

```ts
agent.ctx.systemPrompt.variable('go_snapshot', () => holder.value)
agent.ctx.systemPrompt.section({
  name: 'companion-go:go-snapshot',
  order: 10,
  text: () => holder.value === undefined
    ? ''
    : 'GO_SNAPSHOT={{go_snapshot}}',
})
```

```text
DSH_SECTION_SPIKE 1-latest-only {"firstSystemHasA0":1,"secondSystemHasB1":1,"secondSystemHasA0":0,"durableUserMessages":["start","next"],"headerReasons":["initial","change"],"changeEvents":2,"trace":[{"event":"section/registered","detail":{"disposerIsFunction":true}},{"event":"section/evaluated","detail":{"value":"A0"}},{"event":"section/evaluated","detail":{"value":"B1"}}]}

DSH_SECTION_SPIKE 2-twenty-updates-no-wake {"requestsAfterFirst":1,"turnsAfterFirst":1,"stepsAfterFirst":1,"headersAfterFirst":1,"evaluationsAfterFirst":1,"requestsAfterUpdates":1,"turnsAfterUpdates":1,"stepsAfterUpdates":1,"evaluationsAfterUpdates":1,"finalSystemSnapshotCount":1}

DSH_SECTION_SPIKE 3-unchanged-header {"headerReasons":["initial","change"],"evaluations":4,"systemsIdentical":true,"durableUserMessages":["one","two","three","four"]}

DSH_SECTION_SPIKE 4-double-braces {"rendered":1,"systemTail":" AI agent powered by DeepSeek Harness.\n\nGO_SNAPSHOT=A0 {{x}} {{not a name}} {{}} trailing {{"}

DSH_SECTION_SPIKE 5-agent-isolation {"work":{"workMarker":1,"goMarker":0},"go":{"goMarker":1,"workMarker":0},"bare":{"goMarker":0,"workMarker":0}}

DSH_SECTION_SPIKE 6-prefix-cost-shape {"systemCharsBefore":64,"systemCharsAfter":64,"stablePrefixChars":62,"changedSystemChars":2,"messageCharsAfter":423,"recordedUsage":[{"inputTokens":10,"outputTokens":5},{"inputTokens":10,"outputTokens":5}]}

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

`recordedUsage` in trace 6 is the mock adapter's scripted constant
(`inputTokens: 10`); it is not a token measurement and is not used as one.

## Falsifiability check

Four mutants were applied to the fixture inside the pinned tree
(`run-mutation-check.sh`); each breaks one property and must turn the matching
assertions red. Observed:

| Mutant | Change | Failing tests |
|---|---|---|
| `frozen-value` | variable provider captures the value at registration instead of reading the holder | 1, 2, 3, 6 |
| `wrong-agent-scope` | the Go snapshot is registered on the Work agent's scope | 5 |
| `changing-text` | section text appends the per-assembly evaluation counter | 3 |
| `raw-concatenation` | section text concatenates the value instead of referencing the variable | 4 |

Every one of the six fixture tests is red under at least one mutant and green
under the rest, so the assertions are not self-fulfilling.

## Existing suites (Q6)

From the earlier recorded run against the same pinned checkout (the re-run
covered only the first two rows; see Q6 below):

| Suite | Command target | Result |
|---|---|---|
| Pinned pre-step / interception | `packages/core/agent-loop/tests/interception.spec.ts` | 23 passed (includes `reject closes the claimed prompt turn without a step or model call`) |
| Repo cooperative-yield upgrade gate | `tests/upgrade-gates/cooperative-yield/cooperative-yield.spec.ts` copied into the pinned tests dir | 3 passed |
| Repo cooperative-yield production integration | `tests/integration/cooperative-yield/cooperative-yield.fixture.ts` copied into a temp dir under the pinned tests dir with `src/` as `plugin/` | 3 passed |

The pinned tree was left clean (`git status --porcelain` empty) after each run.

## Q7: token cost of one change

`tests/upgrade-gates/system-prompt-section/token-cost.spec.ts` is an opt-in
instrument (`DEEPSEEK_API_KEY`, `DSH_SPIKE_MODEL`, `DSH_SPIKE_PAID_MEASURE=1`)
that runs three natural requests on one session (A0, unchanged, B1) against
the real DeepSeek adapter and reports the loop-recorded usage. Without those
env vars it skips; the skip path is the only one executed here:

```text
↓ ... > records usage for unchanged and changed system sections
 Test Files  1 skipped (1)
      Tests  1 skipped (1)
```

No provider credential exists in this environment (`DEEPSEEK_API_KEY` unset;
no `.env` in the pinned checkout), and a paid provider call requires owner
approval, so the requested "actual input token delta" is **not measured**.
Estimating it is explicitly out of scope, so no estimate is offered.

What is measured exactly (trace 6):

- system slot: 64 chars before and after the change; the two strings share a
  62-char prefix, so the change is a 2-char substitution at offset 62;
- the section sits before all tool schemas and before every message
  (message payload of request 2: 423 chars of JSON). The fixture compared only the
  two `system` strings, and their common prefix ends at offset 62; it did not
  compare whole requests or provider serialization, and how much the provider
  actually serves from cache is not observed here;
- `request/header` gains exactly one `reason: "change"` event for that
  request, so the epoch change is recorded, not inferred.

Why a changed request cannot fully match the previous request's prefix unit: DeepSeek
persists a cache prefix unit at the end of each request's user input and at the
end of the model output, and a later request hits only by fully matching one of
those units (official cache guide, fetched 2026-11-04). Request 1's unit ends
after its final message and therefore embeds the old system text; request 2
differs inside the system slot, so it cannot fully match that unit. Whether some
smaller, independently persisted common prefix still matches is the provider's
best-effort detection, not something this fixture can observe. The earlier
"64-token block" statement in this document was an unsupported inference from a
pinned-tree e2e test and is withdrawn; the current official guide states no such
granularity.

The exact token and cache-hit delta is provider-tokenizer output and needs a
with-key run; it is not measured here.

Cost model, explicitly unmeasured: let `X` be the input tokens of one request.
A request whose system section differs from the previous request's cannot fully
match that previous prefix unit, but which smaller persisted units still match
is provider-side and unobserved here, so the share of input that misses is
unknown. Official Flash pricing on 2026-11-04 was CNY 0.02 vs CNY 1 per million
input tokens off-peak for hit vs miss (ratio 1/50), so the difference matters in
proportion to the tokens that actually miss. Twenty coalesced updates produce at
most one changed request (only the value at admission is rendered), not twenty.
Whether that cost is acceptable cannot be decided from this fixture; it needs a
with-key run reporting `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`
over a realistic session.

One persistence caveat, confirmed by review: `agent.ts:477-488` in the pinned
tree appends `request/header` events containing the rendered system text, so old
snapshot text does remain on disk in the header log even though it never enters
the message history. The claim "no history pollution" covers model-visible
messages only.

## Spike-question answers

**Q1 — A0 then B1, next natural request's system contains only B1.** PASS.
`secondSystemHasB1: 1`, `secondSystemHasA0: 0`, exactly one `GO_SNAPSHOT=`
occurrence, and request 2's message list contains no snapshot text.

**Q2 — 20 updates, zero requests and zero turns.** PASS. After the first
request, 20 assignments left requests/turns/steps/headers/evaluations
unchanged; the later natural request rendered only `v-20`, once.

**Q3 — unchanged value adds no `request/header` event.** PASS. Three natural
requests with one value produced exactly one header event (`initial`) and
byte-identical system strings; writing the same value again added nothing. A
real change plus a request added exactly one `reason: "change"` event.

**Q4 — `{{x}}` in snapshot text.** PASS through the variable path: the value
`A0 {{x}} {{not a name}} {{}} trailing {{` reached the model verbatim, with no
error and no rescan. Writing the same braces directly into section text
throws `unknown prompt variable "{{x}}"`, so section text must stay a static
template and every dynamic value must arrive through a variable.

**Q5 — two agents do not see each other's section.** PASS. Work saw only
`WORK_ONLY=W0`, Go saw only `GO_SNAPSHOT=G0`, and an agent with no
registration saw neither.

**Q6 — pre-step reject and cooperative-yield unaffected.** PARTIAL. The pinned
`interception` suite and the cooperative-yield fixture passed (26 tests, exit 0 in
the executed run); the three production-integration cases in the table were not
re-run under the same conditions and are not claimed here. The fixture adds
registrations only, no listener ordering and no loop change.

**Q7 — token delta of one change.** NOT MEASURED. Structural cost is measured
exactly (change at offset 62 of 64 in the system slot, before all messages);
the token number needs the with-key instrument.

## Answers

**A. Does the scheme satisfy latest-only + no wake + no history pollution?**
Yes for the three properties as scoped, on the pinned commit: latest-only (Q1),
no wake (Q2, Q3), and no model-visible snapshot in the message history (Q1: no
durable snapshot message, message list unaffected). Caveats: dynamic values must
go through variables (Q4); each changed value that a request observes prevents a
full match with the previous request's prefix unit (Q7 shape); and the rendered
system text is still persisted in `request/header` log events, so "no history
pollution" does not mean "nothing on disk".

**B. Cache cost.** A request that observes a changed section cannot fully match
the previous request's persisted prefix unit; which smaller persisted units still
match is provider-side and unobserved here. The exact token and cache-hit delta
is **not measured** in this environment (Q7), and the official guide describes
hits as best-effort with independent prefix units rather than a strict
longest-common-prefix rule, so this document claims no precise per-change cost and
no acceptability verdict. Coalescing means many updates between two requests cost
at most one changed request. A core-added ephemeral tail might reduce how much of
the prefix changes, but that is unverified: the in-run review shows it is not
identical to append-only replay, so it needs its own spike and remains a candidate,
not a proven win. Recommendation:
treat the section approach as viable pending a with-key measurement of Q7.

**C. Minimal change if adopted.** Plugin-side only, no DSH patch:

- new `src/bridge/prompt-section.ts`: for each lane, register one variable
  (returning the lane's allowlisted awareness view rendered as small text) and
  one section whose `text` is a static `{{variable}}` template and returns
  `''` when the view is absent; read through `CrossLaneAwareness`, O(1), never
  the session log (same rules as `src/bridge/awareness.ts`);
- `src/index.ts` `apply()`: call it once after the Work/Go agents are created
  (the two `ctx.agents.create(...)` handles), so both registrations are
  agent-scoped and disposed with the plugin fiber;
- one integration fixture next to the existing Runtime fixtures asserting the
  Go lane sees only the latest WorkSnapshot and the Work lane only the latest
  GameNotice, with zero model requests from updates.

Documentation consequence (judgment only, nothing changed here):

- **Spec §9.1 must change.** It currently *prefers* `ctx.systemPrompt.context`
  and states that DSH materializes a new snapshot only when the rendered
  snapshot changed — the executed D-S01 probe shows the superseded snapshot
  stays in durable history, so the preferred mechanism contradicts §39.6's
  "only the latest rendered" acceptance. The section mechanism satisfies §39.6
  but is a different seam, so §9.1's preferred-mechanism sentence has to be
  amended before implementation. Per `AGENTS.md`, that amendment is an
  `ESCALATION_REQUIRED` event; it is not performed by this spike.
- **Baseline must change.** The D-S01 row records the context/inject seams as
  `VERIFIED_FACT_NOT_INTEGRATED` with a failing delivery conclusion; a
  section-seam entry pointing at this record and
  `tests/upgrade-gates/system-prompt-section/` is needed when the seam is
  integrated.

## Known limitations

- Not tested: resume/replay of a session whose persisted `request/header`
  carries an older system string (the `reason: "resume"` path), mid-turn
  snapshot changes in a multi-step tool turn, `complete` sections, compaction
  interaction, subagent scopes, and disposal of a live agent.
- The token-cost instrument is unexecuted (skip path only); its with-key path
  is unverified.
- No CI workflow was added for this gate; the run script mirrors the existing
  gate layout but has only been exercised locally.
- Local run used Node `v26.10.0`, not the pinned gate's `v24.11.1`.
