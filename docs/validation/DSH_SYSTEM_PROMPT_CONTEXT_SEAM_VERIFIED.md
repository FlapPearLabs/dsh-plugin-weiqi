# Pinned DSH `ctx.systemPrompt.context` behavior record

Status: **FAIL — WAVE-D-S01 / BL-BR-03 full frozen delivery acceptance**

Issue: WAVE-D-S01 / #28

Pinned DSH: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Pinned package line: `0.1.1-rc.2` (agent / agent-loop / llm / session /
system-prompt / scope)

Runtime: Node `24.11.1`, pnpm `11.7.0`

The historical filename is retained so the existing version-sensitive gate and
record path remain stable. `VERIFIED` in that filename does not denote a PASS
verdict.

## Corrected conclusion

The pinned native path establishes all of the following executable facts:

- registration through `agent.ctx.systemPrompt.context(...)` works;
- registration and model-facing contributions are agent-scoped;
- the provider is evaluated for each eligible prompt assembly;
- changing only the Runtime-held value causes no wake;
- an unchanged rendered value causes no repeated durable materialization;
- separate agents do not receive each other's registered contribution;
- the provider callback can read one already-computed Runtime value without a
  Session or game-history rescan.

However, `ctx.systemPrompt.context`, as exercised through the pinned native
AgentLoop durable snapshot path, is **not sufficient** for the full frozen
Bridge delivery contract.

When the held value changes from `A0` to `B1`, the next natural model request
contains both:

```text
WORK_SNAPSHOT=A0
WORK_SNAPSHOT=B1
```

The earlier snapshot remains on the durable model-facing surface. The fixed DSH
prose:

```text
This snapshot supersedes earlier runtime-context snapshots.
```

does not remove the earlier message from model-facing history and is not
equivalent to latest-only delivery.

Frozen Spec §39.6 requires the next natural Work request to see **only** the
newest relevant snapshot and requires a long update sequence to remain bounded
enough not to degrade Work context. Because changed values accumulate in
durable history, this seam is not a viable delivery seam for that acceptance
and is not O(1)-suitable as an end-to-end model-facing delivery path. The
provider callback's individual read remains O(1); that narrower fact does not
cure history growth per changed value.

## Execution basis

The fixture runs against the real pinned `agent-loop`, `agent`,
`system-prompt`, `session`, `llm`, and `scope` implementations. The workflow
checks out the pinned source, installs its frozen lockfile with Node `24.11.1`
and pnpm `11.7.0`, copies the fixture unchanged into the pinned AgentLoop test
tree, and executes it there.

The original pinned-environment run was GitHub Actions run
`33593197443` on head `14b20c0`. It succeeded while reproducing the
contradictory Experiment B behavior. That green result proved the observed
pinned behavior; it did not prove Spec conformance. The corrected gate keeps
that distinction explicit: green means the observed behavior is reproducibly
established, including the latest-only failure.

## Exact registration API observed

```ts
ctx.systemPrompt.context(context: PromptContext): () => void
// PromptContext: { name, order, text: string | ((assembleCtx: AssembleContext) => string) }
```

The fixture asserts that registration returns a function. It does not exercise
calling that disposer or the wider agent-disposal lifecycle. No claim that the
fixture observed disposal/unwind behavior is made or needed for this FAIL
verdict.

## Probe design

`tests/upgrade-gates/system-prompt-context/system-prompt-context.spec.ts` is
self-contained and is copied unchanged into the pinned DSH tree.

- `SnapshotHolder` is two plain O(1) variables; `undefined` contributes empty
  text.
- Providers return `WORK_SNAPSHOT=<value>` / `GO_SNAPSHOT=<value>` and record
  agent identity, evaluation count, and the directly read holder value.
- Experiment A proves registration, agent assembly identity, ordering before
  `agent/request`, and initial durable materialization.
- Experiment B proves both no wake and the contradiction: request 2 contains
  durable `A0` and newly materialized `B1` together.
- Experiment C proves unchanged-value deduplication only.
- Experiment D proves cross-agent isolation.

## Corrected spike-question answers

| Question | Executable answer | Full-contract consequence |
|---|---|---|
| Registration API | Verified | Narrow fact only |
| Agent scoping | Verified | Narrow fact only |
| Per-assembly evaluation | Verified | Narrow fact only |
| Direct Runtime-held read / no rescan | Verified | Provider read is O(1) |
| Holder update causes wake | No | Satisfies no-Bridge-only-wake fact |
| Unchanged value rematerializes | No | Satisfies unchanged-value dedup fact |
| Cross-agent leak | None observed | Isolation verified |
| Changed value delivery | Old and new snapshots both remain model-facing | Violates §39.6 latest-only |
| Full frozen Bridge delivery acceptance | **FAIL** | Seam is insufficient |

## `agent.inject()` fallback status

Issue #28 and frozen Spec §7.3 / §9.1 predeclare `agent.inject()` as the fallback
candidate for one-shot sourced passive factual context. Pinned source inspection
establishes these relevant semantics:

- `Agent.inject(input)` calls `send(input, "next-step", false)` in
  `packages/core/agent-loop/src/agent.ts`;
- it appends to the `next-step` inbox without waking the driver;
- an idle Agent leaves it pending until a later `followup()` or `steer()` wakes
  the driver;
- a running driver claims it at a later pre-step boundary, and it may miss a
  request whose pre-step already claimed its batch;
- once accepted, the injected `UserMessage` is durably represented with its
  source.

This remediation does not implement D-T03, add a queue, invent wake behavior,
or claim that `agent.inject()` satisfies §39.6. No executable proof currently
establishes a latest-only, bounded model-facing fallback path.

## Baseline and dependency consequence

```text
BL-BR-03 remains NEEDS_SPIKE.
WAVE-D-S01 does not advance to VERIFIED_FACT_NOT_INTEGRATED.
WAVE-D-T03 remains BLOCKED.
```

Ticket Decomposition Contract Rule 6 forbids dependent implementation until
its Spike has PASSED. The frozen Ticket Graph makes D-T03 depend on D-S01 and
describes D-T03 as consuming a verified `ctx.systemPrompt.context` seam. This
Spike FAILs, while the predeclared `agent.inject()` candidate has no executable
Spec-conformance proof or defined PASS transition in the frozen authority.

Therefore the existing frozen authority does not authorize D-T03 to proceed:

```text
ESCALATION_REQUIRED
```

No Ticket Graph topology, frozen Spec, DSH source, Bridge production code, or
new mechanism is changed by this remediation.
