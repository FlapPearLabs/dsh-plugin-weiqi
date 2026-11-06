# Handoff · WAVE-C-T08

- 状态：READY_FOR_REVIEW
- 分支：`work/c-t08-deep-think-boost`
- 基线 BASE_SHA：`71ec784`（`origin/main`，C-T02 合并后）
- 红测试 commit：`899c8fe`（`test: add red tests for the bounded §23 deep-think boost`）
- 绿代码 commit：`0dc3652`（`feat: implement the bounded §23 deep-think boost`）
- 本 handoff 以 `docs:` 单独提交
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标（BL-BUD-03：NOT_IMPLEMENTED → IMPLEMENTED_VERIFIED）：按 Spec §23 实现 `go.request_deep_think` 的**单次有界** boost，接入 C-T07 的 enforcement 边界。
- 票据验收标准（逐条）：
  1. single bounded increment；
  2. request still capped（不得突破 §22.1 绝对 per-request hard cap）；
  3. turn ceiling unchanged（不得移除 §22.2 整体回合上限）；
  4. 无 unlimited mode；
  5. `pnpm verify` 退出码 0。

## 选定的边界（exact bound）

**一次 `go.request_deep_think` 只授予 1 个额外的 model step，整回合最多 1 次。**

- boost 形态：`DEEP_THINK_BOOST_MODEL_STEPS = 1`，只在 `modelSteps` 已到 `maxModelSteps` 时被消费；未用到的额外步不累积。
- 不改的字段：`perRequestMaxTokens`、`maxTurnTokens`、`remainingTurnTokens()` 与 request-cap listener 全部保持原样。boost 步的请求仍被 clamp 到 `min(perRequestMaxTokens, remainingTurnTokens())`。
- 为什么是“加一步”而不是“加 token”：§22 的五个数值属于 BL-BUD-06 / WAVE-C-T10 的 benchmark 标定，本票不得发明任何数值；而 `perRequestMaxTokens` 本身就是 §22.1 的绝对上限，没有“低于绝对上限的常规请求上限”可供 token boost 提升，任何 token boost 要么是空操作、要么违反 §23“boost cannot exceed absolute per-request hard cap”。加一步是结构性、无标定数值的有界增量，逐条满足 §23 三条规则。
- 状态暴露：`snapshot().deepThinkBoost = { pendingModelSteps, grantedModelSteps, consumedModelSteps }`（均为 0/1）；`beginDeepThink()` 返回 `{ granted: true, modelSteps: 1 }`；工具结果 `applied: true`。

## 拒绝语义（§23 “no unlimited mode”）

- 同一回合第二次请求：抛 `GoDeepThinkAlreadyRequestedError`，`deepThinkRequests` 保持 1，不叠加、不合并额度。
- committed play/pass/resign 之后：`beginDeepThink()` 与 `beginModelStep()` 均抛 `GoTurnAnalysisEndedError`；已授予但未用的 boost 保持 pending，但永远不能再用。
- 回合 token 耗尽之后：`beginDeepThink()` 抛 `GoTurnBudgetExhaustedError('maxTurnTokens')`；已授予的 pending boost 也不能让 `beginModelStep()` 穿过 `maxTurnTokens`。
- 拒绝顺序：先 §24 终局 → 再 `maxTurnTokens` 耗尽 → 最后重复请求。耗尽存在时以 §22.4 为准。

## 改动

- `src/budget/enforcement.ts`
  - 新增 `GoDeepThinkAlreadyRequestedError`、`GoDeepThinkBoost`、`GoDeepThinkGrant`。
  - `GoTurnBudgetSnapshot` 增加 `deepThinkBoost`；`beginDeepThink` 返回 grant，不再只是计数。
  - `beginModelStep`：model-step 上限改为 `maxModelSteps + boostGrantedModelSteps`；在 `modelSteps >= maxModelSteps` 且 boost pending 时消费 boost；`maxTurnTokens` 门不变。
  - `snapshot()` 输出 boost 三个计数。
  - 注释从“boost 归 C-T08、本边界不实现”更新为实际语义。
- `src/tools/go/go-tools.ts`
  - `runRequestDeepThink` 返回 `{ ok: true, requested: true, applied: true }`。
  - 模块头注释与工具描述同步为“one additional model step, caps unchanged, second request rejected”。
- `src/tools/go/types.ts`：`GoDeepThinkResult.applied` 从 `false` 改为 `true`，文档注释同步。
- 未改：`src/contracts/*`、`src/budget/config.ts`、`request-cap.ts`、`package.json` / `pnpm-lock.yaml`、主检出、其他票据范围。

## 红 / 绿证据

红（`899c8fe`，仅测试）：

```text
pnpm exec vitest run src/budget src/tools/go
Test Files  2 failed | 4 passed (6)
     Tests  9 failed | 102 passed (111)
exit 1
pnpm run typecheck -> exit 2
  TS2305: no exported member 'GoDeepThinkAlreadyRequestedError' (2 处)
  TS2339: Property 'deepThinkBoost' does not exist on GoTurnBudgetSnapshot (2 处)
```

绿（`0dc3652`）：

```text
pnpm exec vitest run src/budget src/tools/go
Test Files  6 passed (6)
     Tests  111 passed (111)
pnpm verify -> exit 0
  tsc -p tsconfig.json --noEmit
  Test Files  31 passed (31)
       Tests  403 passed (403)
  clean
  tsc -p tsconfig.build.json
```

新增用例 8 个（enforcement 6 + go-tools 2），并改写原有 2 个 deep-think 用例（原先断言“第二次请求也接受 / applied: false”）。

## 边界测试清单（before grant / at cap / after commit / after exhaustion）

- **before grant**：`allows exactly maxModelSteps model steps and denies the next one`（既有）；新用例先断言到 cap 后被拒，再请求 boost。
- **at cap（单次增量）**：`grants exactly one extra model step and never an unlimited mode` —— cap 1：0→1 正常，第 2 次被拒 → 请求 boost → 第 2 步放行并消费（pending 0 / consumed 1）→ 第 3 步再次被拒（`limit: 2, used: 2`）。
- **duplicate**：`rejects a second request in the same turn instead of stacking boosts`，`deepThinkRequests` 保持 1。
- **request still capped / turn ceiling unchanged**：`keeps the per-request token cap and the turn ceiling unchanged for the boosted step` —— 已用 40/100、`perRequestMaxTokens` 257，boost 步请求被 clamp 到 60；`remainingTurnTokens()` 仍为 60，`limits` 原样。
- **after exhaustion（不授予）**：`does not grant a boost once the turn token budget is exhausted`。
- **after exhaustion（pending 也不能用）**：`cannot apply a pending boost through an exhausted turn ceiling` —— pending 仍为 1、consumed 0、`modelSteps` 不增。
- **after commit**：`keeps a granted boost unusable after a committed action` —— play 之后 `beginModelStep` / `beginDeepThink` 都抛 `GoTurnAnalysisEndedError`，boost 未消费。
- **工具层接线**：`grants exactly one extra model step through the shared enforcement` —— 通过 `go.request_deep_think` 注册路径授予，再由同一 enforcement 放行第 2 步、拒绝第 3 步。

## 测试有牙（活体变异，均已复原）

- 变异 A：删掉重复请求守卫（`if (boostGrantedModelSteps > 0) throw ...`）→ **2 个用例红**（enforcement 与 go-tools 各一条 `rejects a second request...`）。
- 变异 B：把 `DEEP_THINK_BOOST_MODEL_STEPS` 从 1 改为 2 → **7 个用例红**，包括 `grants exactly one extra model step...`、两个耗尽用例、commit 用例与工具层两条。
- 复原后 `md5 -q src/budget/enforcement.ts` = `1a4422fb91a2e0b5eed1c49674289214`，与变异前一致；随后 `pnpm verify` 再次退出码 0。

## 关键契约决定

- **boost 只影响 model-step 计数，不碰 token 上限**：request-cap listener 的 clamp 路径完全没有改动，因此 §22.1 的绝对上限与 §22.2 的回合上限在结构上都不可能被 boost 抬高。
- **boost 在“需要时才消费”**：grant 后先让正常 step 走完；只有将要超过 `maxModelSteps` 的那一步才消费。这样一次授权必定换来一次实际增量，不会因为提前用掉而白白蒸发。
- **不累计、不合并**：`grantedModelSteps` 一旦为 1，第二次请求直接报错；不存在“等待中再存一次”的路径。
- **拒绝顺序固定**：§24 终局 → `maxTurnTokens` → 重复请求。已经授予的 boost 不会改变这三个门的判定。
- **没有新增数值标定**：1 是结构性单位，不是 benchmark 结果；生产数值仍归 C-T10。
- **不新增公共导出**：boost 类型与错误在 `src/budget/enforcement.ts` 内导出，`src/tools/go/types.ts` 只更新既有结果类型；包出口未变。

## 限制与未验证

- **没有接真实 pinned-DSH AgentLoop**：worktree 内没有可执行的 Go agent 运行时；本票在 enforcement 与工具注册层验证，`beginModelStep()` 的调用方（由 C-T02 接线）必须保证每个真实 model step 都经过它，否则 boost 不会被消费、也不会生效。
- **boost 不增加 token 额度**：这是有意的边界（见上）。如果未来 benchmark（C-T10）证明需要“单次请求更长的推理”，那属于契约/数值变更，需先走 Spec 或 BL-BUD-06 流程，不在本票内。
- **granted-but-unused boost 会保持 pending 直到回合结束**：这是记录状态，不是额外消耗；snapshot 里可见。
- **没有 bypass 测试套件**：C-T09（§39.4）负责对抗式绕过；本票只用重复请求与耗尽/落子边界证明单次性。
- **没有生产数值**：所有 fixture（`NON_PRODUCTION_BUDGET`）仍是注入的测试值。
- 本机 Node v26.10.0，`package.json` 声明 `>=24.11.1 <25`，`pnpm` 打印 engine 警告；CI 固定 Node 24.11.1。证据来自本机。
- 为跑测试在 worktree 内执行了 `pnpm install --frozen-lockfile`；`pnpm-lock.yaml` / `package.json` 无改动，未新增依赖。

## 已知缺陷

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| — | — | 未发现 P0/P1 级缺陷 | — |
| N-1 | 说明 | grant 之后 model-step 耗尽错误的 `limit` 报 `maxModelSteps + 1`（授予后的实际上限） | 设计决定，测试已断言 `limit: 2, used: 2` |
| N-2 | 说明 | 已授予但未消费的 boost 在 commit 后仍留在 snapshot 的 `pendingModelSteps` 中 | 只读状态，无法再被应用；测试覆盖 |

## 不要做什么

- 不要加 unlimited / 多档 boost，或按模型步数以外的维度叠加额度。
- 不要为实现 token boost 发明数值或改动 §22 字段（需 Spec / C-T10）。
- 不要顺手改 `request-cap.ts`、contracts、bypass 测试（C-T09）或 benchmark（C-T10）。
- 不要 `git add .`；不要 push / PR / merge。

## 下一步（审查者 / 合并后）

- 审查：Standards（是否只动 `src/tools/go/`、`src/budget/` 与测试；是否发明数值；测试是否有牙）+ Spec（§23 三条规则、§22.4、§24）。
- 合并后按流程同步 `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` 的 BL-BUD-03 行为 IMPLEMENTED_VERIFIED（本票不直接改 Baseline）。
- C-T09 / C-T10 可据此测量 deep-think 的实际行为：`deepThinkRequests`、`deepThinkBoost` 三个计数与 `modelSteps`。
