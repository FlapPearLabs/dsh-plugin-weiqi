# DeepSeek Harness Companion Go — Lean V0.1 R2 Product & Architecture Spec

**Status:** ARCHITECTURE FROZEN — R2.4.2 / COOPERATIVE_YIELD_VERIFIED / READY FOR BUILD PHASE A  
**Version:** R2.4.2 (adds the DeepSeek resign action path — `go.resign` model tool — over R2.4.1; R2.4.1 remains historical evidence)  
**Target:** DeepSeek Harness Web first; compatible desktop wrappers second  
**Primary reference:** DSH game-integration pattern exemplified by `shinjiyu/holdem`  
**Go rules authority:** Tenuki behind an internal adapter  
**Design principle:** minimal correct architecture; only add complexity proven necessary by concrete failure modes

---

# 0. Why R2 Exists

R2 keeps the Lean V0.1 architecture as the implementation baseline.

It does **not** return to the Original Full design.

Three independent external reviews broadly agreed that Lean is the correct direction. However, adversarial review found two real architecture gaps:

1. **Cross-lane status is not the same thing as cross-lane user intent.**  
   A latest-value WorkSnapshot cannot carry a command such as:
   > “回去把剩下两个测试修掉。”

2. **`agent/pre-step reject` is not a queue.**  
   It must not be used as the mechanism that "holds" a user message until the inactive lane becomes active.

R2 adds the smallest mechanisms required to fix those failures and also folds in several factual implementation clarifications discovered during review:

- explicit pending focus / handoff state;
- Runtime as the only cross-lane wake authority;
- minimal factual game deltas for attention decisions;
- explicit Tenuki rule configuration;
- Go preset isolation from Code Mode / subagents / generic tools;
- per-request hard token/reasoning caps;
- a small `lastResult` work field;
- Phase A smoke tests for DSH assumptions that remain version-sensitive.

R2 still rejects speculative infrastructure such as:

- focus leases / epochs;
- generalized event buses;
- exactly-once delivery;
- Companion event sourcing;
- transactional focus recovery;
- second-engine oracle in V0.1;
- generic multi-Harness abstractions.

---

# 1. Executive Summary

Companion Go is not a strong Go bot and is not a Go website attached to a coding agent.

It places DeepSeek inside a deterministic Go world while preserving DeepSeek as the sole strategic decision-maker. The same user-visible DeepSeek can continue normal Harness work, maintain an ongoing Go game, switch attention between the two, chat, teach, react emotionally, make bounded judgment mistakes, and later return to work without contaminating work context with a long game transcript.

The core design is:

> **One Companion Identity / Two Isolated Sessions / One Active Cognition Lane / Tiny Cross-Lane Projections + Explicit Handoff**

The system must guarantee:

1. Go rules and board state never depend on LLM memory.
2. DeepSeek receives no external Go strategy during live play.
3. DeepSeek cannot reason or simulate without bound.
4. Work history and Go history stay isolated.
5. Only one lane performs foreground LLM cognition at a time.
6. The user still experiences one continuous Companion identity.
7. Cross-domain awareness uses tiny factual projections, not transcript synchronization.
8. Cross-domain **commands** are explicitly handed to the target lane rather than inferred from status snapshots.

Core philosophy:

> **Deterministic world. Bounded cognition. Stable identity. Variable attention.**

---

# 2. Product Objective

Desired experience:

- DeepSeek is working in Harness.
- A test/build/search may be running.
- The user makes a Go move on the graphical board.
- Depending on attention mode and current state, DeepSeek may ignore it for now, notice it at the next safe point, or briefly switch to Go.
- DeepSeek sees the real board state, reasons within a bounded budget, and uses a tool to place a real stone.
- Captures, turn state, ko and legality are resolved by the Go engine.
- DeepSeek may comment, teach, tease, misread a fight, or make a strategic mistake.
- It can return to the Work Session and continue from the prior work context without carrying the Go transcript into work history.
- If the user gives an operational command in the "other" view, that exact command reaches the target lane.

Desired errors:

- strategic mistakes;
- reading mistakes;
- judgment mistakes;
- overconfidence;
- missed opportunities.

Forbidden errors:

- forgotten captures;
- illegal moves accepted;
- incorrect turn state;
- hallucinated stones;
- broken ko/superko;
- work context polluted by the entire Go game;
- user cross-lane commands silently lost;
- two independent foreground DeepSeek thought streams.

Therefore:

> **Rule/state/routing errors should approach zero.  
> Judgment errors are allowed and desirable.**

---

# 3. Non-Goals

V0.1 does not attempt to:

- maximize Go strength;
- compete with KataGo / Leela / AlphaGo;
- provide win rates, best moves or ranked candidates during live play;
- support unlimited reasoning or unlimited `try_move`;
- guarantee deterministic token-level replay;
- expose a large persona parameter panel;
- build native desktop or TUI interfaces before Web works;
- build multiplayer;
- solve every rare Go UX edge case in advance;
- commercialize the project;
- parse hidden chain-of-thought as application state;
- build generalized cross-session messaging infrastructure.

---

# 4. Core Architecture

```text
                    Companion Identity
                  Persona / Mood / Mode
                           │
              ┌────────────┴────────────┐
              │                         │
        Work Session                Go Session
        Work Agent Lane             Go Agent Lane
              │                         │
              └──────── active_lane ────┘
                           │
                    DeepSeek model
```

There is one user-visible Companion identity.

Internally there are two isolated DSH Sessions:

- **Work Session:** work conversation, tools, job results, coding context.
- **Go Session:** Go conversation, board interactions, Go tools, game-local reasoning.

Raw histories are never synchronized.

---

# 5. Runtime Control State

V0.1 Runtime maintains only the state required for safe lane switching.

The R2 split between `pendingFocusRequest` and `pendingLaneInput` is replaced by **one atomic pending focus intent** so target, origin and optional handoff source cannot diverge.

```ts
type Lane = "work" | "go"

type PendingFocusIntent = {
  target: Lane
  origin: "user_command" | "self_initiated"
  sourceMessage?: {
    sourceSessionId: string
    message: UserMessage
  }
}

type RuntimeFocusState = {
  activeLane: Lane
  llmRunning: boolean
  pendingFocus?: PendingFocusIntent
  pausedLane?: Lane
}
```

`pendingFocus` is **not** a general event mailbox. It represents only the next desired focus transition.

`sourceMessage.message` is the already-created, identified, immutable DSH `UserMessage` value. Runtime does not late-dereference the text from a compacted model surface and does not maintain a second `capturedText` copy.

This is intentionally aligned with current DSH message semantics: the same immutable identified message representation is used across inbox admission, durable `user/message` storage and model-facing history.

`pausedLane` is only set when Runtime deliberately yields an in-progress multi-step lane at a safe continuation boundary. It is not a queue and can name at most one lane in this two-lane V0.1 design.

## Arbitration

Use one explicit precedence rule:

> `user_command` > `self_initiated`

Therefore:

- a pending `user_command` may never be overwritten by a later `self_initiated` request;
- a `user_command` may replace a pending `self_initiated` request;
- a newer `self_initiated` request may replace an older `self_initiated` request;
- direct user inputs themselves must never be silently discarded merely because focus arbitration chose another lane first.

If Phase A proves that multiple unconsumed cross-lane user commands can legitimately accumulate before one handoff, upgrade only the user-command storage to a tiny FIFO. Do not introduce a generalized event bus.

---

# 6. Single Active Cognition Lane

Hard invariant:

> **At most one paired lane may perform foreground LLM cognition at a time.**

Background jobs may continue.

Example:

```text
Work starts pytest in background
        ↓
Go becomes active
DeepSeek thinks and plays one move
        ↓
pytest keeps running
        ↓
Go turn ends
Work becomes active again
```

A lane does not directly command or wake the other lane.

It may request:

```text
companion.request_focus("work" | "go")
```

The Runtime is the **only** component allowed to perform cross-lane wake/steer.

---

# 7. Wake / Admission Protocol

This is a correctness boundary.

## 7.1 Normal path

If a focus request targets the inactive lane:

1. construct one `PendingFocusIntent`;
2. arbitrate it against the existing `pendingFocus` using §5 precedence;
3. preserve any referenced user source message as the exact immutable `UserMessage`; never replace it with an LLM-generated summary;
4. do **not** wake the inactive Agent yet;
5. allow the active lane to reach the next safe **DSH step boundary**;
6. yield or naturally settle the active lane as defined below;
7. switch `activeLane`;
8. when the winning intent contains a cross-lane source message, deliver its exact content blocks into the target lane with explicit Companion-handoff provenance; when the message was created directly for an inactive target View, admit that already-created immutable message without first requiring the target Agent to run;
9. wake the target Agent;
10. clear the consumed `pendingFocus`.

Runtime is the only cross-lane wake/admission authority.

An inactive lane cannot originate a model-authored `self_initiated` focus request because it is not allowed to perform foreground cognition. Direct UI/user activity may still create a higher-priority user-origin focus intent.

### 7.1.1 Exact Safe-Boundary Definition

For V0.1:

> **A safe cognition handoff boundary is between DSH steps: the current step has fully committed `step/end`, including all tool results requested by that model response, and the next model request has not started.**

A DSH **step** is:

```text
one model request
    +
all tool executions requested by that response
```

Therefore:

- do **not** switch between individual tool calls belonging to the same step;
- do **not** wait for the entire multi-step turn to finish if another step would otherwise start;
- do **not** abort an already-running model request or already-started tool execution merely to service an ordinary Companion focus switch.

This makes focus latency bounded by **the current step**, not by the whole turn.

V0.1 does not promise a hard wall-clock bound for one pathological long-running tool call. Long operations should use Harness background jobs or existing tool timeouts. If Phase A proves single-step latency itself is unacceptable, that is evidence for a narrower timeout/pause mechanism; do not invent one pre-emptively.

### 7.1.2 DSH Continuation-Yield Guard

Current DSH runs `agent/pre-step` before every proposed request step, but it claims the proposed inbox batch **before** the hook fires. A plain `PreStepDecision.reject` therefore discards the already-claimed batch unless Companion explicitly restores it.

Consequently:

> **Companion must never implement focus switching as “if pendingFocus then pre-step reject”.**

The cooperative-yield seam has now been executable-verified against pinned DSH commit:

```text
b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

with:

```text
DSH packages: 0.1.1-rc.2
Node: 24.11.1
pnpm: 11.7.0
Vitest: 4.1.8
```

#### Verified inbox restoration primitive

For this pinned DSH implementation, `Inbox` mutations are synchronous.

Batch restore must use:

```ts
agent.inbox.splice(
  "next-step",
  0,
  0,
  payload.messages
)
```

inside the `agent/pre-step` listener before returning the final decision.

Do not use:

```ts
await agent.inbox.prepend(...)
```

because current `Inbox.prepend/splice` are synchronous APIs, and `prepend` accepts one `UserMessage`, not a batch.

The verified `splice` behavior preserves:

1. the complete claimed batch;
2. relative order inside `payload.messages`;
3. placement of the restored claimed batch before messages that arrived after the original claim.

#### Verified minimal cooperative-yield sequence

For pinned DSH `b150a551...`, the preferred V0.1 sequence is:

1. a focus intent becomes pending while the active lane is running;
2. the current DSH step is allowed to finish completely;
3. if the turn naturally settles and the Agent becomes idle, switch from the idle boundary;
4. if DSH proposes another continuation step, Companion intercepts the next `agent/pre-step`;
5. synchronously restore any already-claimed continuation batch:

   ```ts
   agent.inbox.splice("next-step", 0, 0, payload.messages)
   ```

6. return:

   ```ts
   { kind: "reject" }
   ```

   without calling `next()`;

7. on the verified pinned commit, the turn settles as:

   ```text
   turn/end: blocked
   -> idle
   ```

   while the restored inbox remains pending;

8. `await agent.whenIdle()`;
9. set `pausedLane = <yielded lane>`;
10. switch to and wake the winning target lane.

When focus later returns to `pausedLane`:

- if a real user command already wakes that lane, use it;
- otherwise Runtime sends one tiny plugin-sourced `companion-resume` steering message;
- clear `pausedLane` once resume is admitted.

#### `cancel(..., { keepInbox: true })` status

The originally proposed sequence:

```text
splice -> cancel(keepInbox:true) -> reject
```

also passed the executable spike.

However, the negative control proved that on pinned DSH `b150a551...`:

```text
splice -> reject
```

already converges to:

```text
blocked -> idle
```

without same-lane automatic restart.

Therefore:

> **`cancel(..., { keepInbox: true })` is not required for the preferred V0.1 cooperative-yield path on the pinned commit.**

Do not retain unnecessary cancellation in product code merely because it was part of the earlier hypothesis.

The deferred-cancel control likewise produced `blocked -> idle` before the deferred cancel fired, so it provided no additional protection on this commit.

#### Upgrade rule

This behavior is **commit-sensitive**.

Any DSH upgrade must rerun the cooperative-yield fixture before relying on:

- claim-before-pre-step behavior;
- `Inbox.splice` restoration;
- reject -> blocked -> idle convergence;
- absence of same-driver automatic restart;
- resume ordering.

If the behavior changes, update only this seam before adopting the new DSH version.

No generalized pause stack, mailbox, lease or transaction protocol is introduced.

## 7.2 User Input Arriving on an Inactive Lane

User-origin activity does **not** require the inactive lane's Agent to already be running.

If the user sends a natural-language message from the View bound to the currently inactive lane, the UI/Runtime layer must directly create:

```ts
{
  target: <inactive lane>,
  origin: "user_command",
  sourceMessage: {
    sourceSessionId,
    message: userMessage
  }
}
```

and submit it to the §5 arbitration / §7.1 admission path.

The inactive Agent is **not** responsible for first reading the message and deciding to request focus. The arrival of a direct user message on that lane is itself sufficient evidence of user intent to wake that lane.

This rule is required for `Manual` mode, where autonomous focus switching is disabled by definition.

### Direct Board Actions Are Different

A direct deterministic game action is not a natural-language focus request.

Example:

```text
User clicks an empty Go intersection
    -> GoRulesPort.play(...)
    -> authoritative game state updates
    -> GameNotice changes
```

This path does **not** require Go foreground cognition and does not automatically create a focus request.

After the move, Attention Mode and current Companion state decide whether DeepSeek should be woken to inspect/respond.

Therefore:

> **Natural-language command on inactive View -> user-origin focus intent.**  
> **Deterministic board action -> GoRulesPort directly, then GameNotice.**

Do not route natural-language commands through the rules engine, and do not force every board click to switch foreground cognition.

## 7.3 `agent.inject()`

May be used for passive factual context that should be visible on the target lane's next admitted step.

It must not be treated as a wake mechanism.

## 7.4 `agent/pre-step`

It has two narrow Companion uses:

1. **hard invariant guard** — an inactive lane must never be admitted into foreground cognition;
2. **continuation-yield guard** — §7.1.2 may stop the active lane before its next model request, but only after explicitly restoring any batch DSH already claimed.

It must **not** be treated as a queue.

If an inactive lane reaches `agent/pre-step` with a real user message, that is a routing/admission bug. Runtime must preserve/re-route the source input before closing the attempt.

R2.3 explicitly rejects both incorrect assumptions:

> `pre-step reject` does not mean "leave the message waiting in the inbox."

and:

> `agent/pre-step` is not a hook after every individual tool call; it is the gate before a proposed DSH request step.

## 7.5 No distributed locking

V0.1 does not use:

- focus epoch;
- focus lease;
- stale-owner recovery protocol.

This is a single local plugin process.

Crash recovery defaults to Work focus.

---

# 8. Explicit Cross-Lane Handoff

Status projections and operational intent are different categories.

## 8.1 Status

Answered from tiny latest-value projections.

## 8.2 Operational intent

Transferred explicitly.

Example from Go View:

> “回去把剩下两个测试修掉。”

The Go Lane does not summarize this into a new instruction.

It requests Work focus and asks Runtime to forward the current source user message.

Conceptually:

```text
Go Session user message
        ↓
request_focus(work, forwardSourceMessage=true)
        ↓
Runtime stores sourceMessageId
        ↓
safe boundary
        ↓
Work Session receives sourced user/message:
“回去把剩下两个测试修掉。”
```

This preserves the user's actual wording and intent.

Likewise:

> Work View: “去下一手。”

may be forwarded into Go Session when Go focus is acquired.

---

# 9. Tiny Cross-Lane Bridge

The Bridge remains latest-value, not event-stream based.

```ts
type CompanionBridge = {
  latestWorkSnapshot?: WorkSnapshot
  latestGameNotice?: GameNotice
}
```

Bridge context is for **awareness**, not operational command delivery.

## 9.1 DSH-native delivery

Prefer agent-scoped DSH dynamic runtime context (`ctx.systemPrompt.context`) for these latest-value projections rather than hand-building a custom per-step event queue.

The providers are evaluated for each eligible prompt assembly and DSH only materializes a new runtime-context snapshot when the rendered current snapshot has changed.

### Runtime-owned latest values

`latestWorkSnapshot` and `latestGameNotice` are **already-computed Runtime values**.

They are updated once when their source facts change.

The `ctx.systemPrompt.context` provider must only read and render the current small object. It must **not**:

- rescan Session history;
- replay the Go action log;
- recompute board groups;
- rebuild Work state from tool history on every prompt assembly.

Provider read complexity should therefore be effectively O(1) with respect to conversation/game history.

Conceptually:

```text
Work Agent runtime context:
  read latestGameNotice

Go Agent runtime context:
  read latestWorkSnapshot
```

### No evaluation-only model wakes

R2.3 removes a wasteful ambiguity from R2.1/R2.2:

> **A Bridge change alone must not launch a new model request whose sole purpose is “decide whether I should switch lanes”.**

Therefore:

- while the active Agent is already running, the next natural eligible request sees the latest Bridge snapshot and DeepSeek may call `companion.request_focus(...)` from that normal cognition;
- if the active Agent is idle, Runtime applies the already-selected Attention Mode and objective state directly; it does not first wake another model turn merely to ask whether to wake;
- `Manual` never auto-switches from Bridge change;
- `Strict` does not create evaluation-only wakes; idle handling may only use the strict mode's already-defined objective allowance;
- `Normal` and `Mofish` may schedule a Go focus intent from objective state such as `GameNotice.toPlay === "deepseek"` and current Work idleness/background-job state, using the existing single `pendingFocus`;
- multiple Bridge changes before the next natural request/focus admission simply coalesce into the latest value.

Because V0.1 has **no Bridge-only evaluation wake**, it also needs no arbitrary wake-cooldown timer.

`agent.inject()` may still be used for one-shot sourced context when a concrete implementation seam requires it, but do not blindly inject the same snapshot every step. Unchanged Bridge state must add no repeated prompt material.


---

# 10. WorkSnapshot

Keep it small:

```ts
type WorkSnapshot = {
  summary: string
  runningJobs: string[]
  blockers: string[]
  lastResult?: string
}
```

Example:

```yaml
summary: "hash normalization changed; validating again"
runningJobs:
  - "pytest"
blockers: []
lastResult: "previous pytest: 2 failed"
```

Requirements:

- grounded in actual Harness/session/tool/job facts;
- no invented progress percentages;
- `lastResult` preserves the latest meaningful terminal result when a new background run begins;
- deep work details require Work focus.

Do not evolve WorkSnapshot into a second Work state model.

---

# 11. GameNotice

Work must have enough objective information for DeepSeek to make a **human-like attention decision**, but the engine must not assign strategic importance.

```ts
type GameNotice = {
  gameId: string
  lastMove?: string
  moveNumber: number
  toPlay: "user" | "deepseek"
  captures: number
  status: "playing" | "over"
  affectedGroups?: AffectedGroupDelta[]
}
```

Where:

```ts
type AffectedGroupDelta = {
  owner: "user" | "deepseek"
  stones: number
  libertiesBefore: number
  libertiesAfter: number
}
```

Rules:

- only report groups directly affected by the most recent move;
- report objective state only;
- no ranking;
- no danger labels;
- no "critical";
- no recommended response;
- no win rate;
- no hidden salience score.

Allowed:

```text
DeepSeek group:
12 stones
liberties 3 -> 1
```

Forbidden:

```text
CRITICAL DRAGON
URGENT
BEST MOVE N10
```

The system tells DeepSeek **what changed**.

DeepSeek decides **whether it matters**.

---

# 12. No Recursive Projection

Bridge-generated context never becomes a source for another Bridge projection.

Only native Work facts generate WorkSnapshot.

Only authoritative game facts generate GameNotice.

Cross-lane handoff messages are also not re-forwarded automatically.

---

# 13. Shared CompanionState

Both lanes read one small authoritative state:

```ts
type CompanionState = {
  persona: CompiledPersona
  mood: MoodState
  attentionMode: "mofish" | "normal" | "strict" | "manual"
  variationSeed: string
}
```

V0.1 does not require:

- append-only Companion journal;
- event-sourced mood history;
- cross-lane persona synchronization.

Persist only the latest authoritative CompanionState using the simplest reliable plugin persistence available.

---

# 14. Mood

Mood comes from DeepSeek's own interpretation.

Do not hard-code:

```text
test failed => frustration + 0.1
large capture => anger + 0.3
```

Do not parse hidden reasoning.

DeepSeek may explicitly call:

```text
companion.affect({
  frustration: "+small",
  confidence: "-small"
})
```

V0.1 reducer:

- bounded small deltas only;
- clamp;
- slow return toward persona baseline;
- stable persona cannot be overwritten.

Mood may slightly affect:

- risk preference;
- willingness to request deeper thought;
- conversational expression;
- attention switching;
- resignation tendency.

Mood must not radically alter competence or identity.

No `lastSelfReport` field is required in R2. Add it only if real UX testing shows repeated continuity failures.

---

# 15. Persona

Primary user inputs:

1. plain-language description;
2. representative dialogue samples / famous lines / style examples.

A Persona Compiler produces an internal profile.

Example:

> 嘴硬、竞争心强、有点暴躁，但工作汇报很靠谱；下棋时吐槽更多。

Persona affects:

- expression;
- mild behavioral tendencies;
- attention style;
- mood baseline.

Persona does not alter factual Work state.

---

# 16. Attention Modes

No task taxonomy.

No numeric importance table.

Runtime only controls how readily Go facts enter DeepSeek's attention.

DeepSeek decides significance.

## Mofish

- actively accepts micro-break opportunities;
- may check Go between ordinary work steps;
- may temporarily switch even without a long wait;
- cannot interrupt unsafe in-flight execution.

## Normal

- Work remains primary;
- waits such as tests/builds/search/background jobs are natural Go opportunities;
- may switch at another safe boundary if DeepSeek personally judges the position important.

## Strict

- strongly preserves Work continuity;
- Go usually waits;
- GameNotice remains available;
- DeepSeek may switch when genuinely idle or when it independently judges the board change important.

## Manual

- no autonomous Go focus switch;
- UI may show GameNotice;
- user explicitly requests Go handling;
- a user message sent from the inactive Go View directly creates a `user_command` focus intent at the UI/Runtime layer; it does not wait for Go Agent cognition to exist first.

---

# 17. User Message Routing

Default routing follows current view:

```text
Work View -> Work Session
Go View   -> Go Session
```

Cross-domain **status questions** use projections.

Example in Go View:

> 测试怎么样了？

Answer from WorkSnapshot.

No focus switch.

Cross-domain **operational commands** use explicit handoff.

Example:

> 那你回去把剩下两个测试修掉。

Forward the source user message to Work Session at focus handoff.

If the user sends a message directly from the currently inactive lane's View, UI/Runtime creates the `user_command` focus intent immediately; no already-running Agent is required.

Direct deterministic board interaction remains separate:

```text
board click -> GoRulesPort -> GameNotice
```

It does not automatically become a natural-language handoff.

No separate LLM router is required.

---

# 18. Go Strategic Ownership

During live play:

> **DeepSeek is the sole strategic policy owner.**

Forbidden:

- KataGo;
- Leela;
- GNU Go;
- MCTS;
- best-move tools;
- win rate;
- score-lead recommendation;
- Web search for current position;
- spawning another Agent to solve;
- Python/JS search scripts;
- Bash-launched Go engines;
- generic MCP solvers.

The deterministic rules engine may provide only objective state and requested deterministic consequences.

---

# 19. Go Agent Preset / Capability Isolation

Go must not inherit general Work capabilities accidentally.

The Go Agent preset should start from an isolated capability realm.

Required principles:

```text
presentation: native-only
no Code Mode
no subagent
no bash
no web
no python
no generic MCP
no external solver
```

Do not assume that hiding tools from the prompt is sufficient.

Execution authority must enforce the same boundary.

A forbidden capability accidentally registered or aliased into Go Scope must still fail at execution.

---

# 20. Go Lane Tool Surface

Candidate V0.1 model-facing tools (R2.4.2: `go.resign` added so DeepSeek can terminate the game through the authoritative port):

```text
go.state
go.inspect_group
go.inspect_region
go.try_move
go.play
go.pass
go.resign
go.request_deep_think

companion.affect
companion.request_focus
```

Total model-facing surface (R2.4.2): 8 `go.*` + 2 `companion.*` = 10 tools.

`go.resign` invokes the authoritative terminal mutation:

```text
go.resign
-> GoRulesPort.resign
-> authoritative terminal state (opponent wins by resignation)
-> GameNotice update
```

It must not perform board-rule calculation or board mutation, and must not
introduce a second rules authority or a UI-only game-over truth.

`go.try_move` may return:

```text
legal
captures
resulting local liberties
```

It must not return:

```text
good
bad
recommended
win rate
score improvement
```

---

# 21. Anti-Cheat Enforcement

Go Lane must satisfy:

> **Cannot see + cannot execute.**

Use:

1. isolated Go preset/tool scope;
2. execution-time guard / pre-execution policy;
3. no Code Mode transport;
4. no subagent capability;
5. no generic external execution tools.

Budget accounting occurs at the **actual underlying Go tool execution**, not only at outer model-step level.

This prevents aggregated or indirect calling paths from bypassing limits.

---

# 22. GoTurnBudget

Each DeepSeek Go turn owns:

```ts
type GoTurnBudget = {
  maxModelSteps: number
  maxInspectCalls: number
  maxTryMoves: number
  perRequestMaxTokens: number
  maxTurnTokens: number
}
```

Exact numeric values are not frozen.

They come from benchmark.

## 22.1 Per-request hard cap

Every Go model request must be created with a hard request-level token/reasoning cap.

A single long reasoning request must not be able to consume an unbounded turn before counters are updated.

## 22.2 Turn-level cap

Runtime tracks remaining turn budget.

New model steps are denied once the turn-level limit is exhausted.

## 22.3 Tool accounting

Every actual:

```text
go.inspect_*
go.try_move
```

execution consumes budget.

No outer wrapper may hide multiple calls from accounting.

## 22.4 Budget exhaustion

When exhausted:

> DeepSeek must choose using current information.

No additional inspect/try/model step.

---

# 23. Deep Think

DeepSeek may request:

```text
go.request_deep_think()
```

The user may say:

> 这手认真想一下。

This grants one bounded temporary boost.

Rules:

- no unlimited mode;
- boost cannot exceed absolute per-request hard cap;
- boost cannot remove the overall turn ceiling.

---

# 24. Go Turn Lifecycle

Conceptually:

```text
OBSERVE / THINK
       ↓
ACTION
       ↓
SHORT AFTERTALK
       ↓
TURN END
```

A successful action must eventually be:

```text
go.play(...)
```

or:

```text
go.pass()
```

Once the move has been committed, the same turn must not restart another analysis loop.

---

# 25. Go Rules

V0.1 defaults:

```text
Chinese-style area scoring
Komi: 7.5
Positional superko
No user-facing undo
Two consecutive passes -> settlement
Dead-stone confirmation -> final score
Disagreement -> resume play
```

Terminal rule (R2.4.1 approved clarification):

```text
Resignation immediately ends the game.
The opponent wins by resignation.
Resignation does not require a board-rule calculation or board mutation.
```

The following are unchanged from R2.4 and remain frozen: Chinese area scoring,
komi 7.5, positional superko, two-pass settlement, dead-stone flow.

---

# 26. Go Rules Engine Boundary

Tenuki is the V0.1 authoritative rules engine.

Application code must not depend directly on Tenuki APIs.

```ts
interface GoRulesPort {
  createGame(...): GameState
  play(...): MoveResult
  pass(...): MoveResult
  resign(...): ResignResult
  getState(...): GameState
  inspectGroup(...): GroupInfo
  score(...): ScoreResult
  settle(...): SettlementResult
}
```

Implementation:

```text
TenukiAdapter implements GoRulesPort
```

Authority split (R2.4.1 approved clarification):

```text
GoRulesPort = sole application-facing authoritative game-mutation boundary.
Tenuki      = sole authoritative board-rules engine behind that boundary.
resign      = Companion Go terminal action handled at the port boundary;
              it does not create a second board-rules authority.
```

`resign` is a terminal game action handled by Companion Go / the GoRulesPort
wrapper. It does NOT require Tenuki to calculate or mutate board-rule state.
No `GameLifecycleController`, second rules engine, event bus, journal, or
duplicate game-truth subsystem is authorized.

---

# 27. Explicit Tenuki Configuration

Never rely on Tenuki defaults.

At game creation, Adapter must explicitly configure:

```text
scoring = area
koRule = positional-superko
komi = 7.5
```

The pinned Tenuki version must be verified by the §31 positional-superko fixture before UI integration proceeds.

Current Tenuki documentation explicitly exposes `koRule: "positional-superko"`; therefore V0.1 must **not** add a second custom superko rules layer pre-emptively. If the pinned implementation fails the contract fixture, stop and resolve the Adapter/version choice rather than silently degrading to simple ko or introducing an unreviewed parallel rules authority.

Pin an exact validated Tenuki version/commit.

No automatic dependency upgrade.

All Tenuki-specific behavior stays inside `TenukiAdapter`.

---

# 28. Canonical Game Persistence

Do not depend on serializing Tenuki private/internal objects.

Persist our own canonical game record:

```ts
type CanonicalGameRecord = {
  boardSize: 9 | 13 | 19
  scoring: "area"
  koRule: "positional-superko"
  komi: 7.5
  actions: GameAction[]
  settlement?: SettlementRecord
}
```

Where actions include:

```text
play
pass
resign
```

Conceptually (R2.4.1 approved clarification):

```ts
type GameAction =
  | PlayAction
  | PassAction
  | { type: "resign"; by: "user" | "deepseek" }
```

Recovery:

```text
create fresh Tenuki game
        ↓
replay canonical play/pass board actions through GoRulesPort/TenukiAdapter
        ↓
on a resign action, mark authoritative game terminal without board mutation
        ↓
derive winner/reason = opponent / resignation
        ↓
verify final authoritative game state
```

This keeps persistence independent from Tenuki internal object layout. Do NOT
serialize Tenuki internals. Do NOT introduce a second mutable result truth if
winner/reason can be derived reliably from canonical/game state; a rendered
result may be a derived projection.

---

# 29. `inspectGroup`

If Tenuki does not expose the exact inspection shape needed by the model, implement a small derived board traversal over the current authoritative board representation.

It may compute:

- connected stones;
- liberties;
- group size.

It must not compute:

- life/death judgment;
- influence;
- territory prediction;
- tactical ranking;
- candidate moves.

It is perception support, not a second strategy engine.

---

# 30. Go Application Layer

Companion Go may implement its own modules inspired by mature Go libraries such as jGoBoard:

```text
GameTree
SGF
Replay
Annotations
BoardPresentation
MoveMetadata
```

Hard invariant:

> **There is exactly one authoritative game state: GoRulesPort/Tenuki.**

Never maintain a second rules authority in parallel.

jGoBoard is an architectural reference, not a second live board authority.

---

# 31. Go Rules Contract Tests

Create engine-independent tests against `GoRulesPort`.

Minimum Phase A fixtures (R2.4.1: eleven cases):

```text
single capture
multi-stone capture
suicide rejection
simple ko transition
positional superko
pass
two-pass ending
area scoring
dead-stone settlement
canonical replay/restoration
resignation terminal / canonical replay restoration
```

Acceptance for the resignation case must prove:

```text
resign immediately makes the game terminal;
opponent wins by resignation;
no subsequent play / pass is accepted;
canonical replay preserves the resigned terminal state;
board state before resignation is not spuriously mutated.
```

These tests must run before building significant Go UI behavior.

A second rules engine is deferred unless real discrepancies justify it.

---

# 32. Real Graphical Board

Coordinates are protocol, not primary UX.

Human action:

```text
click board
-> GoRulesPort.play
-> authoritative state
-> UI update
```

DeepSeek action:

```text
go.play
-> GoRulesPort.play
-> authoritative state
-> UI update
```

DeepSeek resign action (R2.4.2):

```text
go.resign
-> GoRulesPort.resign
-> authoritative terminal state
-> final-result UI
```

Required:

- 9x9 / 13x13 / 19x19;
- real stones;
- automatic captures;
- last-move indication;
- turn indication;
- Pass;
- Resign;
- final result;
- minimal placement/capture animation;
- minimal sound.

Do not parse text such as:

> “I play N10”

as game truth.

Tool action is truth.

Resign control path (R2.4.1 approved clarification):

```text
Resign control
  -> GoRulesPort.resign
  -> authoritative terminal state
  -> final-result UI
```

There is no UI-only `gameOver` truth; the terminal/result state derives from
the authoritative canonical/game state.

---

# 33. UI

## P0

Official DSH Web UI.

Companion Go should feel like a native DSH view.

DSH shell elements follow upstream tokens and interaction conventions.

The Goban may preserve authentic game texture.

## Main Go View

Concept:

```text
        DeepSeek seat / persona
                 │

           graphical Goban

                 │
              user seat

captures / turn / pass / resign / persona / mode
```

Use:

- visible participants;
- shared central object;
- obvious current actor;
- immediate action feedback;
- peripheral controls.

## Work View

Small Go surface:

```text
Opponent moved
Last move: Q10
DeepSeek's turn
[open Go]
```

If a user requests a Go focus change while the current Work step cannot yet yield safely, show a lightweight status such as:

```text
DeepSeek is busy · will check Go after the current step
```

Do not impose a Go-style cognition budget on Work merely to shorten this wait.

A mini-board is optional until a smoke test proves the extension location and UX are clean.

## Go View

Small WorkSnapshot:

```text
Work:
hash normalization changed; validating again
pytest running
last result: 2 failed
no blockers
```

## Desktop

Compatible wrappers that embed official Web UI should inherit the plugin where possible.

No separate desktop UX in V0.1.

## TUI

Deferred.

---

# 34. UI Capability Smoke Gate

DSH is still evolving.

Before depending on a UI seam, Phase A must prove the actual current capability.

Smoke tests must verify:

1. a full Go view can coexist with normal conversation/trajectory views;
2. the active view does not merge Work and Go transcripts;
3. a small Go status surface can be placed in Work UX cleanly;
4. a small Work status surface can be placed in Go UX cleanly;
5. two paired Sessions can be controlled by one Companion shell without accidental transcript fusion.

If a mini-surface extension seam is awkward, simplify the UX before patching core DSH.

---

# 35. Session Display Policy

Work UI shows Work history.

Go UI shows Go history.

No mixed activity timeline by default.

Bridge projections are small sourced context, not normal transcript replication.

Cross-lane operational handoff is explicit and traceable to the original source user message.

---

# 36. Crash / Resume

V0.1 must restore:

- Work Session;
- Go Session;
- canonical game record;
- reconstructed authoritative board;
- CompanionState;
- attention mode.

Focus recovery may be conservative:

> restart into Work focus by default.

Pending transient cross-lane commands are not required to survive a process crash in V0.1 unless implementation cost is trivial and reliable.

Recovery acceptance for resigned games (R2.4.1 approved clarification):

```text
a resigned game remains terminal after restart/replay,
with the same winner and reason = resignation.
```

Do not add transactional focus recovery.

---

# 37. Post-Game Analysis

Live game remains pure DeepSeek.

Optional future flow:

```text
Game ends
-> create separate Analysis Session
-> KataGo may be enabled there
```

Original Go Session remains the evidence of the actual bounded-DeepSeek game.

---

# 38. Automated Cognition Benchmark

Create fixture positions:

```text
opening
simple capture
escape
local fight
ko
large-group pressure
endgame
ambiguous position
```

For each fixture, ask DeepSeek for one move.

Record:

- latency;
- input/output token usage;
- model steps;
- inspect calls;
- try_move calls;
- deep-think requests;
- illegal attempts;
- final move;
- variation across repeated runs.

Use results to select budget values.

Only a small number of complete human games are required for UX validation.

---

# 39. Phase A Architecture Smoke Tests

Before Companion polish, run explicit tests for the assumptions external review identified.

## 39.1 Cross-lane command handoff

Test:

```text
Go View:
“回去把剩下两个测试修掉”
        ↓
Work focus
```

Assert Work Session receives the original user instruction and acts on it.

Symmetric test:

```text
Work View:
“去下一手”
        ↓
Go focus
```

## 39.2 Concurrent wake / admission

While Work is mid-turn:

- trigger Go input;
- assert Go does not enter foreground model cognition;
- assert the user input is not lost;
- at safe boundary, assert Go receives it.

Safe-boundary latency test:

```text
Work synthetic turn = 20+ model/tool steps
after step 3 fully commits -> user requests Go focus
```

Assert:

- step 3's already-started model/tool work is not aborted;
- Work does **not** start step 4's model request;
- handoff occurs at the first continuation boundary after step 3, not after the 20-step turn finishes;
- if DSH had already claimed `payload.messages` for the proposed continuation, the same immutable messages are restored before the Work driver converges to idle;
- after returning to Work, one `companion-resume` wake is sufficient to continue from the durable tool results/restored next-step context;
- no Work user message or tool-produced next-step context disappears.

### Cooperative-yield implementation spike — VERIFIED

This gate has been completed.

Verified environment:

```text
DSH commit:
b150a551b8d465e31e418e1b2eaf5e79bbb7d28e

DSH package version:
0.1.1-rc.2

Node:
24.11.1

pnpm:
11.7.0

Vitest:
4.1.8
```

Observed main-path trace:

```text
step/end 1
-> step/start/request 2
-> step/end 2
-> step/start/request 3
-> step/end 3
-> stage A,B
-> claim A,B for proposed step 4
-> C arrives after claim
-> splice restore => [A,B,C]
-> reject continuation
-> turn/end: blocked
-> idle
-> external companion-resume
-> claim A,B,C,resume
-> turn 2 / step 1
-> completed / idle
```

Verified assertions:

- no step-4 `step/start`;
- no step-4 provider request;
- inbox after yield exactly `[A, B, C]`;
- no duplicate pending `MessageId`;
- no claimed message lost;
- external resume consumed `A -> B -> C -> companion-resume`;
- restored messages were durably represented exactly once.

Negative controls:

```text
A. splice -> reject
   RESULT: blocked -> idle
   inbox remains [A,B,C]
   no automatic same-lane restart

B. splice -> reject -> deferred cancel
   RESULT: blocked -> idle before deferred cancel
   deferred cancel did not provide additional race protection
```

Conclusion:

```text
COOPERATIVE_YIELD_VERIFIED
```

The preferred pinned-commit implementation is therefore the simpler:

```text
splice claimed batch back to next-step
-> reject continuation
-> whenIdle
-> switch lane
-> external resume later
```

`cancel(..., { keepInbox: true })` remains a valid DSH API but is not required by the verified V0.1 seam on this commit.


Then adversarially race:

```text
Work self-initiated request -> Go
+
explicit user-origin request -> Work
```

Assert:

- the user-origin intent wins arbitration;
- its immutable source `UserMessage` is preserved verbatim;
- the self-initiated request cannot overwrite it;
- no direct user input is silently discarded.

Then test the inactive-lane entry path directly:

```text
activeLane = work
attentionMode = manual
user types in Go View:
"去下一手"
```

Assert:

- the Go Agent does not need to be running first;
- UI/Runtime creates `PendingFocusIntent{ target: "go", origin: "user_command" }`;
- the exact immutable source `UserMessage` is preserved;
- Go is admitted at the next safe boundary;
- the message reaches Go Session and wakes Go cognition.

Source-message representation test:

- create a user message for an inactive target lane before that Agent is running;
- store the identified immutable `UserMessage` in `pendingFocus`;
- compact/rewrite the source Session surface before handoff;
- assert handoff still uses the original immutable content blocks and provenance and performs no late surface-text lookup;
- assert there is no second `capturedText` string copy in Runtime state.

Finally test the deterministic board-action path:

```text
activeLane = work
user clicks a legal Go intersection
```

Assert:

- `GoRulesPort.play` executes immediately;
- authoritative game state changes;
- GameNotice updates;
- no natural-language `PendingFocusIntent` is fabricated solely because of the board click.

Do not use `pre-step reject` as the queue.

## 39.3 Anti-cheat capability test

From Go Lane attempt:

```text
bash
web
python
subagent
Code Mode / run_code
generic MCP
external solver
```

All must fail at execution authority.

## 39.4 Budget bypass test

Attempt:

- many `try_move` calls;
- many inspect calls;
- multiple model steps;
- a single oversized reasoning request;
- any aggregated tool path available in current DSH.

Assert hard limits hold.

## 39.5 Tenuki conformance test

Run §31 fixtures against the pinned Adapter.

Do not assume defaults.

## 39.6 Bridge delivery / prompt stability / call-volume smoke

Verify against the current DSH runtime:

- Work Agent receives only the latest rendered GameNotice context;
- Go Agent receives only the latest rendered WorkSnapshot context;
- unchanged snapshots add no repeated runtime-context message;
- provider callbacks only read the already-computed Runtime snapshot and do not rescan Session/game history;
- an idle `Manual` lane is not woken by Bridge change alone;
- 20 rapid GameNotice updates while Work is already running create **zero additional model requests solely for attention evaluation**;
- the next natural Work request sees only the newest relevant snapshot;
- repeated updates before admission coalesce behind the existing single `pendingFocus`;
- a long synthetic sequence of Bridge updates remains bounded enough not to materially degrade Work context quality.

## 39.7 UI integration smoke

Verify §34 against current DSH Web.

---

# 40. Acceptance Tests

## Correctness

```text
accepted illegal moves = 0
state drift = 0
capture errors = 0
lost cross-lane operational commands = 0
```

## Context Isolation

After a long game:

- Work model history must not contain full Go transcript;
- Work history must not contain full board states;
- Go history must not contain raw coding/tool transcript.

## Continuity

```text
work
-> Go turn
-> work
```

must resume the prior work task correctly.

## Cognition Exclusivity

At most one paired lane owns active foreground model cognition.

## Anti-Cheat

Forbidden capabilities fail at execution authority.

## Budget

Per-request and per-turn hard limits cannot be bypassed through extra steps or tool aggregation.

## Persona Continuity

Same profile remains recognizable without mechanical repetition.

## Subjective UX

Ask:

- Does this feel like the same DeepSeek?
- Does DeepSeek feel like it actually placed a stone?
- Do mistakes feel like bounded judgment mistakes rather than broken state?
- Does returning to Work feel clean?
- Do Mofish / Normal / Strict / Manual feel meaningfully different?
- Does Strict occasionally react to objectively important board changes without a hand-authored "importance score"?

---

# 41. Implementation Phases

## Phase A — Minimal Technical Vertical Slice

Build only:

```text
Work Session + Go Session
Runtime single wake/admission owner
active lane + pending focus/handoff
tiny WorkSnapshot/GameNotice bridge
cross-lane source-message handoff
TenukiAdapter + GoRulesPort
explicit Tenuki rule config
canonical move-log persistence
real Go board UI
isolated native-only Go preset
anti-cheat execution guards
GoTurnBudget
fixture benchmark
work -> Go -> work continuity
DSH capability smoke gates
```

Persona may initially be minimal.

**Gate:**

If bounded DeepSeek Go is not enjoyable, anti-cheat/budget cannot be enforced, or Work context isolation fails:

> stop and fix the core before adding Companion polish.

## Phase B — Companion Layer

Add:

```text
Persona Compiler
Mood micro-deltas
Mofish / Normal / Strict / Manual
WorkSnapshot UX
Go notice UX
mini Go status in Work
mini Work status in Go
```

## Phase C — Deferred Polish

Only after real usage justifies them:

```text
richer SGF ecosystem
GameTree variation UI
post-game KataGo analysis
advanced crash semantics
event journal
general bridge mailbox
second-engine oracle
TUI renderer
native desktop-specific work
richer animation/sound
long-term self-report memory
```

---

# 42. Frozen Decisions — R2

### R2-1 — Session Architecture
**One Companion identity, two isolated DSH Sessions.**

### R2.1-2 — Cognition Ownership
**One active foreground cognition lane at a time. Runtime is the only cross-lane wake authority.**

### R2-3 — Cross-Lane Awareness
**Latest WorkSnapshot + latest GameNotice only.**

### R2.3-4 — Cross-Lane Operational Intent
**One atomic pending focus intent carries target, origin and an optional immutable DSH `UserMessage`. User-origin intent outranks self-initiated intent. A direct user message on an inactive lane is converted into a user-origin focus intent by UI/Runtime without requiring that lane's Agent to already run. Status snapshots never substitute for user commands.**

### R2-5 — CompanionState
**One small shared authoritative state. DeepSeek-authored bounded mood deltas. No event journal in V0.1.**

### R2-6 — Routing
**Current-view affinity + snapshot status answers + explicit/self-requested focus switch. No extra LLM router.**

### R2-7 — Game Awareness
**Only objective latest-move deltas. No strategic labels or salience score.**

### R2-8 — Go Rules
**Tenuki is the sole authoritative rules engine behind GoRulesPort, with explicit area / positional-superko / komi configuration.**

### R2-9 — Persistence
**Canonical action log owned by Companion Go; restore by replay. Do not serialize Tenuki internals.**

### R2-10 — Live Strategy
**No external Go intelligence during play.**

### R2-11 — Capability Isolation
**Go preset is isolated, native-only, and lacks Code Mode / subagent / general execution capabilities.**

### R2-12 — Cognition Budget
**Runtime hard enforcement at request, step, and underlying Go-tool execution boundaries.**

### R2-13 — UI
**Official DSH Web first; real graphical Goban mandatory; mini surfaces proven by smoke test rather than assumed.**

---

# 43. Engineering Taste / Guardrails

Prefer:

- the fewest moving parts that satisfy real requirements;
- explicit boundaries over speculative abstraction;
- thin adapters over framework-building;
- current needs over hypothetical commercialization;
- testable contracts over defensive infrastructure;
- simple latest-state persistence over event-sourcing unless history is genuinely required.

Do not introduce without concrete evidence:

- focus leases / epochs;
- generalized event buses;
- exactly-once semantics;
- durable Companion journals;
- task importance scoring systems;
- dozens of persona parameters;
- second rules engines;
- generic multi-Harness abstractions;
- sophisticated crash transactions;
- rich cross-lane Work mirrors;
- hidden Go significance analyzers.

If a future real failure demonstrates the need, add complexity then.

---

# 44. Core Invariants

```text
ONE user-visible Companion identity.

TWO isolated durable Session histories.

ONE foreground LLM cognition lane at a time.

ONE Runtime cross-lane wake/admission authority.

ONE atomic pending focus intent with user-over-self arbitration.

SAFE focus handoff occurs between DSH steps, not only at whole-turn end and not between individual tool calls.

NO naive pre-step reject: already-claimed continuation messages must be synchronously restored as one ordered `next-step` batch before a forced yield.

NO ordinary focus switch aborts already-started model/tool work.

PINNED DSH yield guard uses synchronous inbox batch-splice + continuation reject. This sequence is executable-verified against DSH `b150a551...`; hook cancellation is not required on this commit.

NO Bridge-only evaluation wake.

BRIDGE providers read Runtime-held latest values; they do not reconstruct history.

PENDING user handoff stores an immutable DSH `UserMessage`, not a late ID-only text lookup or duplicate `capturedText` buffer.

USER messages on an inactive lane are admitted by UI/Runtime, not by first waking that lane to reason.

DIRECT board actions update Go state without automatically becoming focus requests.

ONE authoritative Go rules state.

ONE canonical game action history.

ONE small authoritative CompanionState.

NO raw Work/Go transcript synchronization.

NO cross-lane operational command inferred from a status snapshot.

NO external Go strategy during live play.

NO Code Mode / subagent / generic execution path in Go Lane.

NO unlimited Go cognition.

NO text-parsed moves as game truth.

NO user-facing undo in V0.1.

NO task-importance taxonomy.

NO strategic labels in GameNotice.

NO full Go history in Work context.

NO full Work tool history in Go context.
```

---

# 45. Deferred Upgrade Triggers

The Original Full design remains a design archive, not an implementation baseline.

Only restore deferred mechanisms when concrete triggers appear.

## Add a small FIFO handoff queue only if:
multiple cross-lane user commands can legitimately accumulate before focus handoff.

## Add a bridge event mailbox only if:
a real non-replaceable cross-domain event cannot be represented by latest state or source-message handoff.

## Add Companion event journal only if:
historical mood/persona reconstruction becomes an actual user/debugging requirement.

## Add focus epoch/lease only if:
execution becomes multi-process or a real stale-ownership bug appears.

## Add second-engine oracle only if:
Tenuki discrepancies appear or rules replacement becomes active work.

## Add transactional crash recovery only if:
transient focus/handoff loss becomes materially harmful.

---

# 46. Final External Audit Questions

The R2 reviewer should focus on whether the two P0 fixes are now truly closed.

1. Can an explicit user command sent from either the active or inactive lane ever be lost, overwritten by a self-initiated focus request, reduced to a stale status snapshot, delayed until an entire multi-step turn ends, or race with same-driver continuation during cooperative yield?
2. Is Runtime truly the only cross-lane wake authority?
3. Can direct user input on an inactive lane reliably trigger Runtime admission without requiring that lane to already be running, while still preventing any unauthorized inactive-lane model cognition?
4. Does R2 incorrectly rely on `pre-step reject` as a queue anywhere?
5. Are Code Mode, subagent, tool aggregation or inherited capabilities still potential Go anti-cheat bypasses?
6. Is budget enforcement attached to the actual underlying request/tool execution boundaries?
7. Is GameNotice objective enough to avoid strategy injection but informative enough for Strict/Normal attention decisions?
8. Does TenukiAdapter explicitly eliminate unsafe defaults and avoid private-state serialization?
9. Can WorkSnapshot still answer recent work-result questions without growing into a second Work model?
10. Are any R2 additions already overengineered?
11. Did R2 oversimplify anything else that creates a concrete V0.1 correctness failure?
12. If proposing additional machinery, provide a concrete failure trace that cannot be fixed more simply.

Verdict must be one of:

```text
PASS
PASS_WITH_SIMPLIFICATIONS
CHANGES_REQUESTED
ARCHITECTURE_RETHINK_REQUIRED
```

Build gate must be one of:

```text
READY_FOR_PHASE_A
READY_AFTER_P0_FIXES
NOT_READY
```
