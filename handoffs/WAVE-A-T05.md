# WAVE-A-T05 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi`
- 基线 `main`：`2a2e5b4`
- 分支：`work/a-t05-source-message-handoff`
- 代码 HEAD：`5450f36`
- PR：`#65`（`https://github.com/FlapPearLabs/dsh-plugin-weiqi/pull/65`）
- 状态：实现完成，本地验证与 PR CI 通过；**已开 PR，未合并**

## 做了什么

- 新增 `src/runtime/handoff.ts`
  - `createCompanionHandoff(intent)`：只读 `pendingFocus.sourceMessage`，把已存储的不可变 `UserMessage` 的 exact content blocks 复制到一条新身份的目标泳道 user message；
  - provenance：`source.kind = "plugin"`、`plugin = "companion-go"`、`form = "relay"`、`sourceSessionId = 原 session`；
  - intent 无 `sourceMessage` 时返回 `undefined`；
  - 不读 session surface，不写 `capturedText`，不修改 intent。
- 新增 `src/runtime/handoff.test.ts`（8 个测试）。
- 在 `src/runtime/index.ts` 导出新 API。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红 | `pnpm test` | 1 个 suite 失败：`Cannot find module './handoff.js'`；原有 48 个测试仍通过 | `4123ca0` |
| 绿 | `pnpm test` | 7 files / **56 tests passed** | `5450f36` |
| 回归 | `pnpm verify` | typecheck PASS、56/56 PASS、clean+build PASS | `5450f36` |

## 覆盖的验收点

- exact content blocks（含非 text block）；
- Companion-handoff provenance + 原 source session；
- 新消息身份，复用源 id 会被测试拒绝；
- 源 surface 被 compact/rewrite 后仍交付原 blocks；
- intent 不被修改，Runtime 状态中无第二份 `capturedText`；
- 返回消息深冻结。

## 未验证

- 真实 DSH inbox 投递、inactive lane wake：属于 **A-T06**，本票未做。
- 未在 Node `24.11.1` 下复跑；本机是 Node `26.10.0`，只有 `Unsupported engine` 警告，测试与构建均通过。
- 已推送并开 PR `#65`，尚未合并；未更新 `CURRENT_IMPLEMENTATION_BASELINE.md` / ticket 状态（按仓库规则，合并后由 docs sync 处理）。

## 已知问题 / 需决定

- `sourceSessionId` 作为 plugin source 的扩展字段保留在运行时对象上，但 DSH `MessageSource` 类型没有声明该字段；编译期只能通过 `toMatchObject` 或结构收窄访问。是否把它提升为公开类型，交给审查者决定。
- `createUserMessage` 会 `structuredClone` content，blocks 值完全一致但非同一对象引用；这是 DSH 官方消息创建语义，不是文本缓冲。
