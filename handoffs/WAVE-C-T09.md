# Handoff · WAVE-C-T09

- 状态：READY_FOR_REVIEW
- 分支：`work/c-t09-budget-bypass`
- 基线 BASE_SHA：`40e5a20`（`origin/main`，C-T08 合并后）
- 测试 + CI commit：`c64d906`（`test: add the Spec §39.4 budget bypass suite (WAVE-C-T09)`）
- 本 handoff 以 `docs:` 单独提交
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标（BL-BUD-05：NOT_IMPLEMENTED → IMPLEMENTED_VERIFIED）：按 Spec §39.4 建对抗式预算绕过套件，证明 §22 的硬上限在以下攻击下都成立：大量 `try_move`、大量 inspect、多个 model step、单次超大推理请求、当前 DSH 可用的聚合工具路径。
- 票据验收标准（逐条）：
  1. 每个绕过类别都确定性命中限制（clamp / exhaustion / rejection），边界值精确；
  2. 有专门的 CI job；
  3. `pnpm verify` 退出码 0；
  4. 无真实绕过；若发现，记录精确复现。
- **本票只加测试与 CI，不改任何产品源码**（`git diff --stat -- src` 为空）。

## 改动清单

新增：

- `tests/budget/go-turn-budget-bypass.test.ts`（26 个用例）
  - 走真实的 `createGoTurnEnforcement` 边界；
  - 工具类攻击走真实注册的 `go.*` 表面（`registerGoTools` + `GoCapabilityGuard`），底层是记录调用的 `GoRulesPort`，因此“被拒绝”可以同时断言“没有执行”；
  - 拒绝只认 `GoTurnBudgetExhaustedError` / `GoTurnAnalysisEndedError` / `GoDeepThinkAlreadyRequestedError` 三类；被放行或抛出别类错误都会让测试失败（`rejectionOf`）。
- `.github/workflows/budget-bypass-gate.yml`
  - 独立 job 跑 `pnpm exec vitest run tests/budget --reporter=verbose`；
  - 固定 Node 24.11.1 / pnpm 11.7.0，与 anti-cheat、request-token-hard-cap 门禁一致；
  - 触发路径覆盖本 suite、`src/budget/**`、`src/tools/go/**`、workflow 自身。

未改：`src/**`、`package.json`、`pnpm-lock.yaml`、主检出、其他票据范围。

## §39.4 绕过矩阵与逐条结果

Fixture 预算（测试注入值，非生产标定；BL-BUD-06 / WAVE-C-T10 拥有 §38 数值）：
`maxModelSteps: 2, maxInspectCalls: 3, maxTryMoves: 2, perRequestMaxTokens: 300, maxTurnTokens: 1000`。

| §39.4 绕过类别 | 用例 | 实测结果（精确值） |
| --- | --- | --- |
| 大量 `try_move` | `many try_move calls > admits exactly maxTryMoves...` | 前 2 次执行；第 3 次抛 `GoTurnBudgetExhaustedError{maxTryMoves, limit 2, used 2}`；再连打 50 次全部同值被拒；`tryMoves` 保持 2；port 读次数不增；棋盘未变 |
| 大量 inspect（两个 inspect 工具共享计数） | `many inspect calls > shares maxInspectCalls...` | `inspect_group` + `inspect_region` + `inspect_group` 共 3 次放行；第 4 次抛 `{maxInspectCalls, 3, 3}`；50 次连打不再触达 port |
| 多个 model step | `multiple model steps > admits exactly maxModelSteps...` | 2 次放行；第 3 次抛 `{maxModelSteps, 2, 2}`；50 次连打后 `modelSteps` 仍为 2 |
| 用请求冒充 model step | `multiple model steps > cannot buy a model step by issuing requests...` | 连续 50 次请求全部 clamp 到 300，`modelSteps` 仍 0，`turnTokens` 仍 0 |
| 单次超大请求 | `single oversized reasoning request > clamps ... at the exact boundary` | `10_000_000 → 300`；`300 → 300`（等值放行）；`301 → 300`；`64 → 64`（不抬高）；无 `maxTokens → 300`（必须装上上限） |
| 后置 waterfall 贡献者试图抬高 | `... > cannot be raised by a later contributor inside the waterfall` | 内层先给 300、后置贡献者乘 1000 抬到 300 000，最终仍为 300 |
| 单请求吞掉整个回合 | `... > shrinks to the turn tokens still available after every recorded step` | 3×300 后 `remaining=100`、请求 cap=100；再记 100 后 `remaining=0`、请求 cap=0 |
| 非有限 / 负数提案 | `... > fails closed on a non-finite or negative contributor proposal` | `NaN / -1 / +Infinity` 全部回落到 300 |
| 请求本身不消耗回合 | `... > does not spend turn tokens merely by clamping requests` | 50 个并发请求后 `turnTokens=0`、`remaining=1000` |
| 聚合路径（一个 wrapper 多次执行） | `aggregated tool paths > charges every execution...` | wrapper 连调 25 次 inspect：只执行 3 次后抛 `{maxInspectCalls, 3, 3}`；wrapper 连调 25 次 try_move：只执行 2 次；棋盘未变 |
| 直接调用 + 工具调用混用 | `... > cannot aggregate one direct call and one tool call into a single charge` | 直接 `beginInspect` ×2 + 工具 1 次 = 3；第 4 次被拒，计数与 port 均不增 |
| committed play / pass / resign 之后 | `requests and analysis after a committed action > denies every analysis path after a committed {play,pass,resign}` | 4 条工具分析路径 + 直接 `beginModelStep` 全部抛 `GoTurnAnalysisEndedError`（`action` / `committedAction` / `gameTerminal` 精确匹配）；port 调用数不变；权威状态不变；请求 seam 仍 clamp 到 300，且 `modelSteps` 仍 0 |
| 重复 deep-think 请求 | `deep-think boost attempts > grants the single boost once...` | 第 1 次 `{granted:true, modelSteps:1}`；再连打 50 次全部 `GoDeepThinkAlreadyRequestedError`；`deepThinkRequests=1`，pending/granted 仍为 1/1、consumed 0 |
| boost 试图抬高上限 | `... > cannot raise the per-request cap or the overall turn ceiling` | `limits` 与注入值逐字段相等（含 `maxModelSteps:1` 的覆盖值）；请求仍 300；`remaining=700`；boost 步之后第 3 步抛 `{maxModelSteps, 2, 2}` |
| 耗尽后请求 boost | `... > refuses a boost attempt once the turn tokens are exhausted` | `{maxTurnTokens, 1000, 1000}`；`deepThinkRequests=0`、boost 全 0 |
| 已授予的 boost 穿过耗尽 | `... > cannot spend a granted boost through an exhausted turn ceiling` | 下一步抛 `{maxTurnTokens, 1000, 1000}`；pending 仍 1、consumed 0 |
| 已授予的 boost 在 commit 后使用 | `... > cannot spend a granted boost after a committed action` | 抛 `GoTurnAnalysisEndedError`；pending 1、consumed 0 |
| 回合 token 彻底耗尽 | `total turn-token exhaustion > denies every analysis path but still permits the authoritative action` | 四条分析路径与 `beginModelStep` 全部 `{maxTurnTokens, 1000, 1000}`；请求 cap=0；**权威落子仍允许**（§22.4 “choose using current information”），commit 后记录为 `play` |
| 工具路径 vs enforcement 路径 | `tool path and enforcement path share one budget > shares ...` | inspect 共享计数 3/3、try_move 共享计数 2/2；直接 commit 关闭工具分析路径；工具授予的 boost 让直接重复请求抛重复错误 |
| 反空断言对照 | `anti-vacuity control > admits one attempt through every path under an ample budget` | 充裕预算下 4 条路径各放行 1 次且计数准确，`go.play` 仍能提交 |

**没有发现预算绕过**：所有 §39.4 攻击都确定性命中断言，没有任何一次被放行。

## 红 / 绿证据

本票是给已合并实现补对抗测试（C-T07/C-T08 已绿），所以“红”由**活体变异**证明，而不是先写一个产品侧红测试。

新增套件（工作树）：

```text
pnpm exec vitest run tests/budget --reporter=verbose
Test Files  1 passed (1)
     Tests  26 passed (26)
exit 0
```

全量校验（工作树）：

```text
pnpm verify
$ tsc -p tsconfig.json --noEmit
$ vitest run
Test Files  32 passed (32)
     Tests  429 passed (429)
$ clean && tsc -p tsconfig.build.json
exit 0
```

## 测试有牙（`/tmp/c-t09-mutation` 活体变异，未提交）

副本做法：`rsync` 工作树到 `/tmp/c-t09-mutation`（排除 `node_modules`/`.git`），`node_modules` 软链回工作树；基线跑出 26/26 绿后再变异。

| 变异 | 改动 | 结果 | 变红的用例 |
| --- | --- | --- | --- |
| A | 删除 `beginTryMove` 里的 `assertBelow('maxTryMoves', ...)` | **3 failed / 23 passed** | `admits exactly maxTryMoves...`、`charges every try_move a single wrapper...`、`shares one try_move counter...` |
| B | `request-cap.ts` 的 `Math.min(proposed, cap)` 改为 `proposed` | **9 failed / 17 passed** | `cannot buy a model step...`、`clamps the oversized request...`、`cannot be raised by a later contributor...`、`shrinks to the turn tokens...`、`denies every analysis path after a committed {play,pass,resign}`、`cannot raise the per-request cap...`、`denies every analysis path but still permits...` |
| C | `assertAnalysisOpen` 的 `throw` 改为 `return`（落子后不再拦截） | **5 failed / 21 passed** | `denies every analysis path after a committed {play,pass,resign}`、`cannot spend a granted boost after a committed action`、`shares the commit state...` |

- 变异 B 中 `fails closed on a non-finite or negative contributor proposal` 仍绿，符合预期：该分支走的是 `Number.isFinite` 回落路径，不经过被改掉的 `Math.min`。
- 三处变异都在 `/tmp` 副本内，工作树 `src/` 无改动（`git diff --stat -- src` 为空），副本跑完即弃。

## 范围外发现：committed 之后的 `go.resign` 会先改权威状态再抛错（不是预算绕过）

这不是 §39.4 的预算绕过（没有多花任何预算），但属于同一道 commit 门禁的顺序问题，按“不得隐藏”原则记录精确复现，交由 C-T02/C-T07 的 owner 与审查者判断。

复现（真实未变异源码，`GoRulesPort` 为 `tests/rules/stub-port.ts`，`deepseek` 执黑先行）：

```text
预算：maxModelSteps 5 / maxInspectCalls 5 / maxTryMoves 5 / perRequestMaxTokens 300 / maxTurnTokens 1000
go.play({gameId:'probe', point:{x:4,y:4}})   -> { ok: true }，状态 playing、moveNumber 1、toPlay user
go.resign({gameId:'probe'})                 -> 抛出 GoTurnAnalysisEndedError: "...committed play; commit is not permitted"
但 port.getState('probe') 已经变成：
  status: 'over'
  outcome: { winner: 'user', loser: 'deepseek', reason: 'resignation' }
enforcement.snapshot() 仍是：
  committedAction: 'play', gameTerminal: false
```

机制：`src/tools/go/go-tools.ts` 的 `runPlay` / `runPass` / `runResign` 都是**先** `runtime.port.*` 执行，**再** `enforcement.recordCommittedAction(...)`；因此门禁能拒绝返回值，却挡不住第二次权威动作已经落到 port。`runResign` 里 `publishGameNotice` 在 `recordCommittedAction` 之后，所以 Bridge 也收不到这次终局通知，port 状态与 Bridge/runtime 视图出现分叉（对标 §40 `state drift = 0`）。

- 影响面：同一 Go turn 内 play/pass 之后再 resign（resign 在规则上任何时候都合法，port 会接受）；其他“再落子/再 pass”会被 port 的 turn 校验挡住。
- 归属：C-T02 的工具执行顺序 + C-T07 的 commit 门禁集成；**不属于 C-T09 的预算测试范围，本票按约束不改产品源码、不新增失败测试**。
- 建议：由 owner 在 `runPlay`/`runPass`/`runResign` 执行 port 之前调用 `assertAnalysisOpen('commit')` 等价的准入检查（或先 `recordCommittedAction` 的预检），并补一条“第二次 commit 不触碰 port”的回归测试。

## 未验证项

- **没有在真实 pinned-DSH AgentLoop 里跑**：本仓库当前 `src/index.ts` 只 `ctx.agents.create(...)`，`src/` 内没有注册 `enforcement.requestTokenCap`（`agent/request`）或 `registerGoTools` 的生产调用点；本套件与 C-T07/C-T08 的现有测试一样，直接驱动 enforcement 对象与真实注册的工具面。生产接线必须保证每个真实请求都挂上 `requestTokenCap`、每个真实执行都经过 `begin*`，否则这些上限不会生效——这是接线票的责任，本票无法在仓库内验证。
- **CI workflow 没有在 GitHub 上实际运行过**：只写好了 job 与固定版本步骤；本机无法代表 GitHub Actions 结果。
- 本机 Node v26.10.0，`package.json` 声明 `>=24.11.1 <25`，pnpm 打印 engine 警告；CI 固定 Node 24.11.1。证据来自本机。
- 为跑测试在 worktree 内执行了 `pnpm install --frozen-lockfile`；`package.json` / `pnpm-lock.yaml` 无改动，未新增依赖。
- `go.state` 不消耗 §22.3 的 try_move/inspect 计数（Spec 只列 `go.inspect_*` / `go.try_move`），本套件不把它当绕过；它也不消耗 model token。

## 已知问题汇总

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| OUT-1 | P1（范围外，归属 C-T02/C-T07） | 已 commit 后 `go.resign` 先改 port 状态再抛 `GoTurnAnalysisEndedError`，Bridge 收不到终局通知 | 已复现并记录，本票不修 |
| N-1 | 说明 | 请求 seam 在 commit 之后仍返回 clamp 过的 config（不抛错）；admission 由 `beginModelStep` 拒绝 | 设计如此（§22.2 拒绝归 begin*），套件已断言两侧行为 |
| N-2 | 说明 | 变异 B 下“非有限提案”用例仍绿 | 预期，走的是不同的失败回落路径 |

## 不要做什么

- 不要为了让 OUT-1 变绿而顺手改 `go-tools.ts` 的执行顺序（本票约束：不改产品源码；应开新票或并入 owner 的修复）。
- 不要削弱、跳过或删除本套件的断言来让门禁变绿；不要新增“预期绕过”的白名单分支。
- 不要引入新依赖或改动 `package.json` / `pnpm-lock.yaml`。
- 不要 `git add .`；不要 push / PR / merge。

## 下一步（审查者 / 合并后）

- 审查：Standards（只新增 `tests/budget/` 与一个 workflow；无源码改动；无新依赖；断言有牙）+ Spec（§22.1-22.4、§23、§24、§39.4 逐条覆盖，边界值精确，无绕过）。
- 重点复核 OUT-1：确认它确实在 C-T09 范围外，并把它转给 C-T02/C-T07 的 owner 或新开票。
- 合并后按流程同步 `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` 的 BL-BUD-05 行为 IMPLEMENTED_VERIFIED（本票不直接改 Baseline）。
- F-T04 Phase A Exit Gate 可把本套件与 `budget-bypass-gate.yml` 作为“budget bypass tests pass”的证据输入（与 CI 实际运行结果一起引用）。
