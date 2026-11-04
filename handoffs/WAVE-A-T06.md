# WAVE-A-T06 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-A-T06`
- 基线 `main`：`77dd581`（`Merge pull request #73 from FlapPearLabs/docs/d-t01-post-merge-sync`）
- 分支：`work/a-t06-inactive-lane-admission`
- 测试提交（红）：`7929600`
- 实现提交（绿）：`bde733d`
- 审查 r1 发现修复：测试 `4b92b99`、实现 `e1f25d3`、本文档更新（`git log -1`）
- 审查 r1 审阅 HEAD：`064bd9e`（裁决 CHANGES_REQUESTED：P0×1、P1×1、P2×1、P3×1）
- 状态：r1 的 P0/P1/P2/P3 均已修复并有回归测试；本地 `pnpm verify` 通过；
  **未 push、未开 PR、未合并**

## 做了什么

- 新增 `src/runtime/admission.ts`
  - `admitInactiveLaneUserMessage(state, { target, sourceSessionId, message }, arbitrate?)`
    恰好创建一个 `PendingFocusIntent{ target, origin: "user_command", sourceMessage }`；
  - **同泳道目标被拒绝**：`admission.target === state.activeLane` 时在创建意图前
    返回 `already-active-lane`，仲裁不被调用，`pendingFocus` 不被污染
    （修复 r1 P0 的单槽永久死锁）；
  - `sourceMessage.message` 就是用户那条不可变 DSH `UserMessage` 的同一引用，
    不做文本复制、不落 `capturedText`；意图与 `sourceMessage` 包装均冻结；
  - **不可变性来自 DSH `createUserMessage` 的深冻结契约并被显式校验**：
    `message`、`content` 数组、每个 block 都必须已冻结，否则返回
    `mutable-message`；不冻结调用方对象、不复制消息，也不接受可变引用
    （修复 r1 P1 的虚假不可变断言）；
  - 通过 A-T02 的 `submitFocusIntent` 提交一次，并把仲裁返回的
    `disposition` / `state` 原样带回；仲裁函数可注入（默认即 A-T02 原语），
    供测试断言"仲裁确实收到意图"；
  - 空内容、纯空白文本、`content` 中混入 `null`/`undefined` 块、缺
    `sourceSessionId`、非 `user` 角色、非法 target、缺 message 都在创建意图之前
    拒绝，仲裁不会被调用；
  - 不持有 Agent、定时器、队列、邮箱、路由，也不复制消息文本。
- 新增 `src/runtime/admission.test.ts`（24 个用例，其中 `it.each` 共 7 个：
  5 个通用拒绝 + 2 个同泳道方向）。
- `src/runtime/index.ts` 导出 `admitInactiveLaneUserMessage`、
  `InactiveLaneUserCommandIntent` 与 `InactiveLaneAdmission` /
  `InactiveLaneAdmissionRejection` / `InactiveLaneAdmissionResult` /
  `FocusIntentArbitration`。

规格依据：§7.2（非活动泳道用户输入不需要该泳道 Agent 先运行，且 target 必须是
非活动泳道）、§16 Manual、§44（`USER messages on an inactive lane are admitted
by UI/Runtime, not by first waking that lane to reason.`）。

## 审查 r1 意见处理

| 级别 | 意见 | 处理 | 回归证据 |
|---|---|---|---|
| P0 | 未校验 `target !== state.activeLane`，同泳道意图占满单槽，§5 边界永不消费，后续跨泳道 `user_command` 永久 `retained-existing` | `rejectionReason(state, admission)` 在创建意图前返回 `already-active-lane` | `rejects a 'work' message while 'work' is the active lane`、`rejects a 'go' message while 'go' is the active lane`、`keeps the single focus slot free after a same-lane attempt` |
| P1 | 缺同泳道测试、缺 `go -> work` 对称方向；`Object.isFrozen(message)` 只因测试 helper 冻结而通过 | 补两种同泳道方向、`activeLane=go -> target=work` 对称准入；不可变断言改为使用真实 DSH `createUserMessage`，并新增可变消息/半冻结消息的拒绝测试 | 上述用例 + `accepts a real DSH createUserMessage as the immutable stored reference`、`rejects a mutable message it could not store immutably`、`rejects a message whose frozen shell still holds mutable content` |
| P2 | `hasMeaningfulContent` 对 `null`/`undefined` 块抛 `TypeError` | 逐块空安全判断，畸形容器块按空内容处理 | `rejects malformed null content blocks as empty instead of throwing` |
| P3 | 成功结果的 `sourceMessage` 仍为可选类型 | 新增 `InactiveLaneUserCommandIntent`，`sourceMessage` 必填并导出 | 类型检查覆盖；成功结果可直接访问 `result.intent.sourceMessage.message` |

P0 死锁用例的修复前后对照（`keeps the single focus slot free after a same-lane attempt`）：

- 修复前（`4b92b99`）：先准入 `target: 'work'`（activeLane `'work'`）得到
  `submitted`，单槽被占；随后 `target: 'go'` 的准入得到
  `'retained-existing'`，用例报
  `AssertionError: expected 'retained-existing' to be 'admitted'`。
- 修复后（`e1f25d3`）：同泳道准入返回
  `{ kind: 'rejected', reason: 'already-active-lane' }`，单槽保持空，
  后续跨泳道准入 `'admitted'`。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红（初版测试） | `pnpm test` | 1 suite failed：`Cannot find module './admission.js'`；其余 13 files / 115 tests 通过 | `7929600` |
| 红（初版类型） | `pnpm typecheck` | `TS2307` ×2（`./admission.js` 不存在），exit 2 | `7929600` |
| 绿（初版） | `pnpm typecheck` | exit 0 | `bde733d` |
| 绿（初版） | `pnpm test` | 14 files / **131 tests passed** | `bde733d` |
| 红（r1 回归测试） | `pnpm exec vitest run src/runtime/admission.test.ts` | exit 1，**6 failed / 18 passed**（含死锁用例的 `retained-existing`） | `4b92b99` |
| 红（r1 回归测试类型） | `pnpm typecheck` | exit 0（测试只依赖既有 API 类型，红在断言） | `4b92b99` |
| 绿（修复后定向） | `pnpm exec vitest run src/runtime/admission.test.ts` | **24/24 passed** | `e1f25d3` |
| 回归 | `pnpm verify` | **exit 0**：typecheck PASS、**14 files / 139 tests PASS**、clean + build PASS | `e1f25d3` |

## 变异验证（证明测试不是摆设）

初版实现时的三次临时变异（改完已还原，未提交）：重复调用 `arbitrate` → 2 failed；
`origin` 改成 `self_initiated` → 2 failed；绕过仲裁直接写 `state.pendingFocus`
→ 3 failed。r1 修复后新增用例的红测本身就是变异证据：去掉同泳道判断或深冻结
校验，上述 6 个用例立即失败。

## 覆盖的验收点

- 恰好一个 `PendingFocusIntent`，`target` / `origin` / `sourceMessage` 精确，
  key 集合恰为 `target, origin, sourceMessage`；
- 仲裁恰好收到 1 次调用，且收到的就是这同一个意图；其 `disposition` 与
  `state` 被原样返回；
- 已有 `user_command` 待处理时得到 `retained-existing`，旧意图胜出，不产生
  第二个待处理意图；
- 同泳道（`work->work`、`go->go`）被拒绝、仲裁不调用、单槽不受污染，且不会
  让后续跨泳道消息死锁；`activeLane=go -> target=work` 对称方向可准入；
- 消息按引用存储；真实 DSH `createUserMessage` 生成的深冻结消息被接纳，
  未冻结或仅外壳冻结的消息被拒绝；
- 模拟非活动 View 的 Agent 句柄（`run` / `steer` / `cancel` / `status`）
  计数保持 0，`status` 一次都没读；
- 模块命名面没有 queue / mailbox / router / buffer / history；
- 反复准入后 `RuntimeFocusState` 只有 `activeLane, llmRunning, pendingFocus`，
  `pendingFocus` 永远不是数组（无队列/邮箱）；
- 非法/空/畸形输入被拒绝且不创建意图、不调用仲裁；
- 纯图片内容仍被接纳（不是只看文本）；
- 不修改调用方 state 与原始消息，意图/结果冻结。

## 拒绝原因（公开类型 `InactiveLaneAdmissionRejection`）

`invalid-target`、`already-active-lane`、`missing-source-session`、
`not-user-message`、`empty-message`、`mutable-message`。检查顺序即上表顺序：
先判 target 合法性，再判是否同泳道，之后才是来源/角色/内容/冻结状态。

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
export type InactiveLaneUserCommandIntent
export type InactiveLaneAdmissionResult
export function admitInactiveLaneUserMessage
```

模块没有 import `@deepseek-ai/dsh-agent`，没有 Agent 参数，没有数组/集合型状态，
没有定时器/事件订阅；唯一状态写入是 A-T02 `submitFocusIntent` 的返回值。

## 改动的文件

- `src/runtime/admission.ts`（新增 `bde733d`；r1 修复 `e1f25d3`）
- `src/runtime/admission.test.ts`（新增 `7929600`；r1 回归测试 `4b92b99`）
- `src/runtime/index.ts`（新增导出 `bde733d`、`e1f25d3`）
- `handoffs/WAVE-A-T06.md`（本文件，`docs:` 提交）

## 假设与边界

- "空/无效输入"定义：content 为空数组，或所有块都是纯空白文本/畸形空块；
  图片等非文本 block 视为有效内容。非 `user` 角色、缺 session id、非
  `work|go` target、同泳道 target、未深冻结的消息一律拒绝。
- 本票只做准入意图：API 是 `RuntimeFocusState` 上的纯函数，返回新 state。
  接进 `RuntimeFocusOwner` / 真实 UI 不在本票范围（允许面也只有
  `src/runtime/` 与导出）；A-T03/A-T04/A-T07 负责边界、yield、resume。
- 仲裁参数可注入只用于测试证明"仲裁确实收到意图"；生产默认即 A-T02
  `submitFocusIntent`，没有第二条仲裁路径。
- 同泳道消息由正常会话路径处理，不经过本准入函数；本函数只服务非活动泳道。

## 未验证

- 真实 UI / View 与 DSH 真实 Inbox 投递未接线（本票明确不含）。
- 未在 Node `24.11.1` 下复跑：本机是 Node `26.10.0`，`pnpm` 只打印
  `Unsupported engine` 警告，typecheck / test / build 全部通过。
- r1 审查已由独立 agent 完成；r1 修复后的 r2 复审尚未进行（实现者不能给自己
  审查），本文件不声称已通过复审。
- 未更新 `CURRENT_IMPLEMENTATION_BASELINE.md` / ticket 状态（按仓库规则由
  合并后的 docs sync 处理）。

## 已知问题 / 需决定

- 为在当前工作树跑测试，`node_modules` 是指向主检出已装依赖的软链接
  （`.gitignore` 的 `node_modules/` 目录规则覆盖不到软链接，`git status` 中
  显示为未跟踪）。它没有被提交，也不影响分支/PR；保留它是为了让本工作树
  可以直接复跑 `pnpm verify`，不需要时删除即可，或用
  `pnpm install --frozen-lockfile` 重建。
- `mutable-message` 是新加的拒绝原因：调用方必须传 DSH `createUserMessage`
  产出的深冻结消息。若后续确有无冻结消息的合法来源，应在上游修复，而不是
  放宽本准入函数。
- `retained-existing` 时新意图会随结果返回但不入状态（旧 user_command 胜出），
  调用方若需要"提示用户上一条命令尚未处理"，需由 UI 层决定；本票不引入队列。
- `FocusIntentArbitration` 作为公开类型导出，仅服务于可测试注入；若后续
  不允许外部替换仲裁，可在 UI 接线时收窄为模块内部类型。
