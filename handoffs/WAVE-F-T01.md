# Handoff · WAVE-F-T01

- 状态：READY_FOR_REVIEW
- 轮次：Round 1
- 票号：WAVE-F-T01（BL-HARD-01: NOT_IMPLEMENTED → 待审 IMPLEMENTED_VERIFIED）
- 分支：`work/f-t01-crash-recovery`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-F-T01`
- 基线 BASE_SHA：`71ec784240b5554c69b46a0f1b41ba0419bb059d`（本分支创建时的 `origin/main`）
- 依赖基线：分支已快进到 `90653fb`（`work/f-t02-replay-recovery` 的 tip，含 `restoreFromCanonicalRecord`）
- 红测试 commit：`56fa2cb`
- 代码 HEAD_SHA：`40b3a96`（`40b3a96d5955f7741e71919e2ebbde3e4657ceee`）
- Spec 权威：`docs/spec/SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md` §36（R2.4.1 resign 澄清、R2.4.2 一并适用）

## 目标与验收

目标：把崩溃后重启必须恢复的状态串成一条显式流水线——两个 lane Session、
canonical 对局记录、权威棋盘、CompanionState、attention mode——焦点默认回到
Work；resigned 对局重启后仍是终端，winner 不变、`reason = "resignation"`；
不引入事务性恢复，也不做 pending 命令的持久化。

验收标准（逐条）：

1. 重启后两个 lane Session 都从 `SessionStore` 恢复（返回的是当前 live 对象）。
2. CompanionState 与 attention mode 经 D-T04 的 loader 恢复，字段与崩溃前一致。
3. 棋盘由 F-T02 的 `restoreFromCanonicalRecord` 经 `GoRulesPort` 重放得到，与崩溃前
   现场逐字段 `toEqual`。
4. 焦点一律回到 Work。
5. resigned 对局重启后仍是终端：winner/loser/reason 不变、棋盘停在退子前、重启后
   play/pass/resign 全部 `game-over`。
6. 缺失/损坏输入有确定行为（不凭空造状态）。
7. `pnpm verify` 退出码 0。

## 已完成

- 新增 `src/persistence/recovery.ts`（98 行）：
  - `restoreCompanionRuntime(input, port)`：显式入参 `{ sessions, companionStatePath, game? }`，
    `game` 为 `{ gameId, colors, canonicalRecord }`（记录接受 JSON 字符串或已解析对象）。
  - 两个 lane Session 用 A-T01 的 `resolveLaneSession` 取当前 live 对象；任一缺失即抛
    `lane session companion-go-<lane> (<lane>) was not restored`，不自行创建 Session。
  - CompanionState 走 D-T04 的 `loadLatestCompanionState`；`ENOENT` 返回 `companion: null`
    （首次安装，调用方自己播种默认值）；版本不匹配沿用 loader 的错误；loaded 对象不是
    对象或 `attentionMode` 不在冻结的四个值内则抛错。
  - 棋盘走 F-T02 的 `restoreFromCanonicalRecord`；无 `game` 入参时 `game: null`。
  - 返回值 `focus` 固定为 `{ activeLane: 'work', llmRunning: false }`，不读任何持久化焦点，
    不返回 `pendingFocus` / `pausedLane`。
- 新增 `src/persistence/recovery.test.ts`（372 行，12 个用例）。
- 未改 `src/persistence/replay-recovery.ts`（F-T02 所有）、`src/rules/**`、
  `src/companion/**`、`src/contracts/**`、`src/runtime/**`、`src/index.ts`；
  未加 barrel、未加依赖、未改 `package.json` / lockfile。

## 关键契约决定

- **D-T04 的 loader 未校验 attention mode**：本模块在消费边界补上冻结四值校验
  （`mofish` / `normal` / `strict` / `manual`），未知值直接拒绝；persona/mood 形状仍按
  D-T04 的刻意决定不校验。
- **缺失 ≠ 损坏**：没有快照文件（`ENOENT`）是首次安装，返回 `null` 交调用方播种；
  版本不符、非对象、未知 attention mode、损坏记录都是重启异常，抛带具体信息的错误。
- **Session 只校验不创建**：Session 物化归 AgentLoop（A-T01 的 `apply`）。恢复入口
  报告“未恢复”，不在这里重建 Session，避免出现第二个生命周期所有者。
- **焦点不持久化**：Spec 明确允许保守恢复（restart into Work focus by default），
  并禁止 transactional focus recovery，因此 `focus` 是常量输出，不读入参。
- **分支堆叠**：`restoreFromCanonicalRecord` 目前只在 `work/f-t02-replay-recovery`
  （`90653fb`）上，不在 `origin/main`。本分支用 `git merge --ff-only` 快进到该 tip
  （无 merge commit、无历史改写），因此合并顺序必须先 F-T02 后 F-T01。
- 本票结束后 `origin/main` 已前进到 `6e7293a`（PR #96，docs-only 同步）；本分支尚未包含
  该提交，未做 rebase/merge，留给集成时处理。

## 证据

### 基线

- 分支起点 `71ec784`（`origin/main`，含 PR #94 B-T06 与 #95 C-T02）。
- 起点未单独复跑 `pnpm verify`；绿测全量 33 files / 419 tests 减去本票 12 个用例
  与 F-T02 那 1 个 suite 的 12 个用例，即 `71ec784` 上 31 files / 395 tests（算术相减，
  未单独复跑）。
- 工作树无 `node_modules`，用 `pnpm install --frozen-lockfile --offline` 从本地 store
  安装 62 包、0 下载；未改 `package.json` / lockfile。

### 红测试（在 `56fa2cb` 上）

```text
$ pnpm exec vitest run src/persistence/recovery.test.ts
FAIL src/persistence/recovery.test.ts [ src/persistence/recovery.test.ts ]
Error: Cannot find module './recovery.js' imported from
  .../src/persistence/recovery.test.ts
Test Files  1 failed (1)
     Tests  no tests
VITEST_EXIT=1

$ pnpm run typecheck
src/persistence/recovery.test.ts(12,41): error TS2307: Cannot find module
  './recovery.js' or its corresponding type declarations.
TYPECHECK_EXIT=2
```

### 绿测试（在 `40b3a96` 上）

```text
$ pnpm verify
$ tsc -p tsconfig.json --noEmit          # 无错误
$ vitest run
Test Files  33 passed (33)
     Tests  419 passed (419)
$ tsc -p tsconfig.build.json             # 无错误
VERIFY_EXIT=0
```

新增用例单独运行：

```text
$ pnpm exec vitest run src/persistence/recovery.test.ts
Test Files  1 passed (1)
     Tests  12 passed (12)
```

### 重启（模拟）证据

- “崩溃前”用 `createTenukiGoRulesPort()` 现场下 14 个 action（12 play + 2 pass，
  含一次双方连续 pass 后继续），`serializeCanonicalGameRecord` 写成 JSON 字符串。
- “重启后”换一个全新端口、全新 `Session.create` 的两个 lane 对象与新的 `SessionStore`，
  调 `restoreCompanionRuntime`：返回的 `sessions.work/go` 是**重启后新的 live 对象**
  （`toBe`），CompanionState 与保存值 `toEqual`，`attentionMode = "strict"`。
- 恢复出的 `game.record` 与原记录 `toEqual`；`game.state` 与崩溃前现场 `toEqual`
  （整对象），并单独断言 `stones`、`toPlay`、`moveNumber = 14`、`captures`、`lastMove`、
  `status = "playing"`、`outcome = null`。
- 同一份持久化输入、两个独立新端口各恢复一次：`state` 互相 `toEqual`，也等于现场
  `liveSnapshot`，`gameId` / `colors` 与入参一致——恢复结果可重复、不是残留对象。

### resigned 对局重启证据

- 现场：6 个 action（5 play + 1 pass）后 `user` 退子，记录以 resign 结尾。
- 重启恢复后：`status = "over"`、`outcome = { winner: "deepseek", loser: "user",
  reason: "resignation" }`、`resignation = { resignedBy: "user", winner: "deepseek" }`。
- 棋盘停在退子前：`stones`、`moveNumber = 6`、`captures`、`lastMove` 与退子前现场
  `toEqual`（resign 不改棋盘）。
- 重启后在同一端口继续 `play` / `pass` / `resign`：三个结果全部 `ok: false`、
  `reason = "game-over"`；`port.getState` 仍与恢复状态 `toEqual`。

### 无事务 / 无 journal 证据

- 恢复前后对 CompanionState 所在目录 `readdir`，结果始终只有 `['companion-state.json']`；
  恢复过程不写事务文件、journal、`.jsonl` 或 pending 命令文件。
- 返回值里没有任何 pending 命令或焦点意图字段；`Object.keys(focus)` 恰为
  `['activeLane', 'llmRunning']`。

### 测试有牙齿（临时变异，已还原）

每次只看 `src/persistence/recovery.ts`，跑完立即写回原文件；还原后
`recovery.test.ts` 12/12 通过，`git status` 无残留改动，变异未进入任何提交。

| 变异 | 结果 |
|---|---|
| M1 `focus.activeLane` 改 `'go'` | 2 failed / 10 passed：`restarts into Work focus by default`、`recovers a session-only restart when no game was persisted` |
| M2 恢复后把 resigned 状态改回 `playing` / `outcome: null` | 1 failed / 11 passed：`keeps a resigned game terminal ...` |
| M3 go lane 缺失时不报错，顶替 work session | 1 failed / 11 passed：`rejects a restart where the go lane session was not restored` |
| M4 去掉 attention mode 校验 | 1 failed / 11 passed：`rejects a persisted attention mode outside the frozen four` |

## 未验证 / 已知事项

- **没有真实进程崩溃测试**：本票的“重启”是流水线级模拟（新端口 + 新 Session 对象 +
  从磁盘读回 JSON），没有 kill 进程、没有经 DSH Profile 启动-退出-重启的端到端证据。
  Spec §36 未要求真实崩溃注入，但这是与“真机重启”的差距。
- **Session 数据本身未持久化**：DSH 拥有 Session 存储，本模块只校验 `SessionStore` 里
  两个 lane 已恢复。若 AgentLoop 尚未物化 lane，恢复会报错而不是重建。
- **未校验 persona/mood 结构**：沿用 D-T04 的决定（不冻结 schema），只校验 attention mode。
- **未接线到插件入口**：`src/index.ts` 未调用 `restoreCompanionRuntime`；恢复的调用点
  （启动顺序、CompanionState 路径、CompanionState 缺失时播种什么默认值）属于集成票。
- **未加 barrel**：`src/persistence/index.ts` 不存在，消费方按路径导入；是否提升为
  包内公共入口留给集成决定。
- **未推送、未开 PR、未跑远端 CI**；本 handoff 只覆盖本地 worktree 证据。
- **Node 版本警告**：本机 `node v26.10.0`，`package.json` engines 要求 `>=24.11.1 <25`；
  pnpm 只 WARN，`pnpm verify` 仍 exit 0。
- Baseline 文档未在本票修改；`BL-HARD-01` 状态应在合并后的同步提交中依据合并源码 +
  测试证据更新。

## 需决定 / 风险

- **合并顺序**：本分支在 F-T02 之上。若先合 F-T01，会连带 F-T02 的提交；应先合 F-T02
  （`work/f-t02-replay-recovery`），再把本分支合并/同步。本票未做 rebase（工程规范禁止）。
- **`origin/main` 已前移**：`6e7293a`（PR #96，docs-only）。集成时需要一次同步提交，
  预计与 `src/persistence/` 无冲突。
