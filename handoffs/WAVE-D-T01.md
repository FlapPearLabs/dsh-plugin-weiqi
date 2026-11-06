# WAVE-D-T01 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-D-T01`
- 基线 `origin/main`：`2a2e5b4d6ff4b4161f8f30925aec77600409d40c`
- 分支：`work/d-t01-bridge-latest-value`
- 红测试提交：`3a9da4d`
- 实现提交：`15cb3d6`
- 状态：实现完成，本地 `pnpm verify` 通过；**未推送、未开 PR、未合并**

## 做了什么

- 新增 `src/bridge/latest-value.ts`
  - `LatestValueSlot<T>` 每个 payload 只保留一个最新值和它的顺序号；
  - `publish(value, sequence)` 在 `sequence <= 已保留 sequence` 时返回 `stale` 并且不改写，旧值不会复活；
  - 不存历史、不提供 drain / 队列 / 订阅接口；非负安全整数之外的 sequence 抛 `RangeError`。
- 新增 `src/bridge/schema.ts`
  - `assertWorkSnapshot` / `assertGameNotice` 按 Spec §10/§11 精确校验字段集合；
  - 未知字段（`urgency`、`dangerLabel`、`recommendedMove`、`winRate`、`strategicScore`、`command`、`pendingCommands`、`progressPercent`、`plan` 等）一律 `BridgeSchemaError`；
  - `AffectedGroupDelta` 逐组校验，嵌套的战略标签同样拒绝。
- 新增 `src/bridge/runtime.ts`
  - `BridgeRuntime.updateWork` / `updateGame` 只校验并写入各自 slot；
  - `read()` 仅读两个 slot，返回当前 `CompanionBridge`；`latestWorkSnapshot` / `latestGameNotice` getter 供 O(1) 读取；
  - 更新与读取都不会重扫来源、不会触发另一个 payload 的更新（§12 无递归投影）。
- 新增 `src/bridge/index.ts` 导出上述 Runtime 面。
- 新增三个共置测试文件：`latest-value.test.ts`、`schema.test.ts`、`runtime.test.ts`。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红 | `pnpm test` | 3 个 suite 失败：`Cannot find module './latest-value.js' / './schema.js' / './runtime.js'`；原有 **48** 个测试仍通过 | `3a9da4d` |
| 绿 | `pnpm test` | 9 files / **84 tests passed** | `15cb3d6` |
| 回归 | `pnpm verify` | exit 0：typecheck PASS、84/84 PASS、clean+build PASS | `15cb3d6` |

## 覆盖的验收点

- latest-value 合并：50 次快速发布只保留最新值和 sequence；
- 过期更新不复活：更小或相同的 sequence 返回 `stale`，保留值不变；
- 无历史：slot 的公开键为空，没有 `history` / `values` / `drain` / `flush` / `enqueue` / `subscribe`；
- GameNotice schema：允许字段集合精确等于 Spec §11，禁止战略标签与命令；
- WorkSnapshot grounded：精确保留权威 Work 事实，拒绝 `progressPercent` 等派生/编造字段，可选 `lastResult` 缺失时不补造；
- 无递归：读取不再次读取来源（getter 计数不变），Work 更新不影响 GameNotice，反之亦然；
- `affectedGroups` 随最新通知整体替换，不累积走子历史。

## 假设

- 顺序号由权威来源在产出 payload 时提供（例如走子序号或 Work 事实版本号）；Runtime 不自造顺序，也不按 payload 内容猜测新旧。
- `AffectedGroupDelta` 不是 `CompanionBridge` 的独立字段，而是 `GameNotice.affectedGroups` 的组成部分；本票通过“最新通知整体替换其 affectedGroups”满足“per payload 只保留最新”的语义，未额外增加第三个 bridge 字段（那会修改冻结契约）。

## 未验证

- 真实 Harness/session/tool/job 事实的生产者，以及 Go 侧 `GameNotice` 的生产者：本票只提供 Runtime 持有者与校验，不产出事实。
- `ctx.systemPrompt.context` 投递、按需物化与 prompt 稳定性：属于 **D-T03 / D-S01**，本票未做。
- 长局后的跨泳道历史隔离 gate：属于 **D-T02**。
- 未在 Node `24.11.1` 下复跑；本机为 Node `26.10.0`，仅出现 `Unsupported engine` 警告，typecheck / test / build 均通过。
- 工作树原本没有 `node_modules`，用 `pnpm install --frozen-lockfile` 从现有 pnpm store 安装锁定依赖；未修改 `package.json` / `pnpm-lock.yaml`。
- 未推送、未开 PR、未合并；未更新 `CURRENT_IMPLEMENTATION_BASELINE.md` / ticket 状态（按仓库规则由合并后的 docs sync 处理）。

## 已知问题 / 需决定

- `src/index.ts` 不在本票允许的改动面内，因此 `BridgeRuntime` 目前只从 `src/bridge/index.ts` 导出，包根还看不到；D-T03 接线时再决定是否暴露。
- `read()` 每次返回新的 `CompanionBridge` 容器，但内部 payload 是权威对象的同一引用；本票不做深拷贝或冻结，避免篡改来源对象语义。
- 相同内容、更大 sequence 仍算 `published`。D-T03 若需要“内容未变不重复物化”，应在投递层比较渲染结果，而不是在本持有者里增加内容相等判断。
