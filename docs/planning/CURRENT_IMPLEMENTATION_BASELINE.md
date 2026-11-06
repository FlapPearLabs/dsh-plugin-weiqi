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
| BL-PKG-06 | GitHub source install | `dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` builds and activates | Executed on pinned DSH `b150a551...` / `0.1.1-rc.2` / Node 24.11.1 / pnpm 11.7.0: resolution PASS, clone PASS, install PASS, bundle reconciliation PASS (`--dump-config` composes `companion-go`), **activation FAIL** — installed tree has no `lib/`, mount smoke exits 1 with `ERR_MODULE_NOT_FOUND .../lib/index.js`; root cause: no `prepare` script, `lib/` gitignored and untracked, `files` ships only `cordis.patch.yml` + `lib/**`; merged PR #79 (`161eb5c`) records the failure; fallback = verified packed-tarball path (BL-PKG-05) | VERIFIED_FACT_NOT_INTEGRATED | Git-source install needs an install-time build (`prepare`/packaging fix) before the capability exists; no silent PASS | — | SMALL_INFRA_TICKET |
| BL-PKG-07 | Foundation CI | typecheck + tests + build automated | `.github/workflows/ci.yml` (Node 24.11.1 / pnpm 11.7.0 pins); pass on foundation HEAD | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-08 | DSH version pin | Exact pinned DSH commit/packages | DSH `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; packages `0.1.1-rc.2` (peerDeps + gate assertions) | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |
| BL-PKG-09 | cooperative-yield upgrade gate | Any DSH change reruns the fixture | `.github/workflows/cooperative-yield-upgrade-gate.yml` (copies fixture into pinned DSH tree, real AgentLoop); pass | IMPLEMENTED_VERIFIED | None | — | KEEP_AS_UPGRADE_GATE |

## CI trigger policy

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-CI-01 | Post-bootstrap CI trigger policy | CI runs on current default branch / normal PR flow | `.github/workflows/{ci.yml, cooperative-yield-upgrade-gate.yml, profile-install-smoke.yml}` trigger on `main` push and on PRs targeting `main`, with existing path filters preserved; trigger-only diff merged as PR #63 (`e988992`), adversarial review r1 APPROVE; all 3 PR checks passed | IMPLEMENTED_VERIFIED | None | — | NO_ACTION |

## Runtime / Focus

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-RT-01 | Work / Go two isolated sessions | Two durable isolated DSH sessions | `src/runtime/lane-session.ts` fixes `work` -> `companion-go-work` / `go` -> `companion-go-go` and resolves current live Sessions; `src/index.ts` requests both identities through AgentLoop; real pinned session-ownership gate + production profile Loader smoke verify isolated histories, collision rollback, plugin-fiber disposal/remount (merged PR #50, `5a4623f`) | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-02 | One foreground cognition lane | At most one active lane invariant | `src/runtime/focus.ts` owns deterministic `activeLane` transitions; `src/runtime/focus.test.ts` verifies exactly one `work`/`go` lane remains active across transition sequences (merged PR #54, `a7fe3b7`) | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-03 | Lane / PendingFocusIntent / RuntimeFocusState contracts | Spec §5 exact shapes | `src/contracts/focus.ts` remains the sole unchanged contract; `src/runtime/focus.ts` implements its state transitions and `src/runtime/focus.test.ts` verifies the contract behavior (merged PR #54, `a7fe3b7`) | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-04 | user_command > self_initiated arbitration | Spec §5 precedence | `submitFocusIntent` implements the frozen six-case single-slot matrix; table-driven tests verify user-over-self precedence and retain-existing user/user semantics without consuming the incoming input (merged PR #54, `a7fe3b7`) | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-05 | Immutable UserMessage handoff | Spec §5/§7 exact source message | `src/runtime/handoff.ts` `createCompanionHandoff` reads only `pendingFocus.sourceMessage` and copies the exact stored content blocks into a freshly identified target-lane message with Companion-handoff provenance; no session-surface lookup, no `capturedText`, no second buffer; 10-case test suite + mutation audit; merged PR #65 (`33ad025`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-06 | Safe-boundary eligibility detection | Detect the first safe cognition handoff boundary only after the current DSH step fully commits; do not suppress continuation or switch lanes | `RuntimeFocusOwner` integrates committed `session/event` plus actual `llm/stream` observation; the real pinned DSH trace verifies multi-tool result commitment, post-`step/end` eligibility, unchanged `activeLane`, and explicit `no-step` semantics (merged PR #56, `bfd56d3`) | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-07 | Cooperative-yield production integration + post-settle lane switch | Spec §7.1.2 continuation yield / natural settle handling; perform the actual `activeLane` switch only after confirmed settle | `src/runtime/focus-yield.ts` implements the verified seam (batch splice + reject + blocked→idle) and switches `activeLane` exactly once only after confirmed settle; production gate `cooperative-yield-production-gate.yml` runs the real pinned-DSH AgentLoop fixture; merged PR #58 (`41a4b04`); 48-test package verification PASS | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-08 | pausedLane contract / state field | Spec §5/§7.1.2 | `markLanePaused` preserves a single optional lane and `admitPausedLaneResume` clears it atomically while reactivating that lane; deterministic tests verify no stack/list accumulation (merged PR #54, `a7fe3b7`) | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |
| BL-RT-09 | Inactive-lane natural-language admission | Spec §7.2 | `src/runtime/admission.ts` `admitInactiveLaneUserMessage(state, admission)` creates exactly one `PendingFocusIntent{target, origin:'user_command', sourceMessage}` (deep-frozen message incl. source, `source.kind === 'user'`), rejects same-lane targets (`already-active-lane`) and malformed/empty content, submits once through A-T02 arbitration, and distinguishes `submitted` from `retained` so an unconsumed user message is never silently dropped; 34 tests incl. deadlock regression and source-freeze/malformed-block cases; PR #78 (`47c5ed8`), adversarial review r1-r2 CHANGES_REQUESTED -> r3 APPROVE -> r4 APPROVE | IMPLEMENTED_VERIFIED | None (real UI/View wiring remains outside this ticket; the ticket's simulated View surface is not delivered and is noted in the handoff) | A | NO_ACTION |
| BL-RT-10 | Board click direct route | Spec §7.2/§32 | No code | NOT_IMPLEMENTED | User interaction: board click → UI → GoRulesPort → resulting state/GameNotice → UI. Depends on BL-GR-01 (GoRulesPort behavior) and BL-UI-02 (production UI); not part of Go Agent tools | E | IMPLEMENTATION_TICKET |
| BL-RT-11 | Resume sequencing / cooperative external resume integration | Spec §5/§7.1.2 | `src/runtime/focus-resume.ts` binds the single resumed switch to exactly one plugin-sourced `companion-resume`; `pausedLane` consumed at admission, `pendingFocus` preserved; resignated synthetic resume suppressed under a real user wake; real pinned-DSH resume gate PASS (A,B,C,resume; 4 unique MessageIds, no loss/duplicate); merged PR #60 (`063fee1`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None | A | NO_ACTION |

## Bridge / Context

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-BR-01 | WorkSnapshot / GameNotice / CompanionBridge contracts | Spec §9-11 exact shapes | `src/contracts/bridge.ts` matches Spec; `src/bridge/schema.ts` validates the exact field sets and rejects forbidden strategic/command fields (incl. nested `AffectedGroupDelta`); `src/bridge/runtime.ts` owns independent Work/Game slots without recursive projection; PR #67 (`6348a0f`), adversarial review r1 APPROVE, 84 tests | IMPLEMENTED_VERIFIED | None | D | NO_ACTION |
| BL-BR-02 | Latest-value semantics | Spec §9 awareness only, never a queue | `src/bridge/latest-value.ts` keeps one latest value with a monotonic sequence; stale/duplicate updates are rejected without resurrecting old values; no history/queue/drain/subscription surface; PR #67 (`6348a0f`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None | D | NO_ACTION |
| BL-BR-03 | Hybrid per-direction Bridge delivery seams | Spec §9.1 (Go: `systemPrompt.section` + `variable`; Work: `systemPrompt.context`) and §39.6 numeric bound, as approved in R2.4.3 | Both seams are established by executable pinned-DSH evidence, not by preference: `ctx.systemPrompt.context` FAILS §39.6 latest-only for the Go direction — a changed value leaves the superseded snapshot in durable model-facing history (`docs/validation/DSH_SYSTEM_PROMPT_CONTEXT_SEAM_VERIFIED.md`, PR #62); `agent.inject` is ruled out (PR #108 `80f64e8`); `agent.ctx.systemPrompt.section` + `variable` PASSES latest-only, no-wake, and no-history-growth on the pinned AgentLoop (`docs/validation/DSH_SYSTEMPROMPT_SECTION_SEAM_VERIFIED.md`, gate `tests/upgrade-gates/system-prompt-section/`, CI workflow `.github/workflows/system-prompt-section-gate.yml`, PR #64). R2.4.3 §9.1 assigns section+variable to Go and context to Work; no delivery code exists yet | VERIFIED_FACT_NOT_INTEGRATED | Provider registration and render for both directions is WAVE-D-T03 | D (gate) | INTEGRATION_TICKET (predeclared consumer WAVE-D-T03) |
| BL-BR-04 | Cross-lane awareness / no raw transcript injection | Spec §12/§35 | `src/bridge/awareness.ts` `CrossLaneAwareness` exposes only a frozen, field-whitelisted copy of the latest `GameNotice` to Work and the latest `WorkSnapshot` to Go; no raw history/transcript/board/move keys; handoff never re-forwarded; projections do not re-grow (cached by payload reference); unknown fields rejected with `BridgeSchemaError`; 400-move isolation tests + mutation checks; PR #76 (`9caa0a1`), adversarial review r1 APPROVE + falsifiable-assertion P2 fix | IMPLEMENTED_VERIFIED | None | D | NO_ACTION |
| BL-BR-05 | Bridge-only changes do not trigger evaluation wakes | Spec §9.1 (no evaluation-only wake; no cooldown timer) and §39.6 | No code. R2.4.3 fixes which seam carries each direction and the numeric long-sequence bound WAVE-D-T03 must meet; the no-wake property itself is already established for both seams by the pinned probes (PR #109 section, PR #62 context) | NOT_IMPLEMENTED | Needs Attention linkage and the delivery provider | D | IMPLEMENTATION_TICKET |

## Go Rules

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-GR-01 | GoRulesPort interface | Spec §26 (R2.4.2) `createGame/play/pass/resign/getState/inspectGroup/score/settle`; GoRulesPort = sole application-facing game-mutation boundary; resign = terminal action at the port, no second board-rules authority | `src/contracts/rules.ts` defines the eight-method port incl. `resign(gameId, by) -> ResignResult`; `tests/rules/port-harness.ts` is an engine-independent 13-case harness (all eight methods, illegal-move non-mutation, resign terminal, teeth check) with a deterministic stub; no Tenuki dependency, no second lifecycle controller; PR #70 (`8249c12`), adversarial review r1 APPROVE, 55 tests | IMPLEMENTED_VERIFIED | None | B | NO_ACTION |
| BL-GR-02 | Tenuki Adapter | Spec §26/§27 rules authority behind port | `src/rules/tenuki-adapter.ts` implements `GoRulesPort` with explicit `{ scoring: 'area', koRule: 'positional-superko', komi: 7.5 }`, tenuki confined to the adapter, immutable snapshots, terminal resign, disagreement rebuild from the accepted action history, terminal-aware `score`, and a loop-safe `inspectGroup`; pinned `tenuki@0.3.1` (sha512 matches B-S01); 13-case harness green; PR #83 (`7b65210`), adversarial review r1 CHANGES_REQUESTED -> r2 CHANGES_REQUESTED -> r3 APPROVE | IMPLEMENTED_VERIFIED | None (fixtures/dead-stone flow: B-T04/B-T05) | B | NO_ACTION |
| BL-GR-03 | Pinned Tenuki version + conformance | Spec §27 exact version; §31 superko fixture passes | `tenuki@0.3.1` pinned by tarball sha512 + package sha1; conformance gate 6/6 PASS (explicit `scoring:"area"`, `koRule:"positional-superko"`, `komi:7.5`; repetition rejected under positional-superko, accepted under simple ko; defaults `territory`/`simple`/komi 0 proven not relied on); merged PR #61 (`1dbbe2c`), adversarial review r1 CHANGES_REQUESTED -> fix -> r2 APPROVE | VERIFIED_FACT_NOT_INTEGRATED | Adapter (B-T02) and §31 fixtures (B-T05) consume the pin | B (gate) | INTEGRATION_TICKET (predeclared consumer WAVE-B-T02) |
| BL-GR-04 | Chinese area scoring / komi 7.5 / positional superko | Spec §25/§27 | `src/rules/tenuki-adapter-scoring-superko.test.ts`: hand-computed 9x9 endgame (black 45 / white 43.5 / margin 1.5), empty-board komi exactly 7.5, positional-superko rejection with a simple-ko negative control, no production dependence on territory/simple/komi-0 defaults; 10 cases + mutation matrix; PR #92 (`8ae9edf`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None | B | NO_ACTION |
| BL-GR-05 | Captures / suicide / pass / two-pass settlement / dead-stone flow | Spec §25/§31 fixtures | `src/rules/tenuki-adapter-capture-settlement.test.ts`: 16 port-level cases — single/multi captures with exact counters, suicide rejection (single/group) with an accepted self-atari control, pass/two-pass settlement, terminal rejection, dead-stone confirm/disagree, public-boundary purity; 9-mutation matrix; PR #93 (`d55de84`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None | B | NO_ACTION |
| BL-GR-06 | Canonical action log / replay | Spec §28 (R2.4.2) canonical record; actions = play/pass/resign; replay marks terminal on resign; winner/reason derived (opponent / resignation); no Tenuki internals serialized | `src/rules/canonical-record.ts` defines `CanonicalGameRecord`/`GameAction` (play/pass/resign), rejects unknown keys and post-resign actions, and stores no derived truth; `src/rules/replay.ts` replays through `GoRulesPort`, delegates resign (terminal, no board mutation, derived winner/reason), and restores a long sequence field-for-field; 30 cases + mutation matrix; PR #94 (`e3e7b40`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None (crash integration: Wave F) | B | NO_ACTION |
| BL-GR-07 | Deterministic fixtures | Spec §31 (R2.4.2) **eleven cases** incl. resignation terminal / canonical replay restoration | `src/rules/spec31-fixtures.test.ts` covers 11 deterministic cases through `GoRulesPort` only (no Tenuki import, no randomness/clock): single/multi capture, suicide, pass, two-pass settlement, dead stones, disagreement resume, ko + positional superko, area scoring + komi, resignation terminal, canonical replay; two independent runs diff to zero; mutation matrix (resign winner, ko rule, komi, serializer) turns the intended cases red; PR #99 (`f78167d`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None (E-T01 consumes the fixtures) | B | NO_ACTION |

## Go Tools / Strategy

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-GT-01 | DeepSeek sole live strategy owner | Spec §18 no external solver/agent; Spec §20 (R2.4.2) final surface = 8 `go.*` + 2 `companion.*` = 10; Phase A proves the core `go.*` surface (incl. `go.resign`) is the only Go-strategy/action model-facing surface | `src/tools/go-lane-registry.ts` is the structure-only registry: `GO_LANE_REGISTRY.registrationState = 'structure-only'`, empty frozen `registeredPaths`; `GO_LANE_ADMITTED_PATHS` reuses `GO_PRESET.toolPaths`; deterministic policy accepts the exact 8 `go.*` paths and rejects `companion.*`, solver/best-move/win-rate/general-execution and unknown paths; no solver import; PR #87 (`34e7743`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None (actual tool registration/enumeration owned by C-T02/BL-GT-02) | C | NO_ACTION |
| BL-GT-02 | 8 go.* model-facing tools | Spec §20 (R2.4.2): `go.state`, `go.inspect_group`, `go.inspect_region`, `go.try_move`, `go.play`, `go.pass`, `go.resign`, `go.request_deep_think` | `src/tools/go/` implements and registers all eight over `GoRulesPort`; post-registration enumeration is exactly the eight frozen paths; `go.try_move` is observation-only (no mutation/evaluative fields); `go.resign` delegates to `port.resign`, publishes a terminal GameNotice, mutates no board, and further analysis is rejected; budget accounting wired through C-T07; 305 tests; PR #95 (`71ec784`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None (real AgentLoop wiring/GameNotice-to-Bridge: C-T05/F-T03) | C | NO_ACTION |
| BL-GT-03 | 2 companion.* model-facing tools | Spec §20/§14: `companion.affect`, `companion.request_focus` | No tool registration | NOT_IMPLEMENTED | Both tools | C | IMPLEMENTATION_TICKET |

(Total model-facing surface: 8 `go.*` + 2 `companion.*` = 10 tools.)

## Capability / Anti-cheat

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-CAP-01 | Go lane isolated preset | Spec §19/§21 no Code Mode / bash / python / web / subagent / generic MCP / solver | `src/preset/go-preset.ts` declares a frozen native-only preset (presentation `native-only`, 8 forbidden capability kinds, exact 8 `go.*` Phase A tool paths, `GO_TOOL_PATH_PREFIXES = ['go.']`); the Go lane is created with `meta.agentPreset` **and** `setup: composeGoLaneScope`, which binds the guard as the agent-scoped `goCapabilities` service via `Context.provide`; PR #74 (`81979dd`), adversarial review r1-r3 CHANGES_REQUESTED -> r4 APPROVE; 148 tests | IMPLEMENTED_VERIFIED | None (real AgentLoop factory not in the pinned dependency surface; `restrict()` has no implementation, so the claim is the declaration + setup composition, not per-tool execution hooks) | C | NO_ACTION |
| BL-CAP-02 | Execution-time capability guards | Spec §21 | `src/runtime/go-capability-guard.ts`: private WeakMap provenance + `nativeGoCapability` accepts only the exact 8-tool surface; `register`/`execute`/`assertGoCapabilityAllowed`/scope all reject forged, out-of-surface, forbidden-kind and invalid paths; `go.exec` refused at five entry points; `resolveGoCapabilityGuard()` is the single production accessor; PR #74 (`81979dd`), review r4 APPROVE | IMPLEMENTED_VERIFIED | None (per-tool execution hooks await C-T02/C-T05 wiring; Cordis service isolation for multi-agent lifecycles flagged there) | C | NO_ACTION |
| BL-CAP-03 | Anti-cheat tests | Spec §39.3 | `tests/anti-cheat/go-capability-anti-cheat.test.ts`: 19 cases attempt Code Mode/bash/Python/Web/subagent/generic MCP/external solver/general execution from the Go lane; each is rejected at registration and execution with `forbidden-kind` and the sentinel `run()` never fires; forged/cloned/`go.exec` paths rejected; no-hole control keeps the 8 native paths executable; dedicated `anti-cheat-capability-gate.yml`; PR #88 (`b8f65e8`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None (real DSH tool wiring is C-T02) | C | NO_ACTION |

## Budget

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-BUD-01 | GoTurnBudget contract | Spec §22 fields | `src/contracts/budget.ts` defines `GoTurnBudget` with the five Spec §22 fields (all required, no numeric defaults); `src/budget/config.ts` loads only explicit injected values, rejects missing/invalid fields without defaults, and allows a zero cap for counted operations/token caps while `maxModelSteps` requires >= 1; fixture labeled `NON_PRODUCTION_FIXTURE`; 135 tests incl. a delete-a-field typecheck tooth; PR #81 (`796e1be`), adversarial review r1 APPROVE + P2 fixes | IMPLEMENTED_VERIFIED | None | C | NO_ACTION |
| BL-BUD-02 | Per-request / per-turn hard caps + tool accounting + exhaustion | Spec §22.1-22.4 | `src/budget/request-cap.ts` clamps at the C-S01 `agent/request` seam to `min(perRequestMaxTokens, remainingTurnTokens)`; `src/budget/enforcement.ts` owns per-tool accounting (inspect/try_move/deep-think/model), turn token accumulation, and exhaustion gates on all four `begin*` operations; PR #85 (`3197f1c`), adversarial review r1 APPROVE + P2 fixes -> r2 APPROVE | IMPLEMENTED_VERIFIED | None | C | NO_ACTION |
| BL-BUD-03 | Deep-think boost (bounded) | Spec §23 | `src/budget/enforcement.ts` grants one extra model step for one request, at most once per turn; per-request token cap, `maxTurnTokens`, and `remainingTurnTokens()` untouched, so requests stay clamped and the turn ceiling is unchanged; a second request raises `GoDeepThinkAlreadyRequestedError`; the boost is neither granted nor usable after a committed action or exhaustion; `go.request_deep_think` goes through the shared enforcement (9 new cases + mutation matrix); PR #98 (`40e5a20`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None (C-T10 calibrates §22 numbers) | C | NO_ACTION |
| BL-BUD-04 | Post-move no-analysis-loop rule | Spec §24 (R2.4.2): after committed play / pass / **resign**, the same Go turn must not restart another analysis loop; after resign the game is terminal immediately with no further inspect / try_move / deep-think / model step permitted for that turn | `src/budget/enforcement.ts` records the committed action (incl. resign) and rejects any further analysis/model step in that turn; deterministic sequence tests cover play/pass/resign, with the resign-terminal case explicitly asserted; PR #85 (`3197f1c`), review r1/r2 APPROVE. Follow-up: the tool layer now checks the commit gate before touching the rules port, so a rejected second authoritative action cannot mutate it (PR #104 `1441b24`, review r2 APPROVE) | IMPLEMENTED_VERIFIED | None | C | NO_ACTION |
| BL-BUD-05 | Budget bypass tests | Spec §39.4 | `tests/budget/go-turn-budget-bypass.test.ts` is a 26-case adversarial suite over the real enforcement boundary and the registered `go.*` surface: try_move/inspect/model-step spam, oversized and subsequently raised requests (all clamped), turn-token shrink, aggregated double-invokes, post-commit analysis paths, boost abuse, and the real `go.play` after exhaustion; every attack deterministically hits its exact limit with no bypass found; mutation matrix (try_move gate, request clamp, commit gate) turns it red; dedicated `budget-bypass-gate` CI job; PR #105 (`22e95a2`), review r1 APPROVE | IMPLEMENTED_VERIFIED | None (F-T04 consumes it as gate evidence) | C | NO_ACTION |
| BL-BUD-06 | Automated cognition benchmark / production budget calibration | R2.4.2 §38 automated cognition benchmark — fixture classes: opening, simple capture, escape, local fight, ko, large-group pressure, endgame, ambiguous position. For EACH fixture record: latency, input token usage, output token usage (total token usage if useful), model steps, inspect calls, try_move calls, deep-think requests, illegal attempts, final move, variation across repeated runs. Production GoTurnBudget numeric defaults chosen from real benchmark evidence; do not collapse input/output tokens into one field, large-group pressure into vague "pressure", simple capture into an unrelated category, or drop repeated-run variation | `tests/benchmark/` deterministic harness covers all eight §38 classes × 3 runs over the real C-T02 tools + C-T07 enforcement + C-S01 listener + C-T08 boost; raw scripted record `docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json` + summary are explicitly `scripted-deterministic` / `isDeepSeek: false` / `candidate-not-applied` (PR #103 `15d9fe1`, adversarial review r2 APPROVE). **No real DeepSeek run; no production default switched**. C-T10 free part: benchmark now driven through the real AgentLoop request path (`tests/benchmark/llm-request-path.ts`, `live-provider.ts`, `live-driver.ts`), cost/request gates and fail-closed env selection, scripted record updated; NO paid call made; real DeepSeek calibration pending, production `GoTurnBudget` defaults unchanged; issue #27 stays OPEN (PR #110 `02442a2`, review r1 APPROVE) | NOT_IMPLEMENTED | Real "ask DeepSeek" calibration + production `GoTurnBudget` defaults require owner spend/credential approval; issue #27 stays OPEN | C | IMPLEMENTATION_TICKET |
| BL-BUD-07 | Pinned DSH request-level token hard-cap seam | Spec §22.1 per-request hard cap enforceable on pinned DSH | `docs/validation/DSH_REQUEST_TOKEN_HARD_CAP_SEAM_VERIFIED.md` + the gate (merged PR #45); production integration in `src/budget/request-cap.ts` applies the cap at the verified `agent/request` waterfall and narrows it by the remaining turn budget; PR #85 (`3197f1c`), review r1/r2 APPROVE | IMPLEMENTED_VERIFIED | None | C (gate) | NO_ACTION |

## Companion

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-CMP-01 | CompanionState contract | Spec §13 | `src/contracts/companion.ts` generic `CompanionState<TCompiledPersona, TMoodState>`; `src/companion/state.ts` `CompanionStateHolder` keeps exactly one latest state (latest-wins, no history, no mood reducer); `src/companion/persistence.ts` saves/loads the latest `{version,state}` snapshot with temp-file + rename, no journal; 8 new tests (56 total) + mutation analysis; merged PR #66 (`19cb97f`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None | D | NO_ACTION |
| BL-CMP-02 | Persona / Persona Compiler | Spec §15 | No code (schema intentionally generic) | NOT_IMPLEMENTED | Compiler + schema freeze decision | D | IMPLEMENTATION_TICKET |
| BL-CMP-03 | Mood (bounded deltas, clamp, baseline return) | Spec §14 | No code | NOT_IMPLEMENTED | Reducer | D | IMPLEMENTATION_TICKET |
| BL-CMP-04 | Attention modes (Mofish / Normal / Strict / Manual) | Spec §16 | Only `AttentionMode` type; V4 presents UI only | FOUNDATION_ONLY | Runtime semantics | D | IMPLEMENTATION_TICKET |
| BL-CMP-05 | Self-initiated focus | Spec §5/§6 | No code | NOT_IMPLEMENTED | Trigger + arbitration | D | IMPLEMENTATION_TICKET |

## UI

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-UI-01 | V4 design / prototype reference | Frozen UI/UX reference | `COMPANION_GO_DESIGN_V4.md` + `companion-go-apple-style-v4.html`; boundaries doc fixes komi 7.5 vs 6.5, random AI, fake timing as presentation-only | IMPLEMENTED_VERIFIED | None (reference only, not production) | — | NO_ACTION |
| BL-UI-02 | Production Harness **Core** Go UI | Spec §32/§33 (R2.4.2) core board in Harness Web: 9x9/13x13/19x19, stones, captures, last move, turn, Pass, **Resign (Resign control → GoRulesPort.resign → authoritative terminal state → final-result UI; no UI-only gameOver truth)**, final result, minimal placement/capture animation, minimal stone sound, board click direct route, no transcript fusion, no prototype behavior inheritance | E-T01 partial: dependency-free §32 Core Go UI surface under `src/ui/` with its test matrix; zero new runtime dependency (package.json and pnpm-lock.yaml identical to main); React host mount BLOCKED and documented as blocked in `handoffs/WAVE-E-T01-attempt.md`; issue #38 stays OPEN (PR #111 `5165481`, review r1 APPROVE) | NOT_IMPLEMENTED | React host mount blocked; Core UI surface partial only; board click / resign / sound / view extension remain; issue #38 stays OPEN | E | IMPLEMENTATION_TICKET (blocked by BL-UI-04) |
| BL-UI-03 | Desktop wrapper | Spec §33 compatible desktop second | No code | DEFERRED | Out of V0.1 scope | — | DEFER |
| BL-UI-04 | DSH Web / conversation.view extension seam | Spec §34 capability smoke before depending | `docs/validation/DSH_CONVERSATION_VIEW_SEAM_VERIFIED.md` + `tests/upgrade-gates/conversation-view/conversation-view.spec.tsx` + `.github/workflows/conversation-view-seam-gate.yml` (merged PR #46); verified: plugin-owned Go view registers through `conversation.view`; shipped Chat + Trajectory + Go coexist; view receives current session binding; Work / Go transcripts remain isolated; mini-surface placement seams verified; dual-session single-shell supported; no DSH core patch required | VERIFIED_FACT_NOT_INTEGRATED | Seam verified, not seam unknown; `conversation.view` is a global ring contribution with no per-session tab predicate. Remaining production work is downstream WAVE-E-T01 / E-T02 | E (gate) | INTEGRATION_TICKET |
| BL-UI-05 | Companion mini-surface / projection UX | Spec §33/§35 (R2.4.2): Work View Go status / Go notice UX; Go View WorkSnapshot UX; clean mini-surface placement proven by E-S01; Companion-mode/persona peripheral presentation where applicable; latest-value projections only, no transcript fusion, no prototype rule/AI semantics | No code | NOT_IMPLEMENTED | Companion mini-surface UX (Spec Phase B) | E | IMPLEMENTATION_TICKET |

## Hardening

| Baseline ID | Capability | Spec Target | Current Evidence | Current State | Gap | Wave | Recommended Handling |
|---|---|---|---|---|---|---|---|
| BL-HARD-01 | Crash / resume (dual session + canonical record + CompanionState) | Spec §36 (R2.4.2): restore sessions/canonical record/board/CompanionState/attention mode; **a resigned game remains terminal after restart/replay with same winner and reason = resignation** | `src/persistence/recovery.ts` restores both lane Sessions, the latest CompanionState via the D-T04 loader, attention mode, and the board via F-T02's canonical replay; focus defaults to Work; a resigned game stays terminal with the same winner/reason; missing lanes are an error (no Session recreation); no transaction / no pending-command durability; 12 cases + mutation matrix; PR #100 (`d1a1cc7`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | Production composition wiring remains in F-T03 | F | NO_ACTION |
| BL-HARD-02 | Replay recovery | Spec §28/§36 (R2.4.2): replay play/pass through port; on resign mark terminal without board mutation; derive winner/reason; **resigned game remains terminal after replay** | `src/persistence/replay-recovery.ts` `restoreFromCanonicalRecord` accepts a serialized or parsed record, validates it, replays through `GoRulesPort`, derives resignation winner/reason authoritatively, and rejects a non-terminal post-resign port state; 12 cases (42-action round-trip, resign terminal with unchanged board/moveNumber/captures/lastMove, invalid inputs) + mutation matrix; PR #97 (`f6c210f`), adversarial review r1 APPROVE | IMPLEMENTED_VERIFIED | None | F | NO_ACTION |
| BL-HARD-03 | End-to-end integration (work → go → work continuity) | Spec §40 | No code | NOT_IMPLEMENTED | Full continuity validation | F | IMPLEMENTATION_TICKET |
| BL-HARD-04 | Post-game analysis boundary | Spec §37 | No code; AGENTS frozen constraint | DEFERRED | Separate future scope | — | DEFER |
| BL-HARD-05 | Spec Phase A core exit / viability gate | Evidence gate proving the core technical vertical slice is sound enough to allow Companion Layer (Phase B) execution; §40 core correctness counters + context isolation + cognition exclusivity + anti-cheat + budget bypass + §38 benchmark-derived budget + core Go UI + work→go→work continuity + DSH Phase A smoke gates + small number of complete human games / UX validation | No gate exists | NOT_IMPLEMENTED | Phase A exit gate (evidence/acceptance, not a new subsystem) | F | INTEGRATION_TICKET |
| BL-HARD-06 | Full V0.1 acceptance after Companion Layer | R2.4.2 Spec §40 complete: Correctness, Context Isolation, Continuity, Cognition Exclusivity, Anti-Cheat, Budget, Persona Continuity, Subjective UX | No code | NOT_IMPLEMENTED | Full V0.1 acceptance owner (Phase B) | F | INTEGRATION_TICKET |

Installation / upgrade validation is covered by BL-PKG-05 (verified), BL-PKG-06 (verified negative fact, activation blocked on install-time build), BL-PKG-09 (upgrade gate).

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
- frozen core contracts (BL-RT-03, BL-CMP-04) — type-level tests
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
- `AttentionMode` (BL-CMP-04)

# VERIFIED FACT — NOT INTEGRATED

github-source install (BL-PKG-06):

```text
Feasibility:          VERIFIED NEGATIVE (pinned DSH b150a551, PR #79 merged 161eb5c)
Resolution/clone/install/bundle: PASS
Activation:           FAIL (installed tree has no lib/; mount ERR_MODULE_NOT_FOUND)
Root cause:           no prepare script; lib/ gitignored/untracked; files ships only cordis.patch.yml + lib/**
Fallback:             packed-tarball install (BL-PKG-05, verified)
Follow-up:            SMALL_INFRA_TICKET (install-time build/packaging fix); no new ticket created by the Spike
```

tenuki version / conformance (BL-GR-03):

```text
Feasibility:          VERIFIED (6/6 conformance, pinned tenuki@0.3.1, PR #61 merged 1dbbe2c)
Pin:                  tarball sha512 + internal package.json sha1 asserted by the gate
Explicit config:      scoring area / positional-superko / komi 7.5 (defaults territory/simple/0 proven not relied on)
Consumer:             WAVE-B-T02 TenukiAdapter (predeclared); fixtures WAVE-B-T05
```

DSH Web conversation.view extension seam (BL-UI-04):

```text
Feasibility:          VERIFIED (pinned DSH conversation-view seam gate PASS, merged PR #46)
Capability:           plugin-owned Go view registers through conversation.view; shipped Chat + Trajectory + Go coexist; view receives current session binding; Work / Go transcripts remain isolated; mini-surface placement seams verified; dual-session single-shell supported; no DSH core patch
Known limitation:     conversation.view is a global ring contribution; no per-session tab predicate
Production integration: VERIFIED_FACT_NOT_INTEGRATED
```

Future work may create only `INTEGRATION_TICKET`s for these seams. No new
feasibility Spike.

# REAL UNKNOWNS — SPIKE CANDIDATES

| Baseline ID | Unknown | Why not directly implement | Dependent decision | Why current evidence is insufficient |
|---|---|---|---|---|
| BL-PKG-06 | GitHub source install (`dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi`) | `github:` spec resolution/clone/build/activate path is unverified | Installation docs, Wave F installation acceptance | Smoke covers local tarball only; no `github:` path code or CI evidence |
| BL-GR-03 | Tenuki version satisfying area + positional-superko + komi 7.5 explicit config, passing §31 fixture | Spec §27 forbids defaults, silent downgrade, dual rules authority | GoRulesPort / TenukiAdapter version pin and implementation | No Tenuki dependency, no fixtures, no candidate evaluation record |

Not spikes: cooperative-yield feasibility (verified), V4 style exploration
(frozen), crash/resume mechanism (conservative V0.1 strategy, implementation
task). Production budget numeric values are owned by BL-BUD-06
(IMPLEMENTATION_TICKET, benchmark-derived calibration) — they are a calibration
task, not a Spike.
