# Handoff · WAVE-B-T05

- 状态：READY_FOR_REVIEW
- 轮次：Round 1
- 票号：WAVE-B-T05（BL-GR-07: NOT_IMPLEMENTED → 待审 IMPLEMENTED_VERIFIED）
- 分支：`work/b-t05-fixture-suite`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-T05`
- 基线 BASE_SHA：`71ec784240b5554c69b46a0f1b41ba0419bb059d`（= `origin/main`，含 B-T03/B-T04/B-T06）
- 代码 HEAD_SHA：`34fc6ca`（本票唯一代码提交）
- Spec 权威：`docs/spec/SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md` §31（并引用 §25/§26/§28）
- 依赖：WAVE-B-T03 / B-T04 / B-T06（均已合并）

## 目标与验收

目标：按 Spec §31 建立 engine-independent 的 11 例确定性夹具套件，只经由
`GoRulesPort` 验证，可在 Go UI 工作前作为 CI 门禁；不引入第二规则权威、
不序列化 Tenuki 内部、不削弱既有 B-T02/B-T03/B-T04/B-T06 测试。

票面验收：tests = 11，pass = 11，fail = 0，skip = 0；resign 用例证明
（a）resign 立即终端、（b）对手获胜、（c）之后 play/pass 不被接受、
（d）canonical replay 保持 resigned 终态、（e）退子前棋盘不被改动；CI 证据。

## 已完成

- 新增 `src/rules/spec31-fixtures.test.ts`（507 行，1 个测试文件、11 个 `it`）。
  - 只 import 契约类型、`createTenukiGoRulesPort` 工厂，以及 B-T06 的
    `canonical-record` / `replay`；不 import `tenuki`，不读引擎内部对象。
  - 全部夹具为固定脚本：无 `Date`、无 `Math.random`、无 `setTimeout` /
    `setInterval` / `performance.now`（已 grep 验证 0 命中）。
  - 每个用例断言精确期望值（棋盘点集、captures、手数、轮到谁、连续 pass、
    lastMove、score 明细、outcome），不做模糊匹配。
- 未改任何产品源码；未新增依赖；未改 `package.json` / lockfile；
  未改 B-T02/B-T03/B-T04/B-T06 的任何测试。

## 11 例清单与逐例断言

| 例 | §31 用例 | 夹具（颜色：user=黑，deepseek=白） | 精确期望 |
|---|---|---|---|
| F01 | single capture | 黑(1,0)、白(0,0)、黑(0,1) 提子 | captured = [(0,0) 白]；captures {user:1, deepseek:0}；棋盘 0,1 / 1,0；moveNumber 3；toPlay deepseek |
| F02 | multi-stone capture | 黑(0,0)(1,0) 两子被白(1,1) 一手提掉 | captured 点集 0,0 / 1,0 且全黑；captures {user:0, deepseek:2}；棋盘 0,1 / 1,1 / 2,0 / 8,8；moveNumber 6 |
| F03 | suicide rejection | 黑围住 (0,0) 后白自填 | reason = `suicide`；`result.state` 与 `getState` 均等于落子前快照；moveNumber 3；captures 0/0 |
| F04 | pass | 双方连续 pass 后再落子 | 第 1 次：captured []、棋盘不变、consecutivePasses 1、toPlay deepseek、moveNumber 1、lastMove pass#1；第 2 次计数 2；随后落子清零至 0、moveNumber 3 |
| F05 | two-pass ending | 黑(2,2) + 双方 pass 后同意结算 | score 黑 {1,80,0,81}、白 {0,0,7.5,7.5}、margin 73.5、winner user；status over；outcome score；后续 play/pass 均 `game-over` 且状态不变 |
| F06 | dead-stone settlement | 封死 3x3 角，确认 (0,0)(1,1) 为死子 | score 黑全 0、白 {6,75,7.5,88.5}、margin 88.5、winner deepseek；棋盘 8 子不变；captures 0/0 |
| F07 | disagreement -> resume | 同上，`agreed:false` 并提交死子 | settled false、reason `disagreement`、status playing、consecutivePasses 0、moveNumber 12、lastMove 白(2,3)#12、棋盘不变；随后 pass 接受、计数 1、moveNumber 13 |
| F08 | ko / positional superko | 先构造劫：黑(2,1) 提白(1,1)；再跑 27 手重复循环 | 提劫 accepted、captured [(1,1) 白]、captures user 1、moveNumber 9；立即反提 rejected `superko` 且状态不变；劫材交换（白(6,6)、黑(7,7)）后反提 accepted、captured [(2,1) 黑]、captures 1/1、moveNumber 12；27 手后白(1,0) 重复局面 rejected `superko`、状态不变、随后 pass 接受 |
| F09 | area scoring + komi 7.5 | 黑填 y=4、白填 y=5 各 9 子 + 两次 pass | score 黑 {9,36,0,45}、白 {9,27,7.5,43.5}、winner user、margin 1.5；status 仍 playing、consecutivePasses 2 |
| F10 | resignation terminal | 黑(2,2)、白(3,3) 后白退子 | outcome {winner user, loser deepseek, reason resignation}；status over；stones/moveNumber/toPlay/lastMove/captures/consecutivePasses 与退子前逐项相等；之后 play/pass/resign 全部 `game-over` 且 `getState` 不变 |
| F11 | canonical replay/restoration（含 resigned 终态） | B-T06 的 10 步 play/pass 日志；以及 play,play,play,resign 日志 | 序列化→解析→replay 后与现场对局全字段 `toEqual`（6 子、captures user 1、toPlay user、moveNumber 10、pass 2、lastMove pass#10）；两次独立 replay `toEqual`；resigned 日志 replay 后 status over、outcome resignation、棋盘/手数/captures/lastMove 与退子前一致，后续 play/pass/resign 全部 `game-over` |

## 证据

### 基线（改动前，BASE_SHA `71ec784`）

```text
$ pnpm verify
$ tsc -p tsconfig.json --noEmit
$ vitest run
Test Files  31 passed (31)
     Tests  395 passed (395)
$ tsc -p tsconfig.build.json
exit 0
```

### 绿（HEAD `34fc6ca`）

```text
$ pnpm exec vitest run src/rules/spec31-fixtures.test.ts --reporter=verbose
✓ F01 single capture: one stone removed, counted for the capturer
✓ F02 multi-stone capture: a two-stone group leaves the board in one move
✓ F03 suicide rejection: refused with no board, counter or turn mutation
✓ F04 pass: recorded, counted, turn-advancing and clearing on a later play
✓ F05 two-pass settlement: exact area score and terminal outcome
✓ F06 dead-stone confirmation: confirmed stones score for the opponent, board untouched
✓ F07 disagreement resume: disputed ending rolls back, play continues from there
✓ F08 ko / positional superko: ko recapture waits for a threat, repetition is refused
✓ F09 area scoring + komi 7.5: exact hand-computed endgame totals
✓ F10 resignation terminal: immediate over, opponent wins, no board change, no further action
✓ F11 canonical record -> replay restoration: board, turn, captures; resigned replay stays terminal
Test Files  1 passed (1)
     Tests  11 passed (11)
```

```text
$ pnpm verify
$ tsc -p tsconfig.json --noEmit          # 无错误
$ vitest run
Test Files  32 passed (32)
     Tests  406 passed (406)
$ tsc -p tsconfig.build.json             # 无错误
exit 0
```

### 确定性

- 两次独立运行、去掉耗时字段后 `diff` 退出码 0（11 例结果逐行一致）。
- 源文件 grep `Date|Math.random|setTimeout|setInterval|performance.now` = 0 命中。
- 夹具无随机、无时钟、无并发；每个用例独立 `createGame`，不共享状态。

### 测试有牙齿（临时变异，已恢复，未提交）

- M1：`tenuki-adapter.ts` 中 resign 改为 `{ winner: by, loser: otherPlayer(by) }`
  → **2 failed | 9 passed**：F10、F11 失败，报错
  `expected { winner: 'deepseek' } to deeply equal { winner: 'user' }`。
- M2：`FROZEN_RULES.komi` 7.5 → 6.5 → **3 failed | 8 passed**：
  F05、F06、F09 失败（score 明细与 komi 不符）。
- 两次变异后均恢复；`git diff` 对 `tenuki-adapter.ts` 为空，套件回到 11/11。

### 范围核查

```text
$ git show --stat 34fc6ca
 src/rules/spec31-fixtures.test.ts | 507 ++++++++++++++++++++++++++++++++++++++
 1 file changed, 507 insertions(+)
```

## 需要审查者注意的两点

1. **用例清单口径**：Spec §31 的原始列表把 “simple ko transition” 与
   “positional superko” 列为两例；本票的派单把 ko/superko 合成第 8 例，并单列
   “disagreement resume”。F08 在一个用例内同时断言劫争转移与深层重复局面被
   positional superko 拒绝，因此 §31 列出的每种行为都在 11 例内被断言；没有
   新增或削弱任何行为。
2. **落点**：票面 `Expected Surfaces` 写的是 `tests/fixtures/` + CI job；
   本次派单把可改范围限定为 `src/rules/` 与 `handoffs/`，因此套件放在
   `src/rules/spec31-fixtures.test.ts`，并复用既有 `.github/workflows/ci.yml`
   （`pnpm verify`）作为 CI 门禁，未新增 workflow 文件。

## 未验证 / 已知事项

- **未推送、未开 PR、未跑远端 CI**；本 handoff 只有本地 worktree 证据。
- **Node 版本**：本机 `node v26.10.0`，`package.json` engines 为
  `>=24.11.1 <25`，pnpm 仅 WARN，`pnpm verify` 仍 exit 0；CI 固定 24.11.1，
  未在本票验证。
- **Baseline 文档未改**：按项目规则，`BL-GR-07` 状态在合并后的同步提交中依据
  合并源码 + 测试证据更新。
- **worktree 内的 `node_modules/`、`lib/`** 为本地验证产物，均被 `.gitignore`
  忽略，未提交。
- 本票不覆盖 Wave E 的 UI/桥接、Wave F 的崩溃恢复编排；F11 只验证 canonical
  replay 原语，不实现恢复调度。
