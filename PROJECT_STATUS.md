# Project Status

- Architecture: **FROZEN — R2.4.4 VERIFIED** (desktop UI target per R2.4.4; not yet verified on the desktop App)
- Cooperative Yield: **VERIFIED**
- Repository Bootstrap: **COMPLETE**
- Planning Baseline: **ESTABLISHED**
- Current Stage: **Ticket / Spike Execution Ready**
- Next Stage: **Pre-A Spikes + Implementation Wave A**
- Spec Phase A: **Minimal Technical Vertical Slice**
- Implementation Wave A: **IN PROGRESS — WAVE-A-T01 / T02 / T03 / T04 / T05 / T07 MERGED**
- Implementation Wave C: **IN PROGRESS — C-T10 real request path merged (PR #110), DeepSeek calibration pending**
- Implementation Wave D: **IN PROGRESS — D-S01 closed with the hybrid delivery decision (PR #64, `bbc3d97`; issue #28 closed); D-T03 hybrid delivery merged (PR #114, `999f85a`; hardened in PR #116, `5f75cb4`; issue #31 closed)**
- Implementation Wave E: **IN PROGRESS — E-T01 Core UI partial merged (PR #111), React host mount blocked; issue #38 open**
- Ticketization: **COMPLETE**

## Current scope

The repository contains the project Foundation plus five verified Wave A
Runtime slices: AgentLoop-owned Work/Go Agent-Session pairs with stable lane
IDs, isolated histories, live Session resolution, and deterministic
disposal/remount; the pure RuntimeFocusState machine with one active lane,
explicit `llmRunning`, single-slot focus arbitration, and one optional paused
lane; safe-boundary eligibility detection over the real pinned DSH step and
model-stream lifecycle without continuation interception or lane switching;
cooperative-yield production integration with the actual post-settle lane
switch; immutable source-message handoff with Companion provenance; and resume
sequencing that admits the preserved next-step context exactly once after a
paused-lane return. The package declares a DSH Profile Bundle whose patch
mounts this Runtime entry.

Spec Phase is a product/architecture execution gate. Implementation Wave is an
organizational construction stream. A Ticket belongs to a Wave and must not
redefine a Spec Phase; a Wave is not contained inside a Spec Phase.

## Stage exit

Planning is complete and the approved Ticket Graph is materialized as GitHub
Issues. The next action is:

```text
Begin Pre-A Spikes and Implementation Wave A from latest main.
```
