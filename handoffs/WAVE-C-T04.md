# WAVE-C-T04 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-C-T04`
- 基线 SHA：`2a2e5b4d6ff4b4161f8f30925aec77600409d40c`（分支起点；创建时落后 `origin/main` 2 个提交）
- 分支：`work/c-t04-go-preset-isolation`
- 红测试提交：`638a00060cb327c918d399263467fcf1157ea69f`
- 实现提交：`faf2fcf64dd55eaf060360104a394a703d2e1803`
- 状态：实现完成，本地 `pnpm verify` 通过；**未推送、未开 PR、未合并**

## 做了什么

- 新增 `src/preset/go-preset.ts`：仓库自有的 Go preset 声明。
  - `GO_PRESET_ID = 'companion-go-native-only'`，对应 DSH 会话头 `agentPreset` 的持久化身份；
  - `presentation: 'native-only'`，`capabilityKinds: ['model-native']`；
  - 显式禁止 `code-mode` / `bash` / `python` / `web` / `subagent` / `generic-mcp` / `external-solver` / `general-execution`；
  - 工具路径前缀 `go.` / `companion.`（Spec §20 最终 8 + 2 面；Phase A 只注册 `go.*`）；
  - preset 及其数组全部 `Object.freeze`，运行期不能加宽。
- 新增 `src/runtime/go-capability-guard.ts`：执行期能力守卫。
  - `GoCapabilityGuard.register()` 只记录能力，**不授予执行权**；
  - `GoCapabilityGuard.execute()` 每次调用重新读取冻结的 preset 策略，拒绝后能力自身代码不会运行；
  - 拒绝原因区分 `forbidden-kind` / `unknown-kind` / `tool-path` / `unregistered`，统一抛 `ForbiddenGoCapabilityError`（携带 `toolPath`、`kind`、`presetId`）；
  - `assertGoCapabilityAllowed()` 暴露同一策略检查，供直接调用已绑定函数的工具边界使用，避免只依赖一个 wrapper。
- `src/runtime/index.ts` 导出 preset 与 guard 的公开 API。
- 新增 `src/runtime/go-capability-guard.test.ts`（12 个测试）。

## 真实 DSH API 与仓库自有守卫的原因

在 pinned 依赖面（`@deepseek-ai/cordis@4.0.1`、`dsh-agent@0.1.1-rc.2`、`dsh-llm@0.1.1-rc.2`、`dsh-session@0.1.1-rc.2`）中实际核查：

- 唯一的 preset 相关 API 是 `CreateAgentOptions.meta.agentPreset?: string` 与 `SessionHeader.agentPreset?: string`，语义是“该 session 的 agent 由哪个 preset 组合而来”，是持久化元数据，不是能力策略；
- 不存在 `dsh-agent-presets` 包、`restrict()`、`scopeOf()`、工具注册/执行服务或任何 pre-execution policy 钩子；
- 因此按任务要求实现“仓库自有声明 + 守卫”，不 patch DSH core，也不新增依赖。

`GO_PRESET_ID` 就是将来写入 `ctx.agents.create({ meta: { agentPreset: GO_PRESET_ID } })` 的值。把该元数据接进 Go agent 创建需要改 `src/index.ts`，不在本票允许的改动面（`src/runtime/`、`src/preset/`、同目录测试、`src/contracts/index.ts` 导出），故留给 C-T02 工具注册时一并接线。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红 | `pnpm test` | 1 个 suite 失败：`Cannot find module '../preset/go-preset.js'`；原有 48 个测试通过 | `638a000` |
| 绿 | `pnpm verify` | typecheck PASS、7 files / **60 tests passed**、clean+build PASS | `faf2fcf` |
| 变异检查 | 临时删除 `execute()` 内的 `assertGoCapabilityAllowed(...)`，运行 `npx vitest run src/runtime/go-capability-guard.test.ts` | **6 failed / 6 passed**（守卫测试确实依赖执行期检查）；恢复后 `pnpm verify` 重新全绿 | 未提交 |

## 覆盖的验收点

- preset 形状 native-only：`lane='go'`、`presentation='native-only'`、只允许 `model-native`、8 类禁止能力齐全、preset 与数组冻结；
- 禁止能力注册进 Go scope 后，执行仍确定性失败，且被禁能力的 `run` 从未被调用；
- 别名路径（`go.helpers.run` + `general-execution`）同样失败；
- 8 类禁止能力逐一遍历，全部在执行期被拒；
- 未分类的新 kind 失败关闭（不会“没列进禁止清单就放行”）；
- Go 泳道之外的路径（`fs.read`）与未注册路径同样被拒；
- 权限在每次 `execute()` 时重新评估：同一能力先以 `model-native` 执行成功，改 kind 为 `python` 后立即被拒；
- 直接调用边界的 `assertGoCapabilityAllowed()` 与 guard 使用同一策略。

## 改动文件

- `src/preset/go-preset.ts`（新增）
- `src/runtime/go-capability-guard.ts`（新增）
- `src/runtime/go-capability-guard.test.ts`（新增；绿阶段修正了测试里 `assertGoCapabilityAllowed` 的参数形状）
- `src/runtime/index.ts`（仅导出）

## 未验证

- 本机 Node 为 `v26.10.0`，仓库 engines 要求 `>=24.11.1 <25`；`pnpm verify` 只有 `Unsupported engine` 警告，typecheck、60 个测试、build 均通过。**未在 CI 的 Node `24.11.1` 下复跑**。
- 守卫尚未接入真实工具执行：pinned 依赖面没有工具注册/执行 API，实际接线属于 C-T02（工具注册）与 C-T05（anti-cheat 套件）。
- `GO_PRESET_ID` 尚未写入任何真实 Go session 的 `agentPreset` 元数据（原因见上，`src/index.ts` 不在允许改动面）。
- 未推送、未开 PR、未合并，无 CI 证据。

## 已知问题 / 需决定

- `GO_TOOL_PATH_PREFIXES` 同时允许 `go.` 与 `companion.`，这是 Spec §20 的最终 8 + 2 面；Phase A 只注册 `go.*`，C-T01 的注册表策略仍单独限制为 `go.*`。若审查认为 Phase A preset 只应允许 `go.`，需要改 preset 常量与一条测试。
- 守卫是执行权入口，但 JS 无法阻止调用方绕过 `execute()` 直接调用某个已注册能力的 `run`。C-T02 的所有 Go 工具执行必须经 `GoCapabilityGuard.execute()`，或在自己的执行边界先调用 `assertGoCapabilityAllowed()`；C-T05 应以“绕过守卫直接调用”作为反向用例之一。
- 注册表按 guard 实例保存；若将来多个组合点各自 new guard，需要共享同一个 Go 泳道实例，否则“注册进 Go scope”会分裂成多份。
