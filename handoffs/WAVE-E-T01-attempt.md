# WAVE-E-T01 attempt — Core Go UI (Phase A) + zero-new-dependency verification

Status: **PARTIAL — dependency-free core GREEN; React host mount BLOCKED**

Ticket: WAVE-E-T01 (`docs/planning/TICKET_GRAPH_V1.2.1.md`, BL-UI-02 / BL-RT-10 / BL-UI-04)

Branch: `task/e-t01`

```text
BASE = origin/main = 1b1e612836fd3a8528c92764701767a0f54bcf34
RED  = f8950e9717eea4be42644318cb0aa3d532cb224d  test: add the red §32 Core Go UI matrix suite
HEAD = da92f13fa7bea6c891604682f1ba6c61b47c58fd  feat: implement the §32 Core Go UI surface without new dependencies
```

Working tree: not pushed, no PR, no merge (owner has not approved).

## 1. Zero-new-dependency verdict

**Runtime dependencies: zero added. `package.json` dependencies and `pnpm-lock.yaml` unchanged.**

Achieved by keeping `src/ui/` free of React, JSX, DSH client packages, DOM globals,
and any bundler-only module. Everything is a plain ESM TypeScript module exporting
data and functions; `src/ui/registration.ts` receives the host component as an
opaque value, so no local `react` import is needed for the shipped surface.

**The React mount itself is not achieved** and cannot be in this repository without
new packages. That is the ticket's documented stop condition ("类型不可用").

Evidence from this workspace:

```text
$ node -e "... require.resolve(m) ..."
react => UNRESOLVED
react/jsx-runtime => UNRESOLVED
@deepseek-ai/dsh-client-ui-slots => UNRESOLVED
@deepseek-ai/dsh-client-ui-conversation => UNRESOLVED
@deepseek-ai/dsh-session-projection => UNRESOLVED
jsdom => UNRESOLVED
@testing-library/react => UNRESOLVED
```

`tsconfig.json` also has `"include": ["src/**/*.ts"]` and no `"jsx"` setting, so a
`.tsx` production view could not be compiled even if a component were written.

The pinned DSH checkout required by the E-S01 runner (`DSH_PINNED_ROOT`) is not
configured in this workspace (`env` has no `DSH_*` entries, and no checkout was
found under `~/Documents` at the searched depth), so the retained seam gate could
not be used to mount a production view either.

### Exact packages a React mount needs (not installed, not requested)

Peer/runtime (host-provided in a real DSH install; the plugin must declare them):

| Package | Exact version | Kind |
| --- | --- | --- |
| `react` | `^18.2.0` (host line; pinned by `@deepseek-ai/dsh-client-test-runtime@0.1.1-rc.2` peers) | runtime peer |
| `react-dom` | `^18.2.0` | runtime peer |
| `@deepseek-ai/dsh-client-ui-slots` | `0.1.1-rc.2` | runtime peer (typed `ctx.slots`) |
| `@deepseek-ai/dsh-client-ui-conversation` | `0.1.1-rc.2` | runtime peer (`ConvViewProps`) |
| `@deepseek-ai/dsh-client-runtime` | `0.1.1-rc.2` | runtime peer (session bindings) |
| `@deepseek-ai/dsh-client-locale` | `0.1.1-rc.2` | runtime peer (mount harness) |
| `@deepseek-ai/dsh-session-projection` | `0.1.1-rc.2` | runtime peer (projection types, needed by E-T02) |
| `@types/react` / `@types/react-dom` | `^18.3.x` matching the host line | dev-only (compile) |
| `@deepseek-ai/dsh-client-test-runtime` | `0.1.1-rc.2` | dev-only (slot test runtime) |
| `@deepseek-ai/dsh-client-ui-trajectory` | `0.1.1-rc.2` | dev-only (coexistence assertion) |
| `jsdom` | `30.1.3` | dev-only (vitest jsdom environment) |
| `@testing-library/react` | `16.3.3` | dev-only |
| `@testing-library/dom` | `^10` | dev-only (peer of testing-library) |

Why it is unavoidable: a `conversation.view` entry is a React component registered
through `ctx.slots.register`; the component must call host React hooks and must
import the host's `react` module. Writing local `declare module 'react'` stubs would
replace the host contract with an invented one (drift risk, and still no proof that
DSH resolves the module for this package). Adding any of these changes
`pnpm-lock.yaml`, which requires owner approval per the ticket and the team rules.

`@deepseek-ai/dsh-client-ui-slots@0.1.1-rc.2` and
`@deepseek-ai/dsh-client-ui-conversation@0.1.1-rc.2` do **not** declare `react` as a
peer; the React version above comes from `@deepseek-ai/dsh-client-test-runtime@0.1.1-rc.2`
(`"react": "^18.2.0", "react-dom": "^18.2.0"`).

## 2. What was built

`src/ui/` (production, no test code compiled into `lib/`):

| File | Responsibility |
| --- | --- |
| `board-view.ts` | `buildBoardView(GameState) -> BoardViewModel`: board size, intersections, stones with colors/keys, last move (point or pass), turn + stone color, captures, status, authoritative result, komi from state. Frozen; no transcript input. |
| `interaction.ts` | `GoBoardController`: `playAt(point)` / `pass()` / `resign()` call `GoRulesPort` directly with the session player; off-board and non-integer clicks are rejected before the engine; every outcome carries the authoritative state, the `GameNotice`, and an animation plan. No focus intent, no session read. |
| `effects.ts` | Deterministic `planBoardAnimation(MoveResult)` for placement and captured points; `createWebAudioStoneSound(context)` synthesizes a 100 ms tone (no audio assets); `createSilentStoneSound()` fallback. |
| `registration.ts` | `registerGoView(registry, component)` wraps the E-S01-verified `inject('conversation.view')` + `register({name:'conversation.view', id:'go', order:20, label:'Go'}, Component)` shape. The component is supplied as an opaque value, so the shipped module imports no React. |
| `index.ts` | Public surface of the above. |

`tests/ui/ui-fixtures.ts`: shared explicit-rules fixtures (no engine defaults).

## 3. §32 matrix coverage

| # | Required behavior | Asserted by |
| --- | --- | --- |
| 1 | 9x9 / 13x13 / 19x19 | `board-view.test.ts` sizes; `interaction.test.ts` "plays a legal move on each board size" |
| 2 | Stones black/white from authoritative state | `board-view.test.ts` "renders exactly the state stones" |
| 3 | Automatic captures reflected immediately | `board-view.test.ts` capture case (real TenukiAdapter); `interaction.test.ts` capture-effects case |
| 4 | Last move | `board-view.test.ts` play + pass cases |
| 5 | Turn | `board-view.test.ts` player + stone color |
| 6 | Pass via `GoRulesPort.pass` | `interaction.test.ts` "routes pass through the port" |
| 7 | Resign via `GoRulesPort.resign`, terminal from port | `interaction.test.ts` resign cases (accepted + rejected) |
| 8 | Final result from authoritative state only | `board-view.test.ts` result case; `interaction.test.ts` rejected-resign case |
| 9 | Placement/capture animation | `effects.test.ts` (4 cases) + `interaction.test.ts` effect-emission cases |
| 10 | Minimal stone sound | `effects.test.ts` (2 cases, fake `AudioContext`) |
| 11 | Click -> `GoRulesPort.play`, illegal rejected, no PendingFocusIntent | `interaction.test.ts` (6 cases, `vi.spyOn(port,'play')`) |
| 12 | Work/Go transcript isolation | `board-view.test.ts` whitelist/frozen/foreign-field cases; `interaction.test.ts` foreign-session case; `prototype-boundary.test.ts` source audit |
| 13 | No prototype inheritance | `board-view.test.ts` komi-from-state; `prototype-boundary.test.ts` (randomness, timers, wall clock, 6.5/7.5 literals, tenuki/rules/focus imports, transcript reads) |

**Limits of rows 9/10.** Animation and sound are asserted as data and as call chains,
not as pixels or audible output: the animation plan (`placement`, `captures`, fixed
durations) is what a host renderer applies, and the sound test drives a fake
`AudioContext` and asserts the exact synthesized call sequence. The React/CSS
consumer of the plan and real audio output are part of the blocked mount, so no
DOM or browser evidence exists for them.

**Rows without DOM evidence.** Row 12's production guarantee rests on the module
input type (no transcript or session value enters `src/ui`) plus a source audit, not
on a mounted DOM separation test. The E-S01 spike proved the seam's DOM isolation,
but that proof is not transferred to this production surface.

## 4. Commands and raw results

```text
$ node --version
v26.10.0
```

Environment deviation (pre-existing, not caused by this change): `package.json`
requires `>=24.11.1 <25`; the workstation runs Node 26.10.0, so every pnpm command
prints `[WARN] Unsupported engine`.

```text
$ corepack pnpm@11.7.0 --version
Error: Error when performing the request to https://registry.npmjs.org/pnpm/-/pnpm-11.7.0.tgz
```

The first install attempt failed inside corepack's own downloader (`UND_ERR_INVALID_ARG`
against the local proxy), not in the project. A local pnpm 11.7.0 is already present:

```text
$ pnpm --version
11.7.0

$ pnpm install --frozen-lockfile --offline
Already up to date
Done in 138ms using pnpm v11.7.0
```

Red commit (before implementation):

```text
$ pnpm exec vitest run src/ui
 Test Files  4 failed (4)
      Tests  no tests
Error: Cannot find module './board-view.js' (and ./effects.js, ./interaction.js, ./registration.js)

$ pnpm run typecheck
src/ui/board-view.test.ts(5,42): error TS2307: Cannot find module './board-view.js' ...
src/ui/effects.test.ts(12,8): error TS2307: Cannot find module './effects.js' ...
src/ui/interaction.test.ts(6,35): error TS2307: Cannot find module './interaction.js' ...
src/ui/prototype-boundary.test.ts(10,8): error TS2307: Cannot find module './registration.js' ...
```

Green commit (HEAD da92f13):

```text
$ pnpm verify
$ pnpm run typecheck && pnpm run test && pnpm run clean && pnpm run build
$ tsc -p tsconfig.json --noEmit
$ vitest run
 Test Files  42 passed (42)
      Tests  516 passed (516)
$ node --eval "...rmSync('lib'...)"
$ tsc -p tsconfig.build.json
exit 0
```

Build output contains `lib/ui/*.js` and `lib/ui/*.d.ts`; no test file is emitted.

Two green-commit test corrections (recorded in the commit body):
`state.outcome` identity is not stable across `getState` snapshots (`toBe` ->
`toEqual`), and state stone order is insertion order (capture case now sorts keys).

## 5. Not verified / remaining work

- The production React component body and its `conversation.view` mount: blocked on
  the packages listed in §1.
- A jsdom test of the mounted matrix: `jsdom` and `@testing-library/react` are not
  installed; adding them changes the lockfile and needs owner approval. The current
  matrix suite runs in the default Node environment.
- Browser / smoke evidence and the board-click trace in a real DSH shell: not produced.
- Controller lifecycle in the production client (who creates a controller per Go
  session, where the per-session instance lives, disposal on view unmount): not
  implemented; E-S01 only established that the view component is session-bound.
- GameNotice publication into the existing `BridgeRuntime` from UI actions: the
  controller returns the notice but does not publish it; wiring lives with the mount
  and must not create a second projection store.
- `BL-UI-02` / `BL-RT-10` remain **NOT_IMPLEMENTED** as integrated production UI;
  only the dependency-free core surface is implemented and verified in this attempt.

## 6. Recommendation

Request owner approval for the dependency set in §1 (peer declarations plus
dev-only test packages), then finish the T01 remainder as a small follow-up:
`.tsx` view component using the host React, a jsdom mount test following
`tests/upgrade-gates/conversation-view/conversation-view.spec.tsx`, and the
per-session controller lifecycle. No DSH core patch and no new mechanism are needed.
