# WAVE-C-T04 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-C-T04`
- 基线 SHA：`2a2e5b4d6ff4b4161f8f30925aec77600409d40c`（分支起点；创建时落后 `origin/main` 2 个提交）
- 分支：`work/c-t04-go-preset-isolation`
- 红测试提交（首轮）：`638a00060cb327c918d399263467fcf1157ea69f`
- 实现提交（首轮）：`faf2fcf64dd55eaf060360104a394a703d2e1803`
- 送审 HEAD（r1）：`5371609`（合入 `origin/main` 后的评审基准，14 files / 127 tests）
- 对抗审查 r1 红测试提交：`dae1efa754dfe1369865c1179fb12faa9cf4ca72`
- 对抗审查 r1 修复提交：`728e84ab82fc2431a5027dc21af1f0df12963d52`
- 状态：r1 的 P1/P2 已修复，本地 `pnpm verify` 通过（14 files / **135 tests**）；**未推送、未开 PR、未合并**

## 做了什么

### 首轮（`faf2fcf`）

- 新增 `src/preset/go-preset.ts`：仓库自有的 Go preset 声明。
  - `GO_PRESET_ID = 'companion-go-native-only'`，对应 DSH 会话头 `agentPreset` 的持久化身份；
  - `presentation: 'native-only'`，`capabilityKinds: ['model-native']`；
  - 显式禁止 `code-mode` / `bash` / `python` / `web` / `subagent` / `generic-mcp` / `external-solver` / `general-execution`；
  - 工具路径前缀 `go.` / `companion.`（Spec §20 最终 8 + 2 面；Phase A 只注册 `go.*`）；
  - preset 及其数组全部 `Object.freeze`。
- 新增 `src/runtime/go-capability-guard.ts`：执行期能力守卫（首轮版本）。
- `src/runtime/index.ts` 导出 preset 与 guard 的公开 API。

### r1 修复（`dae1efa` + `728e84a`）

- **P1-1 能力 kind 不再由注册方自报**：新增 `nativeGoCapability(toolPath, run)` 工厂，产出冻结描述符，并在模块私有 `WeakMap` 里记录 kind（唯一写入点）。`register(capability: unknown)` 只接受本模块铸造的描述符；普通对象/伪造对象直接抛 `ForgedGoCapabilityError`，同时把该路径记进隔离表，后续 `execute()` 以 `forged-descriptor` 确定性拒绝，伪造的 `run` 永不执行。`assertGoCapabilityAllowed()` 同样要求已铸造描述符，kind 只从 provenance 记录读取。
- **P1-2 preset 真正落到 Go session**：`src/index.ts` 的 `apply()` 只对 `go` 泳道传 `meta: { agentPreset: GO_PRESET_ID }`，Work 泳道保持原样；`src/index.test.ts` 的严格实参断言已更新，并新增用真实 `@deepseek-ai/dsh-session` 的 `Session.create` 构造会话头、断言 `go session header.agentPreset === GO_PRESET_ID`（Work 为 `undefined`）的用例。
- **P2-1 preset authority 只认冻结常量**：`GoCapabilityGuard` 构造函数接受 `unknown`，只有 `preset === GO_PRESET`（同一冻结对象）才通过，任何加宽副本直接抛错；`assertGoCapabilityAllowed()` 不再接受外部 preset 参数，策略固定读取 `GO_PRESET`。
- **P2-2 Go scope 只有一个**：新增模块级单例 `goCapabilityGuard` 与 `resolveGoCapabilityGuard()`；测试断言两个消费者拿到同一实例，且 A 注册的能力在 B 里可执行。
- 测试从 12 个扩到 20 个（守卫文件），全仓 127 → 135。

## r1 审查发现与处置

| 编号 | 发现 | 处置 | 证据 |
|---|---|---|---|
| P1-1 | `GoCapability.kind` 由注册方自报，bash 标成 `model-native` 即可执行 | 已修复：模块工厂 + 私有 WeakMap 铸造，`register()` 拒绝未铸造对象，隔离表保证执行期仍拒绝 | `dae1efa` 断言级红（`register` 未抛错、`execute` 未抛错）；`728e84a` 后两条用例通过 |
| P1-2 | `src/index.ts` 从未把 preset 应用到 Go 泳道 | 已修复：go 泳道传 `meta.agentPreset`，并断言真实 session header | `dae1efa` 红（实参缺 `meta`、header 两处均 `undefined`）；`728e84a` 后通过 |
| P2-1 | 调用方可传加宽 preset 构造守卫 | 已修复：构造函数只接受 `GO_PRESET` 本身 | "refuses a caller-supplied preset that widens the realm" |
| P2-2 | 守卫实例各自持有一份 scope | 已修复：`goCapabilityGuard` / `resolveGoCapabilityGuard()` 单例 | "resolves one guard for every consumer" |
| P2-3 | 交接包战绩与送审 SHA 不对应 | 已修复：本文件记录 `5371609` = 14 files / 127 tests | 本文件 |
| P3-1 | 首轮红线是模块 import 失败，不是断言级 | 已处理：r1 红测试 `pnpm run typecheck` 通过、3 条守卫用例断言级失败 | `dae1efa` 的提交说明与命令输出 |
| P3-2 | 测试把 `companion.` 前缀钉死，与 C-T01 的 Phase A 注册表策略存在张力 | 保持现状并记录（见"已知问题"），未在本次改动中替票据做决定 | — |

## 真实 DSH API 与仓库自有守卫的原因

在 pinned 依赖面（`@deepseek-ai/cordis@4.0.1`、`dsh-agent@0.1.1-rc.2`、`dsh-llm@0.1.1-rc.2`、`dsh-session@0.1.1-rc.2`）中实际核查：

- 唯一的 preset 相关 API 是 `CreateAgentOptions.meta.agentPreset?: string` 与 `SessionHeader.agentPreset?: string`，语义是"该 session 的 agent 由哪个 preset 组合而来"，是持久化元数据，不是能力策略；
- 不存在 `dsh-agent-presets` 包、`restrict()`、`scopeOf()`、工具注册/执行服务或任何 pre-execution policy 钩子；
- 因此按任务要求实现"仓库自有声明 + 守卫"，不 patch DSH core，也不新增依赖。

`GO_PRESET_ID` 现在已由 `apply()` 写入真实 Go session 的 durable header（`meta.agentPreset`）；把守卫接到真实工具执行边界仍属 C-T02。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 首轮红 | `pnpm test` | 1 个 suite 失败：`Cannot find module '../preset/go-preset.js'`；原有 48 个测试通过（评审 P3-1 指出这不是断言级红） | `638a000` |
| 首轮绿 | `pnpm verify` | typecheck PASS、7 files / 60 tests passed、clean+build PASS | `faf2fcf` |
| r1 送审基准 | `pnpm verify`（评审复跑） | 14 files / 127 tests passed | `5371609` |
| r1 红 | `pnpm run typecheck` + `npx vitest run src/runtime/go-capability-guard.test.ts src/index.test.ts` | typecheck exit 0；守卫 3 failed / 12 passed（全部断言级：伪造注册未抛错、别名能力执行未抛错、加宽 preset 未抛错）；`src/index.test.ts` 2 failed（缺 meta、header 无 agentPreset） | `dae1efa` |
| r1 绿 | `pnpm verify` | **exit 0**；14 files / **135 tests passed**；typecheck、clean、build 全通过 | `728e84a` |
| 定向复跑 | `npx vitest run src/runtime/go-capability-guard.test.ts src/index.test.ts` | 2 files / 24 tests passed（逐条 ✓，含两条 P1-1 回归与 header 断言） | `728e84a` |
| 变异检查（首轮） | 临时删除 `execute()` 内的 `assertGoCapabilityAllowed(...)` | 6 failed / 6 passed；恢复后全绿 | 未提交 |

## 覆盖的验收点

- preset 形状 native-only：`lane='go'`、`presentation='native-only'`、只允许 `model-native`、8 类禁止能力齐全、preset 与数组冻结；
- 伪造 `kind: 'model-native'` 的普通对象：注册即抛 `ForgedGoCapabilityError`，之后执行该路径仍被 `forged-descriptor` 拒绝（Spec §19"accidentally registered or aliased ... must still fail at execution"）；
- 8 类禁止能力逐一遍历：注册被拒 + 执行被拒 + `run` 从未调用；
- 未分类的新 kind 失败关闭；
- 已铸造的 `fs.read` 描述符在执行期被 `tool-path` 拒绝（执行期策略仍在）；
- 未注册路径 `unregistered`；
- 隔离表语义：伪造路径保持被拒，直到用合法铸造的描述符替换；
- 铸造描述符冻结，运行期改写 `kind` 抛 `TypeError`；
- `assertGoCapabilityAllowed()` 与守卫使用同一 provenance + policy 检查；
- 构造函数拒绝加宽 preset，接受冻结 `GO_PRESET`；
- 单例：两个消费者解析到同一 guard，注册可见；
- `apply()`：Work 无 meta，Go 带 `meta.agentPreset`，且真实 `SessionHeader.agentPreset` 只在 Go 上出现。

## 改动文件

- `src/preset/go-preset.ts`（新增）
- `src/runtime/go-capability-guard.ts`（新增，r1 后重写 provenance 模型）
- `src/runtime/go-capability-guard.test.ts`（新增，r1 后扩到 20 个测试）
- `src/runtime/index.ts`（仅导出）
- `src/index.ts`（r1 P1-2：go 泳道 `meta.agentPreset`）
- `src/index.test.ts`（r1 P1-2：严格实参断言 + 真实 session header 断言）
- `handoffs/WAVE-C-T04.md`

## 未验证

- 本机 Node 为 `v26.10.0`，仓库 engines 要求 `>=24.11.1 <25`；`pnpm verify` 只有 `Unsupported engine` 警告。**未在 CI 的 Node `24.11.1` 下复跑**。
- 守卫尚未接入真实工具执行：pinned 依赖面没有工具注册/执行 API，实际接线属于 C-T02（工具注册）与 C-T05（anti-cheat 套件）。
- `goCapabilityGuard` / `resolveGoCapabilityGuard()` 目前只在守卫模块内导出，`src/runtime/index.ts` 的再导出未改（本票允许的改动面不含该文件）；C-T02 接线时应补上再导出并让组合根改用单例。
- 未推送、未开 PR、未合并，无 CI 证据。

## 已知问题 / 需决定

- **P3-2（保持）**：`GO_TOOL_PATH_PREFIXES` 同时允许 `go.` 与 `companion.`，这是 Spec §20 的最终 8 + 2 面；Phase A 只注册 `go.*`，C-T01 的注册表策略单独限制为 `go.*`。若审查认为 Phase A preset 只应允许 `go.`，需要改 preset 常量与一条测试。
- 守卫是执行权入口，但 JS 无法阻止调用方绕过 `execute()` 直接调用某个已铸造描述符的 `run`。C-T02 的所有 Go 工具执行必须经 `GoCapabilityGuard.execute()`，或在自己的执行边界先调用 `assertGoCapabilityAllowed()`；C-T05 应以"绕过守卫直接调用"作为反向用例之一。
- `GoCapabilityGuard` 的构造函数仍然公开（隔离测试需要独立实例）；组合根必须用 `resolveGoCapabilityGuard()`，不要自己 `new`。
