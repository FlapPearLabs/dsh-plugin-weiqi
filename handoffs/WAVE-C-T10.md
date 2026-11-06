# Handoff · WAVE-C-T10

- 状态：READY_FOR_REVIEW（scripted 部分完成；真实 DeepSeek 标定待主人批准）
- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-C-T10`
- 分支：`work/c-t10-benchmark`
- 基线 BASE_SHA：`f6c210fdbaf974bac8a3b3e4b1a0a0d0fe164c92`（`origin/main`，含 F-T02 / B-T05 / C-T08 合并）
- 红测试 commit：`0f9b30dc440a4f2ebd7d1d10676587e99a4c1e2e`
- 绿实现 commit：`6979dec6ab79aec9c31aca212f2c62adff916605`
- 本 handoff 以 `docs:` 单独提交
- 未推送、未开 PR、未合并

## 目标与边界

WAVE-C-T10 / BL-BUD-06（Spec §22、§38、§44）：按 §38 建确定性 benchmark harness，
在**真实生产路径**的 `go.*` 工具上跑八类 fixture，记录全部 §38 指标。

主人尚未批准真实 DeepSeek 调用（花钱 + 凭据），因此本票只完成不依赖批准的部分：

- 真实模型调用：**没有发生**，记录里每个指标都标明来自 scripted adapter；
- 生产 `GoTurnBudget` 默认值：**没有切换**（`src/budget/` 零改动，见「config diff」）；
- 所有候选数值只作为待批准的标定建议记录在案。

## 做了什么

`tests/benchmark/` 新增：

| 文件 | 职责 |
|---|---|
| `fixtures.ts` | §38 八类 fixture（opening / simple capture / escape / local fight / ko / large-group pressure / endgame / ambiguous position），每类固定局面脚本 + 固定模型计划；候选预算常量 |
| `scripted-model.ts` | 确定性 scripted model adapter：逐步发出固定 `go.*` 调用，按固定公式给出合成 input/output token 数，并故意提出 8192 的过大 `maxTokens` |
| `harness.ts` | 单次 run：真实 Tenuki `GoRulesPort` 造局面 → `createGoTurnEnforcement`（C-T07）→ `registerGoTools` + `GoCapabilityGuard`（C-T01/C-T02）→ 每步 `beginModelStep` + S01 `requestTokenCap`；逐步核对 enforcement 计数，绕过即抛 `CognitionBenchmarkBypassError`；`buildBenchmarkRecord` 产出 8 类 × 3 次 |
| `cognition-benchmark.test.ts` | 10 个验收用例（见下） |
| `emit-cognition-benchmark.test.ts` | 校验记录完整性；只有设置 `COGNITION_BENCHMARK_OUT` 时才落盘，`pnpm verify` 不写文件 |
| `run-cognition-benchmark.sh` | 运行 emitter 并写入 `docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json` |

记录与说明：

- 原始记录：`docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json`
  （`generatedAt` 2026-11-04T07:53:49.815Z，24 次 run，8 类各 3 次）
- 人类摘要：`docs/validation/COGNITION_BENCHMARK_SCRIPTED_SUMMARY.md`

## 真实路径接线（不是 mock 规则）

每次 run 都走这些既有生产模块，没有另写一套规则：

1. `createTenukiGoRulesPort()` 真实适配器（B-S01）回放固定 setup 到 DeepSeek 行棋；
2. `registerGoTools({ port, enforcement, guard })` 把八个 `go.*` 注册进
   `GoCapabilityGuard`，执行统一经 `guard.execute`；
3. 每步 `enforcement.beginModelStep()`，请求经 S01 `requestTokenCap` 后再
   `modelStep.complete({ tokens })`；
4. `go.inspect_*` / `go.try_move` / `go.request_deep_think` 的计数由 C-T07/C-T08
   在工具内部真实记账；
5. large-group pressure 第 4 步消费 C-T08 的 +1 boost（`maxModelSteps: 3` → 4 步）。

## 记录指标（每类 3 次，第 1 次展示；结构与摘要表一致）

| §38 类 | latency ms | input | output | steps | inspect | try_move | deep-think | illegal | final move | 3 次 latency range |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| opening | 0.72 | 887 | 352 | 2 | 1 | 2 | 0 | 0 | play (2,4) | 0.63 |
| simple capture | 0.18 | 839 | 320 | 2 | 1 | 1 | 0 | 0 | play (1,2) | 0.10 |
| escape | 0.05 | 791 | 288 | 2 | 1 | 1 | 0 | 0 | play (4,5) | 0.01 |
| local fight | 0.10 | 839 | 320 | 2 | 1 | 2 | 0 | 0 | play (4,3) | 0.09 |
| ko | 0.17 | 839 | 320 | 2 | 1 | 1 | 0 | 1 | play (6,6) | 0.09 |
| large-group pressure | 0.12 | 1658 | 608 | 4 | 2 | 2 | 1 | 0 | play (2,3) | 0.04 |
| endgame | 0.05 | 791 | 288 | 2 | 1 | 0 | 0 | 0 | play (4,5) | 0.01 |
| ambiguous position | 0.09 | 887 | 352 | 2 | 2 | 1 | 0 | 0 | play (4,4) | 0.01 |

- 结构性指标 3 次完全一致（`identicalStructuralMetrics: true`）；只有 wall-clock
  latency 有变化，range 见最后一列。
- ko 类故意在 (1,1) 提回，真实端口以 `superko` 拒绝：`illegalAttempts: 1`，
  随后合法着 (6,6) 成功提交。
- 每步请求都提出 8192，S01 全部 clamp 到 `perRequestMaxTokens: 1024`
  （`oversizedProposalsClamped` = 每一步）。
- token 数是 scripted adapter 的合成记账；latency 是本地 harness 耗时，**都不是
  DeepSeek 的真实测量**。

## 候选默认值与理由（未应用）

| 字段 | 候选值 | 依据 | 是否已标定 |
|---|---:|---|---|
| `maxModelSteps` | 3 | scripted 无 boost 最大 2 步；+1 余量；§23 boost 再 +1（有效上限 4） | 仅结构 |
| `maxInspectCalls` | 4 | scripted 最大 2；+2 余量给真实感知 | 仅结构 |
| `maxTryMoves` | 3 | scripted 最大 2；+1 余量 | 仅结构 |
| `perRequestMaxTokens` | 1024 | **占位值**；scripted 单请求输出从未超过 192，合成 token 不能定真实请求上限 | 否 |
| `maxTurnTokens` | 4096 | **占位值**；scripted 单回合最大 2266，合成 token 不能定真实回合上限 | 否 |

五个字段在运行时都是**硬上限**（不是建议值）：

- `perRequestMaxTokens`：§22.1 绝对单请求上限，C-S01 listener 对已解析配置做 clamp，
  超出只 clamp 不拒绝；
- `maxTurnTokens`：§22.2 回合上限，耗尽后不得再开 model step / inspect / try_move /
  deep-think；
- `maxModelSteps` / `maxInspectCalls` / `maxTryMoves`：按回合计数的硬门。

## config diff：没有应用

```text
src/budget/ 改动：无
git diff f6c210f..HEAD -- src/ -> 空
```

`src/contracts/budget.ts` 明确不携带默认值，`src/budget/config.ts` 只校验注入值；
本票也没有新增生产常量模块。候选值只存在于 `tests/benchmark/fixtures.ts` 的
`CANDIDATE_BUDGET`（标注 candidate-not-applied）和记录/摘要里。

## 红 / 绿证据（真实输出）

红（`0f9b30d`，只有测试文件）：

```text
pnpm exec vitest run tests/benchmark
Test Files  2 failed (2)
     Tests  no tests
Error: Cannot find module './fixtures.js' imported from .../cognition-benchmark.test.ts
exit 1
```

绿（`6979dec`）：

```text
pnpm exec vitest run tests/benchmark
Test Files  2 passed (2)
     Tests  10 passed (10)

pnpm verify -> exit 0
    tsc -p tsconfig.json --noEmit
    Test Files  35 passed (35)
         Tests  436 passed (436)
    clean
    tsc -p tsconfig.build.json
```

记录生成（真实输出）：

```text
./tests/benchmark/run-cognition-benchmark.sh
Test Files  1 passed (1) / Tests  1 passed (1)
cognition benchmark record: docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json
classes 8 runs 24 identical true
```

## 测试清单（10 个）

1. 恰好覆盖 §38 八类、类名不合并、fixture 名唯一；
2. 每个 fixture 都走真实工具/enforcement/boost/cap：commit 动作、步数、inspect/try 计数、
   S01 cap、turn token 与剩余量一致；
3. 每个 fixture 连跑 3 次，结构性指标 JSON 完全相同、latency range 为 0（注入单调时钟）；
4. large-group：deep-think 请求 1 次、boost 消费 1 次、步数 = 3 + 1；
5. ko：1 次非法尝试，reason 为 `go.play superko`，最终着 (6,6)；
6. 8192 的单请求 proposal 全部 clamp 到 1024；
7. **绕过检测**：注入 pass-through enforcement（不记账），run 必须抛
   `CognitionBenchmarkBypassError`；
8. 预算小于脚本时 fail closed：`maxModelSteps: 1` 与 `maxInspectCalls: 0` 都抛
   `GoTurnBudgetExhaustedError`；
9. `buildBenchmarkRecord`：8 类 × 3 次、结构一致、`isDeepSeek: false`、
   `status: 'candidate-not-applied'`；
10. emitter 记录完整性（worktree 测试里同时是 `pnpm verify` 的一部分）。

## 测试有牙（活体变异，均已复原）

| 变异 | 结果 |
|---|---|
| `CANDIDATE_BUDGET.maxTryMoves: 3 -> 0` | **7 failed / 3 passed**，原始错误 `GoTurnBudgetExhaustedError: maxTryMoves (0/0)` |
| 删除 `assertAccounted(...)` 单点核对 | 仍通过：每步核对与 run 末尾的计数对账是两层，任何一层都能抓住绕过；复原后 `md5` 一致 |

复原后 `md5 -q tests/benchmark/harness.ts` = `b3622e0f9a51547521ed45f20df84ddb`，
`md5 -q tests/benchmark/fixtures.ts` = `ecb3c14c7503f0c5aa32a5ef27e3af80`；随后
`pnpm verify` 再次 exit 0。

## 未验证 / 待批准

1. **真实 DeepSeek run 待主人批准**（花钱 + 凭据）：需要真实 latency、真实
   input/output token、真实 model steps 才能替换合成记账；本记录不得当作标定结果。
2. 因此生产 `GoTurnBudget` 默认值**尚未应用**；批准真实 run 后才进入 C-T10 的
   config 步骤（届时需要一个新的、有真实数据的记录）。
3. 本机 Node v26.10.0，`package.json` 声明 `>=24.11.1 <25`，pnpm 有 engine 警告；
   CI 固定 Node 24.11.1。证据来自本机。
4. 为跑测试在 worktree 内执行了 `pnpm install --frozen-lockfile`；
   `package.json` / `pnpm-lock.yaml` 无改动，未新增依赖。
5. scripted latency 是本地 harness wall-clock（约 0.05–0.7 ms），不是模型延迟，
   不能用于超时参数标定。

## 已知限制

- harness 在同一进程内与 enforcement 共信任边界：若 enforcement 直接伪造正确
  snapshot，本 harness 无法分辨；它验证的是「工具执行是否真的经过并推进了记账」。
- 每个 fixture 只覆盖一种局面/一条脚本，不代表 DeepSeek 的真实分布。
- 未接 pinned-DSH AgentLoop（worktree 内没有可执行 Go agent）；harness 用真实工具
  注册、enforcement、boost、S01 listener 组合同一条执行路径，模型步由 adapter 驱动。
