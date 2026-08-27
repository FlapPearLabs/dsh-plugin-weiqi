# Companion Go for DeepSeek Harness

This repository is the implementation home for Companion Go: one user-visible
Companion identity backed by isolated Work and Go sessions, one foreground
cognition lane, deterministic Go rules, and bounded model cognition.

The repository is currently a **Foundation only**. It contains a real
DSH/Cordis plugin entry, frozen public contracts, tests, CI, validated source
documents, the V4 interaction reference, and a repeatable DSH cooperative-yield
upgrade gate. It does not yet contain the Runtime, Go rules engine, tools, or
production UI.

## Status

- Architecture: **FROZEN — R2.4.2 VERIFIED**
- Cooperative Yield: **VERIFIED**
- Current Stage: **Ticket / Spike Decomposition**
- Next Stage: **Implementation Wave A**
- Spec Phase A: **Minimal Technical Vertical Slice**
- Implementation Wave A: **NOT STARTED**

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the authoritative stage marker.

## Pinned environment

- DeepSeek Harness commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- DSH packages: `0.1.1-rc.2`
- Node: `24.11.1`
- pnpm: `11.7.0`
- Vitest: `4.1.8`

Any DSH change must pass the cooperative-yield upgrade gate before adoption.

## Verify the package

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm verify
```

The independent `DSH cooperative-yield upgrade gate` GitHub workflow checks out
the pinned upstream DSH source on a fresh Ubuntu runner and executes all three
recorded experiments against the real AgentLoop.

The independent `DSH profile-install smoke` workflow builds and packs this
package, installs it with `dsh plugin --profile ... add`, verifies bundle
reconciliation and patch composition, then mounts the Foundation no-op plugin.

## Repository map

- `src/index.ts` — real, lifecycle-safe DSH/Cordis plugin entry
- `src/contracts/` — frozen Foundation contracts only
- `tests/upgrade-gates/cooperative-yield/` — executable DSH upgrade gate
- `docs/spec/` — verified architecture truth source
- `docs/validation/` — executed cooperative-yield evidence
- `docs/design/` — frozen V4 UI/UX reference and prototype
- `docs/context/` — concise project context and decisions
- `docs/roadmap/` — Implementation Wave boundaries only; no ticket decomposition

Spec Phases are product and architecture stages. Implementation Waves are
ticket-driven construction slices; future Tickets belong to a Wave and must
not redefine a Spec Phase.

## Foundation boundary

Do not implement Tenuki, GoRulesPort, Go tools, dual-session switching, Bridge
runtime, Attention, Persona, Mood, budget enforcement, anti-cheat enforcement,
production UI, desktop wrappers, or post-game engines during this stage.
