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
| Repository remains one TypeScript package | Bootstrap decision | Foundation instruction |
| Persona and Mood internal schemas remain generic in Foundation | Bootstrap decision | R2.4 leaves shapes unfrozen |
| Empty repository receives one README-only `main` initialization commit before the complete Foundation is committed on the work branch; Foundation remains unmerged | Bootstrap deviation | GitHub API requires a base ref before creating a non-default branch |

## Change rule

A change to the verified Spec, public contracts, or a new shared mechanism
requires `ESCALATION_REQUIRED` and a stop before implementation.
