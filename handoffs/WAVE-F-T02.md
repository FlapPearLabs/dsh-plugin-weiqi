# Handoff · WAVE-F-T02

- 状态：READY_FOR_REVIEW
- 轮次：Round 1
- 票号：WAVE-F-T02（BL-HARD-02: NOT_IMPLEMENTED → 待审 IMPLEMENTED_VERIFIED）
- 分支：`work/f-t02-replay-recovery`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-F-T02`
- 基线 BASE_SHA：`71ec784240b5554c69b46a0f1b41ba0419bb059d`
- 红测试 commit：`cdcf31f07639777e1e0369dd44b89617f3526841`
- 待审代码 HEAD_SHA：`228e57d9cac6179f432fa23cb78b530f28ffd1d7`
- Spec 权威：`docs/spec/SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md` §28/§36
- 依赖：WAVE-B-T06（`canonical-record.ts` / `replay.ts`，已随 PR #94 合入基线）

## 目标与验收

目标：把持久化的 canonical 记录恢复成权威对局：解析记录 → 经 `GoRulesPort`
重放 play/pass → resign 由端口标记终端、不改棋盘、从权威状态派生 winner/reason；
恢复后的状态必须与崩溃前现场对局逐字段一致，resigned 对局恢复后仍是终端。

验收标准（逐条）：

1. 长动作序列（42 个 action）从序列化 JSON 恢复后，棋盘、轮到谁、手数、连续
   pass 数、captures、lastMove、status、outcome 与崩溃前现场 `toEqual`。
2. resigned 记录恢复后 `status = "over"`、`winner = 对手`、`reason = "resignation"`，
   棋盘/手数/captures/lastMove 与退子前一致；恢复后继续 play/pass/resign 全部
   `game-over`。
3. 非法/未知键/非规范规则值/resign 之后仍有动作的记录在恢复入口被拒绝。
4. 端口返回的权威状态若与记录中的 resign 矛盾（非终端），恢复必须报错而不是信任。
5. `pnpm verify` 退出码 0。

## 已完成

- 新增 `src/persistence/replay-recovery.ts`（78 行）：
  - `restoreFromCanonicalRecord(persisted, port, { gameId, colors })`。
  - `persisted` 同时接受 JSON 字符串（`parseCanonicalGameRecord`）和已解析对象
    （`validateCanonicalGameRecord`）；未知键、非规范规则值、resign 后动作沿用
    canonical 校验，不另写一套状态机。
  - 重放完全委托 `replayCanonicalGame`：play/pass 走端口，resign 走 `port.resign`，
    本模块不直接改棋盘、不写 outcome。
  - 记录以 resign 结尾时校验权威状态确为终端且 winner/loser/reason 与 resigner
    一致，否则抛错；返回 `{ record, state, resignation: { resignedBy, winner } }`。
- 新增 `src/persistence/replay-recovery.test.ts`（360 行，12 个用例）。
- 未改 `src/rules/canonical-record.ts`、`src/rules/replay.ts`、F-T01 崩溃恢复编排、
  `src/contracts/`、`package.json` / lockfile，未加依赖，未加 barrel。

## 关键契约决定

- Spec 的 `CanonicalGameRecord` 不含 `gameId` / `colors`；二者仍是运行期输入
  （`ReplayRecoveryRequest`），记录形状不变。
- 恢复入口只负责“解析 + 重放 + 校验终端 + 派生 resign 摘要”；崩溃前现场比对
  属于测试证据（恢复时没有第二份持久化现场可用，也不应新增结果真源）。
- resign 的 `winner` 从 resigner 派生（对手获胜），同时要求端口返回的 outcome
  与之相符；不持久化 winner/reason。
- 端口撒谎（resign 后仍返回 `status: "playing"`）时恢复失败，避免把非终端状态
  当成已恢复对局。
- 未实现 F-T01 的崩溃/重启编排；本票只提供恢复原语。

## 证据

### 基线

- BASE_SHA `71ec784`：`origin/main` 合并 PR #94（B-T06）与 #95（C-T02），
  即本票依赖的 canonical/replay 已在基线中。
- 基线未单独复跑 `pnpm verify`；最终全量 32 files / 407 tests 减去新增
  1 file / 12 tests，即既有 31 files / 395 tests（算术相减，未单独复跑）。

### 红测试（在 `cdcf31f` 上）

```text
$ pnpm exec vitest run src/persistence/replay-recovery.test.ts
FAIL src/persistence/replay-recovery.test.ts [ src/persistence/replay-recovery.test.ts ]
Error: Cannot find module './replay-recovery.js' imported from
  .../src/persistence/replay-recovery.test.ts
Test Files  1 failed (1)
     Tests  no tests
TEST_EXIT:1

$ pnpm run typecheck
src/persistence/replay-recovery.test.ts(13,44): error TS2307: Cannot find module
  './replay-recovery.js' or its corresponding type declarations.
TYPECHECK_EXIT:2
```

### 绿测试（在 `228e57d` 上）

```text
$ pnpm verify
$ tsc -p tsconfig.json --noEmit          # 无错误
$ vitest run
Test Files  32 passed (32)
     Tests  407 passed (407)
$ tsc -p tsconfig.build.json             # 无错误
VERIFY_EXIT:0
```

新增用例单独运行：

```text
$ pnpm exec vitest run src/persistence/replay-recovery.test.ts
Test Files  1 passed (1)
     Tests  12 passed (12)
```

### 测试有牙齿（临时变异，已还原）

两次变异都只改 `src/rules/replay.ts` 并立即 `git checkout --` 还原；还原后
`git diff --exit-code -- src/rules/replay.ts` 为 0，未进入任何提交。

- M1（重放丢动作）：`canonical.actions.forEach` → `canonical.actions.slice(0, -1).forEach`
  → `replay-recovery.test.ts` **5 failed | 7 passed**，首个失败为
  `restores a 42-action sequence field-for-field from serialized JSON`。
- M2（resign 改棋盘）：在 `port.resign(...)` 前插入 `port.play(gameId, action.by, { x: 8, y: 8 })`
  → **2 failed | 10 passed**：`restores the pre-resign board ...` 报
  `expected [ …(4) ] to deeply equal [ …(3) ]`；空棋盘退子用例报
  `expected [ { point: { x: 8, y: 8 }, …(1) } ] to deeply equal []`。
- 两次变异后均还原并重跑：12/12 passed，`pnpm verify` exit 0。

### 长序列 round-trip

- 42 个 action（37 个 play + 5 个 pass，含一次提子、一次双 pass 后继续），
  经 `serializeCanonicalGameRecord` 写入 JSON、`restoreFromCanonicalRecord`
  用新端口恢复，`restored.state` 与现场 `liveState` 全字段 `toEqual`；另单独断言
  `stones`、`toPlay`、`captures`、`moveNumber`、`consecutivePasses`、`lastMove`、
  `status = "playing"`、`outcome = null`，且 `live.captures.user >= 1`。
- 已解析对象输入 + `user = white / deepseek = black` 颜色映射：恢复结果等于现场，
  `captures.deepseek = 1`，`toPlay = "deepseek"`。
- 同一 JSON 两次独立恢复 `toEqual`（确定性）。

### resign 终端证据

- `deepseek` 退子：恢复后 `outcome = { winner: "user", loser: "deepseek",
  reason: "resignation" }`，`resignation = { resignedBy: "deepseek", winner: "user" }`；
  `stones` / `moveNumber` / `consecutivePasses` / `captures` / `lastMove` 与退子前
  现场完全一致。
- 恢复后在同一端口继续 play / pass / resign：全部 `ok: false`、`reason = "game-over"`，
  `getState` 与恢复状态 `toEqual`。
- 空棋盘退子：`status = "over"`、`stones = []`、`moveNumber = 0`、对手获胜。
- 撒谎端口（resign 后 `getState` 返回 `playing` / `outcome: null`）：恢复抛
  `canonical resignation by ... is not terminal ...`。

### 非法输入拒绝

- 非法 JSON → `canonical game record is not valid JSON`。
- 顶层未知键（模拟 Tenuki 内部对象 `game`）→ `unknown key game`。
- 动作未知键（`moveNumber`）→ `unknown key moveNumber`。
- resign 之后仍有动作 → `canonical action 2 follows a resignation`。
- `boardSize = 10` → `boardSize must be 9, 13 or 19`；缺 `actions` →
  `actions must be an array`。

## 未验证 / 已知事项

- **没有真实进程崩溃测试**：重启/恢复编排归 WAVE-F-T01，本票只验证“从持久化
  记录恢复出与现场一致的状态”。真实崩溃点、写盘时机、focus/CompanionState
  恢复均未覆盖。
- **未推送**、未开 PR、未跑远端 CI；本 handoff 只覆盖本地 worktree 证据。
- **Node 版本警告**：本机 `node v26.10.0`，`package.json` engines 要求
  `>=24.11.1 <25`；pnpm 仅 WARN，`pnpm verify` 仍 exit 0。
- 工作树缺少 `node_modules`，用 `pnpm install --frozen-lockfile --offline`
  从本地 store 安装（62 包，0 下载）；未改 `package.json` / lockfile。
- Baseline 文档未在本票修改；按项目惯例，`BL-HARD-02` 状态应在合并后的同步
  提交中依据合并源码 + 测试证据更新。
- `lib/`、`node_modules/` 为本地验证产物，已被 `.gitignore` 忽略，未提交。
