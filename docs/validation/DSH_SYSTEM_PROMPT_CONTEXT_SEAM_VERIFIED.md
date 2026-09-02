# Pinned DSH `ctx.systemPrompt.context` provider seam — verification record

Status: **PASS — WAVE-D-S01 / BL-BR-03 executable probe**

Issue: WAVE-D-S01 / #28

Pinned DSH: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Pinned package line: `0.1.1-rc.2` (agent / agent-loop / llm / session /
system-prompt / scope)

Runtime: Node `24.11.1`, pnpm `11.7.0`

## Conclusion

`ctx.systemPrompt.context` is a viable delivery seam for the Spec §9.1
Bridge projection. Registering a context provider through an agent's own
scoped context (`agent.ctx.systemPrompt.context(...)`) makes it
agent-local; DSH evaluates it during each proposed step's prompt assembly
(before the model request), renders a durable user-role snapshot, and
materializes that snapshot only when the rendered text changed. Updating a
Runtime-held O(1) latest value produces no wake, no event, and no
re-materialization while the value is unchanged.

## Execution basis (transparency note)

The fixture below ran locally against the **pinned source tree** of
deepseek-harness @ `b150a551` using the real `agent-loop` / `agent` /
`system-prompt` / `session` / `llm` / `scope` implementations compiled on
the fly by vite-node. The local host cannot complete `pnpm install
--frozen-lockfile` for the full Harness workspace (its file-ops guard kills
the node_modules linking phase), so this local run bypasses linking by
aliasing every workspace package to its pinned TS source; it does not
reimplement or mock any DSH module. The gate workflow
(`.github/workflows/system-prompt-context-gate.yml`) performs the same
fixture in the pinned environment (real `pnpm install`, GitHub Actions,
Node 24.11.1 / pnpm 11.7.0) — its job log is the authoritative
pinned-environment artifact for this record.

Deterministic rerun: 3/3 local runs, each `4/4 tests passed` (run logs
`run4.log`, `rerun1.log`, `rerun2.log` in the probe workspace;
`DSH_SPIKE_TRACE` lines reproduced identically across reruns).

Pinned-environment gate: GitHub Actions run
`https://github.com/FlapPearLabs/dsh-plugin-weiqi/actions/runs/33593197443`
(`Pinned DSH systemPrompt.context seam gate`, conclusion **success**, head
`14b20c0`); its job log reproduces the same `DSH_SPIKE_TRACE` lines as the
local runs. Foundation CI on the same head also passed.

## Exact registration API observed (pinned source, `dsh-system-prompt` types)

```ts
ctx.systemPrompt.context(context: PromptContext): () => void
// PromptContext: { name, order, text: string | ((assembleCtx: AssembleContext) => string) }
```

Agent scoping is achieved by registering through the agent's own scoped
context: `agent.ctx.systemPrompt.context({ name, order, text: (...) => ... })`.
`Agent.ctx` is documented and observed as agent-local (contributions unwind
on disposal). Assembly carries `{ agent, scope: agent, signal }`
(`assembleContextFor`), so a provider registered on `agent.ctx` participates
only in that agent's assemblies.

## Probe design

`tests/upgrade-gates/system-prompt-context/system-prompt-context.spec.ts`
(self-contained; copied unchanged into the pinned tree by the gate):

- `SnapshotHolder` = two plain O(1) variables (`work`, `go`); `undefined`
  contributes empty text.
- Providers return `WORK_SNAPSHOT=<value>` / `GO_SNAPSHOT=<value>` and
  record `assembleCtx.agent === agent`, evaluation count, and the observed
  holder value. No Session history, inbox, or rescan surface is touched.
- Four experiments (A initial materialization; B A→B latest value without
  wake; C unchanged value no growth; D agent isolation).

## Executed trace (A — initial materialization, abridged)

```text
provider/registered {name: companion-go:work-snapshot, disposerIsFunction: true}
status:running → turn/start 1
provider/evaluated {isThisAgent: true, holderValue: A0}        ← per-step assembly
step/start 1 1
user/message {text: start, source user}
user/message {source plugin @deepseek-ai/dsh-system-prompt, form snapshot,
              sections [{name companion-go:work-snapshot, text WORK_SNAPSHOT=A0}]}
agent/request 1 1
step/end 1 1 → turn/end completed → status:idle
```

The durable projection text is prefixed with a fixed DSH header
("Current runtime context. This snapshot supersedes earlier
runtime-context snapshots."); the exact value is carried in the message's
`sections` attribution.

## Spike-question answers (executable evidence)

| Q | Question | Answer |
|---|---|---|
| 1 | Agent-scope registration possible? | YES — `agent.ctx.systemPrompt.context(...)`; provider evaluated only in that agent's assemblies (`assembleCtx.agent === agent` asserted true on every evaluation). |
| 2 | Real registration API & lifecycle | `ctx.systemPrompt.context(PromptContext) -> disposer function`; provider is a function evaluated per assembly; registration emits `system-prompt/change`; disposal unwinds the registration (agent-local). |
| 3 | When evaluated vs model requests | During each proposed step, inside `pre-step`, after inbox claim and BEFORE `agent/request` — trace order: `provider/evaluated` → `step/start` → snapshot `user/message` → `agent/request`. |
| 4 | Read Runtime-held value w/o rescan | YES — provider is a closure over the holder; no transcript/session surface involved; trace shows holder value read directly at each assembly. |
| 5 | A→B update observed by next natural request | YES — holder `A0`→`B1` (plain assignment); next natural followup's request carries `WORK_SNAPSHOT=B1`; durable history = exactly `[A0, B1]`. |
| 6 | Unchanged state avoids re-materialization | YES — 3 natural requests with unchanged `A0`: provider evaluated 3× (per assembly), durable snapshot materialized exactly once; later requests append no prompt material. |
| 7 | Holder update causes wake? | NO — between turns, after `A0`→`B1`, agent stays `idle`, request count unchanged, no `turn/start`, no `system-prompt/change` (asserted). Only the explicit natural followup opens turn 2. |
| 8 | Constant-size latest projection compatible | YES — materialization is per-change (durable snapshot count = distinct rendered values, not request count); unchanged values add zero material; per-change history growth is inherent to the durable design. |
| 9 | Hidden global/shared leak across agents? | NO — work agent sees only `WORK_SNAPSHOT=W0`, go agent only `GO_SNAPSHOT=G0`, an unregistered third agent sees no snapshot; model-facing requests confirm the same isolation (asserted 0 cross-marker occurrences). |

## Request / materialization counts observed

Experiment B (two natural requests): adapter.requests = 2; durable
snapshots = 2 (`A0`, `B1`); wake events from the holder update = 0.

Experiment C (three natural requests, unchanged value): adapter.requests =
3; provider evaluations >= 3; durable snapshots = 1; requests 2 and 3
contain the snapshot exactly once each (no growth).

## Changed files

- `.github/workflows/system-prompt-context-gate.yml`
- `docs/validation/DSH_SYSTEM_PROMPT_CONTEXT_SEAM_VERIFIED.md` (this file)
- `tests/upgrade-gates/system-prompt-context/system-prompt-context.spec.ts`
- `tests/upgrade-gates/system-prompt-context/run-system-prompt-context.sh`

## Stage transition (proposed)

```text
BL-BR-03: NEEDS_SPIKE -> VERIFIED_FACT_NOT_INTEGRATED
Predeclared downstream consumer: WAVE-D-T03 (per Ticket Graph V1.2.1 / Rule 8,
Ticket Decomposition Contract) — consumes this verified seam at production
integration time. No Bridge, no GameNotice/WorkSnapshot production code, and
no DSH core patch were introduced by this Spike.
```
