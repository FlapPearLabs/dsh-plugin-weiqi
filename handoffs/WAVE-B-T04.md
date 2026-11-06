# Handoff · WAVE-B-T04

- 状态：READY_FOR_REVIEW
- 分支：`work/b-t04-captures-settlement`
- 开发 worktree：`<dev worktree>`（本机绝对路径不入库，仓库为公开仓库）
- 基线 BASE_SHA：`7b6521092c6d71bc5c57539ad20efddf73de046c`（`origin/main`，B-T02 合并提交 / PR #83）
- 测试套件 commit：`4133cb2943e5129b85816645d58899ae442b510c`
- 文档 commit：本文件（送审 HEAD 为含本文件的提交）
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标（BL-GR-05：NOT_IMPLEMENTED → IMPLEMENTED_VERIFIED）：按 Spec §25/§31，为端口建立**确定性、逐用例**的验收证据：提子、自杀拒绝、pass、两连 pass 结算、死子确认、分歧回到对局。
- 票据验收标准（逐条）：
  1. 单子 / 多子提子的确定性夹具 —— 见「逐用例输出」第 1–4 条。
  2. 自杀被拒绝（非法、棋盘不变）—— 第 5–7 条（含群自杀与「一气仍合法」的反向对照）。
  3. pass —— 第 8–9 条。
  4. 两连 pass → 结算 —— 第 10–12 条。
  5. 死子确认 —— 第 13–14 条。
  6. 分歧 → 恢复对局 —— 第 15 条。
  7. 被提子计入 state；公共类型不含 tenuki 内部对象 —— 第 1–4、16 条。
  8. `pnpm verify` 退出码 0 —— 见「验证命令与结果」。
- 明确非目标（票据原文）：不做计分/超级劫（B-T03），不做 §31 全套十一例（B-T05），不新增第二个规则权威，不序列化 tenuki 内部对象，不加依赖。

## 做了什么

- 新增 `src/rules/tenuki-adapter-capture-settlement.test.ts`（447 行，16 个用例），全部通过真实 `createTenukiGoRulesPort()` 驱动端口，**未 mock tenuki**，每个用例的棋盘坐标、手数、比分都是可手算的常量。
- **未修改任何产品源码**：16 个用例在 B-T02 的实现上首跑即全绿，本票没有证明出适配器缺陷（见「为什么没有 fix: commit」）。未改 `src/contracts/`、未改 `package.json`/锁文件、未加依赖。
- 因为新 worktree 没有 `node_modules`，执行了一次 `pnpm install --frozen-lockfile`（62 个包，锁文件与 manifest 无改动，`node_modules/` 已被 `.gitignore` 忽略）。

### 用例与夹具

| # | 用例 | 夹具要点 |
|---|---|---|
| 1 | 黑提一白子：`captured` 载荷 + `captures.user === 1` | 白 (0,0) 被黑 (1,0)/(0,1) 提 |
| 2 | 白提一黑子：`captures.deepseek === 1` | 反向，证明黑白计数没有写反 |
| 3 | 两次提子累计进 state | 同色两次提子后 `captures.user === 2` |
| 4 | 一步提两子（多子提） | 黑 (0,0)+(1,0) 被白 (2,0)/(0,1)/(1,1) 一次提掉 |
| 5 | 单子自杀被拒 | 白下 (0,0)，两邻为黑；`suicide`，状态逐字段不变 |
| 6 | 整块自杀被拒 | 白块 (1,0)+(0,0) 一并零气；`suicide`，状态不变 |
| 7 | 一气自紧仍合法（反向对照） | 白 (0,0) 只剩一气 (0,1)；必须接受，随后被黑提 |
| 8 | pass 推进手数/计数，下一手落子清零 | `consecutivePasses` 1→2→0 |
| 9 | 两连 pass 未确认结算前，落子仍被接受 | `status` 仍 `playing`，计数归零 |
| 10 | 未满两 pass 结算被拒 | `not-two-passes`，状态不变 |
| 11 | 两连 pass + 同意 → 显式 area 比分与 outcome | 黑 81 / 白 7.5 / 差 73.5，`score()` 与结算一致 |
| 12 | 结算终局：play / pass / settle 全拒且状态不变 | 三次都是 `game-over` |
| 13 | 死子对照：不确认死子时的比分 | 白地 66，黑 2 子，差 77.5 |
| 14 | 确认死子：死子迁入对方地，棋盘不动 | 白地 66→75、黑 0、差 88.5；棋盘仍 8 子、`captures` 不变 |
| 15 | 分歧：忽略提交的死子，回到第 12 手 | `consecutivePasses 0`、`lastMove` = 白 (2,3) 第 12 手、可再 pass |
| 16 | 公共边界：结果里只有纯数据 | 递归检查原型，移动/快照/结算结果均无引擎对象 |

死子夹具（第 13–15 条）：白在 x=3（y=0..2）与 y=3（x=0..2）砌墙，封死左上 3×3 角；黑在角内 (0,0) 与 (1,1) 各一子。角内 9 点 = 2 黑子 + 7 空点（同时接触黑白 → 中立）；墙外 66 点只接触白子 → 白地。确认死子后，2 个死子点 + 7 个中立点全部计入白地（66→75），黑子 0。

## 逐用例输出

`pnpm exec vitest run src/rules/tenuki-adapter-capture-settlement.test.ts --reporter=verbose`：

```text
 ✓ WAVE-B-T04 single capture (Spec §31) > captures one white stone and counts it for black
 ✓ WAVE-B-T04 single capture (Spec §31) > captures one black stone and counts it for white
 ✓ WAVE-B-T04 single capture (Spec §31) > accumulates separate captures in the state
 ✓ WAVE-B-T04 multi-stone capture (Spec §31) > removes a two-stone group in one move and counts both stones
 ✓ WAVE-B-T04 suicide rejection (Spec §31) > rejects a single-stone suicide with no board or counter mutation
 ✓ WAVE-B-T04 suicide rejection (Spec §31) > rejects a whole-group suicide with no board mutation
 ✓ WAVE-B-T04 suicide rejection (Spec §31) > accepts a self-atari instead of misclassifying it as suicide
 ✓ WAVE-B-T04 pass (Spec §31) > advances the turn, records the pass and clears the count on the next play
 ✓ WAVE-B-T04 pass (Spec §31) > accepts a play instead of settling while the ending is not confirmed
 ✓ WAVE-B-T04 two-pass ending (Spec §31) > refuses to settle before two consecutive passes without mutation
 ✓ WAVE-B-T04 two-pass ending (Spec §31) > settles a two-pass ending with an explicit area score outcome
 ✓ WAVE-B-T04 two-pass ending (Spec §31) > is terminal: later play, pass and settle leave the settled state unchanged
 ✓ WAVE-B-T04 dead-stone confirmation (Spec §31) > leaves enclosed stones counted as live when nothing is confirmed dead
 ✓ WAVE-B-T04 dead-stone confirmation (Spec §31) > moves confirmed dead stones into the opponent score without mutating the board
 ✓ WAVE-B-T04 disagreement -> resume play (Spec §25) > ignores the offered dead stones and resumes from the pre-ending position
 ✓ WAVE-B-T04 public boundary > returns only plain contract data, with no engine objects in any result
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

关键断言的实际值（第 11、13、14 条）：

```text
两连 pass 结算（黑 (2,2)）：
  black { stones: 1, territory: 80, komi: 0,   total: 81   }
  white { stones: 0, territory: 0,  komi: 7.5, total: 7.5  }
  margin 73.5, winner user, outcome { winner: user, loser: deepseek, reason: score }

死子对照（封角夹具）：
  未确认死子  black { stones: 2, territory: 0,  total: 2   }
              white { stones: 6, territory: 66, total: 79.5 }  margin 77.5
  确认死子    black { stones: 0, territory: 0,  total: 0   }
              white { stones: 6, territory: 75, total: 88.5 }  margin 88.5
  两种情况下棋盘都是 8 子、captures 都是 { user: 0, deepseek: 0 }
```

## 变异牙齿证据

基线 `4133cb2` 上 16/16 全绿，所以「每例都能失败」用变异证明。变异**临时施加在本工作树的 `src/rules/tenuki-adapter.ts`** 上，每次运行后立即从 `HEAD` 还原；脚本结束再还原一次，`git status` 确认只剩测试文件（无任何变异残留、未提交）。每行是该变异下本套件的失败数：

| 变异 | 改动 | 结果（失败用例） |
|---|---|---|
| 基线 | — | 16 passed |
| M1 | `captures[black]` / `captures[white]` 映射对调 | **5 failed**：3 条单子提子 + 多子提子 + 一气对照（后续提子被拒） |
| M2 | `classifyIllegal` 恒返回 `superko` | **2 failed**：单子自杀、整块自杀 |
| M3 | 落子后自己只剩 1 气也判 `suicide` | **3 failed**：一气对照 + 依赖它的提子用例 + 形状用例 |
| M4 | 落子不再把 `consecutivePasses` 清零 | **3 failed**：pass 用例、两 pass 后落子、分歧恢复 |
| M5 | pass 不再自增 `consecutivePasses` | **7 failed**：pass、结算、终局、两条死子、分歧、形状 |
| M6 | 结算门槛从「2 pass」放宽到「1 pass」 | **1 failed**：未满两 pass 结算被拒 |
| M7 | 结算不再 `markDeadAt` | **1 failed**：确认死子后的比分 |
| M8 | play 不再拒绝终局 | **1 failed**：结算后 play 被接受 |
| M9 | 快照里挂上 tenuki `Game` 对象 | **1 failed**：公共边界纯净性 |

## 关键行为观察（供后续票使用）

- **`captures` 映射**：`captures[black] = whiteStonesCaptured`、`captures[white] = blackStonesCaptured`，黑白两个方向都有用例锁住（M1 证明对调会被抓）。
- **自杀分类**：适配器用一份 hypothetical 棋盘转移的 `libertiesAt === 0` 区分 `suicide` 与 `superko`；整块自杀同样报 `suicide`（不是只判单子）。
- **tenuki 的 `territory()` 只在它自己的两连 pass 终局下计算**（`game.territory()` 在 `!isOver()` 时返回空数组），所以**未结算的对局里 `score().territory` 恒为 0，只有子数有意义**。分歧恢复后的状态属于未结算对局，第 15 条因此只断言 `score()` 的子数（证明死子未被应用），不断言地盘。
- **`markDeadAt` 的死子语义是 tenuki 的连通区域**：从被标记的棋子经空点连通到的同色棋子会一起标死；封角夹具里两块黑子在同一条空点通道上，因此标一块等于标两块。适配器不额外解释这个语义，也不外泄 tenuki 对象。
- **结算后 `status: 'over'`、`consecutivePasses` 保留为 2**，`state.stones` 仍是棋盘上的 8 子（死子不从棋盘移除），`captures` 只统计真实提子、不含死子。

## 验证命令与结果

```text
$ pnpm verify
EXIT=0
$ tsc -p tsconfig.json --noEmit        # 通过
 Test Files  25 passed (25)
      Tests  288 passed (288)          # 272 既有 + 16 新增
$ node --eval "...rmSync('lib')"       # clean 通过
$ tsc -p tsconfig.build.json           # build 通过

$ pnpm exec vitest run src/rules/tenuki-adapter-capture-settlement.test.ts
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

- 改动前基线（`7b65210`，未加本文件）：`pnpm test` → 24 files / 272 tests passed。
- 改动后：25 files / 288 tests passed（+1 文件 / +16 用例），typecheck、build 均通过。

## 未验证与边界

- **没有 `fix:` commit**：16 个用例在 B-T02 的适配器上首跑全绿；本票范围内没有证明出适配器缺陷，因此按「只做必须改的」原则不改产品代码。若有审查意见认为某条行为本身不该如此（例如「两连 pass 后、结算确认前仍接受落子」），那是契约/设计取舍，需要改契约或答复，不是本次可自行修的实现错误。
- **本机 Node 版本**：本机为 v26.10.0，`package.json` engines 要求 `>=24.11.1 <25`，`pnpm` 报 engine 警告；本地绿不等价于 CI（Node 24.11.1）上的绿。
- **没有推送 / 没有 PR / 没有 CI run**：按任务约束只在本 worktree 提交，GitHub Actions 证据需推分支后补齐。
- **`tsconfig.json` 的 `include` 只有 `src/**/*.ts`**，本文件在 `src/rules/` 下因此**被**仓库级 typecheck 覆盖（与只在 `tests/` 下的套件不同）。
- **Baseline 未翻转**：`docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` 的 BL-GR-05 仍是 `NOT_IMPLEMENTED`；按既有流程由合并后的 post-merge sync PR 更新，本票不改。
- **计分/超级劫未覆盖**：`simple ko`、`positional superko`、固定收官的手算 area 比分属于 B-T03；§31 十一例全套（含 canonical replay/restoration 与 resignation 合并例）属于 B-T05。本套件只锁 B-T04 的六类行为。
- **12 手之前的分歧恢复**：B-T02 的解密路径已覆盖「分歧后重放并保留 positional superko 历史」（`disagreement -> resume play` 的既有用例），本票只在封角夹具上补了「不应用死子」的新断言，没有重复 B-T02 的重放细节。

## 已知问题 / 遗留

- **适配器对死子点的入参未做校验**：`settle` 会静默忽略越界的 `deadStones` 点，也会接受空点（tenuki 标死后不产生任何效果）。契约没有规定拒绝语义，本票不扩范围；若 UI 需要显式错误，应在 B-T03/B-T05 或契约票里定，而不是在本票顺手改。
- **`choose`/UI 层的「死子确认」交互不在本票**：本票只锁端口行为，渲染与确认流程属于 UI 票。
- 与 B-T02 的 `tenuki-adapter.test.ts` 有意轻微重叠（pass / 两连 pass / 分歧基础路径）：B-T02 锁适配器机制与快照不可变，本票锁 §31 的逐用例语义与死子/提子数值；未修改或弱化任何既有测试。
