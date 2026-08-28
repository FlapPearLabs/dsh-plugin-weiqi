# Companion Go — Ticket / Spike Graph V1.2.1

**Status:** REVIEW_PENDING
**Supersedes for review:** `TICKET_GRAPH_V1.2.md`
**Current Spec Authority:** `docs/spec/SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md`
**Reason (narrow fix, 4 items):**
- DeepSeek resign authoritative action path (`go.resign` model tool; surface 8 go.* + 2 companion.* = 10) — R2.4.2
- Spec Phase ticket count correction (A=31, B=7; V1.2 wrongly stated A=30/B=8)
- C-T01 / C-T02 acceptance semantic cycle removed
- AGENTS.md residual Phase/Wave definition corrected (wave not contained inside a phase)

**Base:** remote main `e82b376c147317dbae928a8a2bf2cd6be967dbbc`
**Branch:** `work/ticket-decomposition-v1`
**Parent HEAD:** `81951ceeec42a9b6427f56681a2fb0808ff563fd` (V1.2)

**Method:** Verified Spec (R2.4.2) − Current Implementation Baseline = Remaining Gap Graph, per `docs/planning/TICKET_DECOMPOSITION_CONTRACT.md`. V1.2.1 is a narrow fix of V1.2, not a re-decomposition and not an architecture redesign.

**Delta vs V1.2 (narrow consistency fix, no re-decomposition):**
- R2.4.2: `go.resign` model tool added — DeepSeek resign path `go.resign → GoRulesPort.resign → authoritative terminal state → GameNotice/UI`; model-facing surface becomes 8 `go.*` + 2 `companion.*` = 10 (§20/§32); §24 Go Turn Lifecycle now includes resign as an authoritative action with immediate terminal and no further step (this fix round).
- Spec Phase distribution corrected (V1.2 wrongly stated A=30/B=8): Pre-A = 6, A = 31, B = 7, Total = 44; §6 gate graph expresses execution work vs gates (30 + F-T04 gate / 6 + F-T05 acceptance).
- C-T01 re-scoped to structural registry policy (acceptance no longer depends on C-T02 output); C-T02 owns tool registration and the post-registration enumeration assertion — acceptance semantic cycle removed.
- AGENTS.md residual Phase/Wave definition corrected (Wave = organizational construction stream; Spec Phase = execution gate; a Wave is not contained inside a Spec Phase).
- V1.2.1 audit metadata corrected: this round changed 7 files (see §13); BUILD_PHASES.md was not touched this round.

---

## 1. Baseline row counts (mechanical, from `CURRENT_IMPLEMENTATION_BASELINE.md`)

Counted by unique `BL-*` ID extraction; the closing SPIKE-CANDIDATES table repeats Spike IDs and is not counted as rows.

| Metric | Value |
|---|---|
| Total baseline rows (unique IDs) | **62** (59 at V1.1 + BL-UI-05 + BL-HARD-05 + BL-HARD-06) |
| Actionable gaps (need Ticket/Spike ownership) | **51** |
| `IMPLEMENTED_VERIFIED` / NO_ACTION | 8 |
| `KEEP_AS_UPGRADE_GATE` | 1 (BL-PKG-09) |
| `DEFERRED` | 2 (BL-UI-03, BL-HARD-04) |
| `NEEDS_SPIKE` | 3 (BL-PKG-06, BL-GR-03, BL-BR-03) |
| `FOUNDATION_ONLY` | 7 (BL-RT-03/05/08, BL-BR-01/04, BL-CMP-01/04) |
| `VERIFIED_FACT_NOT_INTEGRATED` | 5 (BL-RT-06/07/11, BL-BUD-07, BL-UI-04) |
| `NOT_IMPLEMENTED` | 36 |

Breakdown check: 8 + 1 + 2 + 3 + 7 + 5 + 36 = 62 ✓

---

## 2. Ticket / Spike Summary (44)

| Group | IMPLEMENTATION | INTEGRATION | SMALL_INFRA | SPIKE | Total |
|---|---|---|---|---|---|
| Infra | 0 | 0 | 1 | 1 | 2 |
| Wave A | 4 | 3 | 0 | 0 | 7 |
| Wave B | 6 | 0 | 0 | 1 | 7 |
| Wave C | 9 | 1 | 0 | 1 | 11 |
| Wave D | 8 | 0 | 0 | 1 | 9 |
| Wave E | 1 | 1 | 0 | 1 | 3 |
| Wave F | 3 | 2 | 0 | 0 | 5 |
| **Total** | **31** | **7** | **1** | **5** | **44** |

51 actionable gaps → 44 Tickets/Spikes (5 multi-gap Tickets own 14 gaps atomically; see §9). Check: 31 + 7 + 1 + 5 = 44 ✓

### Spec Phase distribution

| Spec Phase | Tickets / Spikes |
|---|---|
| Pre-A | 6 (INFRA-T01, INFRA-S01, B-S01, C-S01, D-S01, E-S01) |
| A | 31 (A-T01..A-T07, B-T01..B-T06, C-T01, C-T02, C-T04..C-T10, D-T01..D-T04, E-T01, F-T01..F-T04) |
| B | 7 (C-T03, D-T05, D-T06, D-T07, D-T08, E-T02, F-T05) |
| Total | 44 |

Wave labels are organizational; Spec Phase is the execution gate. Phase B Tickets may be planned now but must not execute before WAVE-F-T04 PASS.

---

## 3. Complete Ticket Table

### Infra

#### INFRA-T01 — Post-bootstrap CI trigger policy
- **Type:** SMALL_INFRA_TICKET | **Wave:** Infra | **Spec Phase:** Pre-A | **Baseline IDs:** BL-CI-01
- **Current Baseline State:** BL-CI-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** AGENTS.md git/verification discipline; Baseline CI trigger policy section
- **Scope:** Rewrite only the `on:` triggers of `.github/workflows/{ci.yml, cooperative-yield-upgrade-gate.yml, profile-install-smoke.yml}` to run on `main` and normal `pull_request` flow (path filters preserved). No step-logic changes.
- **Explicit Non-Goals:** No gate rewrite; no fixture change; no CI platform refactor.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `.github/workflows/`
- **Acceptance Criteria:** `ci.yml` triggers on PR targeting `main`; both other workflows gain `pull_request` with existing path filters; `git diff` restricted to `on:` blocks; `pnpm verify` passes on this branch.
- **Required Review Evidence:** trigger-only YAML diff; at least one successful CI run on the PR.
- **Stop / Escalation Condition:** trigger update requiring gate-logic or fixture changes → `ESCALATION_REQUIRED`.

#### INFRA-S01 — GitHub source install spike
- **Type:** SPIKE | **Wave:** Infra | **Spec Phase:** Pre-A | **Baseline IDs:** BL-PKG-06
- **Current Baseline State:** BL-PKG-06: NEEDS_SPIKE | **Target State:** IMPLEMENTED_VERIFIED (the Spike verifies the GitHub-source installation capability itself, so PASS advances the row to IMPLEMENTED_VERIFIED directly, not to VERIFIED_FACT_NOT_INTEGRATED)
- **Post-Spike State on PASS:** BL-PKG-06 → `IMPLEMENTED_VERIFIED` directly — no `VERIFIED_FACT_NOT_INTEGRATED` staging; the Spike-verified `github:` install path is the production capability, not a fact awaiting later integration (Post-Spike Stability Rule).
- **Spec Authority:** BL-PKG-05/06 evidence boundary
- **Scope:** On pinned DSH (`b150a551...`, `0.1.1-rc.2`, Node 24.11.1, pnpm 11.7.0), run real `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi`; observe resolution → clone → build → activation. Do not guess prepare/prepack before observing.
- **Explicit Non-Goals:** No publish-config change; no new install code; no profile-smoke modification.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** DSH CLI, `package.json`, `lib/`, `tests/profile-install/`
- **Acceptance Criteria (PASS):** command resolves/builds/activates in clean profile; `profile-mount-smoke.mjs` assertions pass; trace uploaded → BL-PKG-06 = IMPLEMENTED_VERIFIED. **FAIL:** record exact behavior + fallback (packed tarball docs); state reflects evidence (do not force IMPLEMENTED_VERIFIED without PASS).
- **Required Review Evidence:** executed trace; assertions; no invented success.
- **Stop / Escalation Condition:** frozen packaging mutation → `ESCALATION_REQUIRED`.

---

### Wave A — Runtime / dual session / focus / resume

#### WAVE-A-T01 — Dual isolated DSH session lifecycle
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Spec Phase:** A | **Baseline IDs:** BL-RT-01
- **Current Baseline State:** BL-RT-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §4, §44 "TWO isolated durable Session histories"
- **Scope:** Runtime creates/owns two durable isolated DSH sessions (`work`, `go`) on pinned DSH with distinct histories; minimal session registry.
- **Explicit Non-Goals:** No focus arbitration; no tools; no Bridge.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/runtime/`, pinned DSH Session API
- **Acceptance Criteria:** both sessions created; message admitted to `work` never appears in `go` history (deterministic); smoke on pinned AgentLoop.
- **Required Review Evidence:** test run log; isolation assertions.
- **Stop / Escalation Condition:** raw history injection → `ESCALATION_REQUIRED`.

#### WAVE-A-T02 — RuntimeFocusState machine + arbitration
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Spec Phase:** A | **Baseline IDs:** BL-RT-02, BL-RT-03, BL-RT-04, BL-RT-08
- **Current Baseline State:** BL-RT-02/04: NOT_IMPLEMENTED; BL-RT-03/08: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (RuntimeFocusState, one atomic PendingFocusIntent, `user_command > self_initiated`, pausedLane), §44
- **Existing Asset / Contract Reused:** `src/contracts/focus.ts` — `Lane`, `PendingFocusIntent`, `RuntimeFocusState` (incl. `pausedLane`)
- **Scope (atomicity):** four rows = one focus state machine (activeLane + llmRunning + single pendingFocus arbitration + pausedLane). Pure machine, no DSH-step wiring.
- **Explicit Non-Goals:** No DSH event wiring (A-T03); no queue/lease/epoch; no UI.
- **Dependencies / blocked_by:** WAVE-A-T01
- **Expected Surfaces:** `src/runtime/focus.ts`
- **Acceptance Criteria:** table-driven arbitration matrix; `pausedLane` at most one lane, cleared at resume admission; at-most-one activeLane property test; `contracts.test.ts` unchanged and green.
- **Required Review Evidence:** matrix/property output; additive-only contract diff.
- **Stop / Escalation Condition:** second pause/resume field or shape change → `ESCALATION_REQUIRED`.

#### WAVE-A-T03 — Safe-boundary switching (integration)
- **Type:** INTEGRATION_TICKET | **Wave:** A | **Spec Phase:** A | **Baseline IDs:** BL-RT-06
- **Current Baseline State:** BL-RT-06: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.1.1, §44 "SAFE focus handoff occurs between DSH steps"
- **Scope:** Wire A-T02 machine to pinned-DSH step boundary: switches only between committed `step/end` and next `step/start`; never mid-step; never aborting started work.
- **Explicit Non-Goals:** No yield (A-T04); no resume (A-T07); no re-spike.
- **Dependencies / blocked_by:** WAVE-A-T01, WAVE-A-T02
- **Expected Surfaces:** `src/runtime/`, pinned AgentLoop
- **Acceptance Criteria:** 20+ step synthetic Work turn; focus requested after step 3 commits; assert no step-4 `step/start`, step-3 completes, handoff at first continuation boundary.
- **Required Review Evidence:** executed trace; no-step-4 assertion.
- **Stop / Escalation Condition:** new shared mechanism (lease/epoch/timer) → `ESCALATION_REQUIRED`.

#### WAVE-A-T04 — Cooperative-yield production integration
- **Type:** INTEGRATION_TICKET | **Wave:** A | **Spec Phase:** A | **Baseline IDs:** BL-RT-07
- **Current Baseline State:** BL-RT-07: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.1.2 (splice→reject→blocked→idle→whenIdle→switch), §44 "PINNED DSH yield guard uses synchronous inbox batch-splice + continuation reject"
- **Existing Asset / Contract Reused:** verified seam from `DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md`; no re-spike.
- **Scope:** Implement verified yield path; do NOT retain `cancel(keepInbox)` (unnecessary on pinned commit).
- **Explicit Non-Goals:** No resume (A-T07); no fixture change.
- **Dependencies / blocked_by:** WAVE-A-T03
- **Expected Surfaces:** `src/runtime/`, `agent/pre-step`, `agent.inbox`
- **Acceptance Criteria:** reproduce main-path trace; inbox exactly `[A,B,C]`; no duplicate pending MessageId; no lost claimed message; negative control no same-lane auto-restart.
- **Required Review Evidence:** trace; message-integrity assertions.
- **Stop / Escalation Condition:** pinned-commit divergence → STOP + report; no silent new seam.

#### WAVE-A-T05 — Immutable source-message handoff
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Spec Phase:** A | **Baseline IDs:** BL-RT-05
- **Current Baseline State:** BL-RT-05: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (`sourceMessage` immutable DSH `UserMessage`; no late dereference; no `capturedText`), §44
- **Existing Asset / Contract Reused:** `src/contracts/focus.ts` — `PendingFocusIntent.sourceMessage`
- **Scope:** Deliver exact content blocks of stored immutable message with Companion-handoff provenance.
- **Explicit Non-Goals:** No admission (A-T06); no text-capture field.
- **Dependencies / blocked_by:** WAVE-A-T02
- **Expected Surfaces:** `src/runtime/`, DSH `UserMessage`
- **Acceptance Criteria:** compact/rewrite source surface; assert original immutable blocks + provenance; no late lookup; no second buffer.
- **Required Review Evidence:** test output; source inspection.
- **Stop / Escalation Condition:** unrepresentable handoff → `ESCALATION_REQUIRED`.

#### WAVE-A-T06 — Inactive-lane natural-language admission (admission-intent only)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Spec Phase:** A | **Baseline IDs:** BL-RT-09
- **Current Baseline State:** BL-RT-09: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.2 (user-origin activity needs no running Agent), §16 Manual, §44
- **Scope (narrowed):** UI/Runtime-side admission API only: create exact `PendingFocusIntent{target, origin:"user_command", sourceMessage}` with exact immutable `UserMessage`; submit through A-T02 arbitration; inactive Agent never run/judges first. No safe-boundary/wake promise (verified by A-T03/A-T04/A-T07/F-T03).
- **Explicit Non-Goals:** No safe boundary; no yield; no resume; no production UI; no LLM router; no queue/mailbox.
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-A-T05 (unchanged)
- **Expected Surfaces:** `src/runtime/`, simulated inactive View
- **Acceptance Criteria:** exactly one intent created with correct target/origin/sourceMessage; arbitration receives it; inactive Agent does not run first; no LLM router; no queue/mailbox.
- **Required Review Evidence:** admission tests; no-queue audit.
- **Stop / Escalation Condition:** generalized mailbox/queue → `ESCALATION_REQUIRED`.

#### WAVE-A-T07 — Resume sequencing / external resume integration
- **Type:** INTEGRATION_TICKET | **Wave:** A | **Spec Phase:** A | **Baseline IDs:** BL-RT-11
- **Current Baseline State:** BL-RT-11: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (`pausedLane`), §7.1.2 steps 8-10, verified resume ordering `A→B→C→companion-resume`
- **Existing Asset / Contract Reused:** `RuntimeFocusState.pausedLane`; spike resume record
- **Scope:** Production resume: return to `pausedLane` admits preserved next-step context; exactly one `companion-resume`; clear `pausedLane` at admission.
- **Explicit Non-Goals:** No re-spike; no transactional recovery.
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-A-T04
- **Expected Surfaces:** `src/runtime/`
- **Acceptance Criteria:** order `A,B,C,resume`; no duplicate MessageId; `pausedLane` cleared at admission.
- **Required Review Evidence:** resume trace; ordering assertions.
- **Stop / Escalation Condition:** durable pending-command need → `ESCALATION_REQUIRED`.

---

### Wave B — GoRulesPort / Tenuki / rules fixtures (R2.4.2 resign)

#### WAVE-B-S01 — Tenuki version + conformance spike
- **Type:** SPIKE | **Wave:** B (gate) | **Spec Phase:** Pre-A | **Baseline IDs:** BL-GR-03
- **Current Baseline State:** BL-GR-03: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §26/§27 (explicit area/positional-superko/komi 7.5; §31 positional-superko; pin; no auto-upgrade)
- **Scope:** Evaluate candidates against §31 positional-superko fixture + area/komi 7.5 explicit config; produce pinned version + conformance record.
- **Explicit Non-Goals:** No port/adapter code; no second superko layer; no silent downgrade.
- **Dependencies / blocked_by:** none
- **Post-Spike Consumer (predeclared):** WAVE-B-T02 — already `blocked_by` this Spike; its approved Scope consumes the pinned version + conformance record via explicit config. On PASS: BL-GR-03 → `VERIFIED_FACT_NOT_INTEGRATED`; B-T02 consumes the merged evidence; no re-ticketization (Post-Spike Stability Rule).
- **Acceptance Criteria (PASS):** candidate passes; version pinned; record written. **FAIL:** → `ESCALATION_REQUIRED`.
- **Required Review Evidence:** fixture trace; pin; conformance record.
- **Stop / Escalation Condition:** dual rules authority / default reliance → `ESCALATION_REQUIRED`.

#### WAVE-B-T01 — GoRulesPort contract + engine-independent test harness (incl. resign)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Spec Phase:** A | **Baseline IDs:** BL-GR-01
- **Current Baseline State:** BL-GR-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §26 (R2.4.2): `createGame/play/pass/resign/getState/inspectGroup/score/settle`; GoRulesPort = sole application-facing game-mutation boundary; resign = terminal action at the port (no second rules authority); §30
- **Scope:** Define `GoRulesPort` in `src/contracts` incl. `resign(...): ResignResult`; engine-independent test harness over any port implementation (stub initially).
- **Explicit Non-Goals:** No Tenuki dependency; no rules behavior; no fixtures yet; no GameLifecycleController.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/contracts/rules.ts`, `tests/` harness
- **Acceptance Criteria:** type-level port test exposes `resign`; harness green against stub; terminal mutation is application-facing through the port; no second lifecycle controller.
- **Required Review Evidence:** typecheck + harness output.
- **Stop / Escalation Condition:** port shape deviation → `ESCALATION_REQUIRED`.

#### WAVE-B-T02 — TenukiAdapter (pinned)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Spec Phase:** A | **Baseline IDs:** BL-GR-02
- **Current Baseline State:** BL-GR-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §26/§27 (explicit config from B-S01 pin), §29
- **Scope:** `TenukiAdapter implements GoRulesPort` with explicit area/positional-superko/komi 7.5 at creation; Tenuki-specific behavior confined to adapter.
- **Explicit Non-Goals:** No fixtures (B-T05); no UI; no second authority.
- **Dependencies / blocked_by:** WAVE-B-S01, WAVE-B-T01
- **Expected Surfaces:** `src/rules/tenuki-adapter.ts`, `package.json` pin
- **Acceptance Criteria:** harness passes; explicit config asserted (no defaults); application imports only the port.
- **Required Review Evidence:** harness run; config assertion; pin diff.
- **Stop / Escalation Condition:** contradiction with spike record / second layer → `ESCALATION_REQUIRED`.

#### WAVE-B-T03 — Area scoring / komi 7.5 / positional superko
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Spec Phase:** A | **Baseline IDs:** BL-GR-04
- **Current Baseline State:** BL-GR-04: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §25/§27, `IMPLEMENTATION_BOUNDARIES.md` (komi 7.5 not 6.5)
- **Scope:** Verify pinned stack exhibits area scoring, komi 7.5, positional superko via port-level deterministic tests.
- **Explicit Non-Goals:** No captures (B-T04); no full suite (B-T05).
- **Dependencies / blocked_by:** WAVE-B-T02
- **Expected Surfaces:** `src/rules/`, `tests/`
- **Acceptance Criteria:** area score of fixed endgame = hand-computed; komi 7.5 applied; repeated-position sequence rejected (positional superko).
- **Required Review Evidence:** test output; komi assertion; no 6.5 in production.
- **Stop / Escalation Condition:** superko unsupported → `ESCALATION_REQUIRED`.

#### WAVE-B-T04 — Captures / suicide / pass / settlement / dead-stone flow
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Spec Phase:** A | **Baseline IDs:** BL-GR-05
- **Current Baseline State:** BL-GR-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §25/§31 cases
- **Scope:** Port-level behavior: captures, suicide rejection, pass, two-pass ending, dead-stone settlement flow.
- **Explicit Non-Goals:** No scoring/superko; no full suite.
- **Dependencies / blocked_by:** WAVE-B-T02
- **Expected Surfaces:** `src/rules/`, `tests/`
- **Acceptance Criteria:** per-case deterministic fixtures (single/multi capture, suicide rejected, pass, two-pass→settlement, dead-stone confirmation, disagreement→resume).
- **Required Review Evidence:** per-case output.
- **Stop / Escalation Condition:** Tenuki-internals serialization → `ESCALATION_REQUIRED`.

#### WAVE-B-T06 — Canonical action log / replay (incl. resign)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Spec Phase:** A | **Baseline IDs:** BL-GR-06
- **Current Baseline State:** BL-GR-06: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §28 (R2.4.2): `CanonicalGameRecord`; actions play/pass/resign; replay marks terminal on resign without board mutation; winner/reason = opponent / resignation; no Tenuki internals; no second mutable result truth
- **Scope:** Define `CanonicalGameRecord`/`GameAction` (incl. `{type:"resign"; by:"user"|"deepseek"}`), persistence, replay-restore with resign-terminal handling.
- **Explicit Non-Goals:** No crash integration (Wave F); no Tenuki-object serialization; no SGF.
- **Dependencies / blocked_by:** WAVE-B-T02 (no B-T05 dependency)
- **Expected Surfaces:** `src/persistence/canonical.ts` (or `src/rules/canonical.ts`), tests
- **Acceptance Criteria:** play/pass/resign sequences round-trip; replay marks terminal on resign; winner/reason derived correctly; board not mutated by resignation; authoritative state verified.
- **Required Review Evidence:** round-trip + replay tests incl. resign case.
- **Stop / Escalation Condition:** Tenuki private objects needed → `ESCALATION_REQUIRED`.

#### WAVE-B-T05 — §31 deterministic fixture suite — 11 cases (incl. resign)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Spec Phase:** A | **Baseline IDs:** BL-GR-07
- **Current Baseline State:** BL-GR-07: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §31 (R2.4.2): eleven cases — single capture, multi-stone capture, suicide rejection, simple ko transition, positional superko, pass, two-pass ending, area scoring, dead-stone settlement, canonical replay/restoration, **resignation terminal / canonical replay restoration**; §39.5
- **Scope:** Full eleven-case engine-independent suite over `GoRulesPort` (exercising B-T03/B-T04/B-T06 mechanisms), runnable in CI before significant Go UI behavior.
- **Explicit Non-Goals:** No new rules behaviors; no UI.
- **Dependencies / blocked_by:** WAVE-B-T03, WAVE-B-T04, WAVE-B-T06
- **Expected Surfaces:** `tests/fixtures/`, CI job
- **Acceptance Criteria (raw counts):** tests = 11, pass = 11, fail = 0, skip = 0; resignation case proves: resign makes game terminal immediately; opponent wins; no subsequent play/pass accepted; canonical replay preserves resigned terminal; board before resign not spuriously mutated; CI run evidence.
- **Required Review Evidence:** CI run 11/11; resign-case assertions.
- **Stop / Escalation Condition:** case failing within scope → `ESCALATION_REQUIRED`.

---

### Wave C — Go tools / capability isolation / budget / anti-cheat / calibration

#### WAVE-C-S01 — Pinned DSH request-level token hard-cap seam
- **Type:** SPIKE | **Wave:** C (gate) | **Spec Phase:** Pre-A | **Baseline IDs:** BL-BUD-07
- **Current Baseline State:** BL-BUD-07: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §22.1 (per-request hard cap at request creation)
- **Scope:** Verify only: which pinned-DSH request hook/waterfall can modify call config; exact max-token field; propagation to LLM request; executable hard-cap assertion; agent/request scope; plugin/runtime usability without DSH core patch. Not a whole-LLM-subystem study.
- **Explicit Non-Goals:** No LLM subsystem research; no DSH core patch; no enforcement (C-T07).
- **Dependencies / blocked_by:** none
- **Acceptance Criteria (PASS):** executable probe/trace; exact seam documented; hard-cap effect assertable; usable by C-T07 without core patch. **FAIL:** record; DSH core patch / frozen-architecture change / new shared mechanism → `ESCALATION_REQUIRED`.
- **Required Review Evidence:** probe trace; seam doc; hard-cap assertion.
- **Stop / Escalation Condition:** DSH core patch / new mechanism → `ESCALATION_REQUIRED`.

#### WAVE-C-T01 — Core Go lane model-facing registry / sole strategy owner (re-scoped Phase A)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-GT-01
- **Current Baseline State:** BL-GT-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED (Phase A: core `go.*` surface incl. `go.resign`)
- **Spec Authority:** §18 (sole strategic policy owner), §20 (R2.4.2: final V0.1 surface = 8 go.* + 2 companion.* = 10; Phase A proves the core `go.*` surface is the only Go-strategy/action model-facing surface)
- **Scope (Phase A, structural only):** Define the core Go lane model-facing registry structure: the registry accepts only `go.*` whitelisted tool paths and rejects any solver/best-move/win-rate/general-execution surface. It does NOT register the tools itself — registration happens in WAVE-C-T02. After WAVE-C-T03 (Phase B), the final V0.1 surface becomes 8 go.* + 2 companion.* = 10 — lifecycle/phase wording, no architecture change. C-T01 must NOT claim the complete 10-tool surface or any registered tool set exists during Phase A.
- **Explicit Non-Goals:** No tool implementations (C-T02/C-T03); no preset isolation (C-T04); no registration of actual tools.
- **Dependencies / blocked_by:** WAVE-C-T04
- **Expected Surfaces:** `src/tools/` registry (structure/policy), preset config
- **Acceptance Criteria (structural, no dependence on C-T02 output):** registry structure only permits `go.*` whitelisted paths (no companion.*/solver/best-move/win-rate/general-execution path admissible); a forbidden path registration attempt is rejected by the registry policy (deterministic unit test); smoke asserts no forbidden strategy/solver surface and no solver import; no claim that any tool set is already registered.
- **Required Review Evidence:** structural registry tests; policy rejection test; smoke output.
- **Stop / Escalation Condition:** strategy capability required → `ESCALATION_REQUIRED`.

#### WAVE-C-T02 — 8 `go.*` model-facing tools (incl. `go.resign`)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-GT-02
- **Current Baseline State:** BL-GT-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §20 (R2.4.2: 8 tools incl. `go.resign`), §22.3 (accounting at actual execution), §32 (tool action is truth), §26 (resign through GoRulesPort, no second authority)
- **Scope:** Register/implement the eight `go.*` tools over GoRulesPort, including `go.resign` (→ `GoRulesPort.resign` → authoritative terminal state → GameNotice; no board mutation; no UI-only truth); `go.try_move` returns legal/captures/local liberties only; wire budget accounting via C-T07 enforcement API.
- **Explicit Non-Goals:** No `companion.*` (C-T03, Phase B); no boost (C-T08); no strategy advice; no GameLifecycleController.
- **Dependencies / blocked_by:** WAVE-B-T02, WAVE-C-T01, WAVE-C-T06, WAVE-C-T07
- **Expected Surfaces:** `src/tools/go/`
- **Acceptance Criteria:** per-tool §20 shape (try_move no evaluative fields; `go.resign` terminal mutation via port with no board mutation and derived winner/reason); illegal attempt no mutation; budget counter consumed; **post-registration enumeration assertion: the registered `go.*` set is exactly the 8 tools (incl. `go.resign`) and contains no forbidden surface** (this closes the C-T01→C-T02 acceptance loop: C-T01 proves the registry structure, C-T02 proves the actual registered set).
- **Required Review Evidence:** tool tests; try_move schema; resign-route assertion; post-registration enumeration output.
- **Stop / Escalation Condition:** solver-like evaluation → `ESCALATION_REQUIRED`.

#### WAVE-C-T03 — 2 `companion.*` model-facing tools (Phase B)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** B | **Baseline IDs:** BL-GT-03
- **Current Baseline State:** BL-GT-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §20 (`companion.affect`, `companion.request_focus`), §5/§6 (Runtime sole wake authority), §14 (bounded deltas)
- **Scope:** Register `companion.request_focus` (submits intent into §5 arbitration) and `companion.affect` (validates bounded deltas, applies through mood reducer WAVE-D-T08). Planned now; **must not execute before Phase A Exit Gate PASS.**
- **Explicit Non-Goals:** No mood reducer (D-T08); no attention policy (D-T06); no UI.
- **Dependencies / blocked_by:** WAVE-A-T02 (request_focus), **WAVE-D-T08** (affect → mood reducer), **WAVE-F-T04 (Phase A Exit Gate)**
- **Expected Surfaces:** `src/tools/companion/`
- **Acceptance Criteria:** request_focus intent with correct target/origin appears in `pendingFocus` (no direct wake); affect delta applied through reducer; out-of-bound rejected; no cross-lane direct calls.
- **Required Review Evidence:** tool tests; no-direct-call assertion.
- **Stop / Escalation Condition:** request_focus bypassing arbitration → `ESCALATION_REQUIRED`.

#### WAVE-C-T04 — Go preset isolation + execution-time capability guards
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-CAP-01, BL-CAP-02
- **Current Baseline State:** BL-CAP-01/02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §19 (isolated native-only; prompt-hiding insufficient), §21 ("cannot see + cannot execute")
- **Scope (atomicity):** preset declaration + execution guard = one isolation gap.
- **Explicit Non-Goals:** No tools; no anti-cheat suite (C-T05); no DSH core patch.
- **Dependencies / blocked_by:** WAVE-A-T01
- **Expected Surfaces:** DSH preset/scope config, `src/runtime/` guards
- **Acceptance Criteria:** preset native-only; forbidden capability registered into Go scope still fails at execution.
- **Required Review Evidence:** preset output; guard test.
- **Stop / Escalation Condition:** Go needing inherited capability → `ESCALATION_REQUIRED`.

#### WAVE-C-T05 — Anti-cheat tests (§39.3)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-CAP-03
- **Current Baseline State:** BL-CAP-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §39.3, §40 Anti-Cheat
- **Scope:** Suite attempting each forbidden capability from Go lane; assert execution-authority failure.
- **Explicit Non-Goals:** No new guard code; no UI.
- **Dependencies / blocked_by:** WAVE-C-T04
- **Expected Surfaces:** `tests/` suite, CI job
- **Acceptance Criteria:** every forbidden attempt fails deterministically; CI run evidence.
- **Required Review Evidence:** per-capability output.
- **Stop / Escalation Condition:** any success → `ESCALATION_REQUIRED`.

#### WAVE-C-T06 — GoTurnBudget contract + injectable non-production test configuration
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-BUD-01
- **Current Baseline State:** BL-BUD-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22 (fields; numeric values not frozen — benchmark-derived)
- **Scope:** `GoTurnBudget` contract + config loading with injectable values for tests. **No production numeric defaults claimed** (BL-BUD-06 / C-T10 owns calibration).
- **Explicit Non-Goals:** No enforcement (C-T07); no boost (C-T08); no benchmark (C-T10).
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/contracts/budget.ts`, config loader
- **Acceptance Criteria:** type-level contract test; injectable config loads explicit fixture defaults; docs state values are NOT production calibration.
- **Required Review Evidence:** typecheck + contract test; wording check.
- **Stop / Escalation Condition:** freezing values without §38 evidence → `ESCALATION_REQUIRED`.

#### WAVE-C-T07 — Budget enforcement + post-move no-analysis-loop
- **Type:** INTEGRATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-BUD-02, BL-BUD-04, BL-BUD-07
- **Current Baseline State:** BL-BUD-02/04: NOT_IMPLEMENTED; BL-BUD-07: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22.1-22.4, §24 (R2.4.2: after committed play / pass / resign the same turn must not restart an analysis loop; after resign the game is terminal with no further inspect / try_move / deep-think / model step)
- **Scope (atomicity):** Enforcement engine: per-request hard cap **using the C-S01-verified seam** (never guessed), turn-level cap, per-tool accounting, exhaustion, no-analysis-loop (incl. resign-terminal end-of-turn). **Atomicity (post-Spike ownership transition):** BL-BUD-07's verified request-cap seam only has meaning integrated within the same budget-enforcement boundary, so it is atomic with BL-BUD-02/04 (splitting would create a shell INTEGRATION_TICKET).
- **Explicit Non-Goals:** No boost (C-T08); no bypass tests (C-T09); no benchmark (C-T10); no DSH core patch.
- **Dependencies / blocked_by:** WAVE-C-T06, WAVE-C-S01
- **Expected Surfaces:** `src/budget/`
- **Acceptance Criteria:** per-request cap at exact boundary via verified seam; turn-level cap; aggregated double-invoke counted once; after committed play/pass/**resign** no further model step of the turn; after `go.resign` the game turn ends with no further inspect / try_move / deep-think / model step permitted (deterministic sequence test incl. the resign case).
- **Required Review Evidence:** enforcement tests; seam trace; no-wrapper-hole assertion.
- **Stop / Escalation Condition:** seam unusable / DSH core patch / new mechanism → `ESCALATION_REQUIRED`.

#### WAVE-C-T08 — Deep-think boost (bounded)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-BUD-03
- **Current Baseline State:** BL-BUD-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §23
- **Scope:** `go.request_deep_think` grants one bounded boost within enforcement caps.
- **Explicit Non-Goals:** No unlimited mode; no bypass tests (C-T09).
- **Dependencies / blocked_by:** WAVE-C-T02, WAVE-C-T07
- **Expected Surfaces:** `src/tools/go/`, `src/budget/`
- **Acceptance Criteria:** single bounded increment; request still capped; turn ceiling unchanged.
- **Required Review Evidence:** boost boundary tests.
- **Stop / Escalation Condition:** unbounded reasoning → `ESCALATION_REQUIRED`.

#### WAVE-C-T09 — Budget bypass tests (§39.4)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-BUD-05
- **Current Baseline State:** BL-BUD-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §39.4, §40 Budget
- **Scope:** Adversarial suite: many try_moves/inspects/steps, oversized request, aggregated paths; hard limits hold.
- **Explicit Non-Goals:** No enforcement changes.
- **Dependencies / blocked_by:** WAVE-C-T07, WAVE-C-T08
- **Expected Surfaces:** `tests/` budget suite, CI job
- **Acceptance Criteria:** each bypass deterministically hits its limit; CI run.
- **Required Review Evidence:** per-bypass output.
- **Stop / Escalation Condition:** any bypass success → `ESCALATION_REQUIRED`.

#### WAVE-C-T10 — Automated cognition benchmark + production budget calibration (exact §38)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Spec Phase:** A | **Baseline IDs:** BL-BUD-06
- **Current Baseline State:** BL-BUD-06: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22 (numeric values from benchmark), §38 (Automated Cognition Benchmark), §44
- **Scope:** Deterministic benchmark harness + scenario fixtures; run representative cognition scenarios on the real production-like Go reasoning path; collect exact §38 metrics; produce production budget calibration record; switch production `GoTurnBudget` config to chosen numeric defaults (hard caps explicit).
- **Explicit Non-Goals:** No Spec budget-field change; no model-performance research; no strength optimization; no solver/KataGo; no long-term telemetry platform.
- **Dependencies / blocked_by:** WAVE-B-T05, WAVE-C-T02, WAVE-C-T07, WAVE-C-T08 (leaf; no cycle)
- **Expected Surfaces:** `tests/benchmark/`, `src/budget/` production config
- **Acceptance Criteria — exact §38 (for EACH fixture class):** fixture classes: **opening, simple capture, escape, local fight, ko, large-group pressure, endgame, ambiguous position** (8 classes; no collapsing: simple capture ≠ local capture; large-group pressure kept distinct from vague "pressure"). Record per class: **latency; input token usage; output token usage; total token usage if useful; model steps; inspect calls; try_move calls; deep-think requests; illegal attempts; final move; variation across repeated runs** (input/output tokens not collapsed into one field; repeated-run variation not dropped). Output raw benchmark record + chosen numeric defaults + rationale; switch production config; state explicit hard caps; `pnpm verify` / benchmark checks pass; evidence available for review.
- **Stop / Escalation Condition:** benchmark exposing a frozen Spec contract deficiency → `ESCALATION_REQUIRED`.
- **Required Review Evidence:** raw record; calibration rationale; config diff; check run.

---

### Wave D — Bridge / Attention / Persona / Mood

#### WAVE-D-S01 — `ctx.systemPrompt.context` provider spike
- **Type:** SPIKE | **Wave:** D (gate) | **Spec Phase:** Pre-A | **Baseline IDs:** BL-BR-03
- **Current Baseline State:** BL-BR-03: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §9.1
- **Scope:** Probe agent scope/registration/rendering/materialization/O(1) delivery on pinned DSH.
- **Explicit Non-Goals:** No Bridge implementation; no DSH core patch.
- **Dependencies / blocked_by:** none
- **Post-Spike Consumer (predeclared):** WAVE-D-T03 — already `blocked_by` this Spike; its approved Scope consumes the verified `ctx.systemPrompt.context` seam ("per D-S01 findings", pinned DSH context seam). On PASS: BL-BR-03 → `VERIFIED_FACT_NOT_INTEGRATED`; D-T03 consumes the merged evidence; no re-ticketization (Post-Spike Stability Rule).
- **Acceptance Criteria (PASS):** provider registers agent-scoped; reads only Runtime-held snapshot (no rescan); materializes only on change; O(1)-suitable. **FAIL:** record; fallback `agent.inject`; note D-T03 impact.
- **Required Review Evidence:** probe trace; assertions.
- **Stop / Escalation Condition:** new mechanism / DSH patch → `ESCALATION_REQUIRED`.

#### WAVE-D-T01 — Bridge latest-value runtime (Phase A core)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** A | **Baseline IDs:** BL-BR-01, BL-BR-02
- **Current Baseline State:** BL-BR-01: FOUNDATION_ONLY; BL-BR-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §9 (latest-value), §9.1 (Runtime-owned), §10/§11 (no strategic labels)
- **Existing Asset / Contract Reused:** `src/contracts/bridge.ts` — `CompanionBridge`, `WorkSnapshot`, `GameNotice`, `AffectedGroupDelta`
- **Scope (atomicity):** contract shape + latest-value runtime = one Bridge gap.
- **Explicit Non-Goals:** No provider delivery (D-T03); no transcript sync; no recursive projection.
- **Dependencies / blocked_by:** WAVE-A-T01
- **Expected Surfaces:** `src/bridge/`
- **Acceptance Criteria:** latest-value coalescing; GameNotice schema (no forbidden fields); WorkSnapshot grounded; §12 no-recursion.
- **Required Review Evidence:** unit tests; schema assertion.
- **Stop / Escalation Condition:** Bridge carrying commands/queues → `ESCALATION_REQUIRED`.

#### WAVE-D-T02 — Cross-lane awareness / no transcript injection (Phase A core)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** A | **Baseline IDs:** BL-BR-04
- **Current Baseline State:** BL-BR-04: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §12, §35, §40 Context Isolation
- **Existing Asset / Contract Reused:** `src/contracts/bridge.ts`
- **Scope:** Awareness surfaces never inject raw histories; handoff not re-forwarded.
- **Explicit Non-Goals:** No delivery (D-T03); no UI policy.
- **Dependencies / blocked_by:** WAVE-D-T01
- **Expected Surfaces:** `src/bridge/`, tests
- **Acceptance Criteria:** after long game, Work history has no full Go transcript/boards (symmetric); no re-projection.
- **Required Review Evidence:** isolation tests.
- **Stop / Escalation Condition:** DSH history filtering needed → `ESCALATION_REQUIRED`.

#### WAVE-D-T03 — No Bridge-only evaluation wake (Phase A core)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** A | **Baseline IDs:** BL-BR-05
- **Current Baseline State:** BL-BR-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §9.1 (no evaluation-only wake; no cooldown timer), §39.6
- **Scope:** Deliver latest snapshots per D-S01 findings; Bridge changes never create evaluation-only wakes; unchanged snapshots add no repeated prompt material.
- **Explicit Non-Goals:** No attention policy (D-T06); no focus scheduling (D-T07).
- **Dependencies / blocked_by:** WAVE-D-T01, WAVE-D-S01, WAVE-A-T02
- **Expected Surfaces:** `src/bridge/delivery.ts`, pinned DSH context seam
- **Acceptance Criteria:** §39.6 smoke: 20 rapid GameNotice updates → zero attention-evaluation requests (request-count trace); idle Manual lane not woken; next natural request sees newest snapshot.
- **Required Review Evidence:** request-count trace; assertions.
- **Stop / Escalation Condition:** cooldown/new mechanism → `ESCALATION_REQUIRED`.

#### WAVE-D-T04 — CompanionState runtime + latest persistence (Phase A core; NO mood reducer)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** A | **Baseline IDs:** BL-CMP-01 (only)
- **Current Baseline State:** BL-CMP-01: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §13 (one small authoritative CompanionState; latest persistence; no journal), §36 (CompanionState restored on recovery)
- **Existing Asset / Contract Reused:** `src/contracts/companion.ts` — `CompanionState<TCompiledPersona, TMoodState>`, `AttentionMode`
- **Scope:** One small authoritative CompanionState holder + simplest reliable latest-state persistence; attentionMode/variationSeed/persona placeholder storage per existing contract; no event journal; **no mood reducer** (WAVE-D-T08, Phase B). Executable in Phase A because core recovery/persistence may need CompanionState.
- **Explicit Non-Goals:** No mood reducer; no persona compiler (D-T05); no attention policy (D-T06); no journal.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/companion/`
- **Acceptance Criteria:** state holder stores/updates latest CompanionState; persistence round-trip; persona/mood placeholders per contract; no journal artifacts; no mood-delta application.
- **Required Review Evidence:** holder/persistence tests; no-reducer diff scope check.
- **Stop / Escalation Condition:** mood logic entering this ticket (phase cross) → re-scope; journal needed → `ESCALATION_REQUIRED`.

#### WAVE-D-T08 — Mood reducer (NEW, Phase B)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** B | **Baseline IDs:** BL-CMP-03
- **Current Baseline State:** BL-CMP-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §14 (bounded small deltas; clamp; slow return to persona baseline; stable persona not overwritten; no hidden-reasoning parse; no hard-coded trigger→delta table)
- **Scope:** Mood reducer: bounded deltas, clamp, baseline return; operates on CompanionState.mood (from D-T04). Planned now; **must not execute before Phase A Exit Gate PASS.**
- **Explicit Non-Goals:** No state holder (D-T04); no persona compiler (D-T05); no event journal.
- **Dependencies / blocked_by:** WAVE-D-T04, **WAVE-F-T04 (Phase A Exit Gate)**
- **Expected Surfaces:** `src/companion/mood.ts`
- **Acceptance Criteria:** reducer tests: clamping at bounds; slow baseline return; persona never overwritten; no hard-coded trigger→delta rules; no hidden-reasoning parse.
- **Required Review Evidence:** reducer tests.
- **Stop / Escalation Condition:** event history needed → `ESCALATION_REQUIRED`.

#### WAVE-D-T05 — Persona Compiler + schema freeze (Phase B)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** B | **Baseline IDs:** BL-CMP-02
- **Current Baseline State:** BL-CMP-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §15, §40 Persona Continuity
- **Scope:** Persona Compiler from plain-language + dialogue samples; freeze compiled-persona schema. Planned now; **must not execute before Phase A Exit Gate PASS.**
- **Explicit Non-Goals:** No large parameter panel; no mood.
- **Dependencies / blocked_by:** WAVE-D-T04, **WAVE-F-T04 (Phase A Exit Gate)**
- **Expected Surfaces:** `src/companion/persona.ts`
- **Acceptance Criteria:** both input forms → deterministic profile; schema freeze recorded; persona never alters Work state.
- **Required Review Evidence:** compiler tests; frozen schema.
- **Stop / Escalation Condition:** schema conflict with `CompanionState` generic → `ESCALATION_REQUIRED`.

#### WAVE-D-T06 — Attention mode runtime semantics (Phase B)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** B | **Baseline IDs:** BL-CMP-04
- **Current Baseline State:** BL-CMP-04: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §16 (modes; no task taxonomy; Manual disables autonomous switching), §9.1 idle handling
- **Existing Asset / Contract Reused:** `src/contracts/companion.ts` — `AttentionMode`
- **Scope:** Runtime semantics per mode. Planned now; **must not execute before Phase A Exit Gate PASS.**
- **Explicit Non-Goals:** No focus scheduling (D-T07); no UI controls.
- **Dependencies / blocked_by:** WAVE-D-T04, **WAVE-F-T04 (Phase A Exit Gate)**
- **Expected Surfaces:** `src/companion/attention.ts`
- **Acceptance Criteria:** per-mode tests (Mofish/Normal/Strict/Manual); no importance taxonomy.
- **Required Review Evidence:** per-mode output.
- **Stop / Escalation Condition:** numeric importance table → `ESCALATION_REQUIRED`.

#### WAVE-D-T07 — Self-initiated focus (Phase B)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Spec Phase:** B | **Baseline IDs:** BL-CMP-05
- **Current Baseline State:** BL-CMP-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5/§6 (self_initiated origin; Runtime sole wake authority), §9.1 (Normal/Mofish schedule from objective state; coalesce into single pendingFocus)
- **Scope:** Runtime scheduling of self-initiated focus intents per active mode through the single `pendingFocus`. Planned now; **must not execute before Phase A Exit Gate PASS.**
- **Explicit Non-Goals:** No user-origin admission (A-T06); no attention semantics (D-T06).
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-D-T06, **WAVE-F-T04 (Phase A Exit Gate)**
- **Expected Surfaces:** `src/runtime/`, `src/companion/attention.ts`
- **Acceptance Criteria:** Normal mode schedules one self_initiated intent; user-origin wins; repeated triggers coalesce.
- **Required Review Evidence:** scheduling tests.
- **Stop / Escalation Condition:** evaluation-only wakes → `ESCALATION_REQUIRED`.

---

### Wave E — Harness Web UI

#### WAVE-E-S01 — DSH Web `conversation.view` extension seam spike
- **Type:** SPIKE | **Wave:** E (gate) | **Spec Phase:** Pre-A | **Baseline IDs:** BL-UI-04
- **Current Baseline State:** BL-UI-04: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §34 (prove seam before depending; simplify UX before patching core)
- **Scope:** Probe Go view mount, coexistence, dual-session single shell, mini-surface placement. No transcript fusion.
- **Explicit Non-Goals:** No production UI (E-T01/E-T02); no DSH core patch.
- **Dependencies / blocked_by:** none
- **Acceptance Criteria (PASS):** five §34 items verified with view-mount evidence; seam API + placement points recorded. **FAIL:** record real behavior + simplified-UX fallback before E-T01.
- **Required Review Evidence:** mounted-view evidence + assertions.
- **Stop / Escalation Condition:** DSH core patch → `ESCALATION_REQUIRED`.

#### WAVE-E-T01 — Production Harness **Core** Go UI + board-click direct route (Phase A)
- **Type:** INTEGRATION_TICKET | **Wave:** E | **Spec Phase:** A | **Baseline IDs:** BL-UI-02, BL-RT-10, BL-UI-04
- **Current Baseline State:** BL-UI-02/BL-RT-10: NOT_IMPLEMENTED; BL-UI-04: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §32 (R2.4.2 core board), §33 (DSH-native shell; seats), §7.2 (board click → GoRulesPort directly), §34 (seam smoke)
- **Scope (atomicity):** Phase A **core** Go view: native Harness Go view; 9x9/13x13/19x19; stones; captures; last move; turn; Pass; **Resign**; final result; minimal placement/capture animation; minimal stone sound; board click direct route; no transcript fusion; no prototype behavior inheritance. **Production mini-surface completion is NOT in E-T01 acceptance** (E-S01 Phase A smoke still verifies seam/placement capability; full mini-surface UX is E-T02, Phase B). **Atomicity (post-Spike ownership transition):** the `conversation.view` seam's production integration and the Harness Go view mount/lifecycle form the same production boundary; splitting into a second ticket would create a shell INTEGRATION_TICKET.
- **Explicit Non-Goals:** No desktop wrapper (BL-UI-03 DEFERRED); no TUI; no Companion mini-surface UX (E-T02); no prototype logic; no transcript fusion.
- **Dependencies / blocked_by:** WAVE-E-S01, WAVE-B-T05, WAVE-D-T01, WAVE-A-T01
- **Expected Surfaces:** `src/ui/` (Harness Web view extension), `src/bridge/`
- **Acceptance Criteria — §32 core matrix:**

| # | Required behavior | Acceptance assertion |
|---|---|---|
| 1 | Board sizes 9x9 / 13x13 / 19x19 | each size created/displayed/interacted (smoke per size) |
| 2 | Stones (black/white) | rendered correctly; authoritative state drives rendering (no text parsing) |
| 3 | Captures | automatic captures reflected immediately after GoRulesPort update |
| 4 | Last move | visible last-move indication |
| 5 | Turn | clear current-turn indication from authoritative state |
| 6 | Pass | Pass control invokes GoRulesPort.pass; state/GameNotice/UI verified |
| 7 | Resign | **Resign control → GoRulesPort.resign → authoritative terminal state → final-result UI; no UI-only gameOver truth** |
| 8 | Final result | game-over/final-result UI from authoritative rules result |
| 9 | Animation | minimal placement/capture animation (present, not truth-affecting) |
| 10 | Sound | minimal stone sound; must not alter game truth |
| 11 | Board click | click → GoRulesPort.play → state/GameNotice → UI; no fabricated PendingFocusIntent; illegal click rejected |
| 12 | Isolation | Work/Go transcripts not merged (DOM separation) |
| 13 | Prototype boundary | production does NOT inherit komi 6.5 / random AI / fake timing / prototype rules / prototype Attention (audit + assertions) |

- **Required Review Evidence:** browser/smoke evidence; board-click trace; resign-route assertion; §32 matrix output; no-prototype audit.
- **Stop / Escalation Condition:** prototype inheritance → `ESCALATION_REQUIRED`.

#### WAVE-E-T02 — Companion mini-surface / projection UX (NEW, Phase B)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** E | **Spec Phase:** B | **Baseline IDs:** BL-UI-05
- **Current Baseline State:** BL-UI-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §33/§35 (R2.4.2): Work View Go status / Go notice UX; Go View WorkSnapshot UX; clean mini-surface placement proven by E-S01; Companion-mode/persona peripheral presentation where applicable; latest-value projections only; no transcript fusion; no prototype rule/AI semantics
- **Scope:** Companion mini-surface / projection UX per E-S01-verified placement. Planned now; **must not execute before Phase A Exit Gate PASS.**
- **Explicit Non-Goals:** No core board UI (E-T01); no DSH core patch; no transcript fusion.
- **Dependencies / blocked_by:** **WAVE-F-T04 (Phase A Exit Gate)**, WAVE-E-S01, WAVE-D-T01, WAVE-D-T05, WAVE-D-T06
- **Expected Surfaces:** `src/ui/` mini surfaces
- **Acceptance Criteria:** Work View shows small sourced Go status; Go View shows small sourced WorkSnapshot; no transcript fusion; only latest-value projections; mode/persona presentation consistent with Phase B implementation; no prototype rule/AI semantics.
- **Required Review Evidence:** UI smoke/DOM evidence; projection-source assertion.
- **Stop / Escalation Condition:** prototype semantics inheritance → `ESCALATION_REQUIRED`.

---

### Wave F — Integration / crash-resume / replay / gates / acceptance

#### WAVE-F-T01 — Crash / resume recovery (incl. resigned-game restoration)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F | **Spec Phase:** A | **Baseline IDs:** BL-HARD-01
- **Current Baseline State:** BL-HARD-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §36 (R2.4.2): restore sessions/canonical record/board/CompanionState/attention mode; default Work focus; no transactional recovery; **a resigned game remains terminal after restart/replay with same winner and reason = resignation**
- **Scope:** Recovery pipeline restoring all required state incl. resigned-game terminal restoration.
- **Explicit Non-Goals:** No transactional recovery; no pending-command durability.
- **Dependencies / blocked_by:** WAVE-A-T01, WAVE-B-T06, WAVE-D-T04
- **Expected Surfaces:** `src/persistence/`, `src/runtime/`
- **Acceptance Criteria:** restart test restores state; board equals replayed canonical record; focus defaults to Work; **resigned game remains terminal, winner unchanged, reason = resignation**; no transaction.
- **Required Review Evidence:** restart tests incl. resign case.
- **Stop / Escalation Condition:** transaction protocol → `ESCALATION_REQUIRED`.

#### WAVE-F-T02 — Replay recovery (incl. resign terminal)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F | **Spec Phase:** A | **Baseline IDs:** BL-HARD-02
- **Current Baseline State:** BL-HARD-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §28/§36 (R2.4.2): replay play/pass through port; on resign mark terminal without board mutation; derive winner/reason; **resigned game remains terminal after replay**
- **Scope:** Replay-restore integration with resign-terminal handling and verification.
- **Explicit Non-Goals:** No UI; no second rules authority.
- **Dependencies / blocked_by:** WAVE-B-T06
- **Expected Surfaces:** `src/persistence/`, `src/rules/`
- **Acceptance Criteria:** long action sequence round-trips; post-replay state matches pre-crash (board+turn+captures); **resigned terminal state preserved; winner unchanged; reason = resignation**.
- **Required Review Evidence:** replay tests incl. resign case.
- **Stop / Escalation Condition:** Tenuki internals → `ESCALATION_REQUIRED`.

#### WAVE-F-T03 — Phase A Core E2E Continuity (renamed/rescoped; NOT global readiness)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F | **Spec Phase:** A | **Baseline IDs:** BL-HARD-03
- **Current Baseline State:** BL-HARD-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §40 (core: Correctness counters; Context Isolation; Continuity; Cognition Exclusivity), §39.1/§39.2 smoke; §22 (production budget values benchmark-derived)
- **Scope:** Phase A core e2e continuity: work → go → work; concurrent admission; immutable command handoff; safe-boundary behavior; core correctness/cognition continuity; **production budget config in use** (from C-T10). **This is NOT the global V0.1 readiness gate** — F-T04 consumes F-T03 as Phase A evidence; F-T05 owns final acceptance.
- **Explicit Non-Goals:** No Companion-layer features; no post-game analysis.
- **Dependencies / blocked_by:** WAVE-A-T07, WAVE-B-T06, WAVE-E-T01, WAVE-D-T04, WAVE-C-T10
- **Expected Surfaces:** full stack
- **Acceptance Criteria:** §39.1 both handoff cases verbatim; §39.2 concurrent wake (no early cognition, no lost input, safe-boundary admission, no aborted step-3, one companion-resume); §40 core counters all zero; production budget config in use.
- **Required Review Evidence:** e2e trace; assertions; config-in-use check.
- **Stop / Escalation Condition:** §40 core invariant unmet → `ESCALATION_REQUIRED`.

#### WAVE-F-T04 — Spec Phase A Exit / Core Viability Gate (NEW)
- **Type:** INTEGRATION_TICKET | **Wave:** F | **Spec Phase:** A | **Baseline IDs:** BL-HARD-05
- **Current Baseline State:** BL-HARD-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED (gate PASS record)
- **Spec Authority:** Spec Phase A exit (Minimal Technical Vertical Slice); §40 core acceptance; §34/§39 Phase A smoke gates
- **Scope:** An evidence/acceptance gate, NOT a new subsystem: assemble and review the direct evidence owners proving the core technical vertical slice is sound enough to allow Companion Layer (Phase B) execution. Gate result: **PASS → Phase B Tickets may execute; FAIL → stop and fix the core before Companion polish.**
- **Explicit Non-Goals:** No timer; no scoring bureaucracy; no generalized quality platform; no new subsystem.
- **Dependencies / blocked_by (direct evidence owners):**
  - rules correctness / Tenuki conformance: WAVE-B-T05
  - core continuity / cognition exclusivity: WAVE-F-T03
  - anti-cheat: WAVE-C-T05
  - budget bypass: WAVE-C-T09
  - benchmark-derived production budget: WAVE-C-T10
  - context isolation: WAVE-D-T02
  - Bridge prompt/call-volume stability: WAVE-D-T03
  - core real graphical board: WAVE-E-T01
  - (transitive seam Spikes B-S01/C-S01/D-S01/E-S01 are hard dependencies of these tickets; the gate report references their evidence rather than duplicating it)
- **Expected Surfaces:** evidence report (docs/validation), review record
- **Acceptance Criteria (gate inputs must show PASS evidence):**
  - §40 core correctness counters: accepted illegal moves = 0, state drift = 0, capture errors = 0, lost cross-lane operational commands = 0
  - context isolation passes; cognition exclusivity passes
  - anti-cheat execution-authority tests pass; budget bypass tests pass
  - production budget is benchmark-derived from §38 (C-T10)
  - core graphical Go UI passes (E-T01 §32 matrix)
  - work → go → work continuity passes (F-T03)
  - DSH capability smoke gates used by Phase A have PASS evidence (seam Spikes)
  - a small number of complete human games / UX validation confirms bounded DeepSeek Go is usable/enjoyable enough to justify Companion polish
- **Required Review Evidence:** assembled gate report with per-item evidence references.
- **Stop / Escalation Condition:** any required evidence missing or failing → gate FAIL (not escalation); if the gate reveals a Spec/architecture deficiency → `ESCALATION_REQUIRED`.

#### WAVE-F-T05 — Full V0.1 Acceptance (NEW, Phase B)
- **Type:** INTEGRATION_TICKET | **Wave:** F | **Spec Phase:** B | **Baseline IDs:** BL-HARD-06
- **Current Baseline State:** BL-HARD-06: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** R2.4.2 §40 complete (Correctness, Context Isolation, Continuity, Cognition Exclusivity, Anti-Cheat, Budget, Persona Continuity, Subjective UX)
- **Scope:** Full V0.1 acceptance after the Companion Layer — the only Ticket allowed to use "V0.1 final readiness" language (F-T03 must not). Planned now; **must not execute before Phase A Exit Gate PASS.**
- **Explicit Non-Goals:** No new features; no post-game analysis; no scoring platform.
- **Dependencies / blocked_by:** WAVE-F-T04 (Phase A gate PASS), WAVE-F-T01, WAVE-F-T02, WAVE-C-T03, WAVE-D-T05, WAVE-D-T06, WAVE-D-T07, WAVE-D-T08, WAVE-E-T02 (plus any direct core evidence owner needed for §40 if not transitively guaranteed)
- **Expected Surfaces:** full stack
- **Acceptance Criteria — full §40:**
  - Correctness: accepted illegal moves = 0, state drift = 0, capture errors = 0, lost cross-lane commands = 0
  - Context Isolation; Continuity (work → Go turn → work resumes correctly); Cognition Exclusivity
  - Anti-Cheat (forbidden capabilities fail at execution authority); Budget (hard limits unbypassable)
  - Persona Continuity (same profile recognizable without mechanical repetition)
  - Subjective UX — explicitly ask: Does this feel like the same DeepSeek? Does DeepSeek feel like it actually placed a stone? Do mistakes feel like bounded judgment mistakes rather than broken state? Does returning to Work feel clean? Do Mofish/Normal/Strict/Manual feel meaningfully different? Does Strict occasionally react to objectively important board changes without a hand-authored "importance score"?
- **Required Review Evidence:** full acceptance run; §40 matrix output; subjective UX responses.
- **Stop / Escalation Condition:** any §40 requirement unmet within scope → `ESCALATION_REQUIRED`.

---

## 4. Spike List (5 — all Pre-A, independent)

| Spike | Baseline | Question | PASS criteria | FAIL criteria / fallback | Blocked work |
|---|---|---|---|---|---|
| INFRA-S01 | BL-PKG-06 | `github:` spec resolve/build/activate on pinned DSH? | real command succeeds; bundle reconciliation + fiber active; trace | record; fallback tarball docs | Wave F installation acceptance |
| WAVE-B-S01 | BL-GR-03 | Tenuki satisfying area + positional-superko + komi 7.5 passing §31? | candidate passes; pin; conformance record | → ESCALATION_REQUIRED | B-T02→B-T03/04/06→B-T05→E-T01, C-T02, F-T01/02/03/04/05 |
| WAVE-C-S01 | BL-BUD-07 | pinned-DSH request-level max-token seam? | probe; seam doc; hard-cap assertable; usable by C-T07 without core patch | record; DSH-core patch / frozen change → ESCALATION_REQUIRED | C-T07→C-T02→C-T08→C-T10→F-T03/F-T04/F-T05 |
| WAVE-D-S01 | BL-BR-03 | `ctx.systemPrompt.context` semantics? | agent-scoped; no rescan; materialize-on-change; O(1) | record; fallback agent.inject; D-T03 impact | D-T03→F-T04 |
| WAVE-E-S01 | BL-UI-04 | Go view mount in DSH Web; coexistence; no fusion? | §34 five items + view-mount evidence | record; simplify UX before E-T01 | E-T01→F-T03/F-T04; E-T02 (placement) |

---

## 5. Ticket Dependency Graph (cycle-free)

```text
Pre-A / independent:
INFRA-T01, INFRA-S01, WAVE-B-S01, WAVE-C-S01, WAVE-D-S01, WAVE-E-S01,
WAVE-A-T01, WAVE-B-T01, WAVE-C-T06, WAVE-D-T04

Wave A:
A-T02 ← A-T01
A-T03 ← A-T01, A-T02
A-T05 ← A-T02
A-T04 ← A-T03
A-T06 ← A-T02, A-T05
A-T07 ← A-T02, A-T04

Wave B:
B-T02 ← B-S01, B-T01
B-T03 ← B-T02
B-T04 ← B-T02
B-T06 ← B-T02
B-T05 ← B-T03, B-T04, B-T06

Wave C:
C-T04 ← A-T01
C-T01 ← C-T04
C-T07 ← C-T06, C-S01
C-T02 ← B-T02, C-T01, C-T06, C-T07
C-T08 ← C-T02, C-T07
C-T05 ← C-T04
C-T09 ← C-T07, C-T08
C-T10 ← B-T05, C-T02, C-T07, C-T08        (leaf)
C-T03 ← A-T02, D-T08, F-T04               (Phase B; gate-blocked)

Wave D:
D-T01 ← A-T01
D-T02 ← D-T01
D-T03 ← D-T01, D-S01, A-T02
D-T08 ← D-T04, F-T04                      (Phase B)
D-T05 ← D-T04, F-T04                      (Phase B)
D-T06 ← D-T04, F-T04                      (Phase B)
D-T07 ← A-T02, D-T06, F-T04               (Phase B)

Wave E:
E-T01 ← E-S01, B-T05, D-T01, A-T01
E-T02 ← F-T04, E-S01, D-T01, D-T05, D-T06 (Phase B)

Wave F:
F-T01 ← A-T01, B-T06, D-T04
F-T02 ← B-T06
F-T03 ← A-T07, B-T06, E-T01, D-T04, C-T10 (Phase A core e2e)
F-T04 ← B-T05, F-T03, C-T05, C-T09, C-T10, D-T02, D-T03, E-T01   (Phase A Exit Gate)
F-T05 ← F-T04, F-T01, F-T02, C-T03, D-T05, D-T06, D-T07, D-T08, E-T02   (Phase B final)
```

Cycle check: B-T02→{T03,T04,T06}→T05 one-direction; C-T06→C-T07→C-T02→C-T08→C-T10 leaf; every Phase B edge passes through F-T04, which depends only on Phase A tickets; no path returns to a predecessor. **No cycles.**

---

## 6. Spec Phase Gate Graph

```text
Pre-A = 6
    ↓
Phase A execution work = 30
    ↓
F-T04 Phase A Exit Gate = 1
    ↓ PASS only
Phase B execution work = 6
    ↓
F-T05 Full V0.1 Acceptance = 1

Metadata:
Pre-A = 6
A = 31
B = 7
Total = 44
```

Pre-A (6): INFRA-T01, INFRA-S01, B-S01, C-S01, D-S01, E-S01.
Phase A execution work (30): A-T01..A-T07, B-T01..B-T06, C-T01, C-T02, C-T04..C-T10, D-T01..D-T04, E-T01, F-T01..F-T03 (31 tickets minus the F-T04 gate).
F-T04 Phase A Exit Gate (1): BL-HARD-05.
Phase B execution work (6): C-T03, D-T05, D-T06, D-T07, D-T08, E-T02 (7 tickets minus the F-T05 acceptance).
F-T05 Full V0.1 Acceptance (1): BL-HARD-06.

- Phase B Tickets exist in the graph now, but every one declares `blocked_by: WAVE-F-T04`.
- No Phase B execution before F-T04 PASS (AGENTS.md rule + BUILD_PHASES.md semantics + per-Ticket gate).

---

## 7. Critical Path (recomputed)

1. **Phase A runtime path:** A-T01 → A-T02 → A-T03 → A-T04 → A-T07 → F-T03.
2. **Phase A rules/UI path:** B-S01 → B-T02 → {B-T03, B-T04, B-T06} → B-T05 → E-T01 (also E-S01, D-T01 via A-T01) → F-T03.
3. **Phase A budget calibration path:** C-S01 → C-T07 → C-T02 → C-T08 → C-T10 (also B-T05) → F-T03.
4. **Phase A Exit Gate convergence:** {B-T05, F-T03, C-T05, C-T09, C-T10, D-T02, D-T03, E-T01} → **F-T04**.
5. **Phase B Companion path:** F-T04 → {D-T05, D-T06 (←D-T04), D-T08 (←D-T04), C-T03 (←A-T02 + D-T08), E-T02 (←E-S01 + D-T01 + D-T05 + D-T06)}.
6. **Full V0.1 Acceptance convergence:** F-T04 + {F-T01, F-T02, C-T03, D-T05, D-T06, D-T07, D-T08, E-T02} → **F-T05**.

F-T03 is the Phase A core e2e milestone; **F-T04** is the Phase A exit gate (converges all Phase A evidence); **F-T05** is the only "V0.1 final readiness" owner.

---

## 8. Parallelizable Work

- **All 5 Spikes + INFRA-T01 run in parallel immediately** (Pre-A; none depends on Wave A).
- **Independent Phase A tickets in parallel:** A-T01, B-T01, C-T06, D-T04, INFRA-T01.
- **Phase A chains in parallel:** runtime (A-T01→…→A-T07) ∥ rules (B-S01→…→B-T05) ∥ budget (C-S01→…→C-T10).
- **C-T10 (benchmark) overlaps Wave D/E core work** — needs B-T05 + C-T02/C-T07/C-T08 (complete during Wave B/C), converges before F-T04.
- **Phase B Tickets may be planned now but are serialized behind F-T04** — they do not compete for execution before the gate.
- **WAVE-C-T03 (companion.* tools)** starts only after A-T02 + D-T08 + F-T04 (C/D + phase boundary coupling).

---

## 9. BASELINE_COVERAGE_MATRIX (62 rows, one row per ID)

| Baseline ID | Current State | Handling | Primary Ticket | Spec Phase | Dependencies | Coverage Result |
|---|---|---|---|---|---|---|
| BL-PKG-01 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-PKG-02 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-PKG-03 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-PKG-04 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-PKG-05 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-PKG-06 | NEEDS_SPIKE | SPIKE | INFRA-S01 | Pre-A | none | COVERED |
| BL-PKG-07 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-PKG-08 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-PKG-09 | IMPLEMENTED_VERIFIED | KEEP_AS_UPGRADE_GATE | — | — | — | NO_ACTION |
| BL-CI-01 | NOT_IMPLEMENTED | SMALL_INFRA_TICKET | INFRA-T01 | Pre-A | none | COVERED |
| BL-RT-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T01 | A | none | COVERED |
| BL-RT-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T02 | A | A-T01 | COVERED |
| BL-RT-03 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T02 | A | A-T01 | COVERED |
| BL-RT-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T02 | A | A-T01 | COVERED |
| BL-RT-05 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T05 | A | A-T02 | COVERED |
| BL-RT-06 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T03 | A | A-T01, A-T02 | COVERED |
| BL-RT-07 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T04 | A | A-T03 | COVERED |
| BL-RT-08 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T02 | A | A-T01 | COVERED |
| BL-RT-09 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T06 | A | A-T02, A-T05 | COVERED |
| BL-RT-10 | NOT_IMPLEMENTED | INTEGRATION_TICKET | WAVE-E-T01 | A | E-S01, B-T05, D-T01, A-T01 | COVERED |
| BL-RT-11 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T07 | A | A-T02, A-T04 | COVERED |
| BL-BR-01 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T01 | A | A-T01 | COVERED |
| BL-BR-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T01 | A | A-T01 | COVERED |
| BL-BR-03 | NEEDS_SPIKE | SPIKE | WAVE-D-S01 | Pre-A | none | COVERED |
| BL-BR-04 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T02 | A | D-T01 | COVERED |
| BL-BR-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T03 | A | D-T01, D-S01, A-T02 | COVERED |
| BL-GR-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T01 | A | none | COVERED |
| BL-GR-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T02 | A | B-S01, B-T01 | COVERED |
| BL-GR-03 | NEEDS_SPIKE | SPIKE | WAVE-B-S01 | Pre-A | none | COVERED |
| BL-GR-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T03 | A | B-T02 | COVERED |
| BL-GR-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T04 | A | B-T02 | COVERED |
| BL-GR-06 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T06 | A | B-T02 | COVERED |
| BL-GR-07 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T05 | A | B-T03, B-T04, B-T06 | COVERED |
| BL-GT-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T01 | A | C-T04 | COVERED |
| BL-GT-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T02 | A | B-T02, C-T01, C-T06, C-T07 | COVERED |
| BL-GT-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T03 | B | A-T02, D-T08, F-T04 | COVERED |
| BL-CAP-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T04 | A | A-T01 | COVERED |
| BL-CAP-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T04 | A | A-T01 | COVERED |
| BL-CAP-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T05 | A | C-T04 | COVERED |
| BL-BUD-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T06 | A | none | COVERED |
| BL-BUD-02 | NOT_IMPLEMENTED | INTEGRATION_TICKET | WAVE-C-T07 | A | C-T06, C-S01 | COVERED |
| BL-BUD-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T08 | A | C-T02, C-T07 | COVERED |
| BL-BUD-04 | NOT_IMPLEMENTED | INTEGRATION_TICKET | WAVE-C-T07 | A | C-T06, C-S01 | COVERED |
| BL-BUD-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T09 | A | C-T07, C-T08 | COVERED |
| BL-BUD-06 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T10 | A | B-T05, C-T02, C-T07, C-T08 | COVERED |
| BL-BUD-07 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-C-T07 | A | C-S01 | COVERED |
| BL-CMP-01 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T04 | A | none | COVERED |
| BL-CMP-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T05 | B | D-T04, F-T04 | COVERED |
| BL-CMP-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T08 | B | D-T04, F-T04 | COVERED |
| BL-CMP-04 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T06 | B | D-T04, F-T04 | COVERED |
| BL-CMP-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T07 | B | A-T02, D-T06, F-T04 | COVERED |
| BL-UI-01 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | — | NO_ACTION |
| BL-UI-02 | NOT_IMPLEMENTED | INTEGRATION_TICKET | WAVE-E-T01 | A | E-S01, B-T05, D-T01, A-T01 | COVERED |
| BL-UI-03 | DEFERRED | DEFER | — | — | — | DEFERRED |
| BL-UI-04 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-E-T01 | A | E-S01 | COVERED |
| BL-UI-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-E-T02 | B | F-T04, E-S01, D-T01, D-T05, D-T06 | COVERED |
| BL-HARD-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T01 | A | A-T01, B-T06, D-T04 | COVERED |
| BL-HARD-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T02 | A | B-T06 | COVERED |
| BL-HARD-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T03 | A | A-T07, B-T06, E-T01, D-T04, C-T10 | COVERED |
| BL-HARD-04 | DEFERRED | DEFER | — | — | — | DEFERRED |
| BL-HARD-05 | NOT_IMPLEMENTED | INTEGRATION_TICKET | WAVE-F-T04 | A | B-T05, F-T03, C-T05, C-T09, C-T10, D-T02, D-T03, E-T01 | COVERED |
| BL-HARD-06 | NOT_IMPLEMENTED | INTEGRATION_TICKET | WAVE-F-T05 | B | F-T04, F-T01, F-T02, C-T03, D-T05, D-T06, D-T07, D-T08, E-T02 | COVERED |

Coverage check: COVERED = 51 (actionable), NO_ACTION = 9 (8 IMPLEMENTED_VERIFIED + 1 KEEP_AS_UPGRADE_GATE), DEFERRED = 2, ESCALATION_REQUIRED = 0. 51 + 9 + 2 = 62 ✓

---

## 10. Duplicate / Orphan Audit

- **duplicate owners = 0** — 51 actionable rows → 44 primary owners. Multi-gap Tickets (5) own 14 rows with stated atomicity: WAVE-A-T02 (BL-RT-02/03/04/08 = one focus machine), WAVE-C-T04 (BL-CAP-01/02 = isolation both faces), WAVE-C-T07 (BL-BUD-02/04/07 = budget execution + lifecycle rule + verified request-cap seam, one enforcement boundary), WAVE-D-T01 (BL-BR-01/02 = bridge shape+behavior), WAVE-E-T01 (BL-UI-02/BL-RT-10/BL-UI-04 = core board incl. click path + verified conversation.view seam, one production boundary). D-T04/D-T08 now own BL-CMP-01 / BL-CMP-03 separately (no phase-cross bundle).
- **orphan actionable gaps = 0** — all 51 actionable rows have a primary owner.
- **orphan tickets = 0** — every Ticket/Spike references ≥1 Baseline ID.
- **repeated feasibility spikes = 0** — BL-RT-06/07/11 and BL-BUD-07/BL-UI-04 → INTEGRATION_TICKET owners only; three remaining NEEDS_SPIKE rows (BL-PKG-06/BL-GR-03/BL-BR-03) → one Spike each; BL-BUD-06 is an IMPLEMENTATION_TICKET (calibration), not a Spike.

---

## 11. Deferred Work

- **BL-UI-03** (desktop wrapper) — DEFERRED, no Ticket.
- **BL-HARD-04** (post-game analysis) — DEFERRED, no Ticket.
- Spec §45 deferred mechanisms (FIFO handoff queue, bridge mailbox, event journal, focus epoch/lease, second engine) remain off-graph until concrete triggers appear.

---

## 12. Risks / Escalations

- **WAVE-B-S01 fail ⇒ ESCALATION_REQUIRED** (§27 no silent degradation).
- **WAVE-C-S01 fail ⇒ ESCALATION_REQUIRED** if fixing needs DSH core patch / frozen change / new mechanism; otherwise gates C-T07.
- **WAVE-D-S01 / WAVE-E-S01 fail ⇒ documented fallbacks** (agent.inject; simplified UX).
- **Phase B gating:** no Phase B ticket may execute before F-T04 PASS; F-T04 FAIL = stop and fix core (not an escalation, but a gate result).
- **Budget values:** production defaults owned by C-T10; test values never called production.
- **Resign:** the approved contract is encoded in R2.4.2; any ticket requiring a GameLifecycleController / second game truth → `ESCALATION_REQUIRED`.
- **DSH upgrade sensitivity:** re-run yield gate + re-probe seams on any pinned-commit change.
- No open `ESCALATION_REQUIRED`; none of the 44 tickets requires changing the verified Spec or a frozen contract beyond the already-approved resign clarification.

---

## 13. Files Changed (this round, commit `81951ce → a35088e` — 7 files)

- `docs/spec/SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md` (new — R2.4.2 from R2.4.1, `go.resign` DeepSeek action path + §24 resign lifecycle; R2.4.1 preserved)
- `docs/planning/TICKET_GRAPH_V1.2.1.md` (new — this graph; V1/V1.1/V1.2 preserved)
- `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` (modified — BL-GT-01/02 → 8 go.* / 10 tools; R2.4.1 refs → R2.4.2; BL-BUD-04 resign lifecycle)
- `AGENTS.md` (verified-Spec path → R2.4.2; Phase/Wave definition corrected; Phase B execution rule)
- `PROJECT_STATUS.md` (Architecture: FROZEN — R2.4.2 VERIFIED; stage markers unchanged)
- `README.md` (Architecture marker → R2.4.2 VERIFIED)
- `docs/context/DECISION_LOG.md` (approved-Resign record + `go.resign` tool record)

`BUILD_PHASES.md` was NOT changed this round (phase/wave semantics were fixed in the V1.2 round). No JSON/YAML graph; no GitHub Issues; no source/tests/workflows/V4/contract changes.

---

## 14. Recommended First Execution Set (after V1.2.1 review approval)

1. **INFRA-T01** — CI trigger policy.
2. **All 5 Spikes in parallel** (Pre-A): INFRA-S01, B-S01, C-S01, D-S01, E-S01.
3. **Independent Phase A tickets in parallel:** A-T01, B-T01, C-T06, D-T04.
4. Then follow the Phase A graph: runtime chain (A-T02→A-T03→A-T04→A-T07→F-T03), rules chain (B-T02→T03/T04/T06→T05), budget chain (C-T07→C-T02→C-T08→C-T10), D/E core (D-T01→D-T02/D-T03, E-T01) → converge at **F-T04 Phase A Exit Gate**.
5. Only after F-T04 PASS: Phase B (C-T03, D-T05/D-T06/D-T07/D-T08, E-T02) → **F-T05 Full V0.1 Acceptance**.

Nothing in this section is executed this round.
