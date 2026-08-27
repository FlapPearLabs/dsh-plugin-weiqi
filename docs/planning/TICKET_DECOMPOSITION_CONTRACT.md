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

## Rule 12 — Baseline updates follow evidence

A completed Ticket does not self-declare the Baseline done. The corresponding
Baseline row is updated only from merged source + tests + CI/evidence, e.g.:

```text
NOT_IMPLEMENTED                -> IMPLEMENTED_VERIFIED
NEEDS_SPIKE                    -> VERIFIED_FACT_NOT_INTEGRATED
VERIFIED_FACT_NOT_INTEGRATED   -> IMPLEMENTED_VERIFIED
```

The Baseline represents repository reality, not a task plan.

---

## Escalation rule

Any Ticket / Baseline / Spec contradiction — including a proposed change to a
frozen public contract or a new shared mechanism — outputs exactly:

```text
ESCALATION_REQUIRED
```

with the concrete reason, and stops. It is never resolved by a normal Ticket.
