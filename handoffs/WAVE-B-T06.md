# Handoff · WAVE-B-T06

- 状态：READY_FOR_REVIEW
- 轮次：Round 1
- 票号：WAVE-B-T06（BL-GR-06: NOT_IMPLEMENTED → 待审 IMPLEMENTED_VERIFIED）
- 分支：`work/b-t06-canonical-replay`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-T06`
- 基线 BASE_SHA：`7b6521092c6d71bc5c57539ad20efddf73de046c`
- 红测试 commit：`b94aa4bbf58bc040464ee46641d68720dda13131`
- 待审代码 HEAD_SHA：`ed6ca79792ed743aa92902d4362f010af1ffa4ce`
- Spec 权威：`docs/spec/SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md` §25/§28/§36
- 依赖：WAVE-B-T02（`TenukiAdapter implements GoRulesPort`，已合并）

## 目标与验收

目标：按 Spec §28 定义自有 canonical 记录，持久化 play/pass/resign，并通过
`GoRulesPort` 重放恢复；resign 只标记终端、不改棋盘，winner/reason 由端口派生；
不序列化 Tenuki 内部对象，不保存第二份可变结果。

验收标准（逐条）：

1. `CanonicalGameRecord` 与 `GameAction`（play/pass/resign，`by: "user" | "deepseek"`）
   类型存在，字段与 Spec §28 一致。
2. 记录可序列化为纯 JSON，且只含规范字段；Tenuki 内部对象/额外字段不能进入记录。
3. play/pass 序列重放后，棋盘、轮到谁、手数、连续 pass 数、captures、lastMove
   与现场对局一致。
4. resign 重放后：`status = "over"`，`winner = 对手`，`loser = 退方`，
   `reason = "resignation"`；棋盘/手数/captures/lastMove 与退子前一致。
5. 重放后的 resigned 对局保持终端：后续 play/pass/resign 全部 `game-over` 拒绝。
6. 同一记录重复重放结果确定一致；颜色映射由调用方提供并被正确使用。
7. `pnpm verify` 退出码 0。

## 已完成

- 新增 `src/rules/canonical-record.ts`（243 行）：
  - `PlayAction` / `PassAction` / `ResignAction` / `GameAction`。
  - `CanonicalGameRecord`：`boardSize`、`scoring: "area"`、
    `koRule: "positional-superko"`、`komi: 7.5`、`actions`、可选 `settlement`。
  - `SettlementRecord` 复用 `SettlementConfirmation`（死子确认输入），
    不保存 score/winner；没有第二份结果真相。
  - `validateCanonicalGameRecord`：只接受规范键，拒绝 Tenuki 形状的额外字段、
    非规范规则值、resign 之后的动作/结算；返回深冻结记录。
  - `serializeCanonicalGameRecord` / `parseCanonicalGameRecord`：稳定字段投影 +
    JSON 解析校验；序列化前同样校验，非法内存对象不会被写盘。
- 新增 `src/rules/replay.ts`（81 行）：
  - `replayCanonicalGame(port, record, { gameId, colors })` 先
    `port.createGame`，再按顺序重放 play/pass。
  - resign 委托 `port.resign`；replay 不直接改棋盘、不写 outcome，终端状态与
    winner/reason 由端口返回的权威状态派生。
  - 可选 `settlement` 经 `port.settle` 重放；被端口拒绝的 action 按序号与原
    reason 抛错，不静默跳过。
- 新增测试 2 个文件、30 个用例（19 + 11），全部通过。

## 改动

- `src/rules/canonical-record.ts` +243（新）
- `src/rules/replay.ts` +81（新）
- `src/rules/canonical-record.test.ts` +193（新）
- `src/rules/replay.test.ts` +252（新）
- 无范围外改动：未改 `src/contracts/`、`src/rules/tenuki-adapter.ts`、`package.json`、
  lockfile；未新增依赖；未新增 `src/rules/index.ts`（不需要 barrel）。
- 提交：`test:` b94aa4b（红）→ `feat:` ed6ca79（实现 + 两处测试断言修正）。

## 关键契约决定（Spec §28 未完全展开的部分）

- Spec 的 `CanonicalGameRecord` 不含 `gameId` / `colors`；两者是恢复时的运行期
  输入，放进 `ReplayRequest`，记录本身保持 Spec 形状。
- `SettlementRecord` 在 Spec 中只有名字，没有字段定义；本票复用端口的
  `SettlementConfirmation`（`{ deadStones, agreed }`），只持久化“已同意的死子输入”，
  不复制 score/winner，避免与 `GoRulesPort` 形成第二份结果真相。
- 持久化校验拒绝未知键（包括 Tenuki 的 `game` / `currentState` / `moveNumber`
  等），确保引擎内部对象无法进入记录。
- resign 之后的动作在 parse 阶段即拒绝；replay 端依赖同一校验，不再重复一套
  顺序状态机。
- 只重放，不实现崩溃恢复编排（Wave F）、不实现 §31 十一例套件（B-T05）、
  不引入 SGF 或新规则引擎。

## 证据

### 基线

- BASE_SHA `7b65210`：已含 B-T02 `TenukiAdapter` 与端口契约。
- 本票没有单独在 BASE_SHA 上跑一次 `pnpm verify`；最终全量计数 26 files / 302 tests
  减去新增 2 files / 30 tests，即既有 24 files / 272 tests（算术相减，未单独复跑）。

### 红测试（在 `b94aa4b` 上）

```text
$ pnpm exec vitest run src/rules/canonical-record.test.ts src/rules/replay.test.ts
FAIL src/rules/canonical-record.test.ts
  Error: Cannot find module './canonical-record.js'
FAIL src/rules/replay.test.ts
  Error: Cannot find module './replay.js'
Test Files  2 failed (2)
     Tests  no tests
exit 1

$ pnpm run typecheck
src/rules/canonical-record.test.ts(2,72): error TS2307: Cannot find module './canonical-record.js'
src/rules/canonical-record.test.ts(6,8):  error TS2307: Cannot find module './canonical-record.js'
src/rules/replay.test.ts(9,72):           error TS2307: Cannot find module './canonical-record.js'
src/rules/replay.test.ts(10,37):          error TS2307: Cannot find module './replay.js'
exit 2
```

### 绿测试（在 `ed6ca79` 上）

```text
$ pnpm verify
$ tsc -p tsconfig.json --noEmit          # 无错误
$ vitest run
Test Files  26 passed (26)
     Tests  302 passed (302)
$ tsc -p tsconfig.build.json             # 无错误
VERIFY_EXIT:0
```

新增用例单独运行：

```text
$ pnpm exec vitest run src/rules/canonical-record.test.ts src/rules/replay.test.ts --reporter=verbose
✓ canonical-record.test.ts: 19 passed
✓ replay.test.ts: 11 passed
Test Files  2 passed (2)
     Tests  30 passed (30)
```

### 测试有牙齿（临时变异，已恢复）

- M1：把 replay 中的 `port.resign(...)` 改成 `port.pass(...)`（resign 被当成
  非终端的棋盘动作）→ `replay.test.ts` **4 failed | 7 passed**，失败断言为
  `expected 'playing' to be 'over'` 等。
- M2：删除 `port.resign(...)` 调用（终端状态丢失）→ `replay.test.ts`
  **4 failed | 7 passed**，同样是 `expected 'playing' to be 'over'`。
- 两次变异后均恢复实现并重跑：`replay.test.ts` 11/11 passed，最终
  `pnpm verify` exit 0。变异只作用于工作树，未提交。

### replay round-trip 证据

- `reproduces a long play/pass sequence`：10 个 action（含一次提子、两次 pass）
  的现场对局状态与 replay 状态 `toEqual` 全字段一致；额外断言
  `stones.length = 6`、`captures.user = 1`、`toPlay = "user"`、
  `consecutivePasses = 2`。
- `is deterministic across independent replays`：同一记录两次独立 replay
  `toEqual`。
- `honours the supplied player colours`：`user = white / deepseek = black` 时
  replay 与现场一致，`captures.deepseek = 1`。
- `restores the initial state for an empty action log`：空日志 replay 等于
  `createGame` 初始状态。

### resign 终端证据

- `derives winner = opponent when deepseek resigns` 与 `... user resigns`：
  `status = "over"`；`outcome = { winner: 对手, loser: 退方, reason:
  "resignation" }`；`stones`、`moveNumber`、`consecutivePasses`、`captures`、
  `lastMove` 与退子前完全一致。
- `keeps the terminal state after replay ...`：replay 后再次 `play` / `pass` /
  `resign` 全部 `ok: false`、`reason = "game-over"`，且 `getState` 与终态
  `toEqual`。
- `marks resignation on an empty board terminal without adding a stone`：
  空棋盘退子后 `stones = []`、`moveNumber = 0`、对手获胜。
- `rejects a canonical log that keeps acting after a resignation`：resign 后
  再 play 的记录在校验阶段抛 `canonical action 2 follows a resignation`。

## 未验证 / 已知事项

- **未推送**、未开 PR、未跑远端 CI；本 handoff 只覆盖本地 worktree 证据。
- **Node 版本警告**：本机 `node v26.10.0`，`package.json` engines 要求
  `>=24.11.1 <25`；pnpm 仅 WARN，`pnpm verify` 仍 exit 0。CI 使用版本未在本票验证。
- Wave F 的崩溃/恢复编排（BL-HARD-01/02）不在本票范围；本票只提供
  canonical 记录与 replay 原语。
- §31 十一例套件（B-T05）不在本票范围；本票的 replay 测试只覆盖 §28 验收，
  不替代 B-T05 的 raw 11/11 计数。
- Baseline 文档未在本票修改；按项目规则，`BL-GR-06` 状态应在合并后的同步
  提交中依据合并源码 + 测试证据更新。
- 工作树内 `node_modules/` 与 `lib/` 均为本地验证产物，已被 `.gitignore` 忽略，
  未提交。
