# Pinned DSH `agent.ctx.systemPrompt.section` fallback seam behavior record

Status: **PASS — WAVE-D-S01 continuation / BL-BR-03 formal fallback gate**
(evidence PR #64; PASS becomes repository authority only after that PR is
independently reviewed and merged)

Issue: WAVE-D-S01 / #28

Pinned DSH: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Pinned package line: `0.1.1-rc.2` (agent / agent-loop / llm / session /
system-prompt / scope)

Runtime: Node `24.11.1`, pnpm `11.7.0`, Vitest `4.1.8`

The filename follows the existing version-sensitive record convention.
`VERIFIED` in that filename denotes recorded executable behavior, not a
self-declared PASS; the formal verdict is the acceptance matrix below plus
independent review of this PR.

## Candidate and contrast

Candidate under test (authorized by the architecture escalation after the
merged negative evidence in
`docs/validation/DSH_SYSTEM_PROMPT_CONTEXT_SEAM_VERIFIED.md`):

```text
ctx.systemPrompt.context = FAIL   (merged, PR #62 / commit 2a2e5b4)
agent.inject            = NOT the chosen fallback (pinned-source analysis)
agent.ctx.systemPrompt.section = candidate under test here
```

The two seams differ in where the contribution lands:

- `ctx.systemPrompt.context(...)` contributions become a DURABLE user-role
  message appended to the session; changed values accumulate (`A0` and `B1`
  both remain model-facing), which FAILS Spec §39.6 latest-only delivery;
- `agent.ctx.systemPrompt.section(...)` contributions are rendered into the
  SYSTEM prompt by prompt assembly at natural-request time and are never
  appended to session history — the request-header replacement semantics this
  gate was asked to prove or falsify.

## Exact registration API used

```ts
const dispose = agent.ctx.systemPrompt.section({
  name: 'companion-go:work-lane-bridge',   // or 'companion-go:go-lane-bridge'
  order: 20,
  text: (assembleCtx) => string,            // dynamic text provider
})
// dispose: () => void  — exercised in assertion 13
```

Registered through the agent's own scoped context (`agent.ctx`), so
registration is agent-scoped by construction; `assembleCtx.agent === agent`
is asserted for every evaluation of the owning agent.

## Execution basis

The fixture is `tests/upgrade-gates/system-prompt-section/
system-prompt-section.spec.ts`. It is copied unchanged into the pinned
upstream DSH tree at
`packages/core/agent-loop/tests/system-prompt-section.spike.spec.ts` by
`run-system-prompt-section.sh` and executed there against the real
`agent-loop`, `agent`, `system-prompt`, `session`, `llm`, and `scope`
implementations (it imports the upstream `mock-adapter.ts` that already lives
in that directory; no DSH module is reimplemented or patched).

The authoritative pinned-environment run is GitHub Actions run
`33782409492` ("Pinned DSH systemPrompt.section behavior gate") on head
`0bbe6f9c78ff9d9edde29ff72edd43633c2721fd`, which installed the frozen DSH
lockfile with Node `24.11.1` / pnpm `11.7.0` and completed with conclusion
`success` (13/13). A local run against the same pinned sources
(Node `24.11.1`, Vitest `4.1.8`) produced 13/13 PASS twice with
byte-identical `DSH_SPIKE_TRACE` output.

Fail-closed pin binding (same discipline as the context gate): the runner
requires the plugin repository's `peerDependencies` AND `devDependencies`
for `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-llm`, and
`@deepseek-ai/dsh-session` to equal `0.1.1-rc.2`, the pinned checkout to be
at `b150a551...`, Node `24.11.1`, and pnpm `11.7.0`, before any probe work.
`control-pin-binding.sh` proves the NEGATIVE (divergent pins `0.1.2-rc.1` →
exit non-zero with `PLUGIN_REPO_DSH_PIN_MISMATCH` before any probe output)
and the POSITIVE (current pins pass the preflight and advance to the
pinned-checkout checks).

## Formal acceptance matrix

| # | Acceptance requirement | Executable result |
|---|---|---|
| 1 | Registration / scoping via real `agent.ctx.systemPrompt.section`; real request path | PASS — agent-scoped (`assembleCtx.agent === agent` for all evaluations); rendered into the system prompt; `bridgeOccurrencesInMessages = 0`; request-header count equals model request count (production AgentLoop derivation, no fake request path) |
| 2 | O(1) runtime read; no session/action-log/transcript/game-history scan | PASS — exactly 1 provider evaluation per request while session events grow 16 → 30 → 44 → 58 across four requests |
| 3 | No update-only wake | PASS — holder-only changes produce zero requests, zero steps, zero status transitions; idle agent stays idle |
| 4 | A → B → C latest-only before natural request | PASS — request 2 exposes only `GAME_NOTICE=C`; `A` and `B` absent from system prompt and all model messages (occurrence counts asserted explicitly) |
| 5 | Unchanged C → C → C dedup | PASS — no additional request, no additional materialization, no changed request-header record |
| 6 | Subsequent change C → D | PASS — next natural request exposes only D; prior projections do not reappear |
| 7 | 20 updates during an active request | PASS — extra requests = 0, extra steps = 0 (turns 2, steps 2 total); next natural request exposes only update #20 (`RAPID-20`) |
| 8 | 1000-update boundedness | PASS — 1000 holder updates with no natural request cause zero per-update requests/steps; the next natural request receives one latest projection (`BOUND-1000`); system-prompt Bridge material grows only by the marker value's own length (69 → 72 characters), not linearly |
| 9 | Cross-lane isolation | PASS — Work agent receives only `GAME_NOTICE=GN-9`; Go agent receives only `WORK_SNAPSHOT=WS-9`; bare/unrelated agent receives neither (no `section/evaluated` for it; leakage count 0) |
| 10 | Request reconstruction intact | PASS — every Bridge-bearing request flows through the production `agent/request` + step/turn machinery; `requestHeaderCount == modelRequestCount` throughout |
| 11 | Section precedence / no conflicting `complete: true` | PASS — the production-like composition (identity section + dynamic section, no `complete: true`) renders the Bridge section; a `complete: true` control section is demonstrably detected as suppressing the Bridge section (fail-closed, no workaround introduced) |
| 12 | Resume / later natural request | PASS — after four historical requests (`H01`–`H04`) and 36 further silent holder updates (`H05`–`H40`), the later natural request exposes only `GAME_NOTICE=H40`; historical request-header records do not resurrect old values |
| 13 | Disposal actually exercised | PASS — after calling the returned disposer, the next request's Bridge system values are `[]`; the contribution no longer appears (not inferred from the returned function) |

Negative control: the gate's marker-occurrence assertions demonstrably detect
superseded Bridge material — a `complete: true` suppression and the
`ctx.systemPrompt.context` seam (whose `X1 → X2` change leaves both values in
durable model-facing messages) are both caught by the same occurrence-counting
machinery, while the section seam passes it. Green therefore means the
candidate satisfies the acceptance assertions, not merely that a known failure
was reproduced.

## Diagnostics recorded per trace

Model request count; request-header count; turn/step start counts; agent
status transitions; provider evaluation count (and per-request evaluations);
per-request Bridge marker values in the system prompt; Bridge marker
occurrence counts in the system prompt and in model messages; unrelated-agent
leakage count. The traces distinguish the latest Runtime value (what the
provider read), the latest pending value (holder state before the request),
and the latest model-facing value (what the request actually exposed).

## Verdict

```text
ctx.systemPrompt.context = FAIL  (merged negative evidence, unchanged)
agent.ctx.systemPrompt.section = PASS (this record, pending PR #64 merge)
```

## Proposed post-merge transitions

Recorded here per the established bookkeeping convention (proposed state is
recorded separately in the validation record; the Baseline/Graph status cells
transition only after the evidence PR is merged):

```text
BL-BR-03: NEEDS_SPIKE -> VERIFIED_FACT_NOT_INTEGRATED
WAVE-D-S01: PASS via the verified pinned agent-scoped passive
  Bridge-delivery seam (agent.ctx.systemPrompt.section)
WAVE-D-T03: still NOT implemented; its D-S01 dependency is satisfied once
  this evidence PR is merged
```

Issue #28 is not closed by this record; it stays open until the fallback seam
verdict is independently reviewed and the evidence merged.

## Scope

This spike owns no Bridge production code, no GameNotice/WorkSnapshot
production code, no DSH patch, no `agent.inject` integration, no
queue/mailbox/event bus, no timer/cooldown, no snapshot journal, no transcript
synchronization, no surfaceOp-replace workaround, and no generalized delivery
mechanism. No production `src/**` file and no Verified Spec file is modified
by the evidence PR. D-T03 is not implemented.
