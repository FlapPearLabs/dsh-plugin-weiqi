# Handoff · WAVE-C-T10（免费部分）— benchmark 接真实 LLM 请求路径 + 费用/请求闸门

- 状态：READY_FOR_REVIEW（零费用部分完成；真实 DeepSeek 标定仍待主人批准）
- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/task-c-t10`
- 分支：`task/c-t10`
- 基线 BASE_SHA：`1b1e612836fd3a8528c92764701767a0f54bcf34`（`origin/main`）
- 红测试 commit：`6bc6764`（`test: pin the DSH request path and spend/request gates`）
- 绿实现 commit：`cbfcc38`（`feat: route the §38 benchmark through the DSH LLM request path and gate spend`）
- 本 handoff 与记录/摘要以 `docs:` 单独提交
- 未 push、未开 PR

## 结论

`tests/benchmark/` 的请求路径已从“直接调脚本适配器”改为经过 pinned
`@deepseek-ai/dsh-llm` 的真实 `LlmRuntime` 请求路径；模型侧是本地无网络
fake provider。8 类 §38 场景全部在真实 provider 绑定、`llm/stream` 瀑布、
`prepareCall` 和 `BlockAssembler` 上跑通，计数与记录一致。

benchmark 侧新增会话级费用/请求闸门：总请求 96、单请求输入 8000 / 输出 4000、
预估总费用 $1.00、禁自动重试、禁 search/fetch。任一触发即停止并记录
`budget_stop`。每个闸门都有可单独触发的测试（见“红/绿与有牙证据”）。

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
| `maxRequests` | 96 | 每次请求分发前 |
| `maxInputTokensPerRequest` | 8000 | 分发前估算 + 上报 usage 复查 |
| `maxOutputTokensPerRequest` | 4000 | 请求 `maxTokens` clamp + 上报 usage 复查 |
| `maxEstimatedCostUsd` | 1.00 | 分发前最坏情况预估 + 上报后累计 |
| 自动重试 | 禁止 | adapter `maxRetries: 0`；同一步重复请求记 `retries-forbidden` |
| search/fetch | 禁止 | 请求 tools 列表 + 每条流出的 tool call |

触发后：抛 `BenchmarkBudgetStopError`，run 立即停止，metrics 的
`outcome = 'budget_stop'`、`budgetStop` 记录 gate/detail/step/observed/limit；
`buildBenchmarkRecord` 把整次会话的闸门快照写进 `record.budgetGate`（含 `stops`）。
价格表目前是**占位值**（$1/M input、$2/M output），不是 DeepSeek 报价；真实跑必须
传入批准的价目表。

大模型响应里流出的 search/fetch 工具在 `registry.invoke` 之前就被拒绝（测试
`stops before executing a search/fetch tool call streamed by the model`）。

## 改动文件

| 文件 | 职责 |
|---|---|
| `tests/benchmark/llm-request-path.ts` | 新：真实 `LlmRuntime` 请求路径 + `llm/stream` 断言 + `BlockAssembler` 取回 tool call/usage |
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

1. **真实 DeepSeek run 未执行**（无凭据、未批准花费）。真实 latency、真实
   input/output token、真实 model steps 仍缺；本记录不能作为标定结果。
2. 真实 provider adapter `@deepseek-ai/dsh-llm-deepseek` 未安装；真实跑要么加该
   pinned 包，要么提供等价 `LlmAdapter`。
3. `@deepseek-ai/dsh-agent-loop` 未安装。真实跑前需主人决定：加 pinned 依赖，
   或接受当前文档化的 loop 替身。加依赖属于主人的决定（也涉及安装/联网）。
4. 价格表是占位值；真实跑前必须给出批准的 DeepSeek 价目表，否则费用闸门只是
   结构验证。
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
