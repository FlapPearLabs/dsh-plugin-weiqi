# Handoff · WAVE-C-T07

- 状态：READY_FOR_REVIEW
- 分支：`work/c-t07-budget-enforcement`
- 开发 worktree：`<dev worktree>`（本机绝对路径不入库，仓库为公开仓库）
- 基线 BASE_SHA：`796e1bed17cbed0b70ee462c7ddd2dcddda55830`
- 红测试 commit：`54eb2ed`（`test: add red acceptance tests for Go turn budget enforcement`）
- 初始绿代码 commit：`9cdbe970ce0eb5a8abada643c5f5f8b4472eb8a7`（本文件提交前的 HEAD）
- r1 P2 红测试 commit：`cda8fac`
- r1 P2 修复 commit：`5e9e7a1`
- 审查 worktree：由审查者填写
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标（BL-BUD-02 / BL-BUD-04：NOT_IMPLEMENTED、BL-BUD-07：VERIFIED_FACT_NOT_INTEGRATED → IMPLEMENTED_VERIFIED）：在 `src/budget/` 实现 Spec §22.1-22.4 的预算强制与 §24 的“落子后不再分析”规则，单请求上限走 C-S01 已验证的 seam。
- 票据验收标准（逐条）：
  1. per-request cap 在精确边界经已验证 seam 生效（cap N 放行 N，N+1 被 clamp）。
  2. turn-level token cap 生效：到达上限后新 model step 被拒。
  3. per-tool 记账（inspect / try_move / deep-think / model step），耗尽即拒绝。
  4. 聚合式 double-invoke 按实际执行计数一次（§22.3“外层 wrapper 不得隐藏多次调用”）。
  5. committed play / pass / **resign** 后同一回合不得再起分析循环；resign 后棋局立即终局，不再允许 inspect / try_move / deep-think / model step（含 resign 的确定性序列测试）。
  6. `pnpm verify` 退出码 0。

## 已完成

- 新增 `src/budget/request-cap.ts`：
  - `createGoRequestTokenCap(maxTokens, remainingTurnTokens?)` 返回与 C-S01 记录完全一致的 `agent/request` waterfall listener 形状：`(payload, next) => Promise<LlmCallConfig>`；第二个参数可选，不传时退化为绝对 cap（C-S01 原始形状）。
  - 实现是 `const resolved = await next()` 之后计算 `cap`，再 `Math.min(resolved.maxTokens, cap)`，返回替换对象；**clamp 的是 await 之后的结果**，不是“提一个默认值”。
  - `cap` 不再是常量：r1 P2-1 修复后为 `Math.min(perRequestMaxTokens, remainingTurnTokens())`，每次请求重新读取（`remainingTurnTokens()` 由 enforcement 暴露）。回合已耗尽时为 `0`；listener 仍只做 clamp、不抛错，seam 形状不变。
  - 只有在 listener **注册为最外层（最后注册）** 时，`next()` 之后 clamp 才能挡住其它 contributor；若之后又注册一个不调用 `next()` 的 contributor，它会在本 listener 之外抬高上限。注册顺序归 C-T02（见 P3-2）。
  - 不传余额 getter 时：cap N 放行 N；N+1 / 超大值 / 缺失 `maxTokens` 都落到 N；低于 cap 的请求不被抬高；重复应用幂等；非负整数之外的 cap 抛 `RangeError`。
  - `GoRequestWaterfallPayload` 只取 `{ turn, step }`；pinned 事件多出的 `agent` / `signal` 不影响可赋值性（测试里有编译期赋值断言）。
- 新增 `src/budget/enforcement.ts`：
  - `createGoTurnEnforcement(budget)`：一个实例属于一个 Go 回合；先用 C-T06 的 `loadGoTurnBudget` 校验注入值，不发明任何数值。
  - `beginModelStep()`：先查 §24 终局、再查 `maxModelSteps`、再查 `maxTurnTokens`（`used >= limit` 即拒），通过后计一步并返回 step handle。
  - step handle 的 `complete({ tokens })`：同一 step 的相同 token 数重复上报只记一次；不同数值的第二次上报抛 `GoTurnUsageError('already-recorded')`；负数 / 小数 / `NaN` / `Infinity` 抛 `GoTurnUsageError('not-a-non-negative-integer')`。
  - `beginInspect()` / `beginTryMove()`：**执行前**先查 §24 终局、再查各自的 `maxInspectCalls` / `maxTryMoves`，最后查 `maxTurnTokens`；耗尽抛 `GoTurnBudgetExhaustedError`（精确边界：用满 N 次后第 N+1 次被拒）。
  - `beginDeepThink()`：先查 §24 终局，再查 `maxTurnTokens`，最后计 `deepThinkRequests`；boost 的大小与上限属 C-T08，本票不实现也不声称。
  - `recordCommittedAction('play' | 'pass' | 'resign')`：结束本回合分析；`resign` 同时置 `gameTerminal = true`；之后再有任何分析动作（含第二次 commit）抛 `GoTurnAnalysisEndedError`。
  - `runAccountedGoTool(enforcement, kind, execute)`：`go.inspect_*` / `go.try_move` 的唯一记账执行路径，先计数再执行；执行抛错也保留计数（执行已被尝试）。
  - `snapshot()`：返回 limits 与全部计数器，limits 已 `Object.freeze` 的内部副本。
- 新增 `src/budget/request-cap.test.ts`（r1 前 13、r1 修复后 20 个用例）与 `src/budget/enforcement.test.ts`（r1 前 22、r1 修复后 31 个用例）：r1 P2 修复新增 16 个（request-cap 7、enforcement 9），本票累计 51 个新用例；`src/budget/` 合计 61 个用例（含 C-T06 的 10 个）。

## 改动

- 相对 BASE_SHA `796e1be`：`src/budget/request-cap.ts`、`src/budget/enforcement.ts`、`src/budget/request-cap.test.ts`、`src/budget/enforcement.test.ts`（新）+ 本 handoff，全部在 `src/budget/` 与 `handoffs/` 内。
- r1 修复提交：`cda8fac` 只改两个测试文件（+169 行）；`5e9e7a1` 改 `request-cap.ts`、`enforcement.ts`、`enforcement.test.ts`（+51 / -6）。具体行数以 `git diff --stat` 为准。
- 未改：`src/contracts/index.ts`（不需要新导出）、`package.json` / `pnpm-lock.yaml`（未加依赖）、主检出、C-T02/C-T08/C-T09/C-T10 范围、DSH core。
- `git status` 在 feat 提交后无未跟踪的产品文件（`node_modules/`、`lib/` 已被忽略）。

## 关键契约决定

- **seam 只做 clamp，不额外 deny**：C-S01 证明的是请求配置替换点；§22.2 的“新 model step 被拒”在 `beginModelStep`，请求 listener 不抛错、不改变 AgentLoop 控制流。这样 C-T02 接线时，“回合是否还能思考”由预算边界回答，而不是让 waterfall 抛异常。
- **单请求上限随回合余额收缩（r1 P2-1）**：`cap = min(perRequestMaxTokens, remainingTurnTokens())`，在 `await next()` 之后读取，所以本回合已记账的 token 一定生效。余额为 0 时 cap 为 0（clamp 到 0，不拒绝）；余额在 0 与 per-request 之间时 cap 等于余额（例如剩 1 → cap 1）。`beginModelStep` 仍在更早处拒绝新 step，因此 cap 0 只可能出现在“已开始的最后一步”这一路径。
- **§22.4 按“总耗尽”读法（r1 P2-2）**：`turnTokens >= maxTurnTokens` 时，`beginModelStep`、`beginInspect`、`beginTryMove`、`beginDeepThink` 四个门全部抛 `GoTurnBudgetExhaustedError('maxTurnTokens')`；不采用“各自计数器独立”的读法。检查顺序是先本动作计数器、再 `maxTurnTokens`。
- **上游异常值 fail closed / fallback（r1 P3-3）**：`next()` 返回的 `maxTokens` 为 `NaN`、负数或非有限值时，不使用该值，直接落到本次有效 cap（不会把 NaN/负数写进请求配置）；`remainingTurnTokens()` 读出非有限值或负数时按 0 处理。
- **计数发生在执行之前**：这是 §22.3“没有外层 wrapper 可以隐藏多次调用”的可执行落点。一次聚合 wrapper 里发生两次实际执行就记两次；执行失败不回滚计数（否则模型可以靠失败重试绕开上限）。
- **同一 model step 的用量只记一次**：`complete()` 相同值重复上报是 no-op，不同值直接报错。这对应“aggregated double-invoke counted once”的模型步读数，也防止聚合路径把 turn token 花两遍。
- **拒绝顺序**：`beginModelStep` 先查 `maxModelSteps` 再查 `maxTurnTokens`；`beginInspect` / `beginTryMove` 先查各自工具上限再查 `maxTurnTokens`；`beginDeepThink` 只查 `maxTurnTokens`。多者同时耗尽时报先前那个；测试用宽松的其它字段隔离 token 边界，避免依赖顺序。
- **commit 前已开始的 step 允许事后上报 usage**：commit 之后 `complete()` 仍可记账（这是已发生执行的报告，不是新动作），但任何新的分析动作都被拒。确定性测试覆盖。
- **resign 是终局**：`recordCommittedAction('resign')` 之后 `gameTerminal === true`，额外的 commit 也抛 `GoTurnAnalysisEndedError`，不提供任何“重开”入口。
- **deep-think 只做 §24 门禁与计数**：§22 没有 deep-think 预算字段，boost 归 C-T08；本票不添加未使用的“boost 额度”状态，也不声称已实现 boost。
- **零值语义沿用 C-T06**：`maxInspectCalls: 0` / `maxTryMoves: 0` = 禁止该操作；`maxTurnTokens: 0` = 第一次 model step 就被拒。
- **注入值再校验**：`createGoTurnEnforcement` 调 `loadGoTurnBudget`，绕过 loader 直接传非法对象会被 `GoTurnBudgetConfigError` 拒绝，不会带着 `NaN` 之类继续记账。
- **不新增公共导出**：`src/budget/` 不是包出口；C-T02 走包内相对导入。要对外暴露应作为显式契约变更处理。

## Seam 使用（逐字引用 C-S01 记录）

`docs/validation/DSH_REQUEST_TOKEN_HARD_CAP_SEAM_VERIFIED.md`：

> Register an agent-scoped `agent/request` waterfall listener on the Go agent, await the proposed `LlmCallConfig`, and return a replacement whose `maxTokens` is clamped to the Companion hard cap.

> It must clamp the result of `await next()` rather than merely propose a default, so model selection or another legitimate request contributor cannot raise the absolute cap.

本票实现与之逐条对应：`await next()` 后按 `cap = min(perRequestMaxTokens, remainingTurnTokens())` 计算并 `Math.min(resolved.maxTokens, cap)`，返回 `{ ...resolved, maxTokens }`。C-T02 必须把该 listener 注册在最外层，否则之后注册且不调用 `next()` 的 contributor 仍可抬高上限（P3-2）。没有猜测其它 hook，没有 DSH core patch，没有新机制。

已安装的 pinned DSH 类型（`@deepseek-ai/dsh-agent@0.1.1-rc.2`）确认事件签名：

```ts
'agent/request'(payload: { agent; turn; step; signal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

`GoRequestTokenCapListener` 用只含 `{ turn, step }` 的更窄 payload，测试里把监听器赋给完整的 `VerifiedRequestPayload` 函数类型并在运行时调用一次，编译期 + 运行期都证明可挂到该事件上。

C-S01 的 `257` / `8192` 只作为测试 fixture 使用，测试常量注释明确写着“NOT production calibration”；生产数值仍归 BL-BUD-06 / WAVE-C-T10。

## 边界测试清单

- per-request：cap N 放行 N；N+1 → N；8192 → N；低于 cap 不抬高；`next()` 解析出超大值仍被 clamp；缺失 `maxTokens` → N；cap 0；外层 cap 更高时内层 cap 仍然生效；重复应用幂等；其它字段原样保留；不改原对象；与 `agent/request` 形状可赋值；非法 cap 拒绝；上游 `NaN`/负数回落到有效 cap；余额读数为 `NaN`/负数时 cap 0。
- 回合余额（r1 P2-1）：剩余 1 → cap 1；剩余 100 且 per-request 257 → 100；剩余 400 且 per-request 257 → 257；耗尽 → 0；同一 listener 每次请求重新读取余额（先 357 → 257，后 64 → 64）；enforcement 暴露的 `remainingTurnTokens()` 与上述断言一致。
- turn-level：`maxModelSteps` 用满 N 后第 N+1 次拒绝；turn token 恰好到 100 后拒绝（`used: 100, limit: 100`）；`maxTurnTokens: 0` 第一步就拒。
- 总耗尽（r1 P2-2）：`turnTokens = 100` 后 `model_step`、`inspect`、`try_move`、`deep_think` 四个动作逐一抛 `maxTurnTokens` 耗尽（`used: 100, limit: 100`）；剩 1 token 时四个动作仍全部放行（`turnTokens` 保持 99）。
- per-tool：inspect 用满拒绝；聚合 wrapper 两次实际执行记两次；执行抛错仍计数；try_move 与 inspect 分账；零上限禁止操作；wrapper 与直接 `beginInspect()` 共享同一计数器（no-wrapper-hole）；deep-think 计数。
- 回合结束：play / pass / resign 后四个分析动作逐一被拒（`action`、`committedAction`、`gameTerminal` 均断言）；resign 后第二次 commit 被拒；commit 前已开始的 step 仍可上报 usage；play 与 resign 两条确定性序列。

## 证据

- 红测试（`54eb2ed`）：
  - `pnpm exec vitest run src/budget` → 退出码 1：`Test Files 2 failed | 1 passed (3)`，`Tests 10 passed (10)`；两个新套件各 0 test，报 `Cannot find module './request-cap.js'` / `Cannot find module './enforcement.js'`。
  - `pnpm run typecheck` → 退出码 2：`TS2307` 两处（两个新套件解析不到模块）。
- 绿（`9cdbe97`，实现后）：
  - `pnpm verify` → 退出码 0：`tsc --noEmit` → `Test Files 19 passed (19)` / `Tests 179 passed (179)` → `clean` → `tsc -p tsconfig.build.json`。
  - `pnpm exec vitest run src/budget` → `Test Files 3 passed (3)`，`Tests 45 passed (45)`（C-T06 的 10 个 + 本票 35 个）。
- r1 P2 修复（在 `ffb8984` 之后）：
  - 红（`cda8fac`，仅测试）：`pnpm exec vitest run src/budget` → 退出码 1：`Test Files 2 failed | 1 passed (3)`，`Tests 14 failed | 47 passed (61)`；失败集中在剩余余额 cap、耗尽 cap 0、`NaN`/负数、以及遗漏的三个 `begin*` 门。另有 2 个新用例在旧实现下本来就通过（余额充足时的 per-request cap、剩 1 token 时四个动作放行）。
  - 绿（`5e9e7a1`）：`pnpm verify` → 退出码 0：`Test Files 19 passed (19)` / `Tests 195 passed (195)`；`pnpm exec vitest run src/budget` → 3 files / 61 tests。
  - 原 `applies the budget per-request cap...` 用例在修复提交里改为 `maxTurnTokens: 1_000`：修复后同一请求会被余额 100 收窄到 100，该用例的“per-request cap”意图保留，余额交互由新增用例覆盖。
- 测试有牙（活体变异，均已复原并按 md5 逐字节确认）：
  - 变异 1：把 listener 改成 `return resolved`（去掉 clamp）→ `src/budget/request-cap.test.ts` **10 个用例失败**，包括 `clamps a request one token over the boundary`、`clamps the awaited waterfall result...`、`enforces a zero cap`、`stays capped when another contributor...`。
  - 变异 2：`resign` 不写入 `committedAction`（等价于 resign 后仍允许分析）→ `src/budget/enforcement.test.ts` **2 个用例失败**：`makes the game terminal after resign and denies every further action`、`runs a deterministic resign sequence with no further permitted action`。
  - 复原后 `md5 -q` 与变异前一致：`request-cap.ts` `376f85a486edf45cab7ba706cd4b91cf`，`enforcement.ts` `c5b0d336de91445f015bfdf091c2f975`；随后 `pnpm verify` 再次退出码 0。
- 红测试本身的一处修正：turn-token 用例原设计用 3 个 step（60/39/1），与 `maxModelSteps: 3` 同时耗尽，实现后先报 `maxModelSteps`；已在 feat commit 里把该用例改为 `maxModelSteps: 10` 以隔离 token 边界。这是测试隔离问题，不是实现问题。

## r1 审查意见处理

| 意见 | 处理 | 证据 |
| --- | --- | --- |
| P2-1 turn cap 未收窄单请求 | 暴露 `remainingTurnTokens()`，请求时 `min(perRequestMaxTokens, remaining)`，耗尽返回 0 | `request-cap.ts`；`cda8fac` 红、`5e9e7a1` 绿 |
| P2-2 只有 model step 查总耗尽 | 四个 `begin*` 全部加 `maxTurnTokens` 门 | 四条按动作命名的“denies <action>...”用例 |
| P3-1 提交信息用例数不实 | 以 35 为准（13 + 22）；`9cdbe97` 的 “44” 是错的，历史不改写 | 本文件“已完成”计数；vitest 输出 |
| P3-2 “绝对上限”措辞 | 限定为“listener 注册在最外层时”；注册顺序归 C-T02 | “已完成”与“关键契约决定” |
| P3-3 `Math.min` 未校验上游 | 上游 `NaN`/负数回落有效 cap；余额读数异常 fail closed 0 | request-cap 新增用例 |

## 限制与未验证

- **没有接真实 pinned-DSH 运行时**：worktree 里没有可执行的 Go agent / tool 运行时，本票只在单元层验证 listener 形状与确定性序列；把 `requestTokenCap` 注册到 Go agent 的 `agent/request`、把 `beginModelStep` / `runAccountedGoTool` 接进真实 AgentLoop 与 `go.*`，属于 WAVE-C-T02（工具注册与接线）与 C-T05（反作弊/集成）的工作。
- **turn token 的来源未接**：`complete({ tokens })` 的调用方（从请求 usage 里取多少、是否含输入 token）尚未接 DSH 响应；本票只定义“上报多少记多少”，不发明 token 口径。
- **deep-think boost 未实现**：C-T08 拥有 boost 的额度、绝对上限与“不得突破整体回合上限”规则；本票只提供 §24 门禁和请求计数。
- **没有 bypass 测试套件**：C-T09（§39.4）负责对抗式绕过测试；本票的 no-wrapper-hole 断言只是单测层的共享计数器证据。
- **没有生产数值**：所有 fixture 都是注入的测试值；T10 标定前不得当作默认值。
- 本机 Node v26.10.0，`package.json` 声明 `>=24.11.1 <25`，`pnpm` 打印 engine 警告；CI 固定 Node 24.11.1。本票证据来自本机，与 C-T06 相同。
- r1 P2 修复同样只在单测层验证：没有重跑 C-S01 的 wire-level fixture，也没有触发 CI。
- 为跑测试在 worktree 内执行了 `pnpm install --frozen-lockfile`；`pnpm-lock.yaml` / `package.json` 无改动，未新增依赖。

## 已知缺陷

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| — | — | 未发现 P0/P1 级缺陷 | — |
| N-1 | 说明 | `beginModelStep` 同时耗尽 step 与 token 上限时报 `maxModelSteps`（检查顺序固定） | 记录在案，测试已隔离该顺序 |
| N-2 | 说明 | 请求 listener 本身不检查“回合已结束”；该门禁在 `beginModelStep` | 设计决定，C-T02 接线时不得绕过 `beginModelStep` |
| N-3 | 说明 | 回合耗尽时请求 listener 返回 cap 0 而不是拒绝；拒绝发生在 `beginModelStep` | 设计决定（保持 C-S01 clamp-only seam） |

## 已排除的假设

- 假设：per-request 上限应该“拒绝”而不是“clamp”。排除依据：C-S01 的可执行语义就是返回替换配置并 clamp，`oversized request clamped` 是已验证事实；改为抛错会改变 AgentLoop 的控制流并偏离已验证 seam。
- 假设：应该在 `agent/request` listener 里同时拒绝“回合已结束”的请求。排除：listener 只拿到 `{turn, step}`，不持有回合状态；把状态塞进 waterfall 会让请求路径依赖预算对象并可能把正常收尾打成异常。§24 的门禁放在 `beginModelStep`，由 C-T02 保证所有 model step 都经过它。
- 假设：工具执行失败后应该退还预算。排除：§22.3 是“每次实际执行消耗预算”；失败重试可无限接近上限，退还即形成绕过口。
- 假设：同一 model step 的 usage 重复上报应按最大值或累加。排除：一个 step 只发生一次实际请求；相同值重复上报是聚合路径的正常现象（只记一次），不同值说明记账来源冲突，直接报错比静默选一个更安全。
- 假设：deep-think 需要一个 §22 计数器与上限。排除：§22 没有该字段，§23 的 boost 上限属 C-T08；本票只计数与做 §24 门禁。
- 假设：0 上限应被拒绝。排除：C-T06 已把计数与 token 字段的 0 定为合法“禁止该操作 / 不发请求”，本票沿用并在边界测试里覆盖。

## 下一步

- C-T02 接线：每个 Go 回合创建 `createGoTurnEnforcement(loadGoTurnBudget(config))`；把 `requestTokenCap` **最后注册**为 Go agent 的 `agent/request` listener（最外层）；`go.inspect_*` / `go.try_move` 全部经 `runAccountedGoTool`；每次模型请求前 `beginModelStep()`，请求完成后 `step.complete({ tokens })`；`go.play` / `go.pass` / `go.resign` 成功后 `recordCommittedAction(...)`。
- C-T02 的验收应复用本票的确定性序列，并在真实工具注册后断言“没有第二条未记账的调用路径”。
- 审查者按 Standards + Spec 两轴复核；本票禁止 push / PR / merge。

## 不要做什么

- 不要在本分支写入生产预算数值或默认值（需 §38 基准证据，归 C-T10）。
- 不要实现 boost（C-T08）、bypass 测试套件（C-T09）、benchmark（C-T10）。
- 不要 patch DSH core，或换用 C-S01 之外的 hook。
- 不要 `git add .`；不要 push/PR/merge。

## 偏离记录

- 与 AGENTS.md 的偏离：为跑测试在 worktree 内执行了 `pnpm install --frozen-lockfile`（仅还原锁文件依赖，无依赖变更）。
- 红测试 commit 之后对 `enforcement.test.ts` 的 turn-token 用例做了一次隔离修正（见“证据”），随 feat commit 提交，未 amend 红测试 commit。
- r1 P3-1：`9cdbe97` 的提交信息写 “44 new cases”，实际 35（13 request-cap + 22 enforcement）；按仓库规则不改写历史，在此更正。
