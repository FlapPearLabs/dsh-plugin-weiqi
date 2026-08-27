# Companion Go — Ticket / Spike Graph V1

**Status:** REVIEW_PENDING (Ticketization produced; no Ticket executed)
**Base:** remote main `e82b376c147317dbae928a8a2bf2cd6be967dbbc`
**Method:** Verified Spec Target − Current Implementation Baseline = Remaining Ticket/Spike Graph, per `docs/planning/TICKET_DECOMPOSITION_CONTRACT.md`. This graph does not restate the Spec; it maps Baseline rows to Tickets.

**Contract obeyed:** one primary owner per Baseline gap (Contract Rule 8); multi-gap Tickets justify atomicity (Rule 9); `NEEDS_SPIKE` rows produce Spikes and block dependents (Rule 6); `VERIFIED_FACT_NOT_INTEGRATED` rows produce only INTEGRATION_TICKET (Rule 5); `FOUNDATION_ONLY` rows reuse existing contracts (Rule 4); `NO_ACTION` / `DEFER` / `KEEP_AS_UPGRADE_GATE` rows get no implementation Ticket (Rules 3, 7).

---

## 1. Decomposition Method

```
Verified Spec (R2.4, SPEC_LEAN_V0.1_R2.4_VERIFIED.md)
- Current Implementation Baseline (CURRENT_IMPLEMENTATION_BASELINE.md, 44 rows)
= Remaining Gap Graph
```

- Each Baseline row's `Recommended Handling` was consumed verbatim as the ticket **Type**:
  `IMPLEMENTATION_TICKET` / `INTEGRATION_TICKET` / `SPIKE` / `SMALL_INFRA_TICKET`.
- Wave column follows the Baseline row's `Wave`; Spec Phase ≠ Implementation Wave (AGENTS.md).
- `FOUNDATION_ONLY` rows: the ticket reuses `src/contracts/*` exactly; behavior/runtime semantics only.
- `VERIFIED_FACT_NOT_INTEGRATED` rows (BL-RT-06/07/11): INTEGRATION_TICKET only; the feasibility evidence in
  `docs/validation/DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md` is reused, never re-spiked.
- `NEEDS_SPIKE` rows (BL-PKG-06, BL-GR-03, BL-BR-03, BL-UI-04): one Spike each; dependent implementations declare `blocked_by`.
- No new directories beyond what the seams require; Expected Surfaces are real paths under `src/` / `tests/`.

---

## 2. Ticket / Spike Summary

| Group | Implementation | Integration | Small Infra | Spike | Total |
|---|---|---|---|---|---|
| Infra | 0 | 0 | 1 | 1 | 2 |
| Wave A | 4 | 3 | 0 | 0 | 7 |
| Wave B | 6 | 0 | 0 | 1 | 7 |
| Wave C | 9 | 0 | 0 | 0 | 9 |
| Wave D | 7 | 0 | 0 | 1 | 8 |
| Wave E | 1 | 0 | 0 | 1 | 2 |
| Wave F | 3 | 0 | 0 | 0 | 3 |
| **Total** | **30** | **3** | **1** | **4** | **38** |

Baseline rows consumed: 44 (37 actionable gaps → 38 Tickets/Spikes; 5 NO_ACTION; 2 DEFERRED).

---

## 3. Complete Ticket Table

### Infra

#### INFRA-T01 — Post-bootstrap CI trigger policy
- **Type:** SMALL_INFRA_TICKET | **Wave:** Infra
- **Baseline IDs:** BL-CI-01
- **Current Baseline State:** BL-CI-01: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** AGENTS.md git/verification discipline; Baseline CI trigger policy section
- **Scope:** Rewrite only the `on:` triggers of `.github/workflows/{ci.yml, cooperative-yield-upgrade-gate.yml, profile-install-smoke.yml}` to run on the current default branch (`main`) and normal `pull_request` flow (path filters preserved), so main-based PRs execute CI. No workflow step logic changes.
- **Explicit Non-Goals:** No rewrite of existing gates; no change to `tests/upgrade-gates/cooperative-yield` fixture; no CI platform refactor; no new workflows.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `.github/workflows/`
- **Acceptance Criteria:**
  - CI `ci.yml` triggers on `pull_request` targeting `main` (verifiable via `workflow_dispatch` manual run on this branch + `.github/workflows` diff).
  - `profile-install-smoke.yml` and `cooperative-yield-upgrade-gate.yml` each gain a `pull_request` trigger with their existing path filters; run on a PR touching a filtered path (evidence: workflow run log).
  - No step content diff outside the `on:` block (`git diff` restricted to triggers).
  - `pnpm verify` passes locally on this branch before push.
- **Required Review Evidence:** workflow YAML diff limited to triggers; at least one successful CI run on the decomposition→PR; no changes to test fixtures.
- **Stop / Escalation Condition:** If updating triggers requires changing gate logic or fixtures → `ESCALATION_REQUIRED`.

#### INFRA-S01 — GitHub source install spike (`dsh plugin --profile web add github:...`)
- **Type:** SPIKE | **Wave:** Infra
- **Baseline IDs:** BL-PKG-06
- **Current Baseline State:** BL-PKG-06: NEEDS_SPIKE
- **Target State:** VERIFIED_FACT_NOT_INTEGRATED (if PASS) or recorded blocked behavior
- **Spec Authority:** BL-PKG-05/06 evidence boundary (local tarball verified only; `github:` spec path untested)
- **Scope:** On pinned DSH (`b150a551...`, packages `0.1.1-rc.2`, Node 24.11.1, pnpm 11.7.0), execute the real command `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` against this repository and observe resolution → clone → build → activation. Record the exact CLI surface. Do not guess `prepare`/`prepack`/committed `lib/` behavior before observing.
- **Explicit Non-Goals:** No change to package publish config; no new install path code; no modification of the profile smoke; no change to BL-PKG-05 verified behavior.
- **Dependencies / blocked_by:** none (independent; can start immediately)
- **Expected Surfaces:** DSH CLI (`dsh plugin --profile`), `package.json`, `lib/` build output, profile smoke harness (`tests/profile-install/`)
- **Acceptance Criteria (PASS):**
  - Command resolves the GitHub spec to the pinned commit and completes build + activation in a clean profile.
  - Reuse `profile-mount-smoke.mjs` assertions: profile bundle reconciliation succeeds, `companion-go` fiber is active in the real Loader tree (`dump-config` shows the row).
  - Trace log uploaded (same pattern as `profile-install-smoke.yml`).
- **FAIL criteria:** `github:` spec unsupported / resolution or build failure / activation failure → record exact observed behavior + a concrete fallback (e.g., installation docs pin a packed tarball) and mark `VERIFIED_FACT_NOT_INTEGRATED` with the limitation.
- **Required Review Evidence:** executed command trace; pass/fail assertion output; no invented success.
- **Stop / Escalation Condition:** If the command mutates the repository's frozen packaging (publish fields, patch) → `ESCALATION_REQUIRED`.

---

### Wave A — Runtime / dual session / focus / resume

#### WAVE-A-T01 — Dual isolated DSH session lifecycle
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A
- **Baseline IDs:** BL-RT-01
- **Current Baseline State:** BL-RT-01: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §4 (two isolated Sessions), §44 invariant "TWO isolated durable Session histories"
- **Scope:** Runtime creates and owns two durable, isolated DSH sessions (`work`, `go`) on pinned DSH, with distinct histories and no cross-session message flow. Minimal session registry.
- **Explicit Non-Goals:** No focus arbitration (WAVE-A-T02); no tools; no Bridge; no persistence of session identity beyond DSH-native durability.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/runtime/` (session manager), pinned DSH Session API
- **Acceptance Criteria:**
  - Unit/integration: create both sessions; each accepts its own `user/message`; assert cross-session isolation (a message admitted to `work` never appears in `go` history).
  - Smoke against pinned DSH AgentLoop (like the cooperative-yield harness) with deterministic assertions on history contents.
- **Required Review Evidence:** test run log; session isolation assertion output.
- **Stop / Escalation Condition:** If two-session isolation requires injecting raw histories across lanes → `ESCALATION_REQUIRED`.

#### WAVE-A-T02 — RuntimeFocusState machine + arbitration
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A
- **Baseline IDs:** BL-RT-02, BL-RT-03, BL-RT-04, BL-RT-08
- **Current Baseline State:** BL-RT-02: NOT_IMPLEMENTED; BL-RT-03: FOUNDATION_ONLY; BL-RT-04: NOT_IMPLEMENTED; BL-RT-08: FOUNDATION_ONLY
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (RuntimeFocusState, one atomic PendingFocusIntent, arbitration precedence `user_command > self_initiated`, `pausedLane` semantics), §44 invariant "ONE atomic pending focus intent with user-over-self arbitration"
- **Existing Asset / Contract Reused:** `src/contracts/focus.ts` — `Lane`, `PendingFocusIntent`, `RuntimeFocusState` (incl. `pausedLane`). No second pause/resume contract; no new fields.
- **Scope:** Pure Runtime state machine: at-most-one `activeLane`, `llmRunning`, single `pendingFocus` with §5 precedence (user_command never overwritten by self_initiated; user replaces self; newer self replaces older self), `pausedLane` set/cleared at yield/resume boundaries. No DSH-step interaction yet (WAVE-A-T03 wires it).
- **Explicit Non-Goals:** No DSH event wiring; no queue/lease/epoch; no second state contract; no UI.
- **Dependencies / blocked_by:** WAVE-A-T01 (state machine operates on real sessions)
- **Expected Surfaces:** `src/runtime/focus.ts`
- **Acceptance Criteria (deterministic, unit-level):**
  - Arbitration matrix (user-vs-self, self-vs-self, self-vs-user) as a table-driven unit test, all §5 rules asserted.
  - `pausedLane` only ever names at most one lane; cleared exactly on resume admission.
  - At most one `activeLane` at all times (invariant property test over random intent sequences).
  - Type-level contract test (existing `contracts.test.ts`) still passes unchanged.
- **Required Review Evidence:** test output (matrix rows + property run); contract file unchanged diff (only additive runtime files).
- **Stop / Escalation Condition:** If the machine needs a second pause/resume state field, or any change to `RuntimeFocusState` shape → `ESCALATION_REQUIRED`.

#### WAVE-A-T03 — Safe-boundary switching (integration)
- **Type:** INTEGRATION_TICKET | **Wave:** A
- **Baseline IDs:** BL-RT-06
- **Current Baseline State:** BL-RT-06: VERIFIED_FACT_NOT_INTEGRATED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.1.1 (exact safe-boundary definition: between DSH steps), §44 invariant "SAFE focus handoff occurs between DSH steps"
- **Scope:** Wire WAVE-A-T02's state machine to the pinned-DSH step boundary so focus switches happen only between committed `step/end` and the next `step/start`, never between tool calls of one step, never aborting started model/tool work.
- **Explicit Non-Goals:** No yield/restore seam (WAVE-A-T04); no resume (WAVE-A-T07); no feasibility re-spike.
- **Dependencies / blocked_by:** WAVE-A-T01, WAVE-A-T02
- **Expected Surfaces:** `src/runtime/` (DSH step listener), pinned AgentLoop (`agent/pre-step`, `step/end`)
- **Acceptance Criteria:**
  - Integration test on pinned DSH: synthetic Work turn of 20+ steps; focus requested after step 3 fully commits; assert step-4 model request does NOT start, started step-3 work completes, handoff occurs at first continuation boundary.
  - Deterministic assertion: no `step/start` between the request and the boundary.
- **Required Review Evidence:** executed trace (same style as the verified cooperative-yield trace), assertion pass log.
- **Stop / Escalation Condition:** If switching requires a new shared mechanism (lease/epoch/timer pause) → `ESCALATION_REQUIRED`.

#### WAVE-A-T04 — Cooperative-yield production integration
- **Type:** INTEGRATION_TICKET | **Wave:** A
- **Baseline IDs:** BL-RT-07
- **Current Baseline State:** BL-RT-07: VERIFIED_FACT_NOT_INTEGRATED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.1.2 (verified seam: `inbox.splice("next-step", 0, 0, payload.messages)` + `{kind:"reject"}` → blocked → idle → `whenIdle` → switch), §44 invariant "PINNED DSH yield guard uses synchronous inbox batch-splice + continuation reject"
- **Existing Asset / Contract Reused:** executable seam from `docs/validation/DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md` (pinned `b150a551...`); no new feasibility Spike.
- **Scope:** Implement the verified yield path in the production Runtime: on pending focus at a continuation step, restore the claimed batch synchronously, reject, await `whenIdle`, set `pausedLane`, switch. Do NOT retain `cancel(..., {keepInbox:true})` (verified unnecessary on the pinned commit).
- **Explicit Non-Goals:** No resume handling (WAVE-A-T07); no changes to the fixture; no second yield mechanism.
- **Dependencies / blocked_by:** WAVE-A-T03
- **Expected Surfaces:** `src/runtime/`, `agent/pre-step` listener, `agent.inbox`
- **Acceptance Criteria:**
  - Integration test reproducing the verified main-path trace: step/end → claim → splice restore → reject → blocked → idle → switch; assert inbox exactly `[A,B,C]`, no duplicate pending MessageId, no lost claimed message.
  - Negative control: splice→reject converges to blocked→idle with no same-lane auto-restart.
- **Required Review Evidence:** executed trace; message-integrity assertions; fixture reused verbatim.
- **Stop / Escalation Condition:** If the pinned commit's behavior diverges from the verified record (claim-before-pre-step, splice, blocked→idle, no auto-restart) → STOP, report divergence; do not silently adopt a new seam without evidence.

#### WAVE-A-T05 — Immutable source-message handoff
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A
- **Baseline IDs:** BL-RT-05
- **Current Baseline State:** BL-RT-05: FOUNDATION_ONLY
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (`sourceMessage.message` = already-created immutable DSH `UserMessage`, no late text dereference, no second `capturedText` copy), §7.1 steps 3/8, §44 invariant "PENDING user handoff stores an immutable DSH UserMessage"
- **Existing Asset / Contract Reused:** `src/contracts/focus.ts` — `PendingFocusIntent.sourceMessage` (`sourceSessionId` + `message: UserMessage`)
- **Scope:** Handoff behavior: when a winning intent carries a source message, deliver its exact content blocks into the target lane with explicit Companion-handoff provenance, using the stored immutable message; never replace with an LLM summary; never re-fetch text from a compacted surface.
- **Explicit Non-Goals:** No inactive-lane admission path (WAVE-A-T06); no text capture field.
- **Dependencies / blocked_by:** WAVE-A-T02
- **Expected Surfaces:** `src/runtime/` (handoff delivery), DSH `UserMessage` API
- **Acceptance Criteria:**
  - Test: create user message for target lane, store in `pendingFocus`, compact/rewrite source session surface, assert handoff uses original immutable content blocks + provenance and performs no late surface lookup.
  - Assert no second `capturedText` string exists in Runtime state (code-level check).
- **Required Review Evidence:** test output; source inspection showing no duplicate text buffer.
- **Stop / Escalation Condition:** If the frozen `UserMessage`-based handoff cannot represent the source (needs new state field) → `ESCALATION_REQUIRED`.

#### WAVE-A-T06 — Inactive-lane natural-language admission
- **Type:** IMPLEMENTATION_TICKET | **Wave:** A
- **Baseline IDs:** BL-RT-09
- **Current Baseline State:** BL-RT-09: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §7.2 (user-origin activity does not require the inactive Agent running; UI/Runtime creates the `user_command` intent), §16 Manual mode, §44 invariant "USER messages on an inactive lane are admitted by UI/Runtime"
- **Scope:** Admission path: a message targeting the inactive lane is converted into `PendingFocusIntent{target, origin:"user_command", sourceMessage}` and submitted to §5 arbitration + §7.1 admission; the inactive Agent is not woken to "decide" first. View-bound simulation at Runtime level (no production UI yet).
- **Explicit Non-Goals:** No production UI (Wave E); no rules-engine routing; no LLM router.
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-A-T05
- **Expected Surfaces:** `src/runtime/` (admission API), tests simulating the inactive View
- **Acceptance Criteria:**
  - Test (activeLane=work, attentionMode=manual): user input on Go View → assert Go Agent not required to be running first; intent created with exact immutable source message; Go admitted at next safe boundary and woken.
  - Deterministic assertion: no pre-step reject used as a queue.
- **Required Review Evidence:** test output; no queue mechanism in diff.
- **Stop / Escalation Condition:** If admission requires a generalized mailbox/queue → `ESCALATION_REQUIRED`.

#### WAVE-A-T07 — Resume sequencing / external resume integration
- **Type:** INTEGRATION_TICKET | **Wave:** A
- **Baseline IDs:** BL-RT-11
- **Current Baseline State:** BL-RT-11: VERIFIED_FACT_NOT_INTEGRATED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5 (`pausedLane`), §7.1.2 steps 8-10 (whenIdle → pausedLane → wake target; on return, real user command or one tiny `companion-resume` steering message; clear pausedLane on admission)
- **Existing Asset / Contract Reused:** verified resume ordering `A → B → C → companion-resume` from `docs/validation/DSH_COOPERATIVE_YIELD_SPIKE_VERIFIED.md`; `RuntimeFocusState.pausedLane` from `src/contracts/focus.ts`
- **Scope:** Production integration of resume: after a yield to the other lane, returning to `pausedLane` admits the preserved next-step context; exactly one `companion-resume` wake suffices to continue from durable tool results; `pausedLane` cleared once resume admitted.
- **Explicit Non-Goals:** No re-spike of resume feasibility; no transactional recovery; no pending-command persistence.
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-A-T04
- **Expected Surfaces:** `src/runtime/`, pinned AgentLoop (`whenIdle`, inbox)
- **Acceptance Criteria:**
  - Integration test: yield at continuation → return → one `companion-resume` → continuation order `A,B,C,resume` consumed; no duplicate pending MessageId; no lost messages.
  - Deterministic assertion: `pausedLane` cleared exactly at resume admission.
- **Required Review Evidence:** executed resume trace; ordering assertions.
- **Stop / Escalation Condition:** If resume needs durable pending-command state or a new mechanism → `ESCALATION_REQUIRED`.

---

### Wave B — GoRulesPort / Tenuki / rules fixtures

#### WAVE-B-S01 — Tenuki version + conformance spike
- **Type:** SPIKE | **Wave:** B (gate)
- **Baseline IDs:** BL-GR-03
- **Current Baseline State:** BL-GR-03: NEEDS_SPIKE
- **Target State:** VERIFIED_FACT_NOT_INTEGRATED (pinned Tenuki version + explicit config record)
- **Spec Authority:** §26/§27 (Tenuki sole authority behind port; explicit `scoring=area`, `koRule=positional-superko`, `komi=7.5`; §31 positional-superko fixture must pass; pin exact version, no auto-upgrade), §44 invariant "ONE authoritative Go rules state"
- **Scope:** Evaluate candidate Tenuki versions against the exact §31 positional-superko fixture plus area scoring and komi 7.5 explicit configuration. Produce a pinned version/commit and a conformance record. Not a general Tenuki evaluation.
- **Explicit Non-Goals:** No GoRulesPort/Adapter code (WAVE-B-T01/T02); no second superko layer (Spec §27 forbids pre-emptive custom rules); no silent downgrade to simple ko.
- **Dependencies / blocked_by:** none (independent; can run before any Wave A work)
- **Expected Surfaces:** `tests/fixtures/` (positional-superko case), candidate dependency evaluation, `package.json` pin
- **Acceptance Criteria (PASS):** candidate pinned version passes the §31 positional-superko fixture and area-scoring/komi-7.5 explicit config in a reproducible script; conformance record written (candidate, version, fixture output).
- **FAIL criteria:** no candidate passes → `ESCALATION_REQUIRED` (Spec §27: stop and resolve Adapter/version choice; do not silently degrade).
- **Required Review Evidence:** executed fixture trace; pinned version; conformance record.
- **Stop / Escalation Condition:** Any candidate requiring dual rules authority or default-rule reliance → `ESCALATION_REQUIRED`.

#### WAVE-B-T01 — GoRulesPort contract + engine-independent test harness
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B
- **Baseline IDs:** BL-GR-01
- **Current Baseline State:** BL-GR-01: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §26 (`GoRulesPort` interface: createGame/play/pass/getState/inspectGroup/score/settle), §30 (exactly one authoritative state)
- **Scope:** Define the `GoRulesPort` interface in `src/contracts` (application code must never depend on Tenuki APIs directly) and an engine-independent test harness that runs against any port implementation (stub initially).
- **Explicit Non-Goals:** No Tenuki dependency (WAVE-B-T02); no rules behavior; no fixtures yet (WAVE-B-T05).
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/contracts/rules.ts`, `tests/` harness
- **Acceptance Criteria:** type-level contract test for the port signature; harness runs green against a stub implementation (deterministic placeholder assertions).
- **Required Review Evidence:** typecheck + harness test output.
- **Stop / Escalation Condition:** If the port shape deviates from §26 → `ESCALATION_REQUIRED`.

#### WAVE-B-T02 — TenukiAdapter (pinned)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B
- **Baseline IDs:** BL-GR-02
- **Current Baseline State:** BL-GR-02: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §26 (TenukiAdapter implements GoRulesPort), §27 (explicit config, pinned version from WAVE-B-S01), §29 (inspectGroup derived traversal if needed)
- **Scope:** Implement `TenukiAdapter implements GoRulesPort` using the pinned Tenuki version from WAVE-B-S01, with explicit area/positional-superko/komi 7.5 config at game creation; all Tenuki-specific behavior confined to the adapter.
- **Explicit Non-Goals:** No rules fixtures (WAVE-B-T05); no UI; no second rules authority.
- **Dependencies / blocked_by:** WAVE-B-S01, WAVE-B-T01
- **Expected Surfaces:** `src/rules/tenuki-adapter.ts`, `package.json` (pinned Tenuki dep)
- **Acceptance Criteria:** adapter passes the engine-independent harness; explicit config asserted at game creation (no defaults); application code imports only the port.
- **Required Review Evidence:** harness run; config assertion; dependency pin diff.
- **Stop / Escalation Condition:** If Tenuki behavior contradicts the spike record → STOP, re-run conformance; if it needs a second rules layer → `ESCALATION_REQUIRED`.

#### WAVE-B-T03 — Area scoring / komi 7.5 / positional superko
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B
- **Baseline IDs:** BL-GR-04
- **Current Baseline State:** BL-GR-04: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §25 (Chinese area scoring, komi 7.5, positional superko, no undo), §27, `docs/design/IMPLEMENTATION_BOUNDARIES.md` (production komi 7.5, NOT prototype 6.5)
- **Scope:** Verify the pinned rules stack exhibits Chinese area scoring, komi 7.5 and positional superko per §25 through port-level deterministic tests; production must never inherit prototype komi 6.5.
- **Explicit Non-Goals:** No capture/settlement behaviors (WAVE-B-T04); no full §31 suite (WAVE-B-T05).
- **Dependencies / blocked_by:** WAVE-B-T02
- **Expected Surfaces:** `src/rules/`, `tests/`
- **Acceptance Criteria:** port-level tests: area score of a fixed endgame position equals the hand-computed area score; komi 7.5 applied in `score()`; a repeated-position sequence rejected under positional superko (deterministic fixture positions).
- **Required Review Evidence:** test output; komi assertion; no 6.5 anywhere in production code.
- **Stop / Escalation Condition:** superko not supported by pinned engine → `ESCALATION_REQUIRED`.

#### WAVE-B-T04 — Captures / suicide / pass / settlement / dead-stone flow
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B
- **Baseline IDs:** BL-GR-05
- **Current Baseline State:** BL-GR-05: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §25 (captures, two-pass settlement, dead-stone confirmation, disagreement → resume), §31 fixture cases (single/multi-stone capture, suicide rejection, pass, two-pass ending, dead-stone settlement)
- **Scope:** Deterministic port-level behavior for captures, suicide rejection, pass, two-pass ending and dead-stone settlement flow.
- **Explicit Non-Goals:** No scoring/superko (WAVE-B-T03); no full §31 suite (WAVE-B-T05).
- **Dependencies / blocked_by:** WAVE-B-T02
- **Expected Surfaces:** `src/rules/`, `tests/`
- **Acceptance Criteria:** port-level tests: single capture, multi-stone capture, suicide rejected, pass recorded, two-pass → settlement, dead-stone confirmation → final score, disagreement → resume play (each a deterministic fixture).
- **Required Review Evidence:** fixture test output per case.
- **Stop / Escalation Condition:** If settlement requires serializing Tenuki internals → `ESCALATION_REQUIRED`.

#### WAVE-B-T05 — §31 deterministic fixture suite
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B
- **Baseline IDs:** BL-GR-07
- **Current Baseline State:** BL-GR-07: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §31 (ten engine-independent contract cases: single capture, multi-stone capture, suicide rejection, simple ko transition, positional superko, pass, two-pass ending, area scoring, dead-stone settlement, canonical replay/restoration), §39.5
- **Scope:** Lock the ten §31 cases into a repeatable engine-independent suite running against `GoRulesPort` (via the adapter), runnable in CI before significant Go UI work.
- **Explicit Non-Goals:** No new rules behaviors beyond existing ones; no UI.
- **Dependencies / blocked_by:** WAVE-B-T03, WAVE-B-T04
- **Expected Surfaces:** `tests/fixtures/`, CI job (fold into `ci.yml` or a rules job)
- **Acceptance Criteria:** all ten cases pass against the pinned adapter; suite runs in CI (workflow run evidence).
- **Required Review Evidence:** CI run with 10/10 fixture passes (raw counts: tests/pass/fail/skip).
- **Stop / Escalation Condition:** If a case cannot pass within scope → `ESCALATION_REQUIRED` (Spec §27 rule).

#### WAVE-B-T06 — Canonical action log / replay
- **Type:** IMPLEMENTATION_TICKET | **Wave:** B
- **Baseline IDs:** BL-GR-06
- **Current Baseline State:** BL-GR-06: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §28 (`CanonicalGameRecord` + `GameAction`; persist own record, never Tenuki internals; recovery = fresh game + replay + verify), §44 invariant "ONE canonical game action history"
- **Scope:** Define `CanonicalGameRecord` / `GameAction` types, persistence of play/pass actions, and replay-restore (create fresh Tenuki game → replay actions → verify resulting authoritative state).
- **Explicit Non-Goals:** No crash-resume integration (Wave F); no serialization of Tenuki objects; no SGF/game-tree.
- **Dependencies / blocked_by:** WAVE-B-T02, WAVE-B-T05
- **Expected Surfaces:** `src/persistence/canonical.ts` (or `src/rules/canonical.ts`), tests
- **Acceptance Criteria:** unit: record round-trips play/pass sequences; replay-restore reproduces the authoritative state (deterministic assertion on a §31 position); no Tenuki-internal object touched by serialization.
- **Required Review Evidence:** round-trip + replay test output.
- **Stop / Escalation Condition:** If restoring state requires Tenuki private objects → `ESCALATION_REQUIRED`.

---

### Wave C — Go tools / capability isolation / budget / anti-cheat

#### WAVE-C-T01 — Go lane model-facing surface / sole strategy owner
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-GT-01
- **Current Baseline State:** BL-GT-01: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §18 (DeepSeek sole strategic policy owner; forbidden: KataGo/Leela/MCTS/solvers/best-move/win-rate/search), §20 (exact 9-tool surface), AGENTS.md frozen constraint (smoke asserts `companion-go-tools` absent today)
- **Scope:** Define the Go lane's model-facing tool surface as exactly the 9-tool whitelist (7 `go.*` + 2 `companion.*`) and enforce that no strategy/solver/best-move surface exists; smoke test asserts forbidden surfaces absent from the registered tool set.
- **Explicit Non-Goals:** No tool implementations (WAVE-C-T02/T03); no preset/capability isolation (WAVE-C-T04).
- **Dependencies / blocked_by:** WAVE-C-T04 (surface lives inside the isolated preset)
- **Expected Surfaces:** `src/tools/` surface registry, preset config
- **Acceptance Criteria:** registered tool names = exactly the §20 list; smoke asserts none of the forbidden strategy surfaces present; no import of any solver library.
- **Required Review Evidence:** surface enumeration test; smoke output.
- **Stop / Escalation Condition:** If a strategy capability must be exposed to make the game work → `ESCALATION_REQUIRED`.

#### WAVE-C-T02 — 7 `go.*` model-facing tools
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-GT-02
- **Current Baseline State:** BL-GT-02: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §20 (`go.state`, `go.inspect_group`, `go.inspect_region`, `go.try_move`, `go.play`, `go.pass`, `go.request_deep_think`), §22.3 (tool accounting), §32 (tool action is truth; never parse text like "I play N10")
- **Scope:** Register and implement the seven `go.*` tools over `GoRulesPort`; `go.try_move` returns legal/captures/resulting local liberties only (no good/bad/win-rate); `go.play`/`go.pass` mutate the authoritative state; wire budget accounting at actual tool execution.
- **Explicit Non-Goals:** No `companion.*` tools (WAVE-C-T03); no deep-think boost logic (WAVE-C-T08); no strategy advice surface.
- **Dependencies / blocked_by:** WAVE-B-T02, WAVE-C-T01, WAVE-C-T06, WAVE-C-T07 (enforcement API wired at execution)
- **Expected Surfaces:** `src/tools/go/`
- **Acceptance Criteria:** each tool: call → port call → result shape per §20 (try_move output contains no evaluative fields); illegal-move attempt returns legality result, never mutates state; tool execution consumes budget counter (assert after N calls).
- **Required Review Evidence:** tool tests; try_move schema assertion; budget counter assertion.
- **Stop / Escalation Condition:** If a tool needs solver-like evaluation → `ESCALATION_REQUIRED`.

#### WAVE-C-T03 — 2 `companion.*` model-facing tools
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-GT-03
- **Current Baseline State:** BL-GT-03: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §20 (`companion.affect`, `companion.request_focus`), §5/§6 (request_focus → Runtime sole wake authority), §14 (affect bounded deltas)
- **Scope:** Register `companion.request_focus("work"|"go")` end-to-end (submits focus intent into the §5 arbitration path) and `companion.affect({...})` (validates bounded deltas, applies through the mood reducer).
- **Explicit Non-Goals:** No mood reducer semantics themselves (WAVE-D-T04); no attention-mode policy (WAVE-D-T06); no UI.
- **Dependencies / blocked_by:** WAVE-A-T02 (focus arbitration), WAVE-D-T04 (mood reducer for affect)
- **Expected Surfaces:** `src/tools/companion/`
- **Acceptance Criteria:** request_focus test: intent with correct target/origin appears in `pendingFocus` (no direct lane wake); affect test: delta applied through reducer, out-of-bound delta rejected with deterministic error; tools never call the other lane directly.
- **Required Review Evidence:** tool tests; no cross-lane direct-call assertion.
- **Stop / Escalation Condition:** If `request_focus` must bypass Runtime arbitration → `ESCALATION_REQUIRED`.

#### WAVE-C-T04 — Go preset isolation + execution-time capability guards
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-CAP-01, BL-CAP-02
- **Current Baseline State:** BL-CAP-01: NOT_IMPLEMENTED; BL-CAP-02: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §19 (isolated native-only realm; no Code Mode/subagent/bash/web/python/generic MCP/solver; do not assume prompt-hiding suffices), §21 ("cannot see + cannot execute"; execution authority enforces the same boundary)
- **Existing Asset / Contract Reused:** Foundation smoke asserting `companion-go-tools` absent (BL-PKG-01 evidence pattern)
- **Scope:** Go lane preset from an isolated capability realm (presentation native-only) + execution-time guard at the tool boundary that fails closed for any forbidden capability accidentally registered/aliased into Go scope. The two halves are one isolation gap: preset without execution guard fails §21, guard without preset leaves the surface ungoverned.
- **Explicit Non-Goals:** No tools (WAVE-C-T02/T03); no anti-cheat test suite (WAVE-C-T05); no DSH core patching.
- **Dependencies / blocked_by:** WAVE-A-T01 (Go session receives the preset)
- **Expected Surfaces:** DSH preset/scope configuration, `src/runtime/` guards
- **Acceptance Criteria:** preset enumeration shows native-only realm; execution-guard unit test: a forbidden capability registered into Go scope still fails at execution authority (deterministic failure).
- **Required Review Evidence:** preset config output; guard test run.
- **Stop / Escalation Condition:** If Go needs an inherited general capability → `ESCALATION_REQUIRED`.

#### WAVE-C-T05 — Anti-cheat tests (§39.3)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-CAP-03
- **Current Baseline State:** BL-CAP-03: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §39.3 (bash/web/python/subagent/Code Mode/generic MCP/external solver all must fail at execution authority), §40 Anti-Cheat
- **Scope:** Automated suite attempting each forbidden capability from the Go lane and asserting execution-authority failure.
- **Explicit Non-Goals:** No new guard code (WAVE-C-T04); no UI.
- **Dependencies / blocked_by:** WAVE-C-T04
- **Expected Surfaces:** `tests/` anti-cheat suite, CI job
- **Acceptance Criteria:** every forbidden capability attempt yields a deterministic execution-authority failure; CI runs the suite (run log).
- **Required Review Evidence:** suite output per capability (raw pass/fail counts).
- **Stop / Escalation Condition:** if any forbidden capability succeeds → `ESCALATION_REQUIRED`.

#### WAVE-C-T06 — GoTurnBudget contract
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-BUD-01
- **Current Baseline State:** BL-BUD-01: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22 (`GoTurnBudget` fields: maxModelSteps, maxInspectCalls, maxTryMoves, perRequestMaxTokens, maxTurnTokens; exact numeric values not frozen — benchmark-derived)
- **Scope:** Define `GoTurnBudget` contract + a documented default placeholder sourced from the benchmark record (values not frozen; replaced by §38 benchmark when available).
- **Explicit Non-Goals:** No enforcement (WAVE-C-T07); no boost (WAVE-C-T08); no benchmark run in this ticket.
- **Dependencies / blocked_by:** none
- **Expected Surfaces:** `src/contracts/budget.ts`
- **Acceptance Criteria:** type-level contract test matches §22 fields; default object satisfies the type; source of placeholder values documented (benchmark pending).
- **Required Review Evidence:** typecheck + contract test.
- **Stop / Escalation Condition:** if numeric values get frozen without benchmark evidence → `ESCALATION_REQUIRED`.

#### WAVE-C-T07 — Budget enforcement + post-move no-analysis-loop
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-BUD-02, BL-BUD-04
- **Current Baseline State:** BL-BUD-02: NOT_IMPLEMENTED; BL-BUD-04: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §22.1 (per-request hard cap), §22.2 (turn-level cap), §22.3 (actual `go.inspect_*`/`go.try_move` execution consumes budget; no wrapper hides calls), §22.4 (exhaustion → choose with current info), §24 (after committed play/pass, no restart of analysis loop)
- **Scope:** Enforcement engine: per-request hard caps at model-request creation, turn-level denial of new steps, per-tool accounting at actual Go tool execution, exhaustion handling, and the post-move no-analysis-loop rule. Enforcement API consumed by WAVE-C-T02.
- **Explicit Non-Goals:** No deep-think boost (WAVE-C-T08); no bypass tests (WAVE-C-T09); no benchmark.
- **Dependencies / blocked_by:** WAVE-C-T06
- **Expected Surfaces:** `src/budget/`
- **Acceptance Criteria:** unit: cap denial at exact boundary; aggregated double-invoke path counted once per actual execution; after `go.play`/`go.pass` commit, no further model step of the same turn starts (deterministic sequence test).
- **Required Review Evidence:** enforcement unit tests; no outer-wrapper hole assertion.
- **Stop / Escalation Condition:** if enforcement requires per-step hooks DSH does not expose → record evidence; if it needs a new shared mechanism → `ESCALATION_REQUIRED`.

#### WAVE-C-T08 — Deep-think boost (bounded)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-BUD-03
- **Current Baseline State:** BL-BUD-03: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §23 (one bounded temporary boost; no unlimited mode; boost never exceeds per-request hard cap; never removes turn ceiling)
- **Scope:** `go.request_deep_think` grants one bounded boost applied within the enforcement engine's caps.
- **Explicit Non-Goals:** No unlimited mode; no budget-bypass tests (WAVE-C-T09).
- **Dependencies / blocked_by:** WAVE-C-T07, WAVE-C-T02
- **Expected Surfaces:** `src/tools/go/`, `src/budget/`
- **Acceptance Criteria:** boost grants a single bounded increment; request still capped at per-request hard cap; turn ceiling unchanged (deterministic assertions).
- **Required Review Evidence:** boost boundary tests.
- **Stop / Escalation Condition:** if boost requires unbounded reasoning → `ESCALATION_REQUIRED`.

#### WAVE-C-T09 — Budget bypass tests (§39.4)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** C
- **Baseline IDs:** BL-BUD-05
- **Current Baseline State:** BL-BUD-05: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §39.4 (many try_moves, many inspects, multiple model steps, single oversized reasoning request, any aggregated tool path; hard limits hold), §40 Budget
- **Scope:** Adversarial suite attempting every listed bypass and asserting hard limits hold.
- **Explicit Non-Goals:** No enforcement changes (WAVE-C-T07/T08).
- **Dependencies / blocked_by:** WAVE-C-T07, WAVE-C-T08
- **Expected Surfaces:** `tests/` budget suite, CI job
- **Acceptance Criteria:** each bypass attempt deterministically hits its limit (asserted counter/log); CI runs the suite.
- **Required Review Evidence:** suite output per bypass (raw counts).
- **Stop / Escalation Condition:** if any bypass succeeds → `ESCALATION_REQUIRED`.

---

### Wave D — Bridge / Attention / Persona / Mood

#### WAVE-D-S01 — `ctx.systemPrompt.context` provider spike
- **Type:** SPIKE | **Wave:** D (gate)
- **Baseline IDs:** BL-BR-03
- **Current Baseline State:** BL-BR-03: NEEDS_SPIKE
- **Target State:** VERIFIED_FACT_NOT_INTEGRATED (provider semantics record)
- **Spec Authority:** §9.1 (agent-scoped DSH dynamic runtime context; providers evaluated per eligible prompt assembly; DSH materializes a new snapshot only when rendered current snapshot changed; provider must be O(1) read of Runtime-held latest values — no history rescan)
- **Scope:** Probe only what the project depends on: agent scope, registration, rendering, update/materialization semantics, and O(1) latest-projection delivery suitability on pinned DSH. Not a general DSH context-system study.
- **Explicit Non-Goals:** No Bridge implementation (WAVE-D-T01); no context-system research beyond the needed semantics; no DSH core patch.
- **Dependencies / blocked_by:** none (independent; can run before Wave A completes)
- **Expected Surfaces:** pinned DSH `ctx.systemPrompt.context`, `agent.inject` comparison
- **Acceptance Criteria (PASS):** probe proves: (1) provider can register agent-scoped; (2) provider reads only an already-computed Runtime-held snapshot (asserted: no session-history rescan in callback); (3) unchanged snapshot adds no repeated runtime-context message; (4) changed snapshot materializes; (5) delivery suitable for O(1) latest projection.
- **FAIL criteria:** provider semantics unavailable/different → record real capability and choose fallback (`agent.inject` one-shot sourced context per §9.1), note impact on WAVE-D-T03.
- **Required Review Evidence:** probe trace; materialization/dedup assertions.
- **Stop / Escalation Condition:** if using the provider requires a new shared mechanism or DSH patch → `ESCALATION_REQUIRED`.

#### WAVE-D-T01 — Bridge latest-value runtime
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D
- **Baseline IDs:** BL-BR-01, BL-BR-02
- **Current Baseline State:** BL-BR-01: FOUNDATION_ONLY; BL-BR-02: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §9 (`CompanionBridge` latest-value, never event-stream), §9.1 (Runtime-owned latest values updated once per source-fact change), §10/§11 (WorkSnapshot/GameNotice shapes and rules — no strategic labels in GameNotice)
- **Existing Asset / Contract Reused:** `src/contracts/bridge.ts` — `CompanionBridge`, `WorkSnapshot`, `GameNotice`, `AffectedGroupDelta`
- **Scope:** Runtime-owned latest-value holder/updater: `latestWorkSnapshot` from native Work facts, `latestGameNotice` from authoritative game facts (objective deltas only; no ranking/danger/win-rate), coalescing updates. The contract shape and the latest-value runtime are one gap: a holder without the contract's semantics is not the frozen Bridge.
- **Explicit Non-Goals:** No provider delivery (WAVE-D-T03, gate by WAVE-D-S01); no transcript synchronization; no recursive projection (§12).
- **Dependencies / blocked_by:** WAVE-A-T01 (sessions produce facts)
- **Expected Surfaces:** `src/bridge/`
- **Acceptance Criteria:** unit: latest-value coalescing (N updates before read → single latest); GameNotice contains no forbidden fields (schema-level test); WorkSnapshot grounded in real facts (no invented percentages); §12 test: bridge output never feeds another bridge input.
- **Required Review Evidence:** unit tests; schema assertion.
- **Stop / Escalation Condition:** if the Bridge must carry commands/queues → `ESCALATION_REQUIRED`.

#### WAVE-D-T02 — Cross-lane awareness / no transcript injection
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D
- **Baseline IDs:** BL-BR-04
- **Current Baseline State:** BL-BR-04: FOUNDATION_ONLY
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §12 (no recursive projection), §35 (no mixed activity timeline; projections are small sourced context, not transcript replication), §40 Context Isolation
- **Existing Asset / Contract Reused:** `src/contracts/bridge.ts` (projection types)
- **Scope:** Ensure awareness surfaces never inject raw Work/Go histories into the other lane's context; handoff messages are not re-forwarded automatically.
- **Explicit Non-Goals:** No delivery mechanism (WAVE-D-T03); no UI policy (Wave E).
- **Dependencies / blocked_by:** WAVE-D-T01
- **Expected Surfaces:** `src/bridge/`, tests
- **Acceptance Criteria:** test: after a long synthetic game, Work model history contains no full Go transcript and no full board states (and symmetric for Go); a projection is never re-projected (§12 assertion).
- **Required Review Evidence:** isolation test output.
- **Stop / Escalation Condition:** if isolation requires history filtering inside DSH → `ESCALATION_REQUIRED`.

#### WAVE-D-T03 — No Bridge-only evaluation wake
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D
- **Baseline IDs:** BL-BR-05
- **Current Baseline State:** BL-BR-05: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §9.1 (a Bridge change alone must not launch a model request whose sole purpose is "decide whether to switch lanes"; idle handling uses Attention Mode + objective state; Manual never auto-switches; no wake-cooldown timer needed), §39.6
- **Scope:** Delivery of latest snapshots to the lanes per WAVE-D-S01 findings (or the recorded fallback), such that Bridge changes never create evaluation-only wakes; unchanged snapshots add no repeated prompt material.
- **Explicit Non-Goals:** No attention policy itself (WAVE-D-T06); no focus intent creation (WAVE-D-T07).
- **Dependencies / blocked_by:** WAVE-D-T01, WAVE-D-S01, WAVE-A-T02 (idle/active state)
- **Expected Surfaces:** `src/bridge/delivery.ts`, pinned DSH context seam
- **Acceptance Criteria:** §39.6 smoke: 20 rapid GameNotice updates while Work runs create zero additional model requests solely for attention evaluation (asserted via request-count trace); idle Manual lane not woken by Bridge change alone; next natural Work request sees only newest snapshot.
- **Required Review Evidence:** request-count trace; materialization assertions.
- **Stop / Escalation Condition:** if avoiding evaluation wakes requires a cooldown timer or new mechanism → `ESCALATION_REQUIRED`.

#### WAVE-D-T04 — CompanionState runtime + mood reducer
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D
- **Baseline IDs:** BL-CMP-01, BL-CMP-03
- **Current Baseline State:** BL-CMP-01: FOUNDATION_ONLY; BL-CMP-03: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §13 (one small authoritative `CompanionState`; persist latest via simplest reliable plugin persistence; no event journal), §14 (bounded small deltas, clamp, slow baseline return, stable persona not overwritten; no hard-coded trigger→delta rules; no hidden reasoning parse), §44 invariant "ONE small authoritative CompanionState"
- **Existing Asset / Contract Reused:** `src/contracts/companion.ts` — `CompanionState<TCompiledPersona, TMoodState>`, `AttentionMode`
- **Scope:** Single authoritative `CompanionState` holder with persistence (latest only) + the mood reducer (bounded deltas, clamp, baseline return). Holder and reducer are one gap: both operate on the same state object; separating them prevents end-to-end verification of mood updates.
- **Explicit Non-Goals:** No persona compiler (WAVE-D-T05); no attention policy (WAVE-D-T06); no journal/event-sourcing.
- **Dependencies / blocked_by:** none (independent; can run before Wave A)
- **Expected Surfaces:** `src/companion/`
- **Acceptance Criteria:** reducer unit tests: delta clamping at bounds, slow return toward baseline, persona field never overwritten by mood; persistence round-trip of latest state; no event journal artifacts.
- **Required Review Evidence:** reducer tests; persistence round-trip.
- **Stop / Escalation Condition:** if mood needs event history → `ESCALATION_REQUIRED`.

#### WAVE-D-T05 — Persona Compiler + schema freeze
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D
- **Baseline IDs:** BL-CMP-02
- **Current Baseline State:** BL-CMP-02: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §15 (primary inputs: plain-language description + dialogue samples; compiler produces internal profile; persona affects expression/mild tendencies/attention style/mood baseline, never factual Work state), §40 Persona Continuity
- **Scope:** Persona Compiler from the two input forms to a compiled profile; freeze the compiled-persona schema (the contract's generic type is intentional until this decision).
- **Explicit Non-Goals:** No large persona parameter panel; no mood (WAVE-D-T04).
- **Dependencies / blocked_by:** WAVE-D-T04 (writes into `CompanionState.persona`)
- **Expected Surfaces:** `src/companion/persona.ts`
- **Acceptance Criteria:** compiler unit tests: both input forms produce a deterministic profile; schema freeze recorded (type + doc); persona does not alter Work state (test).
- **Required Review Evidence:** compiler tests; frozen schema declaration.
- **Stop / Escalation Condition:** if persona schema conflicts with `CompanionState` generic contract → `ESCALATION_REQUIRED`.

#### WAVE-D-T06 — Attention mode runtime semantics
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D
- **Baseline IDs:** BL-CMP-04
- **Current Baseline State:** BL-CMP-04: FOUNDATION_ONLY
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §16 (Mofish/Normal/Strict/Manual semantics; no task taxonomy, no numeric importance table; Manual disables autonomous switching), §9.1 idle handling per mode
- **Existing Asset / Contract Reused:** `src/contracts/companion.ts` — `AttentionMode`
- **Scope:** Runtime semantics mapping each mode to how readily Go facts enter attention and whether autonomous focus scheduling is allowed (Manual = none).
- **Explicit Non-Goals:** No focus intent scheduling itself (WAVE-D-T07); no UI controls (Wave E).
- **Dependencies / blocked_by:** WAVE-D-T04 (mode stored in CompanionState)
- **Expected Surfaces:** `src/companion/attention.ts`
- **Acceptance Criteria:** per-mode deterministic tests: Mofish may schedule on micro-break; Normal on waits; Strict preserves Work continuity; Manual never schedules autonomously; no importance taxonomy exists.
- **Required Review Evidence:** per-mode test output.
- **Stop / Escalation Condition:** if modes require a numeric importance table → `ESCALATION_REQUIRED`.

#### WAVE-D-T07 — Self-initiated focus
- **Type:** IMPLEMENTATION_TICKET | **Wave:** D
- **Baseline IDs:** BL-CMP-05
- **Current Baseline State:** BL-CMP-05: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §5/§6 (self_initiated origin; lane may request focus via `companion.request_focus`; Runtime is the only cross-lane wake authority), §9.1 (Normal/Mofish may schedule Go focus intent from objective state + idleness, coalescing into the single `pendingFocus`)
- **Scope:** Runtime scheduling of self-initiated focus intents from objective state (e.g., `GameNotice.toPlay === "deepseek"` + Work idleness) per active Attention Mode, always through the single `pendingFocus` arbitration.
- **Explicit Non-Goals:** No user-origin admission (WAVE-A-T06); no attention semantics (WAVE-D-T06).
- **Dependencies / blocked_by:** WAVE-A-T02, WAVE-D-T06
- **Expected Surfaces:** `src/runtime/`, `src/companion/attention.ts`
- **Acceptance Criteria:** test: Normal mode + objective state schedules one `self_initiated` intent; a later user-origin intent wins arbitration (no overwrite); repeated triggers coalesce into the single `pendingFocus`.
- **Required Review Evidence:** scheduling tests; arbitration interaction assertions.
- **Stop / Escalation Condition:** if self-initiated focus needs evaluation-only wakes → `ESCALATION_REQUIRED`.

---

### Wave E — Harness Web UI

#### WAVE-E-S01 — DSH Web `conversation.view` extension seam spike
- **Type:** SPIKE | **Wave:** E (gate)
- **Baseline IDs:** BL-UI-04
- **Current Baseline State:** BL-UI-04: NEEDS_SPIKE
- **Target State:** VERIFIED_FACT_NOT_INTEGRATED (seam capability record)
- **Spec Authority:** §34 (prove the seam before depending: full Go view coexists with Chat/Trajectory; active view does not merge Work+Go transcripts; small Go surface in Work UX; small Work surface in Go UX; two paired Sessions controlled by one Companion shell without transcript fusion; if seam awkward, simplify UX before patching core DSH)
- **Scope:** Probe on pinned DSH Web: how a Go view mounts into the Harness-native Web, whether Chat/Go/Trajectory coexist, dual-session single-shell control, and mini-surface placement. No transcript fusion required.
- **Explicit Non-Goals:** No production UI (WAVE-E-T01); no DSH core patch; no full UX build-out.
- **Dependencies / blocked_by:** none (independent; can run before Wave D completes)
- **Expected Surfaces:** pinned DSH Web `conversation.view`, view registry
- **Acceptance Criteria (PASS):** all five §34 smoke items verified with real view-mount evidence on pinned DSH Web; record the exact seam API and placement points.
- **FAIL criteria:** seam cannot host a Go view / fusion unavoidable → record real behavior and the simplified UX fallback per §34 (must precede WAVE-E-T01).
- **Required Review Evidence:** mounted-view screenshot/DOM evidence + assertion log.
- **Stop / Escalation Condition:** if the smoke requires patching core DSH → `ESCALATION_REQUIRED`.

#### WAVE-E-T01 — Production Harness Go UI + board-click direct route
- **Type:** IMPLEMENTATION_TICKET | **Wave:** E
- **Baseline IDs:** BL-UI-02, BL-RT-10
- **Current Baseline State:** BL-UI-02: NOT_IMPLEMENTED; BL-RT-10: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §32 (real graphical board: 9x9/13x13/19x19, real stones, auto-captures, last-move, turn, Pass, Resign, final result, minimal placement/capture animation, minimal sound; click → GoRulesPort.play → authoritative state → UI update; never parse text as game truth), §33 (DSH-native shell; Main Go View seats; Work View mini Go surface; Go View mini WorkSnapshot; no Go budget imposed on Work), §7.2 (direct board action → GoRulesPort directly, then GameNotice; no fabricated focus intent)
- **Scope:** Production Go view in Harness Web per V4 presentation reference (layout/interaction authority only) + the board-click direct route `click → GoRulesPort.play → state/GameNotice → UI`. Board click is the defining interaction of a real board (§32), hence BL-UI-02 + BL-RT-10 are one vertical slice.
- **Explicit Non-Goals:** No desktop wrapper (BL-UI-03 DEFERRED); no TUI; no prototype JS logic (komi 6.5 / random AI / fake timing / prototype Attention) — production behavior only from the verified Spec; no transcript fusion.
- **Dependencies / blocked_by:** WAVE-E-S01, WAVE-B-T02, WAVE-D-T01, WAVE-A-T01
- **Expected Surfaces:** `src/ui/` (Harness Web view extension), `src/bridge/` (GameNotice feed)
- **Acceptance Criteria:**
  - §34 smoke passes (from WAVE-E-S01 record) in the integrated view; Work/Go transcripts not merged (assert DOM separation).
  - Board click on a legal intersection calls `GoRulesPort.play` immediately; state + GameNotice update; no `PendingFocusIntent` fabricated (test assertion).
  - Illegal click rejected by port, UI reflects legality result; no text parsing of moves.
  - Mini surfaces: Work mini Go status + Go mini WorkSnapshot render from latest-value Bridge.
  - Prototype-inherited values absent: production komi is 7.5 (config assertion), no random-AI move logic, no prototype timing.
- **Required Review Evidence:** browser/smoke run evidence (DOM/screenshot), board-click trace, no-prototype-logic code audit.
- **Stop / Escalation Condition:** if the production UI requires inheriting prototype rules/AI/timing semantics → `ESCALATION_REQUIRED`.

---

### Wave F — Integration / crash-resume / replay recovery / hardening

#### WAVE-F-T01 — Crash / resume recovery
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F
- **Baseline IDs:** BL-HARD-01
- **Current Baseline State:** BL-HARD-01: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §36 (restore Work Session, Go Session, canonical game record, reconstructed authoritative board, CompanionState, attention mode; focus recovery conservative → restart into Work focus by default; no transactional focus recovery; transient cross-lane commands not required to survive)
- **Scope:** Recovery pipeline: on plugin restart, restore both sessions, canonical record (via WAVE-B-T06), reconstructed board, CompanionState, attention mode; default to Work focus.
- **Explicit Non-Goals:** No transactional focus recovery; no pending-command durability (unless trivially reliable per §36); no second engine.
- **Dependencies / blocked_by:** WAVE-A-T01, WAVE-B-T06, WAVE-D-T04
- **Expected Surfaces:** `src/persistence/`, `src/runtime/` (restore path)
- **Acceptance Criteria:** restart test: state written before simulated crash is restored; board equals replayed canonical record (deterministic assertion); focus defaults to Work; transient pending focus not required to survive (documented).
- **Required Review Evidence:** restart test output; no-transaction assertion.
- **Stop / Escalation Condition:** if recovery requires a transaction protocol → `ESCALATION_REQUIRED`.

#### WAVE-F-T02 — Replay recovery
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F
- **Baseline IDs:** BL-HARD-02
- **Current Baseline State:** BL-HARD-02: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §28 (recovery = fresh Tenuki game + replay canonical actions + verify authoritative state), §36
- **Scope:** Replay-restore integration into the recovery path with verification of the resulting authoritative state.
- **Explicit Non-Goals:** No UI; no second rules authority.
- **Dependencies / blocked_by:** WAVE-B-T06
- **Expected Surfaces:** `src/persistence/`, `src/rules/`
- **Acceptance Criteria:** replay-restore integration test: long action sequence survives round-trip; post-replay state matches pre-crash state (deterministic assertion on board + turn + captures).
- **Required Review Evidence:** replay test output.
- **Stop / Escalation Condition:** if replay depends on Tenuki internals → `ESCALATION_REQUIRED`.

#### WAVE-F-T03 — E2E integration continuity (work → go → work)
- **Type:** IMPLEMENTATION_TICKET | **Wave:** F
- **Baseline IDs:** BL-HARD-03
- **Current Baseline State:** BL-HARD-03: NOT_IMPLEMENTED
- **Target State:** IMPLEMENTED_VERIFIED
- **Spec Authority:** §40 (Correctness: illegal moves 0 / state drift 0 / capture errors 0 / lost cross-lane commands 0; Context Isolation; Continuity work→Go turn→work; Cognition Exclusivity), §39.1/39.2 smoke
- **Scope:** End-to-end validation slice: work → Go turn → work continuity with correct resume, context isolation, cognition exclusivity, and the cross-lane command handoff smokes (§39.1/§39.2).
- **Explicit Non-Goals:** No new features; no post-game analysis (BL-HARD-04 DEFERRED).
- **Dependencies / blocked_by:** WAVE-A-T07, WAVE-B-T06, WAVE-E-T01, WAVE-D-T04
- **Expected Surfaces:** full stack `src/runtime/`, `src/rules/`, `src/bridge/`, `src/ui/`
- **Acceptance Criteria:**
  - §39.1: Go View "回去把剩下两个测试修掉" → Work focus, Work Session receives original instruction verbatim (assert); symmetric "去下一手" case.
  - §39.2: concurrent wake — Go input during Work mid-turn does not enter foreground cognition; input not lost; admitted at safe boundary; step-3 work not aborted; handoff at first continuation boundary; one `companion-resume` suffices on return.
  - §40 correctness counters all zero (asserted).
- **Required Review Evidence:** e2e run trace; all assertion outputs.
- **Stop / Escalation Condition:** if any §40 invariant cannot be met within scope → `ESCALATION_REQUIRED`.

---

## 4. Spike List (PASS/FAIL criteria and blocked work)

| Spike | Baseline | Question | PASS criteria | FAIL criteria / fallback | Blocked work |
|---|---|---|---|---|---|
| INFRA-S01 | BL-PKG-06 | Does `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` resolve/build/activate on pinned DSH? | Real command succeeds; bundle reconciliation + fiber active (reuse `profile-mount-smoke.mjs`); trace uploaded | Record real behavior; fallback = installation docs pin a packed tarball | Wave F installation acceptance, installation docs |
| WAVE-B-S01 | BL-GR-03 | Which pinned Tenuki satisfies area + positional-superko + komi 7.5 explicit config passing §31? | Candidate passes §31 positional-superko fixture + area/komi 7.5 explicit config; version pinned; conformance record written | No candidate → `ESCALATION_REQUIRED` (no silent degrade) | WAVE-B-T02/03/04/05/06, WAVE-E-T01, WAVE-C-T02 (rules-dependent) |
| WAVE-D-S01 | BL-BR-03 | `ctx.systemPrompt.context` agent-scoped provider semantics on pinned DSH? | Registered agent-scoped; reads only Runtime-held snapshot (no rescan); materializes only on change; O(1) latest-delivery suitable | Record real capability; fallback `agent.inject` one-shot per §9.1; impacts WAVE-D-T03 | WAVE-D-T03 |
| WAVE-E-S01 | BL-UI-04 | Can a Go view mount in DSH Web with Chat/Go/Trajectory coexisting, dual-session single shell, mini surfaces, no fusion? | All five §34 items verified with view-mount evidence | Record real behavior; simplify UX per §34 before WAVE-E-T01 | WAVE-E-T01 |

All four Spikes are pairwise independent and independent of Wave A; three of four (INFRA-S01, WAVE-B-S01, WAVE-E-S01) can start immediately. WAVE-D-S01 can also start immediately.

---

## 5. Dependency Graph

```text
INFRA-T01 (CI triggers)                         ─ independent
INFRA-S01 (GitHub install spike)                ─ independent
WAVE-B-S01 (Tenuki spike)                       ─ independent
WAVE-D-S01 (context provider spike)             ─ independent
WAVE-E-S01 (Web view seam spike)                ─ independent
WAVE-A-T01 (dual sessions)                      ─ independent
WAVE-B-T01 (GoRulesPort + harness)              ─ independent
WAVE-C-T06 (GoTurnBudget contract)              ─ independent
WAVE-D-T04 (CompanionState + mood reducer)      ─ independent
    │
WAVE-A-T02 (focus machine)          ← WAVE-A-T01
WAVE-A-T03 (safe boundary)          ← WAVE-A-T01, WAVE-A-T02
WAVE-A-T05 (immutable handoff)      ← WAVE-A-T02
WAVE-A-T04 (yield integration)      ← WAVE-A-T03
WAVE-A-T06 (inactive admission)     ← WAVE-A-T02, WAVE-A-T05
WAVE-A-T07 (resume integration)     ← WAVE-A-T02, WAVE-A-T04
    │
WAVE-B-T02 (TenukiAdapter)          ← WAVE-B-S01, WAVE-B-T01
WAVE-B-T03 (area/komi/superko)      ← WAVE-B-T02
WAVE-B-T04 (captures/settle)        ← WAVE-B-T02
WAVE-B-T05 (§31 fixtures)           ← WAVE-B-T03, WAVE-B-T04
WAVE-B-T06 (canonical record)       ← WAVE-B-T02, WAVE-B-T05
    │
WAVE-C-T04 (preset + guards)        ← WAVE-A-T01
WAVE-C-T01 (9-tool surface)         ← WAVE-C-T04
WAVE-C-T07 (budget enforcement)     ← WAVE-C-T06
WAVE-C-T02 (7 go.* tools)           ← WAVE-B-T02, WAVE-C-T01, WAVE-C-T06, WAVE-C-T07
WAVE-C-T08 (deep-think boost)       ← WAVE-C-T02, WAVE-C-T07
WAVE-C-T05 (anti-cheat tests)       ← WAVE-C-T04
WAVE-C-T03 (2 companion.* tools)    ← WAVE-A-T02, WAVE-D-T04
WAVE-C-T09 (budget bypass tests)    ← WAVE-C-T07, WAVE-C-T08
    │
WAVE-D-T01 (bridge latest-value)    ← WAVE-A-T01
WAVE-D-T02 (no transcript)          ← WAVE-D-T01
WAVE-D-T03 (no eval wake)           ← WAVE-D-T01, WAVE-D-S01, WAVE-A-T02
WAVE-D-T05 (persona compiler)       ← WAVE-D-T04
WAVE-D-T06 (attention modes)        ← WAVE-D-T04
WAVE-D-T07 (self-initiated focus)   ← WAVE-A-T02, WAVE-D-T06
    │
WAVE-E-T01 (Go UI + board click)    ← WAVE-E-S01, WAVE-B-T02, WAVE-D-T01, WAVE-A-T01
    │
WAVE-F-T01 (crash/resume)           ← WAVE-A-T01, WAVE-B-T06, WAVE-D-T04
WAVE-F-T02 (replay recovery)        ← WAVE-B-T06
WAVE-F-T03 (e2e continuity)         ← WAVE-A-T07, WAVE-B-T06, WAVE-E-T01, WAVE-D-T04
```

No cycles. Companion tools (WAVE-C-T03) intentionally sit on the C/D boundary: `companion.request_focus` needs Wave A focus, `companion.affect` needs the Wave D mood reducer — the graph encodes that, the Wave label is organizational.

---

## 6. Critical Path

1. **Runtime path (longest):** WAVE-A-T01 → WAVE-A-T02 → WAVE-A-T03 → WAVE-A-T04 → WAVE-A-T07 → WAVE-F-T03. This is the true end-to-end vertical slice to §40 continuity.
2. **Rules path to UI:** WAVE-B-S01 → WAVE-B-T02 → (WAVE-B-T03/04) → WAVE-B-T05 → WAVE-B-T06, and in parallel WAVE-A-T01 → WAVE-D-T01, then WAVE-E-T01 (also requires WAVE-E-S01).
3. **First vertical milestone (Wave A complete):** WAVE-A-T07 done ⇒ Runtime lane switching + yield + resume demonstrable on pinned DSH.

The final vertical slice (WAVE-F-T03) is blocked by both the runtime path (A) and the UI path (E), which can be built in parallel.

---

## 7. Parallelizable Work

- **All 4 Spikes run in parallel immediately** (INFRA-S01, WAVE-B-S01, WAVE-D-S01, WAVE-E-S01) — none depends on Wave A.
- **Independent first-wave tickets in parallel:** INFRA-T01, WAVE-A-T01, WAVE-B-T01, WAVE-C-T06, WAVE-D-T04.
- **Wave A chain (T01→T02→T03→T04→T07) parallel to Wave B rules chain (S01→T02→T03/04→T05→T06).** Rules implementation is blocked only by the Tenuki spike, not by Runtime.
- **Wave D companion/bridge chain (D-T01→D-T02/03) parallel to Wave C tool/budget chain** after their shared roots (A-T01, C-T06, D-T04).
- **WAVE-E-S01 (Web seam spike) does NOT wait for Wave D** — it can resolve while Wave B/C/D proceed.
- **WAVE-C-T03 (companion.* tools) may start only after WAVE-D-T04** (mood reducer) — an intentional C/D coupling, not serial A→F.

---

## 8. BASELINE_COVERAGE_MATRIX

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
| BL-RT-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T02 | WAVE-A-T01 | COVERED |
| BL-RT-03 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T02 | WAVE-A-T01 | COVERED |
| BL-RT-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T02 | WAVE-A-T01 | COVERED |
| BL-RT-05 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T05 | WAVE-A-T02 | COVERED |
| BL-RT-06 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T03 | A-T01, A-T02 | COVERED |
| BL-RT-07 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T04 | WAVE-A-T03 | COVERED |
| BL-RT-08 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-A-T02 | WAVE-A-T01 | COVERED |
| BL-RT-09 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-A-T06 | A-T02, A-T05 | COVERED |
| BL-RT-10 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-E-T01 | E-S01, B-T02, D-T01, A-T01 | COVERED |
| BL-RT-11 | VERIFIED_FACT_NOT_INTEGRATED | INTEGRATION_TICKET | WAVE-A-T07 | A-T02, A-T04 | COVERED |
| BL-BR-01 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T01 | WAVE-A-T01 | COVERED |
| BL-BR-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T01 | WAVE-A-T01 | COVERED |
| BL-BR-03 | NEEDS_SPIKE | SPIKE | WAVE-D-S01 | none | COVERED |
| BL-BR-04 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T02 | WAVE-D-T01 | COVERED |
| BL-BR-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T03 | D-T01, D-S01, A-T02 | COVERED |
| BL-GR-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T01 | none | COVERED |
| BL-GR-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T02 | B-S01, B-T01 | COVERED |
| BL-GR-03 | NEEDS_SPIKE | SPIKE | WAVE-B-S01 | none | COVERED |
| BL-GR-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T03 | WAVE-B-T02 | COVERED |
| BL-GR-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T04 | WAVE-B-T02 | COVERED |
| BL-GR-06 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T06 | B-T02, B-T05 | COVERED |
| BL-GR-07 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-B-T05 | B-T03, B-T04 | COVERED |
| BL-GT-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T01 | WAVE-C-T04 | COVERED |
| BL-GT-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T02 | B-T02, C-T01, C-T06, C-T07 | COVERED |
| BL-GT-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T03 | A-T02, D-T04 | COVERED |
| BL-CAP-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T04 | WAVE-A-T01 | COVERED |
| BL-CAP-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T04 | WAVE-A-T01 | COVERED |
| BL-CAP-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T05 | WAVE-C-T04 | COVERED |
| BL-BUD-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T06 | none | COVERED |
| BL-BUD-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T07 | WAVE-C-T06 | COVERED |
| BL-BUD-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T08 | C-T02, C-T07 | COVERED |
| BL-BUD-04 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T07 | WAVE-C-T06 | COVERED |
| BL-BUD-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-C-T09 | C-T07, C-T08 | COVERED |
| BL-CMP-01 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T04 | none | COVERED |
| BL-CMP-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T05 | WAVE-D-T04 | COVERED |
| BL-CMP-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T04 | none | COVERED |
| BL-CMP-04 | FOUNDATION_ONLY | IMPLEMENTATION_TICKET | WAVE-D-T06 | WAVE-D-T04 | COVERED |
| BL-CMP-05 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-D-T07 | A-T02, D-T06 | COVERED |
| BL-UI-01 | IMPLEMENTED_VERIFIED | NO_ACTION | — | — | NO_ACTION |
| BL-UI-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-E-T01 | E-S01, B-T02, D-T01, A-T01 | COVERED |
| BL-UI-03 | DEFERRED | DEFER | — | — | DEFERRED |
| BL-UI-04 | NEEDS_SPIKE | SPIKE | WAVE-E-S01 | none | COVERED |
| BL-HARD-01 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T01 | A-T01, B-T06, D-T04 | COVERED |
| BL-HARD-02 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T02 | WAVE-B-T06 | COVERED |
| BL-HARD-03 | NOT_IMPLEMENTED | IMPLEMENTATION_TICKET | WAVE-F-T03 | A-T07, B-T06, E-T01, D-T04 | COVERED |
| BL-HARD-04 | DEFERRED | DEFER | — | — | DEFERRED |

---

## 9. Duplicate / Orphan Audit

- **duplicate owners = 0** — every actionable Baseline row maps to exactly one primary Ticket/Spike (matrix above; multi-gap tickets justified: WAVE-A-T02 = one focus state machine; WAVE-C-T04 = isolation both faces; WAVE-C-T07 = budget execution + lifecycle rule; WAVE-D-T01 = bridge shape+behavior; WAVE-D-T04 = state holder + reducer; WAVE-E-T01 = real board incl. its defining click path).
- **orphan actionable gaps = 0** — no actionable Baseline row lacks a primary owner (37 actionable rows all COVERED).
- **orphan tickets = 0** — every Ticket/Spike references at least one Baseline ID; no incidental work.
- **repeated feasibility spikes = 0** — BL-RT-06/07/11 produce INTEGRATION_TICKET only; the four NEEDS_SPIKE rows get exactly one Spike each.

---

## 10. Deferred Work

- **BL-UI-03** (desktop wrapper) — DEFERRED, no Ticket (Spec §33 desktop second).
- **BL-HARD-04** (post-game analysis) — DEFERRED, no Ticket (Spec §37 separate scope; KataGo only in a future separate Analysis Session).
- Deferred Spec mechanisms remain off-graph (FIFO handoff queue, bridge mailbox, event journal, focus epoch/lease, second engine) — they appear only if their §45 concrete triggers appear.

---

## 11. Risks / Escalations

- **WAVE-B-S01 fail ⇒ ESCALATION_REQUIRED** (Spec §27: no silent degradation to simple ko; resolve Adapter/version choice).
- **WAVE-D-S01 / WAVE-E-S01 fail ⇒ fallback documented** (agent.inject; simplified UX), each blocking its dependent (D-T03 / E-T01) until resolved — no silent assumptions.
- **DSH upgrade sensitivity:** any pinned-DSH commit change must re-run the cooperative-yield gate (BL-PKG-09) and re-probe seams (INFRA-S01 / WAVE-D-S01 / WAVE-E-S01) before relying on them.
- **WAVE-C-T03 crosses C/D** — its schedule is governed by the dependency graph, not the Wave label; flag for reviewers.
- **Budget numeric values** deliberately not frozen (BL-BUD-01) — placeholder defaults until the §38 benchmark; reviewers must not treat them as Spec.
- No `ESCALATION_REQUIRED` items are currently open; none of the 38 tickets requires changing the verified Spec or a frozen contract.

---

## 12. Files Changed (this artifact)

- `docs/planning/TICKET_GRAPH_V1.md` (new — this graph)
- `PROJECT_STATUS.md` (Ticketization: NOT STARTED → REVIEW_PENDING; no Baseline status change)

No JSON/YAML ticket graph, no GitHub Issues, no Baseline/Spec modification.

---

## 13. Recommended First Execution Set (after review approval)

1. **INFRA-T01** — CI trigger policy (unblocks main-based PR CI for everything after).
2. **The 4 Spikes in parallel:** INFRA-S01, WAVE-B-S01, WAVE-D-S01, WAVE-E-S01 (all independent; resolve the four real unknowns earliest).
3. **Independent first-wave tickets in parallel:** WAVE-A-T01 (dual sessions), WAVE-B-T01 (GoRulesPort harness), WAVE-C-T06 (budget contract), WAVE-D-T04 (CompanionState + mood reducer).
4. Then follow the dependency graph: WAVE-A-T02 → … (runtime chain) and WAVE-B-T02 → … (rules chain) proceed in parallel.

Nothing in this section is executed this round.
