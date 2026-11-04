# WAVE-A-T06 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-A-T06`
- 基线 `main`：`77dd581`（`Merge pull request #73 from FlapPearLabs/docs/d-t01-post-merge-sync`）
- 分支：`work/a-t06-inactive-lane-admission`
- 测试提交（红）：`7929600`
- 实现提交（绿）：`bde733d`
- 状态：实现完成，本地 `pnpm verify` 通过；**未 push、未开 PR、未合并**

## 做了什么

- 新增 `src/runtime/admission.ts`
  - `admitInactiveLaneUserMessage(state, { target, sourceSessionId, message }, arbitrate?)`
    恰好创建一个 `PendingFocusIntent{ target, origin: "user_command", sourceMessage }`；
  - `sourceMessage.message` 就是用户那条不可变 DSH `UserMessage` 的同一引用，
    不做文本复制、不落 `capturedText`；意图与 `sourceMessage` 包装均冻结；
  - 通过 A-T02 的 `submitFocusIntent` 提交一次，并把仲裁返回的
    `disposition` / `state` 原样带回；仲裁函数可注入（默认即 A-T02 原语），
    供测试断言"仲裁确实收到意图"；
  - 空内容、纯空白文本、缺 `sourceSessionId`、非 `user` 角色、非法 target、
    缺 message 都在创建意图之前拒绝，仲裁不会被调用；
  - 不持有 Agent、定时器、队列、邮箱、路由，也不复制消息文本。
- 新增 `src/runtime/admission.test.ts`（16 个用例，其中 `it.each` 5 个）。
- `src/runtime/index.ts` 导出 `admitInactiveLaneUserMessage` 与
  `InactiveLaneAdmission` / `InactiveLaneAdmissionRejection` /
  `InactiveLaneAdmissionResult` / `FocusIntentArbitration`。

规格依据：§7.2（非活动泳道用户输入不需要该泳道 Agent 先运行）、§16 Manual、
§44（`USER messages on an inactive lane are admitted by UI/Runtime, not by
first waking that lane to reason.`）。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红（测试） | `pnpm test` | 1 suite failed：`Cannot find module './admission.js'`；其余 13 files / 115 tests 通过 | `7929600` |
| 红（类型） | `pnpm typecheck` | `TS2307` ×2（`./admission.js` 不存在），exit 2 | `7929600` |
| 绿 | `pnpm typecheck` | exit 0 | `bde733d` |
| 绿 | `pnpm test` | 14 files / **131 tests passed**（新增 16，原 115 全过） | `bde733d` |
| 回归 | `pnpm verify` | **exit 0**：typecheck PASS、131/131 PASS、clean + build PASS | `bde733d` |

## 变异验证（证明测试不是摆设）

临时改坏 `admission.ts` 后只跑 `src/runtime/admission.test.ts`，改完已还原，
工作树与 `bde733d` 完全一致（`diff -q` 无差异），未提交：

| 变异 | 结果 |
|---|---|
| 重复调用 `arbitrate(state, intent)`（意图被提交两次） | 2 failed（`expected "vi.fn()" to be called 1 times, but got 2 times`） |
| `origin` 改成 `self_initiated` | 2 failed |
| 绕过仲裁，直接写 `state.pendingFocus` | 3 failed（仲裁调用次数为 0） |

## 覆盖的验收点

- 恰好一个 `PendingFocusIntent`，`target` / `origin` / `sourceMessage` 精确，
  key 集合恰为 `target, origin, sourceMessage`；
- 仲裁恰好收到 1 次调用，且收到的就是这同一个意图；其 `disposition` 与
  `state` 被原样返回；
- 已有 `user_command` 待处理时得到 `retained-existing`，旧意图胜出，不产生
  第二个待处理意图；
- 模拟非活动 View 的 Agent 句柄（`run` / `steer` / `cancel` / `status`）
  计数保持 0，`status` 一次都没读；
- 模块命名面没有 queue / mailbox / router / buffer / history；
- 反复准入后 `RuntimeFocusState` 只有 `activeLane, llmRunning, pendingFocus`，
  `pendingFocus` 永远不是数组（无队列/邮箱）；
- 非法/空输入被拒绝且不创建意图、不调用仲裁；
- 纯图片内容仍被接纳（不是只看文本）；
- 不修改调用方 state 与原始消息，意图/结果冻结。

## no-queue / no-agent 审计

```text
$ grep -nE "agent|steer|\brun\b|status" src/runtime/admission.ts
no matches

$ grep -nE "queue|mailbox|router|buffer|history|capturedText" src/runtime/admission.ts
9: * queue, mailbox, router, timer, or copied text.   ← 仅模块注释中的否定声明

$ grep -n "^export" src/runtime/admission.ts
export type InactiveLaneAdmission
export type InactiveLaneAdmissionRejection
export type FocusIntentArbitration
export type InactiveLaneAdmissionResult
export function admitInactiveLaneUserMessage
```

模块没有 import `@deepseek-ai/dsh-agent`，没有 Agent 参数，没有数组/集合型状态，
没有定时器/事件订阅；唯一状态写入是 A-T02 `submitFocusIntent` 的返回值。

## 改动的文件

- `src/runtime/admission.test.ts`（新增，`7929600`）
- `src/runtime/admission.ts`（新增，`bde733d`）
- `src/runtime/index.ts`（+8 行导出，`bde733d`）
- `handoffs/WAVE-A-T06.md`（本文件，`docs:` 提交）

## 假设与边界

- "空/无效输入"定义：content 为空数组，或所有 block 都是纯空白文本；图片等
  非文本 block 视为有效内容。非 `user` 角色、缺 session id、非 `work|go`
  target 一律拒绝。
- 本票只做准入意图：API 是 `RuntimeFocusState` 上的纯函数，返回新 state。
  接进 `RuntimeFocusOwner` / 真实 UI 不在本票范围（允许面也只有
  `src/runtime/` 与导出）；A-T03/A-T04/A-T07 负责边界、yield、resume。
- 仲裁参数可注入只用于测试证明"仲裁确实收到意图"；生产默认即 A-T02
  `submitFocusIntent`，没有第二条仲裁路径。

## 未验证

- 真实 UI / View 接线未做，也没有真实 DSH inbox 投递证据（本票明确不含）。
- 未在 Node `24.11.1` 下复跑：本机是 Node `26.10.0`，`pnpm` 只打印
  `Unsupported engine` 警告，typecheck / test / build 全部通过。
- 未做独立审查（实现者不能给自己审查）；审查由后续独立 agent 执行。
- 未更新 `CURRENT_IMPLEMENTATION_BASELINE.md` / ticket 状态（按仓库规则由
  合并后的 docs sync 处理）。

## 已知问题 / 需决定

- 为在当前工作树跑测试，`node_modules` 是指向主检出已装依赖的软链接
  （`.gitignore` 的 `node_modules/` 目录规则覆盖不到软链接，`git status` 中
  显示为未跟踪）。它没有被提交，也不影响分支/PR；保留它是为了让本工作树
  可以直接复跑 `pnpm verify`，不需要时删除即可，或用
  `pnpm install --frozen-lockfile` 重建。
- `retained-existing` 时新意图会随结果返回但不入状态（旧 user_command 胜出），
  调用方若需要"提示用户上一条命令尚未处理"，需由 UI 层决定；本票不引入队列。
- `FocusIntentArbitration` 作为公开类型导出，仅服务于可测试注入；若后续
  不允许外部替换仲裁，可在 UI 接线时收窄为模块内部类型。
