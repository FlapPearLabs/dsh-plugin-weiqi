# WAVE-A-T06 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-A-T06`
- 基线 `main`：开票时 `77dd581`；r2 复审时 `origin/main` 为 `a9de2f1`；
  r3 修复时 `origin/main` 为 `d54a200`
- 分支：`work/a-t06-inactive-lane-admission`
- 测试提交（红，初版）：`7929600`
- 实现提交（绿，初版）：`bde733d`
- 审查 r1 修复：测试 `4b92b99`、实现 `e1f25d3`
- 审查 r2 修复：测试 `e63c9aa`、实现 `f8a204b`、文档 `6c03e3a`
- 审查 r3 修复：测试 `5820754`、实现 `47b5a24`、本文档更新（`docs:` 提交）
- 审查 r1 审阅 HEAD：`064bd9e`（裁决 CHANGES_REQUESTED：P0×1、P1×1、P2×1、P3×1）
- 审查 r2 审阅 HEAD：`9449b90`（裁决 CHANGES_REQUESTED：P0×1、P1×1、P2×2、P3×3）
- 审查 r3 审阅 HEAD：`6c03e3a`（裁决 APPROVE：P0×0、P1×0、P2×2、P3×4）
- 状态：r1–r3 的 P0/P1/P2 全部修复并有可失败的回归测试；r3 的 P3-1 已修，
  P3-2/P3-4 记为已知边界，P3-3 属历史提交格式（不改写历史）；
  本地 `pnpm verify` 通过；**未 push、未开 PR、未合并**

## 做了什么

- 新增 `src/runtime/admission.ts`
  - `admitInactiveLaneUserMessage(state, { target, sourceSessionId, message })`
    恰好创建一个 `PendingFocusIntent{ target, origin: "user_command", sourceMessage }`；
  - **同泳道目标被拒绝**：`admission.target === state.activeLane` 时在创建意图前
    返回 `already-active-lane`，仲裁不被调用，`pendingFocus` 不被污染
    （修复 r1 P0 的单槽永久死锁）；
  - `sourceMessage.message` 就是用户那条不可变 DSH `UserMessage` 的同一引用，
    不做文本复制、不落 `capturedText`；意图与 `sourceMessage` 包装均冻结；
  - **不可变性来自 DSH `createUserMessage` 的深冻结契约并被显式校验**：
    `message`、`content` 数组、每个已存在的 block、以及 `source` 及其嵌套
    provenance 对象都必须已冻结，否则返回 `mutable-message`；不冻结调用方
    对象、不复制消息，也不接受可变引用（修复 r1 P1、r2 P1）；
  - 通过 A-T02 的 `submitFocusIntent` 提交一次，并把仲裁返回的
    `disposition` / `state` 原样带回；**公开签名只有 `(state, admission)` 两个
    参数，不提供仲裁覆盖点**，生产与测试走同一条仲裁路径（r3 P2-1）；
  - 结果按 `kind` 区分：`submitted`（`admitted` / `replaced`）、
    `retained`（`retained-existing`，此时新意图**未被接纳**，只存在于结果的
    `intent` 上）、`rejected`；调用方必须显式处理 `retained`，不能只应用
    `result.state` 而丢掉用户消息（r3 P2-2，Spec §5/§44）；
  - 空内容、纯空白文本、`content` 中混入 `null`/`undefined`/无字符串 `type`
    的块、缺 `sourceSessionId`、非 `user` 角色、非 `user` 来源（tool/plugin/
    model）、非法 target、缺 message 都在创建意图之前拒绝，仲裁不会被调用；
  - 不持有 Agent、定时器、队列、邮箱、路由，也不复制消息文本。
- 新增 `src/runtime/admission.test.ts`（34 个用例，其中 10 个来自 `it.each`
  表：5 个通用拒绝、2 个同泳道方向、3 种非 user 来源）。
- `src/runtime/index.ts` 导出 `admitInactiveLaneUserMessage`、
  `InactiveLaneUserCommandIntent` 与 `InactiveLaneAdmission` /
  `InactiveLaneAdmissionRejection` / `InactiveLaneAdmissionResult`
  （r3 起不再导出 `FocusIntentArbitration`）。

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

## 审查 r2 意见处理

| 级别 | 意见 | 处理 | 回归证据 |
|---|---|---|---|
| P0 | 「非活动 Agent 不会先运行」用例里的 Agent/reads 对象从未传入被测函数，`run`/`steer`/`cancel` 零调用与 symbol-key 断言恒真，handoff 却把它当作覆盖证据 | 删除装饰性 helper 与那五条恒真断言；用例改名为「无 Agent 句柄也能准入」，用 `llmRunning === false`、`activeLane` 不变与源码审计承担证据 | `admits without an Agent handle and leaves the lane and run state untouched`、`has no Agent dependency: no dsh-agent import and no Agent parameter`；恒真演示见下 |
| P1 | `message.source` 未校验冻结，准入后仍可把 `source.kind` 改成 `tool` | `isDeeplyFrozenUserMessage` 递归校验 `source` 及其嵌套 provenance 对象 | `rejects a message whose frozen shell, content and block still hold a mutable source`、`rejects a frozen source that still holds mutable nested provenance` |
| P2-1 | `source.kind: 'tool'`（含 `createToolResultMessage`）被当作 `user_command` 准入 | `isUserMessage` 要求 `source.kind === 'user'`；tool/plugin/model 一律 `not-user-message` | `rejects a 'tool'/'plugin'/'model' source as a non-user message`、`rejects a real DSH tool-result message instead of admitting it as user intent` |
| P2-2 | 无 `type` 的畸形块 `{}` 被当作有效内容 | `hasMeaningfulContent` 要求块是非空对象且 `type` 为字符串；未知/无 type 块按空内容 | `rejects a malformed block without a string type as empty` |
| P3 | 可注入仲裁与「只有一条仲裁路径」表述不符；意图类型重复；handoff 基线过期、审计命令大小写敏感 | `arbitrate` 在 JSDoc 中标注为测试专用注入点，生产调用方必须省略（r3 P2-1 已改为彻底删除该参数）；`InactiveLaneUserCommandIntent` 改为 `PendingFocusIntent` 的收窄交叉类型；更新基线并给审计命令加 `-i` | 类型检查 + 本文档 |

P0 恒真演示（临时改动已还原，未提交）：把 `admission.ts` 的
`rejectionReason` 调用短路为 `undefined`（等于删掉全部准入校验），再用
`git show 9449b90:src/runtime/admission.test.ts` 跑旧用例
`-t 'never runs or consults'`，结果 **1 passed**。也就是说该用例在「零校验」
实现下依然通过——它的 Agent 断言与被测函数无关，不能作为验收证据。

## 审查 r3 意见处理

r3 裁决 APPROVE（P0×0、P1×0），以下 P2/P3 在 UI 接线前处理。

| 级别 | 意见 | 处理 | 回归证据 |
|---|---|---|---|
| P2-1 | 公开签名接受第三个 `arbitrate` 参数（默认 `submitFocusIntent`），调用方可绕过 A-T02 却仍拿到 `kind: 'submitted'`，与「只有一条仲裁路径」矛盾 | 删除该参数与 `FocusIntentArbitration` 类型（`admission.ts` / `runtime/index.ts` 均不再导出）；测试改用 `vi.mock('./focus.js')` 监听真实 `submitFocusIntent`，mock 委托原实现，仲裁语义不变 | 编译期断言 `@ts-expect-error - the public API exposes no arbitration override`：旧签名下 `pnpm typecheck` 报 TS2578，新签名下通过 |
| P2-2 | `retained-existing` 被报成 `kind: 'submitted'`，新意图只在结果上，只应用 `result.state` 的调用方会静默丢掉用户消息 | 新增独立 `kind: 'retained'`（带 `intent` / `state` / `disposition: 'retained-existing'`）；`submitted` 的 `disposition` 收窄为 `admitted \| replaced`；JSDoc 明确三种 kind 的语义与调用方责任 | `keeps the older pending user command and reports a distinct retained outcome`、`never reports a non-admitted intent as submitted`、`exposes no queue…` 的循环断言；旧源码下 **3 failed / 31 passed** |
| P3-1 | Agent 依赖扫描只匹配 `from` 导入，裸导入 `import '@deepseek-ai/dsh-agent'` 漏检（r3 实测 32/32 全过） | 扫描正则扩为 `(?:\bfrom\s+\|\bimport\s*\(\s*\|\bimport\s+)['"]…['"]`，并加一条扫描器自身的 fixture 用例（裸 / type-only / 动态 / re-export） | `scans bare, type-only and dynamic imports, not only from-clauses`；变异证明见下 |
| P3-2 | 任何带字符串 `type` 的非 `text` 块都算有效内容（`{ type: 'garbage' }` 被准入） | 记为已知边界：验 Spec 未列举合法块类型，收紧需先定白名单，不在本票猜测 | 见「已知问题」 |
| P3-3 | 早期提交 `7929600` / `bde733d` / `064bd9e` 的 subject 含字面量 `\n`，整段说明被塞进标题 | 历史不改写（仓库禁止 amend/rebase）；从 r3 起提交用 `git commit -F <消息文件>`，subject 与正文分离 | `git log -1 --format=%s` |
| P3-4 | `sourceSessionId` 未与 target lane 交叉校验 | 记为已知边界：二者对应关系 Spec 未强制，A-T05 会原样写入 relay provenance，应由接线调用方保证 | 见「已知问题」 |

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
| 红（r2 回归测试） | `pnpm exec vitest run src/runtime/admission.test.ts` | exit 1：**7 failed / 25 passed**（source 可变×2、tool/plugin/model 来源×3、真实 tool-result、无 type 块） | `e63c9aa` |
| 绿（r2 修复后定向） | `pnpm exec vitest run src/runtime/admission.test.ts` | **32/32 passed** | `f8a204b` |
| 回归（r2 修复后） | `pnpm verify` | **exit 0**：typecheck PASS、**14 files / 147 tests PASS**、clean + build PASS | `f8a204b` |
| 红（r3 回归测试） | `pnpm exec vitest run src/runtime/admission.test.ts` | exit 1：**3 failed / 31 passed**（retained 两处 + 单槽循环；此时源码仍为 r2 版） | `5820754` |
| 红（r3 回归测试类型） | `pnpm run typecheck` | exit 2：`TS2578`（未使用的 `@ts-expect-error`）、`TS2367`（`'retained'` 无可比类型）、`TS2339`（`never`） | `5820754` |
| 绿（r3 修复后定向） | `pnpm exec vitest run src/runtime/admission.test.ts` | **34/34 passed** | `47b5a24` |
| 回归（r3 修复后） | `pnpm verify` | **exit 0**：typecheck PASS、**14 files / 149 tests PASS**、clean + build PASS | `47b5a24` |

## 变异验证（证明测试不是摆设）

初版实现时的三次临时变异（改完已还原，未提交）：重复调用 `arbitrate` → 2 failed；
`origin` 改成 `self_initiated` → 2 failed；绕过仲裁直接写 `state.pendingFocus`
→ 3 failed。r1 修复后新增用例的红测本身就是变异证据：去掉同泳道判断或深冻结
校验，上述 6 个用例立即失败。r2 修复的 7 个红测同样就是变异证据。r3 P3-1 重做了依赖扫描的变异（改完即还原，未提交）：

- 裸导入 `import '@deepseek-ai/dsh-agent'` 放到 `admission.ts` 首行 →
  `has no Agent dependency` 用例 **1 failed / 33 skipped**，报
  `expected [ '@deepseek-ai/dsh-agent' ] to deeply equal []`；修复前同一变异是
  **0 failed**（这正是 r3 P3-1 指出的盲点）。
- 顶层动态导入 `const late = () => import('@deepseek-ai/dsh-agent')` → 同样 **1 failed**。
- 带 `from` 的类型导入在 r2 已证明可被杀；参数名含 `agent` 也被
  `not.toMatch(/\bagent\b/)` 拦住。

另外，把 `rejectionReason` 短路为 `undefined` 后，旧版
「never runs or consults the inactive Agent」用例仍 **1 passed**（见 r2 P0 演示）。

## 覆盖的验收点

- 恰好一个 `PendingFocusIntent`，`target` / `origin` / `sourceMessage` 精确，
  key 集合恰为 `target, origin, sourceMessage`；
- 仲裁恰好收到 1 次调用，且收到的就是这同一个意图；其 `disposition` 与
  `state` 被原样返回；
- 已有 `user_command` 待处理时得到独立的 `kind: 'retained'`（`disposition:
  'retained-existing'`），旧意图胜出、`state` 原样返回，新意图只在该结果的
  `intent` 上——不会被报成 `submitted`，调用方也无法只应用 `state` 就把用户
  消息静默丢掉；
- 同泳道（`work->work`、`go->go`）被拒绝、仲裁不调用、单槽不受污染，且不会
  让后续跨泳道消息死锁；`activeLane=go -> target=work` 对称方向可准入；
- 消息按引用存储；真实 DSH `createUserMessage` 生成的深冻结消息（含 frozen
  `source`）被接纳，未冻结、仅外壳冻结、或 `source`/嵌套 provenance 可变的
  消息被拒绝；tool/plugin/model 来源的消息被拒绝；
- 准入不需要 Agent 句柄：成功准入后 `activeLane` 不变、`llmRunning` 仍为
  `false`；源码级审计断言 `admission.ts` 不 import `@deepseek-ai/dsh-agent`
  （扫描覆盖 `from` / 裸导入 / 动态导入），且导出函数签名与函数体不含 Agent
  参数；公开签名只有两个参数，仲裁不可注入（编译期 `@ts-expect-error` 用例）。
  r2 P0 指出旧用例里的模拟 Agent 对象从未传入被测函数，那五条零调用断言对
  任何实现恒真，已删除；「非活动 Agent 不会先运行」的证据由上述状态不变式 +
  源码审计承担；
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
$ grep -niE "agent|steer|\brun\b|status" src/runtime/admission.ts
7: * it to the A-T02 single-slot arbitration. The inactive Agent is never asked
8: * to read the message or request focus first. This module holds no Agent,
   ← 仅模块注释里的否定声明，不是代码

$ grep -n "@deepseek-ai/dsh-agent" src/runtime/admission.ts
no matches（grep exit 1）

$ grep -niE "queue|mailbox|router|buffer|history|capturedText" src/runtime/admission.ts
9: * queue, mailbox, router, timer, or copied text.   ← 仅模块注释中的否定声明

$ grep -n "^export" src/runtime/admission.ts
export type InactiveLaneAdmission
export type InactiveLaneAdmissionRejection
export type InactiveLaneUserCommandIntent
export type InactiveLaneAdmissionResult
export function admitInactiveLaneUserMessage
```

模块没有 import `@deepseek-ai/dsh-agent`（`admission.test.ts` 的
`has no Agent dependency` 用例在源码层面断言这一点，并分别用裸导入、动态导入、
`from` 类型导入三种变异验证过会失败），没有 Agent 参数，没有数组/集合型状态，
没有定时器/事件订阅；唯一状态写入是 A-T02 `submitFocusIntent` 的返回值。
上面的 `agent`/`status` 命中都是第 7–8 行注释里的否定声明，不是代码。

## 改动的文件

- `src/runtime/admission.ts`（新增 `bde733d`；r1 修复 `e1f25d3`；r2 修复
  `f8a204b`；r3 修复 `47b5a24`）
- `src/runtime/admission.test.ts`（新增 `7929600`；r1 回归测试 `4b92b99`；
  r2 回归测试 `e63c9aa`；r3 回归测试 `5820754`）
- `src/runtime/index.ts`（新增导出 `bde733d`、`e1f25d3`；r3 移除
  `FocusIntentArbitration` 导出 `47b5a24`）
- `handoffs/WAVE-A-T06.md`（本文件，`docs:` 提交）

## 假设与边界

- "空/无效输入"定义：content 为空数组，或所有块都是纯空白文本/畸形空块；
  图片等非文本 block 视为有效内容。非 `user` 角色、缺 session id、非
  `work|go` target、同泳道 target、未深冻结的消息一律拒绝。
- 本票只做准入意图：API 是 `RuntimeFocusState` 上的纯函数，返回新 state。
  接进 `RuntimeFocusOwner` / 真实 UI 不在本票范围（允许面也只有
  `src/runtime/` 与导出）；A-T03/A-T04/A-T07 负责边界、yield、resume。
- 仲裁不可注入：公开签名只有 `(state, admission)`，内部固定调用 A-T02
  `submitFocusIntent`；测试通过 `vi.mock('./focus.js')` 观察这一次调用，mock
  委托真实实现，不改变仲裁语义。
- 同泳道消息由正常会话路径处理，不经过本准入函数；本函数只服务非活动泳道。

## 未验证

- 真实 UI / View 与 DSH 真实 Inbox 投递未接线（本票明确不含）。
- 未在 Node `24.11.1` 下复跑：本机是 Node `26.10.0`，`pnpm` 只打印
  `Unsupported engine` 警告，typecheck / test / build 全部通过。
- r1–r3 审查均由独立 agent 完成（r3 审 `6c03e3a`，裁决 APPROVE）；r3 修复
  （`5820754` / `47b5a24`）之后尚未复审（实现者不能给自己审查），本文件不
  声称已通过复审。
- r2 复审时分支落后 `origin/main` 33 个提交（`a9de2f1`）；r2 修复后在本机用
  `git merge-tree --write-tree origin/main HEAD`（`origin/main` = `d2e85a3`）
  得到干净合并树 `05419a7`，`git archive` 到 `/tmp` 后 `pnpm verify` **exit 0**
  （**18 files / 176 tests passed**，Node 26.10.0）。合并结果最终以 PR CI 为准；
  本次未 push，因此没有真实 CI 记录。
- r3 修复后同样落后 `origin/main`（`d54a200`）：`git merge-tree --write-tree
  origin/main HEAD` 得到干净合并树 `2ab75c1`（exit 0），但**未在合并树上重跑
  测试**；本文件所有的 `pnpm verify` 数字均来自当前分支工作树。
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
- `retained` 结果里的新意图只存在于返回值、不入状态（旧 `user_command` 胜出）。
  调用方必须处理 `kind: 'retained'` 的 `intent`（提示用户上一条命令尚未处理，
  或在旧命令被消费后重新准入）；本票不引入队列，也不替 UI 决定提示方式。
- 已知边界（r3 P3-2）：`hasMeaningfulContent` 把任何带字符串 `type` 的非 `text`
  块都视为有效内容，因此 `content: [{ type: 'garbage' }]` 也会被准入。验 Spec
  未列举合法块类型，收紧需先定白名单，本票不猜，留待 UI 接线时按真实块类型处理。
- 已知边界（r3 P3-4）：`sourceSessionId` 未与 target lane 交叉校验（例如
  `target: 'go'` + `sourceSessionId: 'companion-work-work'` 也会准入），A-T05
  `createCompanionHandoff` 会把它原样写进 relay provenance。Spec 未强制二者
  的对应关系，本票不替调用方推断，接线时由调用方传入来源会话的真实 id。
- r3 P3-3：早期提交 `7929600`、`bde733d`、`064bd9e` 的 subject 里是字面量 `\n`
  （整段说明被塞进标题）。历史不改写（仓库禁止 amend/rebase），从 r3 起改用
  `git commit -F <消息文件>`，本分支新增提交的 subject 与正文分离。
