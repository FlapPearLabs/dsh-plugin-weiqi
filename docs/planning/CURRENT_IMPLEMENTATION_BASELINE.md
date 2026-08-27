# Current Implementation Baseline

**Status:** ESTABLISHED — planning index of the current implementation state
**Base:** `db3d8960a0fd1011e4cad7ec2b2bdedeb298c980` (main, post-Foundation)
**Authority:** AGENTS.md order — Verified Spec > Executable Evidence > Current Pinned Source / Real Repository State > **this Baseline** > Frozen Design > Roadmap > Ticket

This file is a **planning index of the current repository state**, not a new
architecture Spec. If any row conflicts with real code, tests, or executable
evidence, the evidence wins and this Baseline must be corrected. Tickets must
never override this Baseline or the Spec.

The only Baseline artifact is this Markdown file. No parallel JSON/YAML
baseline exists or should be created.

---

## State model

`IMPLEMENTED_VERIFIED` · `FOUNDATION_ONLY` · `VERIFIED_FACT_NOT_INTEGRATED` ·
`NOT_IMPLEMENTED` · `NEEDS_SPIKE` · `DEFERRED` · `CONFLICT_UNCLEAR`

## Handling model

`NO_ACTION` · `IMPLEMENTATION_TICKET` · `INTEGRATION_TICKET` · `SPIKE` ·
`KEEP_AS_UPGRADE_GATE` · `SMALL_INFRA_TICKET` · `DEFER` ·
`ESCALATION_REQUIRED`

---

## Repository / Packaging

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-PKG-01 | DSH plugin entry | Real lifecycle-safe Cordis plugin | `src/index.ts` (`apply()` no-op, `name='companion-go'`); `src/index.test.ts` mount/dispose; profile smoke mounts fiber in real Loader tree | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-02 | DSH Profile Bundle declaration | `package.json` declares bundle | `package.json` `dsh.bundle.patch="./cordis.patch.yml"`; smoke asserts packed manifest | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-03 | cordis.patch | Bundle patch mounts plugin row | `cordis.patch.yml` insert `companion-go` → `@flappearlabs/dsh-plugin-weiqi`; smoke asserts composeEntries + dump-config | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-04 | build / package | Reproducible build + pack | `pnpm verify` (tsc build → lib/); smoke runs `pnpm pack` and asserts tarball contents | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-05 | profile install (packed tarball) | `dsh plugin --profile add <tgz>` + bundle reconciliation + mount | `tests/profile-install/run-profile-install-smoke.sh` + `profile-mount-smoke.mjs`; CI pass | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-06 | GitHub source install | `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` builds and activates | No evidence: smoke covers local tarball only; no `github:` spec path tested | NEEDS_SPIKE | Unknown CLI resolution/build/activation path for `github:` spec | — | SPIKE |
| BL-PKG-07 | Foundation CI | typecheck + tests + build automated | `.github/workflows/ci.yml` (Node 24.11.1 / pnpm 11.7.0 pins); pass on foundation HEAD | IMPLEMENTED_VERIFIED | Trigger policy is bootstrap-era (see BL-CI-01) | — | NO_ACTION |
| BL-PKG-08 | DSH version pin | Exact pinned DSH commit/packages | DSH `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; packages `0.1.1-rc.2` (peerDeps + gate assertions) | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-09 | cooperative-yield upgrade gate | Any DSH change reruns the fixture | `.github/workflows/cooperative-yield-upgrade-gate.yml` (copies fixture into pinned DSH tree, real AgentLoop); pass | IMPLEMENTED_VERIFIED | None | — | KEEP_AS_UPGRADE_GATE |

## CI trigger policy

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-CI-01 | Post-bootstrap CI trigger policy | CI runs on current default branch / normal PR flow | All three workflows still trigger push on `work/bootstrap-foundation-v1`; only `ci.yml` has a generic `pull_request`; cooperative-yield gate and profile-install smoke have no regular PR trigger | NOT_IMPLEMENTED | No policy for main-based development; CI would not run on normal PRs against `main` | — | SMALL_INFRA_TICKET |

## Runtime / Focus

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-RT-01 | Work / Go two isolated sessions | Two durable isolated DSH sessions | No runtime code; only `Lane` type | NOT_IMPLEMENTED | Session creation + lifecycle | A | IMPLEMENTATION_TICKET |
| BL-RT-02 | One foreground cognition lane | At most one active lane invariant | No runtime code; only `RuntimeFocusState.activeLane` type | NOT_IMPLEMENTED | Lane arbitration state machine | A | IMPLEMENTATION_TICKET |
| BL-RT-03 | Lane / PendingFocusIntent / RuntimeFocusState contracts | Spec §5 exact shapes | `src/contracts/focus.ts` matches Spec field-for-field; type-level tests | FOUNDATION_ONLY | Behavior, not shape | A | IMPLEMENTATION_TICKET |
| BL-RT-04 | user_command > self_initiated arbitration | Spec §5 precedence | No code beyond `origin` field | NOT_IMPLEMENTED | Arbitration logic | A | IMPLEMENTATION_TICKET |
| BL-RT-05 | Immutable UserMessage handoff | Spec §5/§7 exact source message | Contract references DSH `UserMessage`; no runtime handling | FOUNDATION_ONLY | Handoff behavior | A | IMPLEMENTATION_TICKET |
| BL-RT-06 | Safe-boundary switching | Spec §7.1.1 step-boundary switch | Spike verified seam against real AgentLoop; not integrated | VERIFIED_FACT_NOT_INTEGRATED | Runtime integration | A | INTEGRATION_TICKET |
| BL-RT-07 | Cooperative yield production integration | Spec §7.1.2 | Spike 3/3 pass; preferred seam = batch splice + reject + blocked/idle + external resume | VERIFIED_FACT_NOT_INTEGRATED | Runtime integration; gate already verified | A | INTEGRATION_TICKET |
| BL-RT-08 | pausedLane contract / state field | Spec §5/§7.1.2 | `RuntimeFocusState.pausedLane` contract exists in `src/contracts/focus.ts`; no Runtime state machine | FOUNDATION_ONLY | Behavior, not shape | A | IMPLEMENTATION_TICKET |
| BL-RT-09 | Inactive-lane natural-language admission | Spec §7.2 | No code (concept only) | NOT_IMPLEMENTED | Runtime + UI admission path | A | IMPLEMENTATION_TICKET |
| BL-RT-10 | Board click direct route | Spec §7.2/§32 | No code | NOT_IMPLEMENTED | User interaction: board click → UI → GoRulesPort → resulting state/GameNotice → UI. Depends on BL-GR-01 (GoRulesPort behavior) and BL-UI-02 (production UI); not part of Go Agent tools | E | IMPLEMENTATION_TICKET |
| BL-RT-11 | Resume sequencing / cooperative external resume integration | Spec §5/§7.1.2 | Verified cooperative-yield spike resume ordering (A→B→C→companion-resume) and external resume seam against pinned DSH `b150a551...`; not integrated into production Runtime | VERIFIED_FACT_NOT_INTEGRATED | Production Runtime integration | A | INTEGRATION_TICKET |

## Bridge / Context

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-BR-01 | WorkSnapshot / GameNotice / CompanionBridge contracts | Spec §9-11 exact shapes | `src/contracts/bridge.ts` matches Spec; type-level tests | FOUNDATION_ONLY | Behavior, not shape | D | IMPLEMENTATION_TICKET |
| BL-BR-02 | Latest-value semantics | Spec §9 awareness only, never a queue | No runtime holder/updater | NOT_IMPLEMENTED | State ownership + updates | D | IMPLEMENTATION_TICKET |
| BL-BR-03 | ctx.systemPrompt.context provider delivery | Spec §9.1 DSH-native agent-scoped context | No evidence: provider registration/render/dedup behavior on pinned DSH unverified | NEEDS_SPIKE | Unknown DSH provider seam semantics | D (gate) | SPIKE |
| BL-BR-04 | Cross-lane awareness / no raw transcript injection | Spec §12/§35 | Contract only; AGENTS frozen constraint | FOUNDATION_ONLY | Behavior | D | IMPLEMENTATION_TICKET |
| BL-BR-05 | Bridge-only changes do not trigger evaluation wakes | Spec §9.1 | No code | NOT_IMPLEMENTED | Needs Attention linkage | D | IMPLEMENTATION_TICKET |

## Go Rules

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-GR-01 | GoRulesPort interface | Spec §26 (R2.4.1) `createGame/play/pass/resign/getState/inspectGroup/score/settle`; GoRulesPort = sole application-facing game-mutation boundary; resign = terminal action at the port, no second board-rules authority | Absent from `src/contracts` | NOT_IMPLEMENTED | Interface + implementation (incl. resign) | B | IMPLEMENTATION_TICKET |
| BL-GR-02 | Tenuki Adapter | Spec §26/§27 rules authority behind port | No dependency, no code | NOT_IMPLEMENTED | Adapter + explicit config | B | IMPLEMENTATION_TICKET (blocked by BL-GR-03) |
| BL-GR-03 | Pinned Tenuki version + conformance | Spec §27 exact version; §31 superko fixture passes | No Tenuki dependency; no fixture; no candidate evaluation record | NEEDS_SPIKE | Which Tenuki satisfies area + positional-superko + komi 7.5 explicit config | B (gate) | SPIKE |
| BL-GR-04 | Chinese area scoring / komi 7.5 / positional superko | Spec §25/§27 | No code; `IMPLEMENTATION_BOUNDARIES.md` fixes production komi 7.5 (not prototype 6.5) | NOT_IMPLEMENTED | Rules behavior | B | IMPLEMENTATION_TICKET |
| BL-GR-05 | Captures / suicide / pass / two-pass settlement / dead-stone flow | Spec §25/§31 fixtures | No code, no fixture tests | NOT_IMPLEMENTED | Rules behavior | B | IMPLEMENTATION_TICKET |
| BL-GR-06 | Canonical action log / replay | Spec §28 (R2.4.1) canonical record; actions = play/pass/resign; replay marks terminal on resign; winner/reason derived (opponent / resignation); no Tenuki internals serialized | No `CanonicalGameRecord`/`GameAction` types | NOT_IMPLEMENTED | Record schema + replay (incl. resign terminal) | B | IMPLEMENTATION_TICKET |
| BL-GR-07 | Deterministic fixtures | Spec §31 (R2.4.1) **eleven cases** incl. resignation terminal / canonical replay restoration | No fixtures | NOT_IMPLEMENTED | Fixture suite with GoRulesPort (11 cases) | B | IMPLEMENTATION_TICKET |

## Go Tools / Strategy

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-GT-01 | DeepSeek sole live strategy owner | Spec §18 no external solver/agent | No code; AGENTS frozen constraint; smoke asserts `companion-go-tools` absent | NOT_IMPLEMENTED | Tool surface + preset | C | IMPLEMENTATION_TICKET |
| BL-GT-02 | 7 go.* model-facing tools | Spec §20: `go.state`, `go.inspect_group`, `go.inspect_region`, `go.try_move`, `go.play`, `go.pass`, `go.request_deep_think` | No tool registration | NOT_IMPLEMENTED | All seven tools | C | IMPLEMENTATION_TICKET |
| BL-GT-03 | 2 companion.* model-facing tools | Spec §20/§14: `companion.affect`, `companion.request_focus` | No tool registration | NOT_IMPLEMENTED | Both tools | C | IMPLEMENTATION_TICKET |

(Total model-facing surface: 7 `go.*` + 2 `companion.*` = 9 tools.)

## Capability / Anti-cheat

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-CAP-01 | Go lane isolated preset | Spec §19/§21 no Code Mode / bash / python / web / subagent / generic MCP / solver | No preset, no scope configuration | NOT_IMPLEMENTED | Preset + scope | C | IMPLEMENTATION_TICKET |
| BL-CAP-02 | Execution-time capability guards | Spec §21 | No code | NOT_IMPLEMENTED | Guards at tool boundary | C | IMPLEMENTATION_TICKET |
| BL-CAP-03 | Anti-cheat tests | Spec §39.3 | No tests | NOT_IMPLEMENTED | Test suite with Wave C | C | IMPLEMENTATION_TICKET |

## Budget

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-BUD-01 | GoTurnBudget contract | Spec §22 fields | Absent from `src/contracts` | NOT_IMPLEMENTED | Contract + defaults | C | IMPLEMENTATION_TICKET |
| BL-BUD-02 | Per-request / per-turn hard caps + tool accounting + exhaustion | Spec §22.1-22.4 | No code | NOT_IMPLEMENTED | Accounting + enforcement | C | IMPLEMENTATION_TICKET |
| BL-BUD-03 | Deep-think boost (bounded) | Spec §23 | No code | NOT_IMPLEMENTED | Boost path | C | IMPLEMENTATION_TICKET |
| BL-BUD-04 | Post-move no-analysis-loop rule | Spec §24 | No code | NOT_IMPLEMENTED | Rule enforcement | C | IMPLEMENTATION_TICKET |
| BL-BUD-05 | Budget bypass tests | Spec §39.4 | No tests | NOT_IMPLEMENTED | Test suite with Wave C | C | IMPLEMENTATION_TICKET |
| BL-BUD-06 | Automated cognition benchmark / production budget calibration | R2.4.1 §38 automated cognition benchmark — fixture classes: opening, simple capture, escape, local fight, ko, large-group pressure, endgame, ambiguous position. For EACH fixture record: latency, input token usage, output token usage (total token usage if useful), model steps, inspect calls, try_move calls, deep-think requests, illegal attempts, final move, variation across repeated runs. Production GoTurnBudget numeric defaults chosen from real benchmark evidence; do not collapse input/output tokens into one field, large-group pressure into vague "pressure", simple capture into an unrelated category, or drop repeated-run variation | No benchmark harness / run / calibration record; current values must NOT be treated as production-frozen values | NOT_IMPLEMENTED | No benchmark harness / run / calibration record; production numeric defaults have no owner | C | IMPLEMENTATION_TICKET |
| BL-BUD-07 | Pinned DSH request-level token hard-cap seam | Spec §22.1 per-request hard cap enforceable on pinned DSH | No executable proof of the request-level cap hook / config field / propagation / enforcement on pinned DSH; only the agent/request waterfall is evidenced | NEEDS_SPIKE | Pinned DSH request-level token cap real hook / config field / propagation / enforcement not executable-verified | C (gate) | SPIKE |

## Companion

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-CMP-01 | CompanionState contract | Spec §13 | `src/contracts/companion.ts` generic `CompanionState<TCompiledPersona, TMoodState>`; test asserts internals intentionally unfrozen | FOUNDATION_ONLY | Persistence + behavior | D | IMPLEMENTATION_TICKET |
| BL-CMP-02 | Persona / Persona Compiler | Spec §15 | No code (schema intentionally generic) | NOT_IMPLEMENTED | Compiler + schema freeze decision | D | IMPLEMENTATION_TICKET |
| BL-CMP-03 | Mood (bounded deltas, clamp, baseline return) | Spec §14 | No code | NOT_IMPLEMENTED | Reducer | D | IMPLEMENTATION_TICKET |
| BL-CMP-04 | Attention modes (Mofish / Normal / Strict / Manual) | Spec §16 | Only `AttentionMode` type; V4 presents UI only | FOUNDATION_ONLY | Runtime semantics | D | IMPLEMENTATION_TICKET |
| BL-CMP-05 | Self-initiated focus | Spec §5/§6 | No code | NOT_IMPLEMENTED | Trigger + arbitration | D | IMPLEMENTATION_TICKET |

## UI

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-UI-01 | V4 design / prototype reference | Frozen UI/UX reference | `COMPANION_GO_DESIGN_V4.md` + `companion-go-apple-style-v4.html`; boundaries doc fixes komi 7.5 vs 6.5, random AI, fake timing as presentation-only | IMPLEMENTED_VERIFIED | None (reference only, not production) | — | NO_ACTION |
| BL-UI-02 | Production Harness **Core** Go UI | Spec §32/§33 (R2.4.1) core board in Harness Web: 9x9/13x13/19x19, stones, captures, last move, turn, Pass, **Resign (Resign control → GoRulesPort.resign → authoritative terminal state → final-result UI; no UI-only gameOver truth)**, final result, minimal placement/capture animation, minimal stone sound, board click direct route, no transcript fusion, no prototype behavior inheritance | No production code; no view extension | NOT_IMPLEMENTED | Core UI implementation (Goban, seats, controls, board click, resign, sound) | E | IMPLEMENTATION_TICKET (blocked by BL-UI-04) |
| BL-UI-03 | Desktop wrapper | Spec §33 compatible desktop second | No code | DEFERRED | Out of V0.1 scope | — | DEFER |
| BL-UI-04 | DSH Web / conversation.view extension seam | Spec §34 capability smoke before depending | No probe; seam capability unknown on pinned DSH | NEEDS_SPIKE | Go view coexistence with Chat/Trajectory, dual-session single shell, mini-surface placement, no transcript fusion | E (gate) | SPIKE |
| BL-UI-05 | Companion mini-surface / projection UX | Spec §33/§35 (R2.4.1): Work View Go status / Go notice UX; Go View WorkSnapshot UX; clean mini-surface placement proven by E-S01; Companion-mode/persona peripheral presentation where applicable; latest-value projections only, no transcript fusion, no prototype rule/AI semantics | No code | NOT_IMPLEMENTED | Companion mini-surface UX (Spec Phase B) | E | IMPLEMENTATION_TICKET |

## Hardening

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-HARD-01 | Crash / resume (dual session + canonical record + CompanionState) | Spec §36 (R2.4.1): restore sessions/canonical record/board/CompanionState/attention mode; **a resigned game remains terminal after restart/replay with same winner and reason = resignation** | No code | NOT_IMPLEMENTED | Recovery pipeline (incl. resigned-game restoration) | F | IMPLEMENTATION_TICKET |
| BL-HARD-02 | Replay recovery | Spec §28/§36 (R2.4.1): replay play/pass through port; on resign mark terminal without board mutation; derive winner/reason; **resigned game remains terminal after replay** | No code | NOT_IMPLEMENTED | Depends on BL-GR-06 | F | IMPLEMENTATION_TICKET |
| BL-HARD-03 | End-to-end integration (work → go → work continuity) | Spec §40 | No code | NOT_IMPLEMENTED | Full continuity validation | F | IMPLEMENTATION_TICKET |
| BL-HARD-04 | Post-game analysis boundary | Spec §37 | No code; AGENTS frozen constraint | DEFERRED | Separate future scope | — | DEFER |
| BL-HARD-05 | Spec Phase A core exit / viability gate | Evidence gate proving the core technical vertical slice is sound enough to allow Companion Layer (Phase B) execution; §40 core correctness counters + context isolation + cognition exclusivity + anti-cheat + budget bypass + §38 benchmark-derived budget + core Go UI + work→go→work continuity + DSH Phase A smoke gates + small number of complete human games / UX validation | No gate exists | NOT_IMPLEMENTED | Phase A exit gate (evidence/acceptance, not a new subsystem) | F | INTEGRATION_TICKET |
| BL-HARD-06 | Full V0.1 acceptance after Companion Layer | R2.4.1 Spec §40 complete: Correctness, Context Isolation, Continuity, Cognition Exclusivity, Anti-Cheat, Budget, Persona Continuity, Subjective UX | No code | NOT_IMPLEMENTED | Full V0.1 acceptance owner (Phase B) | F | INTEGRATION_TICKET |

Installation / upgrade validation is covered by BL-PKG-05 (verified), BL-PKG-06 (spike), BL-PKG-09 (upgrade gate).

---

# ALREADY DONE — DO NOT TICKET

These are verified; future work must not recreate them as ordinary
implementation Tickets:

- DSH plugin entry (BL-PKG-01) — mount/dispose verified
- Profile Bundle declaration (BL-PKG-02) — packed manifest verified
- cordis.patch (BL-PKG-03) — composition verified
- packed-tarball profile installation (BL-PKG-05) — real `dsh plugin --profile add` verified
- plugin mount in real Loader tree (BL-PKG-05) — fiber active verified
- Foundation build/test (BL-PKG-04, BL-PKG-07) — typecheck + 4 tests + build verified
- frozen core contracts (BL-RT-03, BL-BR-01, BL-CMP-01, BL-CMP-04) — type-level tests
- cooperative-yield feasibility (BL-RT-07) — 3/3 spike experiments pass
- cooperative-yield executable evidence — `docs/validation/DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md`
- cooperative-yield upgrade gate (BL-PKG-09) — real pinned-DSH AgentLoop gate
- V4 design reference (BL-UI-01) — frozen presentation evidence
- design implementation boundary — `docs/design/IMPLEMENTATION_BOUNDARIES.md`
- DSH pins (BL-PKG-08) — commit `b150a551...` / packages `0.1.1-rc.2`

# FOUNDATION ONLY — IMPLEMENT BEHAVIOR, DO NOT RECREATE CONTRACT

These contracts already exist in `src/contracts/`. Future Tickets implement
behavior / integration / runtime semantics / persistence only. Creating a
second synonymous contract is forbidden; modifying these public contracts
requires `ESCALATION_REQUIRED`:

- `Lane`, `PendingFocusIntent`, `RuntimeFocusState` (BL-RT-03)
- `RuntimeFocusState.pausedLane` state field (BL-RT-08)
- `WorkSnapshot`, `GameNotice`, `AffectedGroupDelta`, `CompanionBridge` (BL-BR-01)
- `CompanionState`, `AttentionMode` (BL-CMP-01, BL-CMP-04)

# VERIFIED FACT — NOT INTEGRATED

cooperative yield (BL-RT-07):

```text
Feasibility:          VERIFIED (3/3 spike experiments, pinned DSH b150a551...)
Upgrade gate:         IMPLEMENTED_VERIFIED (BL-PKG-09)
Production integration: VERIFIED_FACT_NOT_INTEGRATED
```

resume sequencing / cooperative external resume integration (BL-RT-11):

```text
Feasibility:          VERIFIED (spike resume ordering A→B→C→companion-resume, pinned DSH b150a551...)
Production integration: VERIFIED_FACT_NOT_INTEGRATED
```

Future work may create only `INTEGRATION_TICKET`s for these seams. No new
feasibility Spike.

# REAL UNKNOWNS — SPIKE CANDIDATES

| Baseline ID | Unknown | Why not directly implement | Dependent decision | Why current evidence is insufficient |
|---|---|---|---|---|
| BL-PKG-06 | GitHub source install (`dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi`) | `github:` spec resolution/clone/build/activate path is unverified | Installation docs, Wave F installation acceptance | Smoke covers local tarball only; no `github:` path code or CI evidence |
| BL-GR-03 | Tenuki version satisfying area + positional-superko + komi 7.5 explicit config, passing §31 fixture | Spec §27 forbids defaults, silent downgrade, dual rules authority | GoRulesPort / TenukiAdapter version pin and implementation | No Tenuki dependency, no fixtures, no candidate evaluation record |
| BL-UI-04 | DSH Web `conversation.view` extension seam actual capability | Spec §34 mandates proving seam before depending | Wave E UI architecture | No probe or smoke of the DSH Web UI seam |
| BL-BR-03 | `ctx.systemPrompt.context` agent-scoped runtime-context provider semantics | Spec §9.1 requires read-only computed values, O(1), materialized on change | Wave D Bridge delivery mechanism | No provider code or DSH-internal probe |
| BL-BUD-07 | Pinned DSH request-level token hard-cap seam | Spec §22.1 per-request hard cap must be enforceable at request creation | WAVE-C-T07 enforcement seam choice | No executable probe of request call-config / max-token field / propagation / enforcement on pinned DSH |

Not spikes: cooperative-yield feasibility (verified), V4 style exploration
(frozen), crash/resume mechanism (conservative V0.1 strategy, implementation
task). Production budget numeric values are owned by BL-BUD-06
(IMPLEMENTATION_TICKET, benchmark-derived calibration) — they are a calibration
task, not a Spike.
