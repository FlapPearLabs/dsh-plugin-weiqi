# Pinned DSH Web `conversation.view` seam verification

Status: **PASS — VERIFIED FACT, NOT PRODUCTION UI**

Issue: WAVE-E-S01 / #37

Pinned DSH: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

Pinned package line: `0.1.1-rc.2`

Runtime: Node `24.11.1`, pnpm `11.7.0`

This spike proves the current DSH Web extension capability. It does not build
the production Go board, rules adapter, Companion projections, or mini-surface
UX.

## Exact registration and mount seam

The supported registration shape is:

```tsx
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'go',
  order: 20,
  label: 'Go',
}, GoView))
```

The shipped Trajectory plugin uses the same pattern at
`packages/client/ui-trajectory/src/client/index.ts:43-64`. The owning
Conversation plugin declares `conversation.view` as a `list` with `session`
scope at `packages/client/ui-conversation/src/client/apply.ts:240-254`; the
typed contract says each entry is a tab and receives the session standard kit
at `packages/client/ui-conversation/src/client/contract/slots.ts:107-113` and
`:459-467`.

Registration belongs to the mounting Cordis plugin fiber. `ctx.slots.inject`
waits for the owner declaration, and disposal of that fiber removes both the
Go tab and its header mini-surface. The retained probe asserts this unload
cascade while the shipped Chat and Trajectory entries remain mounted.

## Session binding and view coexistence

`ConvViewProps` supplies the current `sessionId`, a current-session
`useSession` selector, the session list/workspace hooks, and `useProjection`.
An entry may also declare `inject: (sessionId) => ...`, as Trajectory does at
`ui-trajectory/src/client/index.ts:49-62`.

The Conversation shell projects all ring entries into tabs
(`ui-conversation/src/client/apply.ts:153-166`) and renders exactly the active
entry through `only: active.id`
(`ui-conversation/src/client/skeleton/ConversationSession.tsx:200-207`). The
active view store is session-scoped and shared by the header/body
(`ui-conversation/src/client/apply.ts:240-270`). Therefore each session keeps
its own selected tab.

The executable probe mounts the production slot renderer, the shipped
Conversation shell, the shipped Chat view, the shipped Trajectory plugin, and
the probe Go view in one jsdom tree. Its mounted tab list is exactly:

```text
对话 | 轨迹 | Go
```

The Chat DOM (`data-chat-flow`) exists before the Go tab is selected and again
after the probe fiber is disposed.

## §34 five-item result

1. **Go + normal views:** PASS. One mounted ring contains Chat, the real
   Trajectory contribution, and Go; only the selected entry renders.
2. **No transcript merge:** PASS. With the Work session current, the Go
   component's framework `useSession` reads only `WORK_TRANSCRIPT_ONLY`; after
   switching to the Go session it reads only `GO_TRANSCRIPT_ONLY`. The other
   marker is absent from the mounted DOM in both directions.
3. **Small Go status in Work UX:** PASS. Register a conditional entry in
   `conversation.session.header.actions`; it is an additive session-scoped
   seat beside the title (`contract/slots.ts:90-100`, render site
   `ConversationSession.tsx:137-139`). The probe reads only the Work session's
   latest `weiqi/game-notice` projection and renders nothing when absent.
4. **Small Work status in Go UX:** PASS. Put the compact WorkSnapshot strip in
   the Go view's own top chrome. The view already owns this layout and receives
   session-scoped `useProjection`; the probe reads only the Go session's latest
   `weiqi/work-snapshot`. No DSH child-slot addition is needed.
5. **Two sessions, one shell:** PASS. One runtime holds both Work and Go
   sessions, switches the shell's current session, preserves a separate active
   tab per session, and supplies separate snapshot/projection stores. DSH's
   production `SessionManager` likewise owns a `Map<SessionId, Session>`, a
   selected session, and per-session projection stores
   (`packages/client/runtime/src/client/sessions/manager.ts:105-151,
   :179-201`).

Mounted evidence emitted by the retained test:

```text
E-S01 DOM TRACE {"tabs":["对话","轨迹","Go"],"work":{"sessionId":"work-session","transcript":"WORK_TRANSCRIPT_ONLY","goStatus":"Opponent moved · Q10"},"go":{"sessionId":"go-session","transcript":"GO_TRANSCRIPT_ONLY","workSnapshot":"hash normalization changed; validating again"}}
```

## Mini-surface placement decision

| Need | Preferred seat | Reason |
| --- | --- | --- |
| Work View: compact sourced Go status/action | `conversation.session.header.actions` | Per-session, additive, beside the session title, already rendered by the native shell. Return `null` when the Work session has no Go projection. |
| Work View: longer ambient readout if later UX evidence requires it | `conversation.composer.dock` or `conversation.input.dock` | The contract explicitly reserves these for an ambient under-composer readout or a full-width prose row (`contract/slots.ts:195-214`). This is an available fallback, not selected production UX. |
| Go View: compact sourced WorkSnapshot | Inside the registered Go view's top chrome | The Go entry owns its board layout and already receives `useProjection`; this avoids leaking Work context into Chat/Trajectory or modifying DSH core. |

These are placement capabilities only. E-T02 owns production copy, styling,
interaction, and projection schemas after its own dependency gates.

## Limits and non-core fallback

`conversation.view` entries are a global ring contribution: registering Go
adds the Go tab to every session whose Conversation shell is mounted. The
component and injected face are session-bound, but the ring does not expose a
per-session tab-registration predicate. This does not block §34 or E-T01: the
Go session selects Go, while the Work session stays on Chat.

If product review later requires hiding the Go tab outside the paired Go
session, do not patch DSH core. Use the simplest shell-compatible UX: keep one
global Go tab and have its session-bound component show either the board for a
Go session or a small “open paired Go session” affordance for a Work session.

## E-T01 / E-T02 implementation path

- E-T01 can be a normal client plugin contribution to `conversation.view`.
  Register the production component through `ctx.slots.inject`; read the
  current Go session through `sessionId`/`useSession`. Authoritative board
  state may arrive through a typed read-only projection or plugin-owned
  injection. Play, pass, and resign actions must use plugin-owned injected
  callbacks that route directly to GoRulesPort; latest-value projections are
  awareness-only and never deliver commands. No DSH core patch is required.
- E-T02 can register the Work-side status in
  `conversation.session.header.actions` and render the Go-side WorkSnapshot
  inside the Go view. Both must consume already-computed, latest-value,
  session-scoped projections. They must not copy either transcript.

## Reproduction

After installing the pinned DSH checkout dependencies:

```bash
DSH_PINNED_ROOT=/absolute/path/to/deepseek-harness \
  bash tests/upgrade-gates/conversation-view/run-conversation-view.sh
```

Expected: `1 passed (1)` plus the exact `E-S01 DOM TRACE` above. The runner
verifies the DSH commit, package versions, Node, and pnpm before copying the
test into the pinned DSH test suite, and removes that temporary copy on every
exit path.

## Boundary result

- DSH core patch required: **NO**
- Transcript fusion: **NO**
- Production Go UI implemented: **NO**
- Production mini-surface UX implemented: **NO**
- Prototype behavior inherited: **NO**
