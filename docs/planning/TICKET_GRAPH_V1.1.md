# Companion Go — Ticket / Spike Graph V1.1

**Status:** REVIEW_PENDING
**Supersedes for review:** `TICKET_GRAPH_V1.md`
**Reason:** ChatGPT dependency / spec coverage / benchmark / seam corrections (CHANGES_REQUESTED)

**Base:** remote main `e82b376c147317dbae928a8a2bf2cd6be967dbbc`
**Branch:** `work/ticket-decomposition-v1`
**Parent HEAD:** `0d30fdc920b45808cd8fd3727c5f1fd64858bbf7` (V1)

**Method:** Verified Spec Target − Current Implementation Baseline = Remaining Ticket/Spike Graph, per `docs/planning/TICKET_DECOMPOSITION_CONTRACT.md`. V1.1 is a **fix of V1** (six CHANGES_REQUESTED items), not a re-decomposition.

**Delta vs V1:**
- Fix 1: Wave B replay/§31 dependency chain repaired (B-T06 no longer depends on B-T05; B-T05 owns the full ten-case §31 suite incl. canonical replay; E-T01 gains B-T05 gate).
- Fix 2: §38 Automated Cognition Benchmark now a real Baseline gap (BL-BUD-06) owned by new WAVE-C-T10; WAVE-C-T06 no longer claims production defaults.
- Fix 3: Baseline coverage recounted mechanically from real rows (57 → 59 after adding BL-BUD-06/07; V1's "44 rows" was wrong).
- Fix 4: New request-level hard-cap seam Spike (BL-BUD-07 → WAVE-C-S01); WAVE-C-T07 now blocked by it.
- Fix 5: WAVE-E-T01 acceptance expanded to the full §32 required-behavior matrix.
- Fix 6: WAVE-A-T06 scope narrowed to admission-intent creation only (no safe-boundary/wake promise).

---

## 1. Baseline row counts (mechanical, from `CURRENT_IMPLEMENTATION_BASELINE.md`)

Counted by `grep '^| BL-'` + unique ID extraction. The file's closing "REAL UNKNOWNS — SPIKE CANDIDATES" table repeats 4 Spike IDs and is **not** counted as rows.

| Metric | Value |
|---|---|
| Total baseline rows (unique IDs) | **59** (57 at V1 + BL-BUD-06 + BL-BUD-07) |
| Actionable gaps (need Ticket/Spike ownership) | **48** |
| `IMPLEMENTED_VERIFIED` / NO_ACTION | 8 |
| `KEEP_AS_UPGRADE_GATE` | 1 (BL-PKG-09) |
| `DEFERRED` | 2 (BL-UI-03, BL-HARD-04) |
| `NEEDS_SPIKE` | 5 (BL-PKG-06, BL-GR-03, BL-BR-03, BL-UI-04, BL-BUD-07) |
| `FOUNDATION_ONLY` | 7 (BL-RT-03/05/08, BL-BR-01/04, BL-CMP-01/04) |
| `VERIFIED_FACT_NOT_INTEGRATED` | 3 (BL-RT-06/07/11) |
| `NOT_IMPLEMENTED` | 33 |

Breakdown check: 8 + 1 + 2 + 5 + 7 + 3 + 33 = 59 ✓

---

## 2. Ticket / Spike Summary

| Group | IMPLEMENTATION | INTEGRATION | SMALL_INFRA | SPIKE | Total |
|---|---|---|---|---|---|
| Infra | 0 | 0 | 1 | 1 | 2 |
| Wave A | 4 | 3 | 0 | 0 | 7 |
| Wave B | 6 | 0 | 0 | 1 | 7 |
| Wave C | 10 | 0 | 0 | 1 | 11 |
| Wave D | 7 | 0 | 0 | 1 | 8 |
| Wave E | 1 | 0 | 0 | 1 | 2 |
| Wave F | 3 | 0 | 0 | 0 | 3 |
| **Total** | **31** | **3** | **1** | **5** | **40** |

48 actionable gaps → 40 Tickets/Spikes (6 multi-gap Tickets own 14 gaps atomically; see §9 audit). Ticket count check: 31 + 3 + 1 + 5 = 40 ✓

---

## 3. Complete Ticket Table

### Infra

#### INFRA-T01 — Post-bootstrap CI trigger policy
- **Type:** SMALL_INFRA_TICKET | **Wave:** Infra | **Baseline IDs:** BL-CI-01
- **Current Baseline State:** BL-CI-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** AGENTS.md git/verification discipline; Baseline CI trigger policy section
- **Scope:** Rewrite only the `on:` triggers of `.github/workflows/{ci.yml, cooperative-yield-upgrade-gate.yml, profile-install-smoke.yml}` to run on the current default branch (`main`) and normal `pull_request` flow (path filters preserved). No workflow step logic changes.
- **Explicit Non-Goals:** No rewrite of existing gates; no change to `tests/upgrade-gates/cooperative-yield`; no CI platform refactor.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `.github/workflows/`
- **Acceptance Criteria:** CI `ci.yml` triggers on PR targeting `main`; both other workflows gain `pull_request` with existing path filters; `git diff` restricted to `on:` blocks; `pnpm verify` passes on this branch.
- **Required Review Evidence:** trigger-only YAML diff; at least one successful CI run on the decomposition PR.
- **Stop / Escalation Condition:** trigger update requiring gate-logic or fixture changes → `ESCALATION_REQUIRED`.

#### INFRA-S01 — GitHub source install spike
- **Type:** SPIKE | **Wave:** Infra | **Baseline IDs:** BL-PKG-06
- **Current Baseline State:** BL-PKG-06: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED (or recorded blocked behavior)
- **Spec Authority:** BL-PKG-05/06 evidence boundary (local tarball verified only; `github:` spec path untested)
- **Scope:** On pinned DSH (`b150a551...`, packages `0.1.1-rc.2`, Node 24.11.1, pnpm 11.7.0), run the real `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` and observe resolution → clone → build → activation. Record exact CLI surface; do not guess prepare/prepack/committed `lib/` behavior before observing.
- **Explicit Non-Goals:** No package publish-config change; no new install-path code; no profile-smoke modification.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** DSH CLI (`dsh plugin --profile`), `package.json`, `lib/`, `tests/profile-install/`
- **Acceptance Criteria (PASS):** command resolves the GitHub spec, builds, activates in a clean profile; `profile-mount-smoke.mjs` assertions pass (bundle reconciliation + `companion-go` fiber active in real Loader tree); trace uploaded.
- **FAIL criteria:** `github:` spec unsupported / resolution/build/activation failure → record exact behavior + concrete fallback (e.g., docs pin a packed tarball); mark `VERIFIED_FACT_NOT_INTEGRATED` with limitation.
- **Required Review Evidence:** executed command trace; pass/fail assertions; no invented success.
- **Stop / Escalation Condition:** if the command forces frozen packaging mutation → `ESCALATION_REQUIRED`.

---

### Wave A — Runtime / dual session / focus / resume

#### WAVE-A-T01 — Dual isolated DSH session lifecycle
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Baseline IDs:** BL-RT-01
- **Current Baseline State:** BL-RT-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §4 (two isolated Sessions), §44 "TWO isolated durable Session histories"
- **Scope:** Runtime creates and owns two durable isolated DSH sessions (`work`, `go`) on pinned DSH with distinct histories and no cross-session message flow. Minimal session registry.
- **Explicit Non-Goals:** No focus arbitration; no tools; no Bridge.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/runtime/` (session manager), pinned DSH Session API
- **Acceptance Criteria:** unit/integration: create both sessions; message admitted to `work` never appears in `go` history (deterministic assertion); smoke on pinned AgentLoop.
- **Required Review Evidence:** test run log; isolation assertions.
- **Stop / Escalation Condition:** two-session isolation requiring raw history injection → `ESCALATION_REQUIRED`.

#### WAVE-A-T02 — RuntimeFocusState machine + arbitration
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Baseline IDs:** BL-RT-02, BL-RT-03, BL-RT-04, BL-RT-08
- **Current Baseline State:** BL-RT-02: NOT_IMPLEMENTED; BL-RT-03: FOUNDATION_ONLY; BL-RT-04: NOT_IMPLEMENTED; BL-RT-08: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (RuntimeFocusState, one atomic PendingFocusIntent, `user_command > self_initiated`, `pausedLane` semantics), §44 "ONE atomic pending focus intent with user-over-self arbitration"
- **Existing Asset / Contract Reused:** `src/contracts/focus.ts` — `Lane`, `PendingFocusIntent`, `RuntimeFocusState` (incl. `pausedLane`). No second pause/resume contract; no new fields.
- **Scope (atomicity):** These four rows are one focus state machine (activeLane + llmRunning + single pendingFocus arbitration + pausedLane); splitting them leaves no verifiable machine. Pure Runtime state machine, no DSH-step interaction yet.
- **Explicit Non-Goals:** No DSH event wiring (A-T03); no queue/lease/epoch; no UI.
- **Dependencies / blocked_by:** WAVE-A-T01
- **Expected Surfaces:** `src/runtime/focus.ts`
- **Acceptance Criteria:** table-driven arbitration matrix (all §5 rules); `pausedLane` at most one lane, cleared exactly on resume admission; at-most-one activeLane invariant over random intent sequences; existing `contracts.test.ts` unchanged and green.
- **Required Review Evidence:** matrix + property test output; contract file diff additive-only.
- **Stop / Escalation Condition:** needing a second pause/resume field or any `RuntimeFocusState` shape change → `ESCALATION_REQUIRED`.

#### WAVE-A-T03 — Safe-boundary switching (integration)
- **Type:** INTEGRATION_TICKET | **Wave:** A | **Baseline IDs:** BL-RT-06
- **Current Baseline State:** BL-RT-06: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.1.1 (exact safe-boundary definition), §44 "SAFE focus handoff occurs between DSH steps"
- **Scope:** Wire A-T02's machine to the pinned-DSH step boundary: switches only between committed `step/end` and next `step/start`; never between tool calls of one step; never aborting started work.
- **Explicit Non-Goals:** No yield/restore (A-T04); no resume (A-T07); no feasibility re-spike.
- **Dependencies / blocked_by:** WAVE-A-T01, WAVE-A-T02
- **Expected Surfaces:** `src/runtime/`, pinned AgentLoop (`agent/pre-step`, `step/end`)
- **Acceptance Criteria:** integration test on pinned DSH: 20+ step synthetic Work turn; focus requested after step 3 commits; assert no step-4 `step/start`, step-3 work completes, handoff at first continuation boundary.
- **Required Review Evidence:** executed trace; no-step-4-start assertion.
- **Stop / Escalation Condition:** switching requiring a new shared mechanism (lease/epoch/timer) → `ESCALATION_REQUIRED`.

#### WAVE-A-T04 — Cooperative-yield production integration
- **Type:** INTEGRATION_TICKET | **Wave:** A | **Baseline IDs:** BL-RT-07
- **Current Baseline State:** BL-RT-07: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.1.2 (verified seam: `inbox.splice("next-step", 0, 0, payload.messages)` + `{kind:"reject"}` → blocked → idle → `whenIdle` → switch), §44 "PINNED DSH yield guard uses synchronous inbox batch-splice + continuation reject"
- **Existing Asset / Contract Reused:** executable seam from `docs/validation/DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md` (pinned `b150a551...`); no new feasibility Spike.
- **Scope:** Implement the verified yield path in production Runtime; do NOT retain `cancel(..., {keepInbox:true})` (verified unnecessary on the pinned commit).
- **Explicit Non-Goals:** No resume (A-T07); no fixture changes; no second yield mechanism.
- **Dependencies / blocked_by:** WAVE-A-T03
- **Expected Surfaces:** `src/runtime/`, `agent/pre-step`, `agent.inbox`
- **Acceptance Criteria:** reproduce the verified main-path trace (step/end → claim → splice restore → reject → blocked → idle → switch); assert inbox exactly `[A,B,C]`, no duplicate pending MessageId, no lost claimed message; negative control splice→reject converges with no same-lane auto-restart.
- **Required Review Evidence:** executed trace; message-integrity assertions; fixture reused verbatim.
- **Stop / Escalation Condition:** pinned-commit divergence from the verified record → STOP, report; no silent new-seam adoption.

#### WAVE-A-T05 — Immutable source-message handoff
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Baseline IDs:** BL-RT-05
- **Current Baseline State:** BL-RT-05: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (`sourceMessage.message` = already-created immutable DSH `UserMessage`; no late text dereference; no second `capturedText` copy), §44 "PENDING user handoff stores an immutable DSH UserMessage"
- **Existing Asset / Contract Reused:** `src/contracts/focus.ts` — `PendingFocusIntent.sourceMessage`
- **Scope:** Handoff behavior: deliver exact content blocks of the stored immutable message with Companion-handoff provenance; never replace with LLM summary; never re-fetch from compacted surface.
- **Explicit Non-Goals:** No inactive-lane admission (A-T06); no text-capture field.
- **Dependencies / blocked_by:** WAVE-A-T02
- **Expected Surfaces:** `src/runtime/`, DSH `UserMessage`
- **Acceptance Criteria:** compact/rewrite source surface after storing in `pendingFocus`; assert handoff uses original immutable blocks + provenance, no late lookup; no second `capturedText` buffer (code check).
- **Required Review Evidence:** test output; source inspection.
- **Stop / Escalation Condition:** frozen `UserMessage`-based handoff unrepresentable → `ESCALATION_REQUIRED`.

#### WAVE-A-T06 — Inactive-lane natural-language admission (narrowed)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A | **Baseline IDs:** BL-RT-09
- **Current Baseline State:** BL-RT-09: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.2 (user-origin activity does not require the inactive Agent running; UI/Runtime creates the `user_command` intent), §16 Manual, §44 "USER messages on an inactive lane are admitted by UI/Runtime"
- **Scope (narrowed):** The inactive-lane natural-language input **admission API only**: UI/Runtime-side entry creates the exact `PendingFocusIntent{target, origin:"user_command", sourceMessage}` with the exact immutable `UserMessage` retained, and submits it through the WAVE-A-T02 arbitration path. The inactive Agent is never required to run or judge first. No safe-boundary/wake behavior is promised here — that is verified by A-T03 (safe boundary), A-T04 (cooperative yield), A-T07 (resume), F-T03 (E2E).
- **Explicit Non-Goals:** No safe-boundary switching; no cooperative-yield; no resume; no production UI; no LLM router; no queue/mailbox.
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-A-T05 (unchanged; intentionally NOT blocked by A-T04)
- **Expected Surfaces:** `src/runtime/` (admission API), tests simulating the inactive View
- **Acceptance Criteria (admission-only):**
  - Input targeting the inactive lane (activeLane=work, attentionMode=manual) → exactly one `PendingFocusIntent` created: exact `target` = inactive lane, `origin = "user_command"`, `sourceMessage` holds the exact immutable `UserMessage`.
  - The intent is submitted into the §5 arbitration path (assert it lands in `pendingFocus` per arbitration rules).
  - The inactive lane's Agent is NOT run and does NOT perform any model cognition first (deterministic assertion).
  - No LLM router exists; no queue/mailbox mechanism in the diff.
- **Required Review Evidence:** admission tests; arbitration-submission assertion; no-queue audit.
- **Stop / Escalation Condition:** admission requiring a generalized mailbox/queue → `ESCALATION_REQUIRED`.

#### WAVE-A-T07 — Resume sequencing / external resume integration
- **Type:** INTEGRATION_TICKET | **Wave:** A | **Baseline IDs:** BL-RT-11
- **Current Baseline State:** BL-RT-11: VERIFIED_FACT_NOT_INTEGRATED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (`pausedLane`), §7.1.2 steps 8-10 (whenIdle → pausedLane → wake target; one tiny `companion-resume` on return; clear pausedLane on admission)
- **Existing Asset / Contract Reused:** verified resume ordering `A → B → C → companion-resume` from `DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md`; `RuntimeFocusState.pausedLane` from `src/contracts/focus.ts`
- **Scope:** Production resume: returning to `pausedLane` admits preserved next-step context; exactly one `companion-resume` wake suffices; `pausedLane` cleared at resume admission.
- **Explicit Non-Goals:** No re-spike; no transactional recovery; no pending-command persistence.
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-A-T04
- **Expected Surfaces:** `src/runtime/`, pinned AgentLoop
- **Acceptance Criteria:** yield at continuation → return → one `companion-resume` → order `A,B,C,resume` consumed; no duplicate pending MessageId; `pausedLane` cleared exactly at admission.
- **Required Review Evidence:** resume trace; ordering assertions.
- **Stop / Escalation Condition:** resume needing durable pending-command state → `ESCALATION_REQUIRED`.

---

### Wave B — GoRulesPort / Tenuki / rules fixtures (repaired chain)

#### WAVE-B-S01 — Tenuki version + conformance spike
- **Type:** SPIKE | **Wave:** B (gate) | **Baseline IDs:** BL-GR-03
- **Current Baseline State:** BL-GR-03: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §26/§27 (explicit `scoring=area`, `koRule=positional-superko`, `komi=7.5`; §31 positional-superko fixture; pin exact version; no auto-upgrade), §44 "ONE authoritative Go rules state"
- **Scope:** Evaluate candidate Tenuki versions against the §31 positional-superko fixture + area scoring + komi 7.5 explicit config. Produce pinned version + conformance record. Not a general Tenuki evaluation.
- **Explicit Non-Goals:** No GoRulesPort/Adapter code (B-T01/T02); no second superko layer; no silent downgrade.
- **Dependencies / blocked_by:** none (independent)
- **Expected Surfaces:** `tests/fixtures/` (superko case), candidate dependency evaluation, `package.json` pin
- **Acceptance Criteria (PASS):** candidate passes §31 positional-superko fixture + area/komi 7.5 explicit config in a reproducible script; conformance record written.
- **FAIL criteria:** no candidate passes → `ESCALATION_REQUIRED` (Spec §27).
- **Required Review Evidence:** executed fixture trace; pinned version; conformance record.
- **Stop / Escalation Condition:** candidate requiring dual rules authority or default reliance → `ESCALATION_REQUIRED`.

#### WAVE-B-T01 — GoRulesPort contract + engine-independent test harness
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Baseline IDs:** BL-GR-01
- **Current Baseline State:** BL-GR-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §26 (GoRulesPort interface), §30 (exactly one authoritative state)
- **Scope:** Define `GoRulesPort` in `src/contracts` (application never depends on Tenuki directly) + engine-independent test harness over any port implementation (stub initially).
- **Explicit Non-Goals:** No Tenuki dependency; no rules behavior; no fixtures yet.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/contracts/rules.ts`, `tests/` harness
- **Acceptance Criteria:** type-level contract test for the port signature; harness runs green against stub with deterministic placeholder assertions.
- **Required Review Evidence:** typecheck + harness output.
- **Stop / Escalation Condition:** port shape deviating from §26 → `ESCALATION_REQUIRED`.

#### WAVE-B-T02 — TenukiAdapter (pinned)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Baseline IDs:** BL-GR-02
- **Current Baseline State:** BL-GR-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §26 (TenukiAdapter implements GoRulesPort), §27 (explicit config from B-S01 pin), §29 (derived inspectGroup if needed)
- **Scope:** Implement `TenukiAdapter implements GoRulesPort` with explicit area/positional-superko/komi 7.5 at game creation; all Tenuki-specific behavior confined to the adapter.
- **Explicit Non-Goals:** No fixtures (B-T05); no UI; no second rules authority.
- **Dependencies / blocked_by:** WAVE-B-S01, WAVE-B-T01
- **Expected Surfaces:** `src/rules/tenuki-adapter.ts`, `package.json` pin
- **Acceptance Criteria:** adapter passes the harness; explicit config asserted at creation (no defaults); application imports only the port.
- **Required Review Evidence:** harness run; config assertion; pin diff.
- **Stop / Escalation Condition:** Tenuki contradicting spike record → re-run conformance; second rules layer → `ESCALATION_REQUIRED`.

#### WAVE-B-T03 — Area scoring / komi 7.5 / positional superko
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Baseline IDs:** BL-GR-04
- **Current Baseline State:** BL-GR-04: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §25 (Chinese area scoring, komi 7.5, positional superko, no undo), §27, `IMPLEMENTATION_BOUNDARIES.md` (production komi 7.5, NOT prototype 6.5)
- **Scope:** Verify pinned rules stack exhibits area scoring, komi 7.5 and positional superko via port-level deterministic tests.
- **Explicit Non-Goals:** No capture/settlement (B-T04); no full §31 suite (B-T05).
- **Dependencies / blocked_by:** WAVE-B-T02
- **Expected Surfaces:** `src/rules/`, `tests/`
- **Acceptance Criteria:** port-level tests: area score of fixed endgame position equals hand-computed score; komi 7.5 applied; repeated-position sequence rejected under positional superko.
- **Required Review Evidence:** test output; komi assertion; no 6.5 in production code.
- **Stop / Escalation Condition:** superko unsupported → `ESCALATION_REQUIRED`.

#### WAVE-B-T04 — Captures / suicide / pass / settlement / dead-stone flow
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Baseline IDs:** BL-GR-05
- **Current Baseline State:** BL-GR-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §25 (captures, two-pass settlement, dead-stone confirmation, disagreement → resume), §31 cases
- **Scope:** Deterministic port-level behavior for captures, suicide rejection, pass, two-pass ending, dead-stone settlement flow.
- **Explicit Non-Goals:** No scoring/superko (B-T03); no full §31 suite (B-T05).
- **Dependencies / blocked_by:** WAVE-B-T02
- **Expected Surfaces:** `src/rules/`, `tests/`
- **Acceptance Criteria:** port-level tests per case: single capture, multi-stone capture, suicide rejected, pass, two-pass → settlement, dead-stone confirmation → final score, disagreement → resume.
- **Required Review Evidence:** per-case fixture output.
- **Stop / Escalation Condition:** settlement requiring Tenuki internals serialization → `ESCALATION_REQUIRED`.

#### WAVE-B-T06 — Canonical action log / replay (repaired: no B-T05 dependency)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Baseline IDs:** BL-GR-06
- **Current Baseline State:** BL-GR-06: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §28 (`CanonicalGameRecord` + `GameAction`; persist own record, never Tenuki internals; recovery = fresh game + replay + verify), §44 "ONE canonical game action history"
- **Scope:** Define `CanonicalGameRecord` / `GameAction` types, persistence of play/pass actions, and replay-restore (create fresh Tenuki game → replay actions → verify authoritative state). Standalone from B-T05: the replay **mechanism** is implemented here; its ten-case contract coverage lives in B-T05.
- **Explicit Non-Goals:** No crash-resume integration (Wave F); no Tenuki-object serialization; no SGF/game-tree.
- **Dependencies / blocked_by:** WAVE-B-T02 (repaired — was B-T02 + B-T05 in V1; the semantic loop is removed)
- **Expected Surfaces:** `src/persistence/canonical.ts` (or `src/rules/canonical.ts`), tests
- **Acceptance Criteria:** unit: play/pass sequences round-trip; replay-restore reproduces authoritative state (deterministic assertion on a fixed position); no Tenuki-internal object touched.
- **Required Review Evidence:** round-trip + replay test output.
- **Stop / Escalation Condition:** restore requiring Tenuki private objects → `ESCALATION_REQUIRED`.

#### WAVE-B-T05 — §31 deterministic fixture suite (repaired: owns full ten cases incl. replay)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B | **Baseline IDs:** BL-GR-07
- **Current Baseline State:** BL-GR-07: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §31 (ten engine-independent cases: single capture, multi-stone capture, suicide rejection, simple ko transition, positional superko, pass, two-pass ending, area scoring, dead-stone settlement, **canonical replay/restoration**), §39.5
- **Scope:** Lock the **full ten-case** §31 suite (including canonical replay/restoration, which exercises the B-T06 mechanism) into a repeatable engine-independent suite over `GoRulesPort`, runnable in CI before significant Go UI behavior.
- **Explicit Non-Goals:** No new rules behaviors; no UI.
- **Dependencies / blocked_by:** WAVE-B-T03, WAVE-B-T04, **WAVE-B-T06** (repaired — replay case depends on the B-T06 mechanism)
- **Expected Surfaces:** `tests/fixtures/`, CI job
- **Acceptance Criteria:** all ten cases pass against the pinned adapter — raw counts: tests = 10, pass = 10, fail = 0, skip = 0; suite runs in CI (workflow run evidence).
- **Required Review Evidence:** CI run with 10/10 fixture passes; replay case assertion output.
- **Stop / Escalation Condition:** a case failing within scope → `ESCALATION_REQUIRED` (Spec §27 rule).

---

### Wave C — Go tools / capability isolation / budget / anti-cheat / calibration

#### WAVE-C-S01 — Pinned DSH request-level token hard-cap seam (new Spike)
- **Type:** SPIKE | **Wave:** C (gate) | **Baseline IDs:** BL-BUD-07
- **Current Baseline State:** BL-BUD-07: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §22.1 (per-request hard cap at request creation), §44 "NO unlimited Go cognition"
- **Scope:** Verify only: which pinned-DSH request hook/waterfall can modify call config; which exact field controls request max tokens; whether the field propagates to the LLM request; how to executable-assert the hard cap; whether it is agent-scoped/request-scoped; whether a plugin/runtime can use it without patching DSH core. **Not a whole-LLM-subsystem study.**
- **Explicit Non-Goals:** No LLM subsystem research; no DSH core patch; no enforcement implementation (C-T07).
- **Dependencies / blocked_by:** none (independent; gates C-T07)
- **Expected Surfaces:** pinned DSH agent/request waterfall, request call-config
- **Acceptance Criteria (PASS):** executable probe/trace shows the exact seam; exact max-token field documented; hard-cap effect assertable (e.g., oversized reasoning request truncated/rejected deterministically); usable by C-T07 without DSH core patch.
- **FAIL criteria:** no usable seam on pinned DSH → record real result; if fixing requires DSH core modification / frozen-architecture change / new shared mechanism → `ESCALATION_REQUIRED`.
- **Required Review Evidence:** probe trace; seam documentation; hard-cap assertion.
- **Stop / Escalation Condition:** seam requires DSH core patch or new shared mechanism → `ESCALATION_REQUIRED`.

#### WAVE-C-T01 — Go lane model-facing surface / sole strategy owner
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-GT-01
- **Current Baseline State:** BL-GT-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §18 (sole strategic policy owner; forbidden solver surface), §20 (exact 9-tool whitelist), AGENTS.md frozen constraint
- **Scope:** Define Go lane's model-facing surface as exactly the 9-tool whitelist; enforce no strategy/solver/best-move surface; smoke asserts forbidden surfaces absent.
- **Explicit Non-Goals:** No tool implementations (C-T02/T03); no preset isolation (C-T04).
- **Dependencies / blocked_by:** WAVE-C-T04
- **Expected Surfaces:** `src/tools/` registry, preset config
- **Acceptance Criteria:** registered tool names = exactly §20 list; smoke asserts no forbidden strategy surface; no solver library import.
- **Required Review Evidence:** surface enumeration; smoke output.
- **Stop / Escalation Condition:** strategy capability required → `ESCALATION_REQUIRED`.

#### WAVE-C-T02 — 7 `go.*` model-facing tools
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-GT-02
- **Current Baseline State:** BL-GT-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §20 (7 tools), §22.3 (tool accounting at actual execution), §32 (tool action is truth)
- **Scope:** Register/implement the seven `go.*` tools over `GoRulesPort`; `go.try_move` returns legal/captures/local liberties only (no evaluative fields); wire budget accounting at actual tool execution via C-T07's enforcement API.
- **Explicit Non-Goals:** No `companion.*` (C-T03); no boost logic (C-T08); no strategy advice.
- **Dependencies / blocked_by:** WAVE-B-T02, WAVE-C-T01, WAVE-C-T06, WAVE-C-T07
- **Expected Surfaces:** `src/tools/go/`
- **Acceptance Criteria:** each tool: call → port call → §20 result shape (try_move no good/bad/win-rate); illegal attempt returns legality result without state mutation; execution consumes budget counter.
- **Required Review Evidence:** tool tests; try_move schema assertion; budget counter assertion.
- **Stop / Escalation Condition:** tool needing solver-like evaluation → `ESCALATION_REQUIRED`.

#### WAVE-C-T03 — 2 `companion.*` model-facing tools
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-GT-03
- **Current Baseline State:** BL-GT-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §20 (`companion.affect`, `companion.request_focus`), §5/§6 (Runtime sole wake authority), §14 (bounded deltas)
- **Scope:** Register `companion.request_focus("work"|"go")` end-to-end (submits intent into §5 arbitration) and `companion.affect({...})` (validates bounded deltas, applies through mood reducer).
- **Explicit Non-Goals:** No mood reducer semantics (D-T04); no attention policy (D-T06); no UI.
- **Dependencies / blocked_by:** WAVE-A-T02 (focus arbitration), WAVE-D-T04 (mood reducer)
- **Expected Surfaces:** `src/tools/companion/`
- **Acceptance Criteria:** request_focus test: correct target/origin intent appears in `pendingFocus` (no direct lane wake); affect test: delta applied through reducer, out-of-bound delta rejected; no cross-lane direct calls.
- **Required Review Evidence:** tool tests; no-direct-call assertion.
- **Stop / Escalation Condition:** request_focus bypassing Runtime arbitration → `ESCALATION_REQUIRED`.

#### WAVE-C-T04 — Go preset isolation + execution-time capability guards
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-CAP-01, BL-CAP-02
- **Current Baseline State:** BL-CAP-01: NOT_IMPLEMENTED; BL-CAP-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §19 (isolated native-only realm; prompt-hiding insufficient), §21 ("cannot see + cannot execute")
- **Existing Asset / Contract Reused:** Foundation smoke asserting `companion-go-tools` absent (evidence pattern)
- **Scope (atomicity):** Preset declaration and execution-time guard are one isolation gap (preset without guard fails §21; guard without preset leaves surface ungoverned).
- **Explicit Non-Goals:** No tools; no anti-cheat suite (C-T05); no DSH core patch.
- **Dependencies / blocked_by:** WAVE-A-T01
- **Expected Surfaces:** DSH preset/scope config, `src/runtime/` guards
- **Acceptance Criteria:** preset enumeration shows native-only realm; guard test: forbidden capability registered into Go scope still fails at execution (deterministic failure).
- **Required Review Evidence:** preset config output; guard test run.
- **Stop / Escalation Condition:** Go needing inherited general capability → `ESCALATION_REQUIRED`.

#### WAVE-C-T05 — Anti-cheat tests (§39.3)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-CAP-03
- **Current Baseline State:** BL-CAP-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §39.3 (all forbidden capabilities fail at execution authority), §40 Anti-Cheat
- **Scope:** Automated suite attempting each forbidden capability from the Go lane; assert execution-authority failure.
- **Explicit Non-Goals:** No new guard code; no UI.
- **Dependencies / blocked_by:** WAVE-C-T04
- **Expected Surfaces:** `tests/` anti-cheat suite, CI job
- **Acceptance Criteria:** every forbidden attempt yields deterministic execution-authority failure; CI runs the suite (run log, raw pass/fail counts).
- **Required Review Evidence:** per-capability suite output.
- **Stop / Escalation Condition:** any forbidden capability succeeding → `ESCALATION_REQUIRED`.

#### WAVE-C-T06 — GoTurnBudget contract + injectable non-production test configuration (re-scoped)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-BUD-01
- **Current Baseline State:** BL-BUD-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22 (`GoTurnBudget` fields; exact numeric values not frozen — benchmark-derived)
- **Scope:** Define the `GoTurnBudget` contract + **config loading with injectable values** so tests can use explicit fixture/test defaults. **No production numeric defaults are claimed here.** All values are non-production test configuration until WAVE-C-T10 (BL-BUD-06) produces benchmark-derived calibration.
- **Explicit Non-Goals:** No enforcement (C-T07); no boost (C-T08); no benchmark run (C-T10); **no production-default claim** — values must not be presented as production-frozen in Baseline/docs before §38 evidence.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/contracts/budget.ts`, config loader
- **Acceptance Criteria:** type-level contract test matches §22 fields; injectable config loads explicit fixture defaults; documentation states values are NOT production calibration (no production-default wording).
- **Required Review Evidence:** typecheck + contract test; docs wording check.
- **Stop / Escalation Condition:** freezing numeric values without §38 evidence → `ESCALATION_REQUIRED`.

#### WAVE-C-T07 — Budget enforcement + post-move no-analysis-loop (now blocked by the seam spike)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-BUD-02, BL-BUD-04
- **Current Baseline State:** BL-BUD-02: NOT_IMPLEMENTED; BL-BUD-04: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22.1 (per-request hard cap at request creation), §22.2 (turn-level cap), §22.3 (accounting at actual Go tool execution; no wrapper hides calls), §22.4 (exhaustion), §24 (post-move no-analysis-loop)
- **Scope:** Enforcement engine: per-request hard cap **using the seam verified by WAVE-C-S01** (never guessed), turn-level denial, per-tool accounting, exhaustion handling, no-analysis-loop rule. Enforcement API consumed by C-T02.
- **Explicit Non-Goals:** No deep-think boost (C-T08); no bypass tests (C-T09); no benchmark (C-T10); no DSH core patch.
- **Dependencies / blocked_by:** WAVE-C-T06, **WAVE-C-S01** (new — per-request hard cap must use the spike-verified real seam, not an assumption)
- **Expected Surfaces:** `src/budget/`
- **Acceptance Criteria:** per-request cap denied at exact boundary (via the verified seam); turn-level cap; aggregated double-invoke counted once per actual execution; after committed play/pass, no further model step of the same turn (deterministic sequence test).
- **Required Review Evidence:** enforcement tests; seam usage trace (from C-S01); no-wrapper-hole assertion.
- **Stop / Escalation Condition:** seam proves unusable → record; enforcement needing DSH core patch or new mechanism → `ESCALATION_REQUIRED`.

#### WAVE-C-T08 — Deep-think boost (bounded)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-BUD-03
- **Current Baseline State:** BL-BUD-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §23 (one bounded boost; no unlimited mode; never exceeds per-request cap; never removes turn ceiling)
- **Scope:** `go.request_deep_think` grants one bounded boost within the enforcement engine's caps.
- **Explicit Non-Goals:** No unlimited mode; no bypass tests (C-T09).
- **Dependencies / blocked_by:** WAVE-C-T02, WAVE-C-T07
- **Expected Surfaces:** `src/tools/go/`, `src/budget/`
- **Acceptance Criteria:** boost grants single bounded increment; request still capped; turn ceiling unchanged (deterministic assertions).
- **Required Review Evidence:** boost boundary tests.
- **Stop / Escalation Condition:** boost requiring unbounded reasoning → `ESCALATION_REQUIRED`.

#### WAVE-C-T09 — Budget bypass tests (§39.4)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-BUD-05
- **Current Baseline State:** BL-BUD-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §39.4 (many try_moves/inspects/steps, oversized request, aggregated paths; hard limits hold), §40 Budget
- **Scope:** Adversarial suite attempting each listed bypass; assert hard limits hold.
- **Explicit Non-Goals:** No enforcement changes (C-T07/T08).
- **Dependencies / blocked_by:** WAVE-C-T07, WAVE-C-T08
- **Expected Surfaces:** `tests/` budget suite, CI job
- **Acceptance Criteria:** each bypass deterministically hits its limit (asserted counters/log); CI runs the suite.
- **Required Review Evidence:** per-bypass output (raw counts).
- **Stop / Escalation Condition:** any bypass succeeding → `ESCALATION_REQUIRED`.

#### WAVE-C-T10 — Automated cognition benchmark + production budget calibration (new)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C | **Baseline IDs:** BL-BUD-06
- **Current Baseline State:** BL-BUD-06: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22 (numeric values come from benchmark), §38 (Automated Cognition Benchmark), §44 "NO unlimited Go cognition"
- **Scope:** Build a deterministic benchmark harness + scenario fixtures; run representative cognition scenarios over the real production-like Go reasoning path; collect the Spec §38 metrics; produce a production budget calibration record; switch production `GoTurnBudget` runtime config to the chosen numeric defaults (hard caps explicit). The benchmark must run on: stable rules behavior (B-T05), actual model-facing Go tools (C-T02), actual enforcement (C-T07), actual deep-think behavior (C-T08).
- **Explicit Non-Goals:** No change to Spec budget fields; no model-performance research; no strength optimization; no solver/KataGo; no long-term telemetry platform.
- **Dependencies / blocked_by:** WAVE-B-T05, WAVE-C-T02, WAVE-C-T07, WAVE-C-T08 (chain: C-S01 → C-T07 → C-T02 → C-T08 → C-T10; B-T05 parallel) — no cycle (C-T10 is a leaf)
- **Expected Surfaces:** `tests/benchmark/`, `src/budget/` (production config), runtime Go reasoning path
- **Acceptance Criteria (per fixture class — at least opening, local capture, escape, ko, pressure, endgame):**
  - Record per class: latency, model token total, model steps, inspect calls, try_move calls, deep-think use, illegal attempts.
  - Output the raw benchmark record.
  - Output chosen numeric defaults + rationale.
  - Switch production config to benchmark-derived values; state explicitly which are hard caps.
  - `pnpm verify` / relevant benchmark checks pass; evidence available for review.
- **Stop / Escalation Condition:** benchmark exposing a frozen Spec contract deficiency → `ESCALATION_REQUIRED`.
- **Required Review Evidence:** raw benchmark record; calibration rationale; config diff; check run.

---

### Wave D — Bridge / Attention / Persona / Mood

#### WAVE-D-S01 — `ctx.systemPrompt.context` provider spike
- **Type:** SPIKE | **Wave:** D (gate) | **Baseline IDs:** BL-BR-03
- **Current Baseline State:** BL-BR-03: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §9.1 (agent-scoped provider; evaluated per eligible prompt assembly; materializes only on change; O(1) read of Runtime-held values)
- **Scope:** Probe only what the project depends on: agent scope, registration, rendering, update/materialization semantics, O(1) latest-projection delivery suitability. Not a DSH context-system study.
- **Explicit Non-Goals:** No Bridge implementation (D-T01); no DSH core patch.
- **Dependencies / blocked_by:** none (independent)
- **Expected Surfaces:** pinned DSH `ctx.systemPrompt.context`, `agent.inject` comparison
- **Acceptance Criteria (PASS):** provider registers agent-scoped; reads only an already-computed Runtime snapshot (no history rescan asserted); unchanged snapshot adds no repeated message; changed snapshot materializes; delivery O(1)-suitable.
- **FAIL criteria:** unavailable/different → record real capability, fallback `agent.inject` one-shot per §9.1, note D-T03 impact.
- **Required Review Evidence:** probe trace; materialization/dedup assertions.
- **Stop / Escalation Condition:** provider requiring new shared mechanism or DSH patch → `ESCALATION_REQUIRED`.

#### WAVE-D-T01 — Bridge latest-value runtime
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Baseline IDs:** BL-BR-01, BL-BR-02
- **Current Baseline State:** BL-BR-01: FOUNDATION_ONLY; BL-BR-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §9 (latest-value, never event-stream), §9.1 (Runtime-owned latest values), §10/§11 (WorkSnapshot/GameNotice; no strategic labels)
- **Existing Asset / Contract Reused:** `src/contracts/bridge.ts` — `CompanionBridge`, `WorkSnapshot`, `GameNotice`, `AffectedGroupDelta`
- **Scope (atomicity):** Contract shape + latest-value runtime are one gap (holder without frozen semantics is not the Bridge).
- **Explicit Non-Goals:** No provider delivery (D-T03, gate by D-S01); no transcript sync; no recursive projection (§12).
- **Dependencies / blocked_by:** WAVE-A-T01
- **Expected Surfaces:** `src/bridge/`
- **Acceptance Criteria:** latest-value coalescing (N updates → single latest); GameNotice no forbidden fields (schema test); WorkSnapshot grounded in facts; §12 no-recursive-projection test.
- **Required Review Evidence:** unit tests; schema assertion.
- **Stop / Escalation Condition:** Bridge carrying commands/queues → `ESCALATION_REQUIRED`.

#### WAVE-D-T02 — Cross-lane awareness / no transcript injection
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Baseline IDs:** BL-BR-04
- **Current Baseline State:** BL-BR-04: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §12 (no recursive projection), §35 (no mixed timeline; small sourced context), §40 Context Isolation
- **Existing Asset / Contract Reused:** `src/contracts/bridge.ts`
- **Scope:** Awareness surfaces never inject raw histories; handoff messages not re-forwarded automatically.
- **Explicit Non-Goals:** No delivery (D-T03); no UI policy.
- **Dependencies / blocked_by:** WAVE-D-T01
- **Expected Surfaces:** `src/bridge/`, tests
- **Acceptance Criteria:** after long synthetic game, Work history has no full Go transcript/board states (symmetric for Go); projection never re-projected (§12).
- **Required Review Evidence:** isolation test output.
- **Stop / Escalation Condition:** isolation requiring DSH history filtering → `ESCALATION_REQUIRED`.

#### WAVE-D-T03 — No Bridge-only evaluation wake
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Baseline IDs:** BL-BR-05
- **Current Baseline State:** BL-BR-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §9.1 (no evaluation-only wake; idle handling via mode + objective state; Manual never auto-switches; no cooldown timer), §39.6
- **Scope:** Deliver latest snapshots per D-S01 findings (or recorded fallback) such that Bridge changes never create evaluation-only wakes; unchanged snapshots add no repeated prompt material.
- **Explicit Non-Goals:** No attention policy (D-T06); no focus scheduling (D-T07).
- **Dependencies / blocked_by:** WAVE-D-T01, WAVE-D-S01, WAVE-A-T02
- **Expected Surfaces:** `src/bridge/delivery.ts`, pinned DSH context seam
- **Acceptance Criteria:** §39.6 smoke: 20 rapid GameNotice updates while Work runs → zero additional attention-evaluation model requests (request-count trace); idle Manual lane not woken by Bridge change; next natural Work request sees only newest snapshot.
- **Required Review Evidence:** request-count trace; materialization assertions.
- **Stop / Escalation Condition:** avoiding eval wakes requiring cooldown/new mechanism → `ESCALATION_REQUIRED`.

#### WAVE-D-T04 — CompanionState runtime + mood reducer
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Baseline IDs:** BL-CMP-01, BL-CMP-03
- **Current Baseline State:** BL-CMP-01: FOUNDATION_ONLY; BL-CMP-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §13 (one small authoritative CompanionState; latest persistence; no journal), §14 (bounded deltas, clamp, baseline return; no hard-coded trigger rules), §44 "ONE small authoritative CompanionState"
- **Existing Asset / Contract Reused:** `src/contracts/companion.ts` — `CompanionState<TCompiledPersona, TMoodState>`, `AttentionMode`
- **Scope (atomicity):** Holder + reducer operate on the same state object; separating them prevents end-to-end mood verification.
- **Explicit Non-Goals:** No persona compiler (D-T05); no attention policy (D-T06); no journal.
- **Dependencies / blocked_by:** none (independent)
- **Expected Surfaces:** `src/companion/`
- **Acceptance Criteria:** reducer tests: clamping at bounds, slow baseline return, persona never overwritten by mood; latest-state persistence round-trip; no journal artifacts.
- **Required Review Evidence:** reducer tests; persistence round-trip.
- **Stop / Escalation Condition:** mood needing event history → `ESCALATION_REQUIRED`.

#### WAVE-D-T05 — Persona Compiler + schema freeze
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Baseline IDs:** BL-CMP-02
- **Current Baseline State:** BL-CMP-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §15 (plain-language + dialogue-sample inputs; compiler profile; persona never alters Work state), §40 Persona Continuity
- **Scope:** Persona Compiler from both input forms; freeze compiled-persona schema.
- **Explicit Non-Goals:** No large parameter panel; no mood.
- **Dependencies / blocked_by:** WAVE-D-T04
- **Expected Surfaces:** `src/companion/persona.ts`
- **Acceptance Criteria:** compiler tests (both inputs → deterministic profile); schema freeze recorded; persona does not alter Work state.
- **Required Review Evidence:** compiler tests; frozen schema declaration.
- **Stop / Escalation Condition:** schema conflicting with `CompanionState` generic → `ESCALATION_REQUIRED`.

#### WAVE-D-T06 — Attention mode runtime semantics
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Baseline IDs:** BL-CMP-04
- **Current Baseline State:** BL-CMP-04: FOUNDATION_ONLY | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §16 (mode semantics; no task taxonomy; Manual disables autonomous switching), §9.1 idle handling
- **Existing Asset / Contract Reused:** `src/contracts/companion.ts` — `AttentionMode`
- **Scope:** Runtime semantics mapping each mode to attention readiness and autonomous-switch permission.
- **Explicit Non-Goals:** No focus scheduling (D-T07); no UI controls.
- **Dependencies / blocked_by:** WAVE-D-T04
- **Expected Surfaces:** `src/companion/attention.ts`
- **Acceptance Criteria:** per-mode tests: Mofish may schedule on micro-break; Normal on waits; Strict preserves Work continuity; Manual never schedules; no importance taxonomy.
- **Required Review Evidence:** per-mode output.
- **Stop / Escalation Condition:** modes requiring numeric importance table → `ESCALATION_REQUIRED`.

#### WAVE-D-T07 — Self-initiated focus
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D | **Baseline IDs:** BL-CMP-05
- **Current Baseline State:** BL-CMP-05: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5/§6 (self_initiated origin; Runtime sole wake authority), §9.1 (Normal/Mofish schedule from objective state; coalesce into single pendingFocus)
- **Scope:** Runtime scheduling of self-initiated focus intents from objective state per active mode, always through the single `pendingFocus`.
- **Explicit Non-Goals:** No user-origin admission (A-T06); no attention semantics (D-T06).
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-D-T06
- **Expected Surfaces:** `src/runtime/`, `src/companion/attention.ts`
- **Acceptance Criteria:** Normal mode + objective state schedules one `self_initiated` intent; later user-origin intent wins; repeated triggers coalesce.
- **Required Review Evidence:** scheduling tests; arbitration interaction.
- **Stop / Escalation Condition:** needing evaluation-only wakes → `ESCALATION_REQUIRED`.

---

### Wave E — Harness Web UI

#### WAVE-E-S01 — DSH Web `conversation.view` extension seam spike
- **Type:** SPIKE | **Wave:** E (gate) | **Baseline IDs:** BL-UI-04
- **Current Baseline State:** BL-UI-04: NEEDS_SPIKE | **Target State:** VERIFIED_FACT_NOT_INTEGRATED
- **Spec Authority:** §34 (prove seam before depending: coexistence, no fusion, mini surfaces, dual-session single shell; simplify UX before patching core)
- **Scope:** Probe on pinned DSH Web: Go view mount, Chat/Go/Trajectory coexistence, dual-session single-shell control, mini-surface placement. No transcript fusion.
- **Explicit Non-Goals:** No production UI (E-T01); no DSH core patch.
- **Dependencies / blocked_by:** none (independent)
- **Expected Surfaces:** pinned DSH Web `conversation.view`, view registry
- **Acceptance Criteria (PASS):** all five §34 items verified with real view-mount evidence; seam API and placement points recorded.
- **FAIL criteria:** seam cannot host Go view / fusion unavoidable → record real behavior + simplified-UX fallback per §34 (must precede E-T01).
- **Required Review Evidence:** mounted-view evidence + assertion log.
- **Stop / Escalation Condition:** smoke requiring DSH core patch → `ESCALATION_REQUIRED`.

#### WAVE-E-T01 — Production Harness Go UI + board-click direct route (acceptance matrix strengthened)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** E | **Baseline IDs:** BL-UI-02, BL-RT-10
- **Current Baseline State:** BL-UI-02: NOT_IMPLEMENTED; BL-RT-10: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §32 (full required behavior), §33 (DSH-native shell; seats; mini surfaces; no Go budget on Work), §7.2 (board click → GoRulesPort directly, then GameNotice; no fabricated focus intent), §34 (seam smoke)
- **Scope (atomicity):** Production Go view in Harness Web per V4 presentation reference (layout/interaction authority only) + the board-click direct route `click → GoRulesPort.play → state/GameNotice → UI`. Board click is the defining interaction of a real board (§32), so BL-UI-02 + BL-RT-10 are one vertical slice.
- **Explicit Non-Goals:** No desktop wrapper (BL-UI-03 DEFERRED); no TUI; no prototype logic inheritance; no transcript fusion.
- **Dependencies / blocked_by:** WAVE-E-S01, **WAVE-B-T05** (new — full rules fixtures must pass before significant Go UI behavior per §31), WAVE-D-T01, WAVE-A-T01. (B-T02 is reached transitively through B-T05; not duplicated.)
- **Expected Surfaces:** `src/ui/` (Harness Web view extension), `src/bridge/` (GameNotice feed)
- **Acceptance Criteria — §32 required behavior matrix (each row must be explicitly verified):**

| # | Required behavior | Acceptance assertion |
|---|---|---|
| 1 | Board sizes 9x9 / 13x13 / 19x19 | Each size can be created, displayed and interacted with (smoke per size) |
| 2 | Stones (black/white) | Stones rendered correctly; authoritative state drives rendering (no text parsing of moves) |
| 3 | Captures | Automatic captures reflected immediately after `GoRulesPort` state update (assert board+count) |
| 4 | Last move | Visible last-move indication after play/pass |
| 5 | Turn | Clear current-turn indication from authoritative state |
| 6 | Pass | Pass control invokes `GoRulesPort.pass`; resulting state / GameNotice / UI verified |
| 7 | Resign | Resign control exists; game status/final-result path correct per Spec |
| 8 | Final result | Game-over/final-result UI shown from authoritative rules result (not model text) |
| 9 | Animation | Minimal placement animation + minimal capture animation (present, not truth-affecting) |
| 10 | Sound | Minimal stone sound; sound must not alter game truth |
| 11 | Board click | click → `GoRulesPort.play` → authoritative state / GameNotice → UI; no fabricated `PendingFocusIntent`; illegal click rejected and reflected |
| 12 | Mini surfaces | Work View mini Go surface; Go View mini WorkSnapshot, both from latest-value Bridge |
| 13 | Isolation | Work / Go transcripts not merged (DOM separation assertion) |
| 14 | Prototype boundary | Production does NOT inherit: komi 6.5 (assert config = 7.5), random AI, fake timing, prototype rules, prototype Attention semantics (code audit + assertions) |

- **Required Review Evidence:** browser/smoke run evidence (DOM/screenshot), board-click trace, §32 matrix assertion output, no-prototype-logic audit.
- **Stop / Escalation Condition:** production UI requiring prototype rules/AI/timing inheritance → `ESCALATION_REQUIRED`.

---

### Wave F — Integration / crash-resume / replay recovery / hardening

#### WAVE-F-T01 — Crash / resume recovery
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F | **Baseline IDs:** BL-HARD-01
- **Current Baseline State:** BL-HARD-01: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §36 (restore sessions/canonical record/board/CompanionState/attention mode; default Work focus; no transactional recovery)
- **Scope:** Recovery pipeline restoring both sessions, canonical record (via B-T06), reconstructed board, CompanionState, attention mode; default Work focus.
- **Explicit Non-Goals:** No transactional recovery; no pending-command durability (unless trivially reliable).
- **Dependencies / blocked_by:** WAVE-A-T01, WAVE-B-T06, WAVE-D-T04
- **Expected Surfaces:** `src/persistence/`, `src/runtime/`
- **Acceptance Criteria:** restart test: pre-crash state restored; board equals replayed canonical record; focus defaults to Work; transient pending focus not required to survive (documented).
- **Required Review Evidence:** restart test output; no-transaction assertion.
- **Stop / Escalation Condition:** recovery requiring transaction protocol → `ESCALATION_REQUIRED`.

#### WAVE-F-T02 — Replay recovery
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F | **Baseline IDs:** BL-HARD-02
- **Current Baseline State:** BL-HARD-02: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §28 (fresh game + replay + verify), §36
- **Scope:** Replay-restore integration into recovery with authoritative-state verification.
- **Explicit Non-Goals:** No UI; no second rules authority.
- **Dependencies / blocked_by:** WAVE-B-T06
- **Expected Surfaces:** `src/persistence/`, `src/rules/`
- **Acceptance Criteria:** long action sequence survives round-trip; post-replay state matches pre-crash state (board + turn + captures).
- **Required Review Evidence:** replay test output.
- **Stop / Escalation Condition:** replay depending on Tenuki internals → `ESCALATION_REQUIRED`.

#### WAVE-F-T03 — E2E integration continuity (work → go → work)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F | **Baseline IDs:** BL-HARD-03
- **Current Baseline State:** BL-HARD-03: NOT_IMPLEMENTED | **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §40 (Correctness counters; Context Isolation; Continuity; Cognition Exclusivity), §39.1/39.2 smoke, §22 (production budget values must be benchmark-derived)
- **Scope:** End-to-end validation slice: work → Go turn → work continuity, context isolation, cognition exclusivity, cross-lane command handoff smokes (§39.1/§39.2). Runs on production budget configuration (benchmark-derived, per C-T10).
- **Explicit Non-Goals:** No new features; no post-game analysis (BL-HARD-04 DEFERRED).
- **Dependencies / blocked_by:** WAVE-A-T07, WAVE-B-T06, WAVE-E-T01, WAVE-D-T04, **WAVE-C-T10** (production readiness requires benchmark-derived budget values — §38/§22; shown in the graph, not elided for parallelism)
- **Expected Surfaces:** full stack `src/runtime/`, `src/rules/`, `src/bridge/`, `src/ui/`, `src/budget/`
- **Acceptance Criteria:**
  - §39.1: Go View "回去把剩下两个测试修掉" → Work focus, Work Session receives original instruction verbatim (assert); symmetric "去下一手".
  - §39.2: concurrent wake — Go input during Work mid-turn does not enter foreground cognition; input not lost; admitted at safe boundary; step-3 work not aborted; handoff at first continuation boundary; one `companion-resume` suffices on return.
  - §40 correctness counters all zero (accepted illegal moves = 0, state drift = 0, capture errors = 0, lost cross-lane commands = 0).
  - Runs against production budget defaults from WAVE-C-T10 (not test config).
- **Required Review Evidence:** e2e run trace; all assertion outputs; production config in use.
- **Stop / Escalation Condition:** any §40 invariant unmet within scope → `ESCALATION_REQUIRED`.

---

## 4. Spike List (5)

| Spike | Baseline | Question | PASS criteria | FAIL criteria / fallback | Blocked work |
|---|---|---|---|---|---|
| INFRA-S01 | BL-PKG-06 | Does `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` resolve/build/activate on pinned DSH? | Real command succeeds; bundle reconciliation + fiber active (reuse `profile-mount-smoke.mjs`); trace uploaded | Record real behavior; fallback = installation docs pin a packed tarball | Wave F installation acceptance, installation docs |
| WAVE-B-S01 | BL-GR-03 | Which pinned Tenuki satisfies area + positional-superko + komi 7.5 explicit config passing §31? | Candidate passes §31 positional-superko fixture + area/komi 7.5 explicit config; version pinned; conformance record | No candidate → `ESCALATION_REQUIRED` (no silent degrade) | B-T02 → B-T03/B-T04/B-T06 → B-T05 → E-T01, C-T02, F-T01/T02/T03 |
| WAVE-D-S01 | BL-BR-03 | `ctx.systemPrompt.context` agent-scoped provider semantics on pinned DSH? | Registered agent-scoped; reads only Runtime-held snapshot (no rescan); materializes only on change; O(1) latest-delivery suitable | Record real capability; fallback `agent.inject` one-shot per §9.1; impacts D-T03 | WAVE-D-T03 |
| WAVE-E-S01 | BL-UI-04 | Can a Go view mount in DSH Web with Chat/Go/Trajectory coexisting, dual-session single shell, mini surfaces, no fusion? | All five §34 items verified with view-mount evidence | Record real behavior; simplify UX per §34 before E-T01 | WAVE-E-T01 |
| WAVE-C-S01 | BL-BUD-07 | Which pinned-DSH request hook/field enforces request-level max tokens? (new) | Executable probe/trace; exact seam documented; hard-cap effect assertable; usable by C-T07 without DSH core patch | No usable seam → record; DSH-core patch / frozen-architecture change / new shared mechanism → `ESCALATION_REQUIRED` | WAVE-C-T07 → C-T02 → C-T08 → C-T10 → F-T03 |

All five Spikes are pairwise independent and independent of Wave A; they can all start immediately.

---

## 5. Dependency Graph (recomputed, cycle-free)

```text
INFRA-T01 (CI triggers)                     ─ independent
INFRA-S01 (GitHub install spike)            ─ independent
WAVE-B-S01 (Tenuki spike)                   ─ independent
WAVE-D-S01 (context provider spike)         ─ independent
WAVE-E-S01 (Web view seam spike)            ─ independent
WAVE-C-S01 (request hard-cap seam spike)    ─ independent (new)
WAVE-A-T01 (dual sessions)                  ─ independent
WAVE-B-T01 (GoRulesPort + harness)          ─ independent
WAVE-C-T06 (budget contract, injectable)    ─ independent
WAVE-D-T04 (CompanionState + mood reducer)  ─ independent

Wave A:
WAVE-A-T02 (focus machine)         ← WAVE-A-T01
WAVE-A-T03 (safe boundary)         ← WAVE-A-T01, WAVE-A-T02
WAVE-A-T05 (immutable handoff)     ← WAVE-A-T02
WAVE-A-T04 (yield integration)     ← WAVE-A-T03
WAVE-A-T06 (inactive admission)    ← WAVE-A-T02, WAVE-A-T05   (NOT blocked by A-T04)
WAVE-A-T07 (resume integration)    ← WAVE-A-T02, WAVE-A-T04

Wave B (repaired):
WAVE-B-T02 (TenukiAdapter)         ← WAVE-B-S01, WAVE-B-T01
WAVE-B-T03 (area/komi/superko)     ← WAVE-B-T02
WAVE-B-T04 (captures/settle)       ← WAVE-B-T02
WAVE-B-T06 (canonical record)      ← WAVE-B-T02              (NO B-T05 dependency)
WAVE-B-T05 (§31 full ten cases)    ← WAVE-B-T03, WAVE-B-T04, WAVE-B-T06

Wave C:
WAVE-C-T04 (preset + guards)       ← WAVE-A-T01
WAVE-C-T01 (9-tool surface)        ← WAVE-C-T04
WAVE-C-T07 (budget enforcement)    ← WAVE-C-T06, WAVE-C-S01   (new seam gate)
WAVE-C-T02 (7 go.* tools)          ← WAVE-B-T02, WAVE-C-T01, WAVE-C-T06, WAVE-C-T07
WAVE-C-T08 (deep-think boost)      ← WAVE-C-T02, WAVE-C-T07
WAVE-C-T05 (anti-cheat tests)      ← WAVE-C-T04
WAVE-C-T03 (2 companion.* tools)   ← WAVE-A-T02, WAVE-D-T04
WAVE-C-T09 (budget bypass tests)   ← WAVE-C-T07, WAVE-C-T08
WAVE-C-T10 (benchmark+calibration) ← WAVE-B-T05, WAVE-C-T02, WAVE-C-T07, WAVE-C-T08  (leaf)

Wave D:
WAVE-D-T01 (bridge latest-value)   ← WAVE-A-T01
WAVE-D-T02 (no transcript)         ← WAVE-D-T01
WAVE-D-T03 (no eval wake)          ← WAVE-D-T01, WAVE-D-S01, WAVE-A-T02
WAVE-D-T05 (persona compiler)      ← WAVE-D-T04
WAVE-D-T06 (attention modes)       ← WAVE-D-T04
WAVE-D-T07 (self-initiated focus)  ← WAVE-A-T02, WAVE-D-T06

Wave E:
WAVE-E-T01 (Go UI + board click)   ← WAVE-E-S01, WAVE-B-T05, WAVE-D-T01, WAVE-A-T01  (B-T05 gate added)

Wave F:
WAVE-F-T01 (crash/resume)          ← WAVE-A-T01, WAVE-B-T06, WAVE-D-T04
WAVE-F-T02 (replay recovery)       ← WAVE-B-T06
WAVE-F-T03 (e2e continuity)        ← WAVE-A-T07, WAVE-B-T06, WAVE-E-T01, WAVE-D-T04, WAVE-C-T10
```

Cycle check: B-T02 → {T03, T04, T06} → T05 (one direction); C-T06 → C-T07 → C-T02 → C-T08 → C-T10 (one direction; C-T02 also ← C-T01 ← C-T04); no edge points back to a predecessor on any path. **No cycles.**

---

## 6. Critical Path (recomputed)

1. **Runtime path:** A-T01 → A-T02 → A-T03 → A-T04 → A-T07 → F-T03.
2. **Rules/UI path:** B-S01 → B-T02 → {B-T03, B-T04, B-T06} → B-T05 → E-T01 (also needs E-S01, D-T01 via A-T01, A-T01) → F-T03.
3. **Budget calibration path (new):** C-S01 → C-T07 → C-T02 → C-T08 → C-T10 (also waits on B-T05) → F-T03.
4. **Convergence:** all three paths terminate at **F-T03** (final vertical slice / production readiness).

**§38 calibration blocking statement:** per Spec §22 (numeric values come from benchmark) and §40 (production acceptance), production budget defaults must be benchmark-derived **before** final e2e production readiness. Therefore **WAVE-C-T10 blocks WAVE-F-T03** — it is on the critical path to final readiness, encoded in the graph (not elided for parallelism). It does NOT block the early runtime or rules chains; it runs in parallel with Wave D/E and converges before F-T03.

---

## 7. Parallelizable Work (recomputed)

- **All 5 Spikes run in parallel immediately** (INFRA-S01, B-S01, C-S01, D-S01, E-S01) — none depends on Wave A.
- **Independent first-wave tickets in parallel:** INFRA-T01, A-T01, B-T01, C-T06, D-T04.
- **Wave A chain ∥ Wave B chain ∥ budget chain:** A (T01→T02→T03→T04→T07) ∥ B (S01→T02→T03/04/06→T05) ∥ C-budget (C-S01→C-T07→C-T02→C-T08→C-T10).
- **C-T10 (benchmark) overlaps Wave D and Wave E:** it needs B-T05 + C-T02/C-T07/C-T08, all of which complete during Wave B/C — so calibration runs while Wave D/E progress; it converges before F-T03.
- **WAVE-E-S01 (Web seam spike) does not wait for Wave D.**
- **WAVE-C-T03 (companion.* tools) starts only after A-T02 + D-T04** — intentional C/D coupling, not serial A→F.

---

## 8. BASELINE_COVERAGE_MATRIX (59 rows, one row per ID)

| Baseline ID | Current State | Handling | Primary Ticket | Dependencies | Coverage Result |
|---|---|---|---|---|---|
| BL-PKG-01 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-PKG-02 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-PKG-03 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-PKG-04 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-PKG-05 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-PKG-06 | NEEDS_SPIKE | SPIKE | INFRA-S01 | none | COVERED |
| BL-PKG-07 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-PKG-08 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-PKG-09 | IMPLEMENTED_VERIFIED | KEEP_AS_UPGRADE_GATE | — | — | NO_ACTION |
| BL-CI-01 | NOT_IMPLEMENTED | SMALL_INFRA_TICKET | INFRA-T01 | none | COVERED |
| BL-RT-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T01 | none | COVERED |
| BL-RT-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T02 | A-T01 | COVERED |
| BL-RT-03 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T02 | A-T01 | COVERED |
| BL-RT-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T02 | A-T01 | COVERED |
| BL-RT-05 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T05 | A-T02 | COVERED |
| BL-RT-06 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T03 | A-T01, A-T02 | COVERED |
| BL-RT-07 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T04 | A-T03 | COVERED |
| BL-RT-08 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T02 | A-T01 | COVERED |
| BL-RT-09 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T06 | A-T02, A-T05 | COVERED |
| BL-RT-10 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-E-T01 | E-S01, B-T05, D-T01, A-T01 | COVERED |
| BL-RT-11 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T07 | A-T02, A-T04 | COVERED |
| BL-BR-01 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T01 | A-T01 | COVERED |
| BL-BR-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T01 | A-T01 | COVERED |
| BL-BR-03 | NEEDS_SPIKE | SPIKE | WAVE-D-S01 | none | COVERED |
| BL-BR-04 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T02 | D-T01 | COVERED |
| BL-BR-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T03 | D-T01, D-S01, A-T02 | COVERED |
| BL-GR-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T01 | none | COVERED |
| BL-GR-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T02 | B-S01, B-T01 | COVERED |
| BL-GR-03 | NEEDS_SPIKE | SPIKE | WAVE-B-S01 | none | COVERED |
| BL-GR-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T03 | B-T02 | COVERED |
| BL-GR-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T04 | B-T02 | COVERED |
| BL-GR-06 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T06 | B-T02 | COVERED |
| BL-GR-07 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T05 | B-T03, B-T04, B-T06 | COVERED |
| BL-GT-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T01 | C-T04 | COVERED |
| BL-GT-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T02 | B-T02, C-T01, C-T06, C-T07 | COVERED |
| BL-GT-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T03 | A-T02, D-T04 | COVERED |
| BL-CAP-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T04 | A-T01 | COVERED |
| BL-CAP-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T04 | A-T01 | COVERED |
| BL-CAP-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T05 | C-T04 | COVERED |
| BL-BUD-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T06 | none | COVERED |
| BL-BUD-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T07 | C-T06, C-S01 | COVERED |
| BL-BUD-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T08 | C-T02, C-T07 | COVERED |
| BL-BUD-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T07 | C-T06, C-S01 | COVERED |
| BL-BUD-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T09 | C-T07, C-T08 | COVERED |
| BL-BUD-06 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T10 | B-T05, C-T02, C-T07, C-T08 | COVERED |
| BL-BUD-07 | NEEDS_SPIKE | SPIKE | WAVE-C-S01 | none | COVERED |
| BL-CMP-01 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T04 | none | COVERED |
| BL-CMP-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T05 | D-T04 | COVERED |
| BL-CMP-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T04 | none | COVERED |
| BL-CMP-04 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T06 | D-T04 | COVERED |
| BL-CMP-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T07 | A-T02, D-T06 | COVERED |
| BL-UI-01 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-UI-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-E-T01 | E-S01, B-T05, D-T01, A-T01 | COVERED |
| BL-UI-03 | DEFERRED | DEFER | — | — | DEFERRED |
| BL-UI-04 | NEEDS_SPIKE | SPIKE | WAVE-E-S01 | none | COVERED |
| BL-HARD-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T01 | A-T01, B-T06, D-T04 | COVERED |
| BL-HARD-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T02 | B-T06 | COVERED |
| BL-HARD-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T03 | A-T07, B-T06, E-T01, D-T04, C-T10 | COVERED |
| BL-HARD-04 | DEFERRED | DEFER | — | — | DEFERRED |

Coverage result check: COVERED rows = 48 (actionable), NO_ACTION = 9 (8 IMPLEMENTED_VERIFIED + 1 KEEP_AS_UPGRADE_GATE), DEFERRED = 2, ESCALATION_REQUIRED = 0. 48 + 9 + 2 = 59 ✓

---

## 9. Duplicate / Orphan Audit

- **duplicate owners = 0** — 48 actionable rows → exactly 40 primary owners. Multi-gap Tickets (6) own 14 rows with stated atomicity: WAVE-A-T02 (BL-RT-02/03/04/08 = one focus machine), WAVE-C-T04 (BL-CAP-01/02 = isolation both faces), WAVE-C-T07 (BL-BUD-02/04 = budget execution + lifecycle rule), WAVE-D-T01 (BL-BR-01/02 = bridge shape+behavior), WAVE-D-T04 (BL-CMP-01/03 = state holder + reducer), WAVE-E-T01 (BL-UI-02/BL-RT-10 = real board incl. defining click path).
- **orphan actionable gaps = 0** — all 48 actionable rows have a primary owner (matrix above).
- **orphan tickets = 0** — every Ticket/Spike references ≥1 Baseline ID; no incidental work.
- **repeated feasibility spikes = 0** — BL-RT-06/07/11 → INTEGRATION_TICKET only; five NEEDS_SPIKE rows → exactly one Spike each; BL-BUD-06 is an IMPLEMENTATION_TICKET (calibration), not a Spike.

---

## 10. Deferred Work

- **BL-UI-03** (desktop wrapper) — DEFERRED, no Ticket (Spec §33).
- **BL-HARD-04** (post-game analysis) — DEFERRED, no Ticket (Spec §37).
- Spec §45 deferred mechanisms remain off-graph (FIFO handoff queue, bridge mailbox, event journal, focus epoch/lease, second engine) until their concrete triggers appear.

---

## 11. Risks / Escalations

- **WAVE-B-S01 fail ⇒ ESCALATION_REQUIRED** (Spec §27: no silent degradation).
- **WAVE-C-S01 fail ⇒ ESCALATION_REQUIRED** if fixing needs DSH core patch / frozen-architecture change / new shared mechanism; otherwise the real seam (or a recorded limitation) gates C-T07.
- **WAVE-D-S01 / WAVE-E-S01 fail ⇒ documented fallbacks** (agent.inject; simplified UX), each blocking its dependent until resolved.
- **DSH upgrade sensitivity:** any pinned-DSH commit change re-runs the yield gate (BL-PKG-09) and re-probes seams (INFRA-S01 / C-S01 / D-S01 / E-S01).
- **Budget numeric values:** production defaults are owned by WAVE-C-T10 (BL-BUD-06); until §38 benchmark evidence exists, all values are non-production test configuration (BL-BUD-01/C-T06 wording enforced).
- **WAVE-C-T03 crosses C/D** — schedule governed by the dependency graph, not the Wave label.
- **WAVE-C-T10 sits on the critical path to final readiness (F-T03)** per §22/§40 — reviewers must accept this as a real dependency, not manufactured serialization.
- No open `ESCALATION_REQUIRED`; none of the 40 tickets requires changing the verified Spec or a frozen contract.

---

## 12. Scope Audit (V1.1 fix round)

- No GitHub Issues created.
- No Ticket executed; no Wave A started.
- No source / tests / workflows / V4 / frozen contract changes.
- Spec unchanged; `TICKET_GRAPH_V1.md` preserved as historical artifact.
- Only: `CURRENT_IMPLEMENTATION_BASELINE.md` (+BL-BUD-06, +BL-BUD-07 rows, SPIKE-CANDIDATES table sync, Not-spikes wording) and new `TICKET_GRAPH_V1.1.md`.
- PROJECT_STATUS.md: `Ticketization: REVIEW_PENDING` unchanged (not COMPLETE).

---

## 13. Files Changed (this round)

- `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` (modified: BL-BUD-06, BL-BUD-07 added)
- `docs/planning/TICKET_GRAPH_V1.1.md` (new — this graph; V1 preserved)
- `PROJECT_STATUS.md` (unchanged in this round; status value remains REVIEW_PENDING)

---

## 14. Recommended First Execution Set (after V1.1 review approval)

1. **INFRA-T01** — CI trigger policy.
2. **All 5 Spikes in parallel:** INFRA-S01, WAVE-B-S01, WAVE-C-S01, WAVE-D-S01, WAVE-E-S01.
3. **Independent first-wave tickets in parallel:** WAVE-A-T01, WAVE-B-T01, WAVE-C-T06, WAVE-D-T04.
4. Then follow the graph: A chain (T02→T03→T04→T07), B chain (T02→T03/T04/T06→T05), C chain (C-T07→C-T02→C-T08, and later C-T10), D chain (D-T01→…), E (E-T01), F (F-T01/T02, then F-T03 after C-T10).

Nothing in this section is executed this round.
