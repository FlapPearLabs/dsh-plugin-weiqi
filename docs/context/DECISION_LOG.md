# Decision Log

This log points to decisions; it does not duplicate the verified Spec.

| Decision | Status | Authority |
|---|---|---|
| One Companion identity, two isolated sessions, one foreground cognition lane | Frozen | R2.4 §§4–7 |
| Runtime is the only cross-lane wake/admission authority | Frozen | R2.4 §§6–8 |
| Atomic `PendingFocusIntent`; user command outranks self-initiated focus | Frozen | R2.4 §5 |
| Latest-value Bridge is awareness only, never an operational queue | Frozen | R2.4 §§9–12 |
| Preferred cooperative yield is batch splice + reject + blocked/idle | Executable-verified | Spike record |
| `cancel(keepInbox)` is not required on pinned DSH | Executable-verified | Spike negative controls |
| Tenuki behind `GoRulesPort` is the sole future rules authority | Frozen; not implemented | R2.4 §§25–31 |
| Live Go has no external solver, Code Mode, or subagent | Frozen; not implemented | R2.4 §§18–23 |
| DSH Web and V4 are the future production UI baseline | Frozen; not implemented | R2.4 §§32–35 + V4 |
| V4 is authoritative for UI/UX presentation only; verified Spec wins every behavioral conflict | Bootstrap clarification | `docs/design/IMPLEMENTATION_BOUNDARIES.md` |
| Spec Phases are architecture stages; Implementation Waves are ticket-driven construction slices | Bootstrap clarification | `docs/roadmap/BUILD_PHASES.md` |
| Repository remains one TypeScript package | Bootstrap decision | Foundation instruction |
| Persona and Mood internal schemas remain generic in Foundation | Bootstrap decision | R2.4 leaves shapes unfrozen |
| Empty repository receives one README-only `main` initialization commit before the complete Foundation is committed on the work branch; Foundation remains unmerged | Bootstrap deviation | GitHub API requires a base ref before creating a non-default branch |
| Resign is a terminal Companion Go action handled at the GoRulesPort boundary; Tenuki remains the sole board-rules engine behind the port; `resign` is a canonical GameAction (opponent wins by resignation, no board mutation, no UI-only truth, no GameLifecycleController) | Approved contract clarification | R2.4.1 §§25/26/28/31/32/36 + `docs/context/DECISION_LOG.md` |

## Change rule

A change to the verified Spec, public contracts, or a new shared mechanism
requires `ESCALATION_REQUIRED` and a stop before implementation.
