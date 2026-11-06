# Handoff · WAVE-C-T10（免费部分）— benchmark 接真实 LLM 请求路径 + 费用/请求闸门

- 状态：READY_FOR_REVIEW（零费用部分完成；live 驱动已接线，真实 DeepSeek 标定仍待主人批准）
- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/task-c-t10`
- 分支：`task/c-t10`
- 本轮 BASE_SHA：`9652fc8`（本轮开工时的 HEAD）
- 本轮 fix commit：`e46f4ec`（`fix(test): make the benchmark gate conservative, releasable and CNY-denominated`）
- 本轮 feat commit：`f571c30`（`feat(test): drive the live benchmark record from an env-selected provider`）
- 基线 BASE_SHA：`1b1e612836fd3a8528c92764701767a0f54bcf34`（`origin/main`）
- 红测试 commit：`6bc6764`（`test: pin the DSH request path and spend/request gates`）
- 绿实现 commit：`cbfcc38`（`feat: route the §38 benchmark through the DSH LLM request path and gate spend`）
- 闸门加固 commit：`cf06a87`（`fix(test): close the four spend-gate holes before a real calibration run`）
- 工具名映射/fail-closed commit：`e7588f0`（`fix(test): map provider-safe tool names and fail closed on bad responses`）
- 本 handoff 与记录/摘要以 `docs:` 单独提交
- 未 push、未开 PR

## 本轮（live 驱动 + 四个残留，2026-11-04，仍零花费）

对抗审查在同一 SHA 上实测后列出 1 个阻塞项和 4 个残留；本轮全部修完，仍然
没有发起任何真实模型请求（live 测试注入 stub `fetch`）。

| 项 | 修法 | 验收测试（`tests/benchmark`） |
|---|---|---|
| live 驱动未接 | `BenchmarkLlmProvider` 抽象；`buildBenchmarkRecord` 从 env 快照读 mode，live 时用 `LiveBenchmarkProvider` + 显式价目表，按 model 响应跑到 commit 或步数上限 | `runs all eight §38 classes through the live adapter selected by env alone` |
| 流式工具名分片 | delta 先累积，名字完整（在映射表内）后再映射；分片 delta 不发 name，block-end 兜底 | `waits for the complete streamed tool name before mapping it` |
| 估算低估 | CJK 1.25/单位、ASCII 0.4/单位、JSON 标点 0.5，另加 chat template 固定开销 | `estimates Chinese, mixed and dense-JSON input at or above the fixed reference usage`；`charges CJK, ASCII and JSON punctuation at or above the measured floors` |
| 预留泄漏 | 失败/取消/无 usage 时 `releaseRequest(step)`；重复 step 替换旧预留；无预留完成 → `missing-reservation` budget_stop | `releases a failed request reservation and never counts the same step twice`；`stops with a budget_stop when a request completes without a reservation` |
| 币种 | cap 改 **CNY 6.66**，汇率默认 **7.1**；快照同时记录 USD 估算、CNY 估算与汇率；分发前按最坏情况换算预检 | `caps spend in CNY using the recorded USD/CNY rate, before dispatch`；`records the USD estimate, the CNY cap and the rate used for the comparison` |

**只改环境变量能否跑 3 局 live：能。** 设 `BENCHMARK_PROVIDER=live` 和
`BENCHMARK_BASE_URL` / `BENCHMARK_API_KEY` / `BENCHMARK_MODEL` /
`BENCHMARK_PRICING_JSON` 五个变量后，`tests/benchmark/run-cognition-benchmark.sh`
直接跑 emitter（默认写 `docs/validation/COGNITION_BENCHMARK_LIVE_RECORD.json`）；
缺任一变量 exit 2，绝不回退 scripted。本轮没有用真实变量执行过。

证据：

```text
pnpm exec vitest run tests/benchmark -> 9 files, 74 tests passed
pnpm verify -> 45 files, 542 tests passed, build exit 0
fix commit e46f4ec 单独 stash 后 pnpm verify -> exit 0
```

六处活体变异（每处只改一处、跑对应测试、按字节复原）：流式名字立即映射、
缺 usage 不释放预留、ASCII 权重回 0.25、CNY 预检不做换算、live 模式强制 scripted、
重复 step 不去重——对应测试全部变红，复原后 SHA-256 与改前一致。

## 闸门加固（独立审查 4 个缺口，2026-11-04）

独立审查在 `0afda3e` 上做活体变异后确认：闸门在 harness 内部有效，但作为“真实
花钱标定”的护栏不合格。本节是加固结果；本轮仍然没有发起任何真实模型请求。

| 缺口 | 修法 | 新测试（`tests/benchmark`） |
|---|---|---|
| D1 闸门位置 | `openBenchmarkRequestPath(provider, gate)` 必须接收 `BenchmarkBudgetGate`；`request()` 内部做 `beginRequest`/`completeRequest`，省略 gate 在类型层是错误、运行时抛 `TypeError` | `refuses to open the path without a BenchmarkBudgetGate`；`admits and records every request inside the path, and refuses a repeated step` |
| D2 禁重试无牙 | 路径打开时拒绝 `mode:'always'` 或 `maxRetries>0` 的 adapter（`BenchmarkRetryPolicyError`）；metrics 新增 `transportAttempts` / `admittedRequests` / `retryAttempts`，`runFixture` 发现多余传输尝试直接抛 | `makes exactly one HTTP attempt when the transport fails, and counts no retry`（真实 `fetch` 打本地 429 服务，断言 1 次 HTTP 尝试、0 重试）；`refuses an adapter that declares retries before any request leaves` |
| D3 触发请求不计费 | `completeRequest` 先累加 usage/cost，再按输入/输出/费用上限抛 `budget_stop` | `records the triggering request usage before stopping on the reported output cap`（output 192 / limit 100） |
| D4 输入复查无测试 | 保留上报后的输入上限复查，补用例 | `stops when the provider reports more input tokens than the per-request cap`（上报 9000 / limit 8000） |

顺手修：

- `harness.ts` 的 `model.requestPath` 不再写死：`BenchmarkRequestPathStats.seam`
  由实际路径给出，记录从各 run 的观察值聚合，出现混合路径直接报错。
- `BenchmarkBudgetGate` 增加 `mode`（`scripted` | `live`）。live 模式不带显式
  价目表时构造即抛 `RangeError`；快照记录 `pricingSource`
  （`placeholder` | `explicit`）。scripted 模式仍可用占位价，并如实标注。
- `maxRequests` 96 → 120（8 类 × 3 局 × 最多 4 步 = 96，加余量）；总花费仍由
  `maxEstimatedCostCny`（汇率 `usdToCnyRate`）与单请求 token 上限约束。

变异验证（每次只改一处、跑对应测试、随后复原）：

| 变异 | 结果 |
|---|---|
| 删除 `openBenchmarkRequestPath` 的 gate 运行时检查 | `refuses to open the path without a BenchmarkBudgetGate` 红 |
| `fake-provider.ts` 的 `maxRetries` 改 10 | 整组 benchmark 测试红（路径在分发前拒绝） |
| 删除 adapter 重试策略守卫 | `refuses an adapter that declares retries before any request leaves` 红 |
| 请求路径失败后再分发一次 | `makes exactly one HTTP attempt ...` 红 |
| `completeRequest` 把累加挪回抛错之后 | `records the triggering request usage ...` 红 |
| 删除上报后的输入上限复查 | `stops when the provider reports more input tokens ...` 红 |

命令与结果：

```text
pnpm exec vitest run tests/benchmark
 Test Files  4 passed (4)
      Tests  34 passed (34)

pnpm verify
 Test Files  40 passed (40)
      Tests  502 passed (502)
$ tsc -p tsconfig.build.json
VERIFY_EXIT=0
```

**现在真实入口还能不能绕过闸门：不能。** `tests/benchmark` 里唯一的请求出口是
`openBenchmarkRequestPath(provider, gate)`：gate 是必填参数，`beginRequest` /
`completeRequest` 在 `request()` 内部执行，打开时还会拒绝带重试策略的 adapter；
harness 已改成只调 `path.request`，自己不再持有闸门调用。`src/**` 未动。

## 工具名映射与 fail-closed（2026-11-04，零费用）

上一轮真实请求被官方 API 以 400 拒绝：`tools[0].function.name` 必须匹配
`^[a-zA-Z0-9_-]+$`，而产品工具名带点号。本轮补上双向映射和失败路径，全程没有
发起任何真实模型请求，也没有读取凭据。

### 映射规则

`tests/benchmark/tool-name-mapping.ts` 从真实的 `GO_TOOL_NAMES` 构建双射表，
出站把 `.` 换成 `_`，入站反查回原名：

| 原名 | provider 名 |
|---|---|
| `go.state` | `go_state` |
| `go.inspect_group` | `go_inspect_group` |
| `go.inspect_region` | `go_inspect_region` |
| `go.try_move` | `go_try_move` |
| `go.play` | `go_play` |
| `go.pass` | `go_pass` |
| `go.resign` | `go_resign` |
| `go.request_deep_think` | `go_request_deep_think` |

- 建表时校验：每个 provider 名匹配 `^[a-zA-Z0-9_-]+$`、两两不同、能反查；
  冲突或编码后不合规直接抛错，不会静默覆盖。
- 出站映射工具 schema 和 assistant 历史里的 tool-call 名字；入站映射模型返回的
  tool-call 名字，未知名字抛 `BenchmarkToolNameError`，绝不透传或猜。
- 测试：`tool-name-mapping.test.ts` 覆盖表完整性、往返、冲突、非法编码、schema/
  历史映射；`request-path.test.ts` 断言 provider 实际收到的名字全部合规、响应里的
  `tool_calls` 被还原成原名且都在 `GO_TOOL_NAMES` 中。

### 六条 fail-closed 测试

文件：`tests/benchmark/fail-closed.test.ts`。每条都用本地注入 provider 触发，
没有网络请求。

| 失败路径 | 测试名 |
|---|---|
| 响应缺 `usage` | `stops when the response has no usage and records no tokens` |
| 超时 | `stops on a provider timeout without retrying` |
| 连接中断 | `stops on a connection interruption mid-stream without retrying` |
| 流被截断（无 `finish`） | `stops and records a failure when the stream ends without a finish chunk` |
| 模型别名漂移 | `stops on model alias drift and records the reported model` |
| 未知入站工具名 | `fails closed when the model returns an unknown tool name` |

行为：全部 `throw`，并把失败类型写进 `path.stats().failures`；有 `usage` 的失败
先按真实 usage 结算再抛（花费不能因为失败而丢），无 `usage` 的失败释放最坏情况
预留（本轮从“保留”改为“释放”，避免泄漏到后续 step）。

### 预留与落盘

- `beginRequest` 按 `maxTokens` + 预检输入估算预留最坏费用，换算成 CNY 后在分发前
  预检；重复 step 先替换旧预留，不双记。`completeRequest` 先释放预留、再按真实
  usage 结算，最后复查上限；无预留直接记 `missing-reservation` budget_stop。
- 失败/取消且没有 usage 时由请求路径显式 `releaseRequest(step)`；带 usage 的失败
  仍先结算。
- `BenchmarkSpendLedger` 在 `beginRequest`（含预留）和 `completeRequest` 后原子写盘；
  进程重启从同一文件恢复请求数/token/花费/未释放预留；损坏或负值文件直接抛错，
  不重置为 0。测试用临时目录 + 两个子进程验证跨进程累加。

### 本轮记录里的模型名与计费口径

**本轮没有真实 DeepSeek 调用。** 记录（`COGNITION_BENCHMARK_SCRIPTED_RECORD.json`）
里的 `model.reportedModel` 是本地 scripted adapter 的 envelope 值
`scripted-legal-move-adapter-v1`，不是服务端返回；`model.reportedModels` 也只有这一个。
计费口径记录为 DSH 归一化字段：`usage.inputTokens` / `usage.outputTokens` /
`usage.cacheReadTokens` / `usage.cacheWriteTokens` / `usage.reasoningTokens`；
reasoning 视为已含在 output 里，不重复计费。价格仍是占位表（$1/M input、$2/M output、
$0.5/M cache read、$1/M cache write），不是 DeepSeek 报价。记录里只有字段，没有 key。

重新生成的记录：54 requests、`estimatedCostUsd=0.039681`（占位价）、
`reservedCostUsd=0`、`stops=0`。

### 验证

```text
pnpm exec vitest run tests/benchmark
 Test Files  7 passed (7)
      Tests  56 passed (56)

pnpm verify
 Test Files  43 passed (43)
      Tests  524 passed (524)
VERIFY_EXIT=0
```

变异验证 21 条，每条只改一处、跑对应单测、确认变红、按 SHA-256 复原：
映射冲突、未知出站/入站、schema 映射、历史映射、入站还原、缺 usage、超时分类、
连接中断分类、截断流、别名漂移、未知入站工具、预留检查、预留累加、预留释放、
分发前落盘、重启加载、损坏账本、负值账本、账本保存、请求声明的 search 工具。
全部 `RED`，复原后 benchmark 56/56 通过。

### 真实入口剩余未验证风险

1. **真实 DeepSeek 调用仍未发生。** `reportedModel` 目前只是本地 adapter 的值。真实
   adapter 必须把响应里的 `model` 放进 `finish.replayState.response.model`（或等价
   暴露）；否则 drift 检查只能记录 `null`，等于不生效。
2. **真实 usage 字段映射未验证。** 计费口径在 DSH 归一化层（`usage.inputTokens` /
   `outputTokens`）；真实 adapter 是否把 DeepSeek 的 `prompt_tokens` /
   `completion_tokens` / cache 字段正确映射到这些字段，未在真实响应上验证。
3. **真实超时/连接中断未验证。** 本轮用本地抛 `LlmError('TIMEOUT')` 和
   `NETWORK_INTERRUPTED` 的 provider 证明分类逻辑；真实 HTTP adapter 是否把 socket
   超时、TLS reset、流中断都归一化成 `finish` 的 error/aborted，需要在真实入口复核。
4. **映射只覆盖 benchmark 请求路径。** 真实 adapter 自己序列化 `options.tools` /
   messages 时看到的是映射后的名字；如果 adapter 内部还从别处重放历史消息，那段
   序列化是否同样走映射尚未验证。
5. **价格/缓存计费未标定。** 占位价和 cache 读按 input 价兜底是保守估计，不是
   DeepSeek 报价；真实跑必须传批准的价目表并以 `mode: 'live'` 构造 gate。
6. **`@deepseek-ai/dsh-agent-loop` 仍未安装。** step/turn 驱动仍是文档化替身；
   真实 loop 的 resume/steering/turn-end 语义不在本 harness 范围内。
7. **别名漂移是精确字符串比较。** 官方若发布新的模型 id，运行会按设计停住；
   需要人工确认后更新配置的 model id，而不是自动接受。

## 结论

`tests/benchmark/` 的请求路径已从“直接调脚本适配器”改为经过 pinned
`@deepseek-ai/dsh-llm` 的真实 `LlmRuntime` 请求路径；模型侧是本地无网络
fake provider。8 类 §38 场景全部在真实 provider 绑定、`llm/stream` 瀑布、
`prepareCall` 和 `BlockAssembler` 上跑通，计数与记录一致。

benchmark 侧新增会话级费用/请求闸门：总请求 120、单请求输入 8000 / 输出 4000、
预估总费用 ¥6.66（默认汇率 7.1 USD/CNY，≈$0.94）、禁自动重试、禁 search/fetch。
任一触发即停止并记录 `budget_stop`。每个闸门都有可单独触发的测试（见“红/绿与
有牙证据”）。

`src/` 零改动；生产 `GoTurnBudget` 默认值与 `src/budget/` 语义未动；冻结物
（TICKET_GRAPH_V1.2.1、CURRENT_IMPLEMENTATION_BASELINE、docs/spec）未动；无新增依赖。

## 真实路径接的是哪一层

```
fixture 脚本
  └─ harness 步骤驱动（站内替身，见下）
       ├─ createGoTurnEnforcement (C-T07) + createGoRequestTokenCap (C-S01)
       ├─ markAgentLoopRequest(...)                    ← 真实 dsh-llm
       ├─ LlmRuntime.prepareCall(...)                  ← 真实 dsh-llm（注册表绑定）
       ├─ ctx.on('llm/stream') 瀑布                    ← 真实 dsh-llm
       ├─ registered LlmAdapter.stream(...)            ← 本地 fake provider
       ├─ BlockAssembler.push(chunk)                   ← 真实 dsh-llm
       └─ registerGoTools / GoCapabilityGuard          ← 真实生产工具面
```

- `tests/benchmark/llm-request-path.ts`：真实 `LlmRuntime` 接线；`llm/stream`
  监听器会断言每个请求都带 AgentLoop 标记，否则直接报错。
- `tests/benchmark/fake-provider.ts`：`ScriptedLlmProvider extends LlmAdapter`，
  只实现 `stream()`，产出真实 `StreamChunk` 词汇。
- 每次请求在 metrics 里记录 `requestPath`：`llmRequests` /
  `loopMarkedRequests` / `streamSeamRequests` / `retryPolicy`，测试要求三者等于步数。

### 唯一的替身：AgentLoop 本体

`@deepseek-ai/dsh-agent-loop` 不在本包依赖面内（`node_modules/@deepseek-ai` 只有
`cordis`、`dsh-agent`、`dsh-llm`、`dsh-session`），因此 step/turn 驱动由
`tests/benchmark/harness.ts` 按 pinned loop 的公开契约自行组装：标记 loop 请求 →
应用生产 `agent/request` cap → 调 `LlmRuntime`。loop 以下全部是真实 pinned 实现。
`src/runtime` 里没有可执行的 loop 工厂，只有 lane 身份与 focus/yield 边界，因此
“复用 src/runtime 的 AgentLoop 接线”在本仓库当前依赖下做不到；这一点在摘要
`docs/validation/COGNITION_BENCHMARK_SCRIPTED_SUMMARY.md` 里也写明了。

## 替身与真实 provider 的接口差

相同：都实现 `LlmAdapter` 抽象类；都由 `registerAdapter` 注册；都经
`prepareCall` → `llm/stream` → `stream()` 分发；都产出同样的 `StreamChunk`
（`block-start` / `tool-call-delta` / `block-end` / `usage` / `finish`）。

不同（均已在 `fake-provider.ts` 文件头注明）：

1. 传输：无 HTTP、无 `fetch`、无 `attributionHeaders`、无 DeepSeek 序列化；
2. usage：脚本合成 token（固定公式），不是 provider 真实计量；
3. `maxTokens`：fake provider 故意不截断输出，用来证明闸门不信请求字段、
   仍会按上报 usage 复查；
4. 重试策略：显式 `maxRetries: 0`（真实 adapter 由自身 policy 决定）。

## 闸门参数

`tests/benchmark/budget-gate.ts`（只在 benchmark 侧，作用域＝整次 benchmark 会话）：

| 闸门 | 默认值 | 执行点 |
|---|---:|---|
| `maxRequests` | 120 | 每次请求分发前（8×3×4=96 + 余量） |
| `maxInputTokensPerRequest` | 8000 | 分发前估算 + 上报 usage 复查 |
| `maxOutputTokensPerRequest` | 4000 | 请求 `maxTokens` clamp + 上报 usage 复查 |
| `maxEstimatedCostCny` | ¥6.66（汇率 `usdToCnyRate` 7.1） | 分发前最坏情况换算预检 + 上报后累计 |
| 自动重试 | 禁止 | adapter `maxRetries: 0`；同一步重复请求记 `retries-forbidden` |
| search/fetch | 禁止 | 请求 tools 列表 + 每条流出的 tool call |

触发后：抛 `BenchmarkBudgetStopError`，run 立即停止，metrics 的
`outcome = 'budget_stop'`、`budgetStop` 记录 gate/detail/step/observed/limit；
`buildBenchmarkRecord` 把整次会话的闸门快照写进 `record.budgetGate`（含 `stops`）。
价格表目前是**占位值**（$1/M input、$2/M output），不是 DeepSeek 报价；真实跑必须
传入批准的价目表，并以 `mode: 'live'` 构造 gate——live 模式缺价目表会直接抛错。

大模型响应里流出的 search/fetch 工具在 `registry.invoke` 之前就被拒绝（测试
`stops before executing a search/fetch tool call streamed by the model`）。

## 改动文件

| 文件 | 职责 |
|---|---|
| `tests/benchmark/llm-request-path.ts` | 新：真实 `LlmRuntime` 请求路径 + `llm/stream` 断言 + `BlockAssembler` 取回 tool call/usage；现要求 gate 并在内部准入/记账，拒绝带重试的 adapter |
| `tests/benchmark/request-path.test.ts` | 新：闸门下沉与传输层不重试的测试（含本地 429 HTTP 服务） |
| `tests/benchmark/fake-provider.ts` | 新：无网络 `LlmAdapter` 替身、重试策略 0、物理请求计数 |
| `tests/benchmark/budget-gate.ts` | 新：会话级请求/输入/输出/费用/重试/search-fetch 闸门 + `budget_stop` |
| `tests/benchmark/harness.ts` | 改：每步走真实请求路径、应用闸门、记录 `requestPath`/`outcome`/`budgetStop`；AgentLoop 驱动为文档化替身 |
| `tests/benchmark/fixtures.ts` | 改：`ScriptedToolCall` 增加仅闸门测试使用的 `web_search` |
| `tests/benchmark/cognition-benchmark.test.ts` | 改：断言 8 类场景的真实请求路径计数与记录里的闸门快照 |
| `tests/benchmark/budget-gate.test.ts` | 新：15 个闸门/正常路径/失败可见用例 |
| `docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json` | 重新生成（requestPath、budgetGate） |
| `docs/validation/COGNITION_BENCHMARK_SCRIPTED_SUMMARY.md` | 更新真实路径、闸门、待办 |

`src/` 改动：无（`git diff 1b1e612..cbfcc38 -- src/` 为空）。

## 命令与真实输出

红（`6bc6764`，工作树暂时 stash 掉实现文件）：

```text
pnpm exec vitest run tests/benchmark
 Test Files  2 failed | 1 passed (3)
      Tests  2 failed | 8 passed (10)
AssertionError: expected undefined to be 'dsh-llm-runtime'
（budget-gate.test.ts 因 ./budget-gate.js 不存在整文件加载失败）
```

绿（`cbfcc38`）：

```text
pnpm exec vitest run tests/benchmark
 Test Files  3 passed (3)
      Tests  25 passed (25)

pnpm verify
$ pnpm run typecheck && pnpm run test && pnpm run clean && pnpm run build
$ tsc -p tsconfig.json --noEmit
 Test Files  39 passed (39)
      Tests  493 passed (493)
$ node --eval "...rmSync('lib'...)"
$ tsc -p tsconfig.build.json
EXIT=0
```

记录重新生成（`./tests/benchmark/run-cognition-benchmark.sh`）：

```text
cognition benchmark record: docs/validation/COGNITION_BENCHMARK_SCRIPTED_RECORD.json
requests=54  estimatedCostUsd=0.039681  stops=0
8 classes × 3 runs, all outcome=completed
```

## 红/绿与有牙证据（活体变异，已复原）

对 `budget-gate.ts` 逐项变异并只跑 `tests/benchmark/budget-gate.test.ts`：

| 变异 | 结果 |
|---|---|
| 删除 `maxRequests` 检查 | 2 failed / 13 passed（含 record 用例） |
| 删除上报后的输出上限复查 | 1 failed / 14 passed |
| 删除重复 step（重试）检测 | 1 failed / 14 passed |
| 禁用 search/fetch 判定 | 2 failed / 13 passed |
| 删除费用预估 + 累计两个检查 | 3 failed / 12 passed |

全部复原后：`Tests 15 passed (15)`。

## 未验证 / 需决定

1. **真实 DeepSeek run 未执行**（无凭据、未批准花费）。live 驱动已接线并通过
   stub `fetch` 验证；真实 latency、真实 input/output token、真实 model steps 仍缺，
   本记录不能作为标定结果。
2. 真实跑使用本仓库的 `LiveBenchmarkProvider`（等价 `LlmAdapter`），没有安装
   `@deepseek-ai/dsh-llm-deepseek`；真实 API 的 usage 字段映射、SSE 分片和超时
   归一化仍未在真实响应上验证。
3. `@deepseek-ai/dsh-agent-loop` 未安装。真实跑前需主人决定：加 pinned 依赖，
   或接受当前文档化的 loop 替身。加依赖属于主人的决定（也涉及安装/联网）。
4. 价格表是占位值；真实跑必须给出批准的 DeepSeek 价目表，并让 gate 以
   `mode: 'live'` 构造（缺价目表会直接抛错，不会静默用占位价）。
5. 生产 `GoTurnBudget` 默认值仍未切换；等真实数据后再进 C-T10 的 config 步骤。
6. 本机 Node v26.10.0，`package.json` 要求 `>=24.11.1 <25`；CI 固定 Node 24.11.1，
   上面的证据来自本机。

## 已知限制

- fake provider 的 token 数是脚本公式，不是 DeepSeek 计量；latency 是本地
  harness 墙钟（含 `LlmRuntime` 开销），不是模型延迟。
- AgentLoop step/turn 生命周期是替身；真实 loop 的 resume/steering/turn-end
  语义不在本 harness 范围内。
- 闸门与 harness 同进程同信任边界：若 provider 伪造 `usage`，闸门只能按伪造值判；
  它保证的是“任何被报告的超限都会停”，不是“provider 不会撒谎”。
