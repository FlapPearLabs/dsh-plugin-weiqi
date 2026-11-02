# WAVE-A-T05 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi`
- 基线 `main`：`2a2e5b4`
- 分支：`work/a-t05-source-message-handoff`
- 代码 HEAD：`a0cd046`
- PR：`#65`（`https://github.com/FlapPearLabs/dsh-plugin-weiqi/pull/65`）
- 状态：实现完成，本地验证与 PR CI 通过；**已开 PR，未合并**

## 做了什么

- 新增 `src/runtime/handoff.ts`
  - `createCompanionHandoff(intent)`：只读 `pendingFocus.sourceMessage`，把已存储的不可变 `UserMessage` 的 exact content blocks 复制到一条新身份的目标泳道 user message；
  - provenance：`source.kind = "plugin"`、`plugin = "companion-go"`、`form = "relay"`、`sourceSessionId = 原 session`；
  - intent 无 `sourceMessage` 时返回 `undefined`；
  - 不读 session surface，不写 `capturedText`，不修改 intent。
- 新增 `src/runtime/handoff.test.ts`（10 个测试）。
- 在 `src/runtime/index.ts` 导出新 API 与 provenance 类型。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红 | `pnpm test` | 1 个 suite 失败：`Cannot find module './handoff.js'`；原有 48 个测试仍通过 | `4123ca0` |
| 绿 | `pnpm test` | 7 files / **56 tests passed** | `5450f36` |
| 回归 | `pnpm verify` | typecheck PASS、56/56 PASS、clean+build PASS | `5450f36` |
| 补牙红 | `pnpm test` / `pnpm typecheck` | 1 failed（wrapper 未冻结）+ 57 passed；`TS2339`（`sourceSessionId` 无公开类型） | `4649747` |
| 补牙绿 | `pnpm verify` | typecheck PASS、7 files / **58 tests passed**、clean+build PASS | `a0cd046` |

## 独立审查（测试 agent，全新上下文）

- 结论 **APPROVE**，无 P0/P1；9 个变异实验中 7 个被杀。
- 两条漏网变异已在本分支修复：硬编码 `target:'go'`、硬编码 `sourceSessionId` 都能全绿；新增 `'work'` 夹具、独有 session 值、API 形状类型测试与 intent 重写快照测试。
- `sourceSessionId` 已通过 `CompanionHandoffMessage` / `CompanionHandoffSource` 提升为公开类型，消费方不再需要 cast。
- 评审原始结论与变异矩阵由审查 agent 输出，未落盘。

## 覆盖的验收点

- exact content blocks（含非 text block）；
- target 原样透传（`go` 与 `work` 两个方向）；
- Companion-handoff provenance + 原 source session（公开类型可读）；
- 新消息身份，复用源 id 会被测试拒绝；
- API 只接受 intent、不接 session surface；intent 被重写后交付快照不变；
- intent 不被修改，Runtime 状态中无第二份 `capturedText`；
- 消息、content、单个 block、source 与返回 wrapper 均深冻结。

## 未验证

- 真实 DSH inbox 投递、inactive lane wake：属于 **A-T06**，本票未做。
- 未在 Node `24.11.1` 下复跑；本机是 Node `26.10.0`，只有 `Unsupported engine` 警告，测试与构建均通过。
- 已推送并开 PR `#65`，尚未合并；未更新 `CURRENT_IMPLEMENTATION_BASELINE.md` / ticket 状态（按仓库规则，合并后由 docs sync 处理）。

## 已知问题 / 需决定

- `sourceSessionId` 已作为 `CompanionHandoffMessage` 的公开类型暴露；底层仍是 DSH 未声明的 plugin-source 扩展字段，若 DSH 后续收紧 source schema，需要改为官方扩展点（声明合并）。
- 插件名 `'companion-go'` 在 `src/index.ts` 与 `handoff.ts` 各有一份字面量；合并前可接受，后续可提到共享常量，避免改名漂移。
- `createUserMessage` 会 `structuredClone` content，blocks 值完全一致但非同一对象引用；这是 DSH 官方消息创建语义，不是文本缓冲。
- T06 必须在 `consumePendingFocus` 之前调用 `createCompanionHandoff`，否则 intent 已被丢弃、函数返回 `undefined`。
