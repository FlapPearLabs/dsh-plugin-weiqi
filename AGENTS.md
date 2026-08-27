# Repository Agent Rules

These rules apply to the entire repository.

## Authority order

When sources conflict, use this strict order:

1. verified Spec;
2. executable evidence;
3. current pinned source;
4. frozen design;
5. roadmap;
6. Ticket.

The verified Spec is `docs/spec/SPEC_LEAN_V0.1_R2.4_VERIFIED.md`. The executable
evidence record is `docs/validation/DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md`.

## Frozen architecture

- Do not independently change the frozen architecture.
- Do not add a generalized queue, event bus, focus lease, epoch, transaction,
  or exactly-once mechanism without a verified concrete failure requiring it.
- Do not synchronize or inject raw Work/Go histories across lanes.
- Go lane must not inherit Code Mode, Bash, Python, Web, subagents, generic MCP,
  or any general execution capability.
- Live Go must not use KataGo, Leela, MCTS, GNU Go, an external solver, or a
  second strategic Agent.
- Do not fabricate evidence, test output, CI state, version pins, or runtime
  behavior. A written workflow is not proof that it ran.
- Any DSH commit or package upgrade requires rerunning the cooperative-yield
  fixture before adoption.

If work requires modifying the verified Spec, a public contract, or introducing
a new shared mechanism, output exactly:

```text
ESCALATION_REQUIRED
```

Explain the concrete reason and STOP. Do not implement the change.

## Scope discipline

- Read `PROJECT_STATUS.md` before starting work.
- Respect the current phase and explicit Ticket boundary.
- Spec Phase means a product/architecture stage; Implementation Wave means a
  ticket-driven construction slice within that stage.
- Future Tickets belong to an Implementation Wave and must not redefine a Spec
  Phase.
- Do not start Implementation Wave A during Repository Bootstrap or
  ticketization.
- Keep the package single-package until pinned DSH proves a split necessary.
- Preserve V4 as the current UI/UX reference; do not restart style exploration.
- Design and prototype files are authoritative only for UI/UX presentation
  unless the verified Spec explicitly delegates behavior to them.
- Never derive Go rules, strategy, budget, Attention semantics, or capability
  policy from prototype JavaScript.
- When Design conflicts with the verified Spec, the verified Spec wins.

## Git and verification

- Never use `git add -A`, `git add .`, or `git add --all`.
- Stage only named, reviewed paths with `git add -- <paths>`.
- Inspect staged and unstaged diffs before committing.
- Run the narrowest relevant tests plus package verification.
- Report failures and uncertainty directly; never infer PASS from source reading.
