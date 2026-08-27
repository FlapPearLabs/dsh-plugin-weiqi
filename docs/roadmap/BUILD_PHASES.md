# Build Phases

This file defines phase boundaries only. Ticket and spike decomposition is the
next project stage and is intentionally absent here.

## A — Runtime / dual session / focus / resume

Build the minimal Runtime vertical slice: isolated Work and Go sessions, one
foreground lane, atomic focus intent, exact source-message handoff, verified
cooperative yield, resume, and required DSH capability smoke gates.

## B — GoRulesPort / Tenuki / rules fixtures

Introduce the sole authoritative Go rules boundary, explicit pinned Tenuki
configuration, canonical action replay, and engine-independent contract tests.

## C — Go tools / capability isolation / budget / anti-cheat

Add the bounded model-facing Go tool surface, isolated native-only Go preset,
execution-time capability guards, and request/turn/tool budget enforcement.

## D — Bridge / Attention / Persona / Mood

Add factual latest-value projections, attention modes, shared Companion state,
persona compilation, and bounded mood deltas without transcript synchronization.

## E — Harness Web UI

Implement the production DSH Web experience by directly referencing the frozen
V4 structure and interaction design. The V4 HTML remains a prototype, not
production code.

## F — Integration / crash-resume / post-game / hardening

Validate end-to-end isolation and continuity, canonical recovery, failure
handling, UX hardening, and separately scoped post-game analysis.
