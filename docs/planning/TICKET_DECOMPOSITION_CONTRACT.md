# Ticket Decomposition Contract

**Purpose:** Define how future `/TO-TICKET` runs consume the planning Baseline.
This file does not restate the Spec. It only governs the mapping between
Tickets/Spikes and `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md`.

**Authority:** AGENTS.md order — Verified Spec > Executable Evidence > Current
Pinned Source / Real Repository State > Current Implementation Baseline >
Frozen Design > Roadmap > Ticket. A Ticket never overrides the Baseline or the
Spec; a Baseline/Spec contradiction always produces `ESCALATION_REQUIRED`.

---

## Rule 1 — Every Ticket must reference Baseline IDs

Every Ticket / Spike must declare:

```text
Baseline IDs:
- BL-...
```

A Ticket without any Baseline ID is invalid by default.

## Rule 2 — Ticket closes a Gap, not a Spec chapter

A Ticket's goal must be written as a state transition:

```text
Current Baseline State: <state> (Baseline ID BL-...)
Target State:           IMPLEMENTED_VERIFIED / VERIFIED_FACT_NOT_INTEGRATED
```

Not simply "implement Spec §X". Spec references support the gap, they do not
replace it.

## Rule 3 — NO_ACTION cannot become Ticket

Baseline rows that are `IMPLEMENTED_VERIFIED` + `NO_ACTION` (e.g. BL-PKG-01…
05, BL-UI-01) must never be turned into implementation Tickets.

## Rule 4 — FOUNDATION_ONLY means reuse

For a `FOUNDATION_ONLY` row, the Ticket must state:

```text
Existing Asset / Contract Reused: <exact file + symbol>
```

Redefining a synonymous interface/type/state is forbidden. Modifying the
existing public contract requires `ESCALATION_REQUIRED`, not a normal Ticket.

## Rule 5 — VERIFIED_FACT_NOT_INTEGRATED

Only `INTEGRATION_TICKET` may be created for these rows (e.g. BL-RT-06,
BL-RT-07). No new feasibility Spike may be created for an already-verified
fact.

## Rule 6 — NEEDS_SPIKE blocks dependent implementation

If a Baseline row is `NEEDS_SPIKE`, dependent implementation Tickets may
appear in the dependency graph, but each must declare:

```text
blocked_by: <Spike Baseline ID>
```

No dependent implementation work starts until the Spike has PASSED.

## Rule 7 — DEFERRED means no current Ticket

`DEFERRED` rows (e.g. BL-UI-03, BL-HARD-04) get no current Ticket unless the
Spec Phase or project scope formally changes.

## Rule 8 — One primary owner per Baseline Gap

Each Baseline Gap has exactly one primary Ticket / Spike that closes it.
Other Tickets may depend on it; they must not re-implement the same gap.

**Clarification (NEEDS_SPIKE chains):** a Gap whose state is `NEEDS_SPIKE`
has two disjunct ownership slices over time: the Spike owns
`NEEDS_SPIKE` -> `VERIFIED_FACT_NOT_INTEGRATED`, and a predeclared downstream
consumer owns `VERIFIED_FACT_NOT_INTEGRATED` -> `IMPLEMENTED_VERIFIED`. As long
as the two transitions do not overlap and the consumer was statically declared
before the Spike executed, this is not duplicate ownership. No new ownership
system is introduced.

## Rule 9 — Multi-gap Ticket must justify coupling

A Ticket that closes multiple Baseline IDs must state why those gaps must be
done atomically. Otherwise it must be split. No "big tickets".

## Rule 10 — No orphan Ticket

Every Ticket maps to at least one Baseline ID. If a Ticket cannot be mapped,
first check whether the Baseline is missing a row (update the Baseline with
evidence); do not add "incidental work".

## Rule 11 — No orphan Baseline Gap

Once the Ticket Graph is complete, every Baseline gap that is not
`NO_ACTION` / `DEFER` / `KEEP_AS_UPGRADE_GATE` must be covered by a
Ticket/Spike ownership, or explicitly recorded as `ESCALATION_REQUIRED`.
Nothing may be silently left uncovered.

**Clarification (Spike PASS producing `VERIFIED_FACT_NOT_INTEGRATED`):** if a
Spike PASS advances a Gap to `VERIFIED_FACT_NOT_INTEGRATED`, a predeclared
downstream consumer must already exist before the Spike executes. Exception: if
the Spike acceptance itself fully verifies the target production capability and
no later integration step exists, PASS may advance the Gap directly to
`IMPLEMENTED_VERIFIED` (no consumer needed).

## Rule 12 — Baseline updates follow evidence

A completed Ticket does not self-declare the Baseline done. The corresponding
Baseline row is updated only from merged source + tests + CI/evidence, e.g.:

```text
NOT_IMPLEMENTED                -> IMPLEMENTED_VERIFIED
NEEDS_SPIKE                    -> VERIFIED_FACT_NOT_INTEGRATED
VERIFIED_FACT_NOT_INTEGRATED   -> IMPLEMENTED_VERIFIED
```

The Baseline represents repository reality, not a task plan.

**Clarification (Spike terminal states):** `NEEDS_SPIKE` ->
`VERIFIED_FACT_NOT_INTEGRATED` is the common Spike transition, not a mandatory
unique outcome. `NEEDS_SPIKE` -> `IMPLEMENTED_VERIFIED` is allowed only when
the Spike acceptance itself directly, completely and executably verifies the
target capability and no residual integration gap exists. Current approved
instance: WAVE-INFRA-S01 (BL-PKG-06). No further rules or exceptions are added.

## Post-Spike Stability Rule

### A. Default behaviour on Spike PASS

Once a Spike PASSes and its executable evidence is merged:

1. the corresponding Baseline evidence state advances per Rule 12
   (`NEEDS_SPIKE` -> `VERIFIED_FACT_NOT_INTEGRATED`);
2. the Spike Issue may be closed;
3. for existing Tickets blocked on the Spike, the dependency is considered
   satisfied for execution readiness; the approved dependency edge remains
   unchanged;
4. the Ticket Graph remains frozen by default.

Spike PASS alone is never grounds for:

- creating a new Ticket;
- re-running `/TO-TICKET`;
- changing the Ticket total;
- redesigning the dependency graph;
- creating a second "integration shell" Ticket;
- changing Ticket Type;
- changing Ticket ownership;
- rewriting unrelated GitHub Issues;
- adding a new planning registry / JSON / YAML / database.

### B. Predeclared downstream consumer

An existing Ticket is the **predeclared downstream consumer** of a Spike when:

1. it is explicitly `blocked_by` that Spike in the approved Graph; and
2. its existing Scope already states that it consumes the Spike's verified
   seam / capability / evidence.

After Spike PASS, for such a Ticket:

- the dependency is considered satisfied for execution readiness; the approved
  dependency edge remains unchanged;
- the merged executable evidence is used;
- no new Ticket is needed;
- the Ticket is **not** re-classified because of the Baseline state change.

The following relationship is allowed:

```text
Spike
NEEDS_SPIKE
→ VERIFIED_FACT_NOT_INTEGRATED

existing downstream Ticket
already blocked_by Spike
already says "use findings / verified seam"
→ consumes evidence
→ IMPLEMENTED_VERIFIED
```

### C. Rule 5 compatibility

Rule 5 (`VERIFIED_FACT_NOT_INTEGRATED` -> `INTEGRATION_TICKET` only) applies
when a **new** Ticket is created / decomposed after the Baseline is already
`VERIFIED_FACT_NOT_INTEGRATED`.

Rule 5 does **not** require an already-approved predeclared downstream consumer
to change its Ticket Type solely because its prerequisite Spike passed.

If the existing Ticket was already `blocked_by` the Spike and its approved
Scope already consumes the verified seam / capability / evidence:

- retain the existing Ticket identity and Type;
- use the merged executable evidence;
- do not reopen post-Spike ticketization.

Already-approved ownership transitions stay as-is: e.g. WAVE-C-T07 (owns
BL-BUD-07) and WAVE-E-T01 (owns BL-UI-04) remain `INTEGRATION_TICKET` — do not
revert them.

### D. When the Graph may reopen

Only the following conditions permit reopening the approved Ticket Graph:

1. executable evidence proves the existing dependency relationship is wrong;
2. executable evidence contradicts the frozen Spec / architecture contract;
3. the approved downstream Ticket scope cannot actually consume the Spike
   result and a new architecture decision is required.

In these cases:

```text
ESCALATION_REQUIRED
```

Do not automatically re-ticketize.

### E. No new planning subsystem

This rule does **not** introduce:

- a graph validator;
- a graph compiler;
- a lifecycle engine;
- a state database;
- a JSON/YAML registry;
- automatic Graph rewriting;
- a second planning system.

The existing Markdown (Baseline + Ticket Graph + this contract) + GitHub Issues
+ merged executable evidence remain sufficient.

---

## Escalation rule

Any Ticket / Baseline / Spec contradiction — including a proposed change to a
frozen public contract or a new shared mechanism — outputs exactly:

```text
ESCALATION_REQUIRED
```

with the concrete reason, and stops. It is never resolved by a normal Ticket.
