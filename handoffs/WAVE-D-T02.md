# WAVE-D-T02 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-D-T02`
- 基线 `origin/main`：`77dd581a4be102fd9fa170135ad5a633237ecca6`
- 分支：`work/d-t02-cross-lane-awareness`
- 红测试提交：`5c52539`
- 实现提交：`a37f268`
- 测试有效性修订（r1 P2-1）：`e459e61`
- 状态：实现完成，本地 `pnpm verify` 通过；**未推送、未开 PR、未合并**

## 做了什么

新增 `src/bridge/awareness.ts`（只在 D-T01 的 latest-value runtime 上加读取面，未改契约）：

- `CrossLaneAwareness(runtime)`：
  - `forWorkLane()` → `{ latestGameNotice }`，Work 泳道唯一能看到的 Go 侧信息；
  - `forGoLane()` → `{ latestWorkSnapshot }`，Go 泳道唯一能看到的 Work 侧信息。
- 投影按契约字段白名单逐字段重建：`GameNotice` 七个字段（`lastMove`/`affectedGroups` 缺省时不补造）、`WorkSnapshot` 四个字段；`affectedGroups` 里的每个 `AffectedGroupDelta` 也重建。
- 重建出的对象与数组全部 `Object.freeze`；每个泳道拿到的是自己的一份副本，不是权威对象，也不是权威数组的同一引用。
- 因此非枚举字段、符号字段、原型链上的内容（`Object.keys` 校验看不见的那部分）不会随投影穿越到另一个泳道。
- 每个槽按 payload 引用缓存投影：同一份最新值重复读取返回同一个冻结对象，不重读源 getter，不做二次投影；新值发布后缓存替换，旧视图不再被引用成历史。
- 无 `enqueue` / `messages` / `history` / `subscribe` / `inject` / `handoff` / `forwardSourceMessage` 等面；投影对象也无法被重新发布为另一投影的来源（schema 拒绝未知字段）。
- `src/bridge/index.ts` 增加 `CrossLaneAwareness`、`GoLaneAwareness`、`WorkLaneAwareness` 导出。
- 新增 `src/bridge/awareness.test.ts`（9 个用例）。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红 | `pnpm test` | `FAIL src/bridge/awareness.test.ts`，`Error: Cannot find module './awareness.js'`；其余 13 files / **115** tests 仍通过 | `5c52539` |
| 绿 | `pnpm test` | 14 files / **124 tests passed**（新增 9） | `a37f268` |
| 回归 | `pnpm verify` | `EXIT=0`：typecheck PASS、124/124 PASS、clean+build PASS | `a37f268` |
| P2 修订 | `pnpm verify` | `EXIT=0`：typecheck PASS、124/124 PASS、clean+build PASS | `e459e61` |

### 变异检查（证明隔离测试会红，不是空断言）

| 注入的缺陷 | 结果 |
|---|---|
| 投影直接返回权威 payload 引用（隐藏字段随之外泄） | 2 个用例失败：`never inherits hidden payload carrying another lane history`、`hands each lane its own frozen copy, not the authoritative array` |
| 契约数组按引用拷贝（`runningJobs` / `blockers` 不重建） | 1 个用例失败：`hands each lane its own frozen copy, not the authoritative array` |
| 去掉 `schema.ts` 的未知字段校验（`assertKnownKeys` 两处调用） | 4 个用例失败（含新增的 `moves` / `boardStates` / `transcript` 拒绝断言） |
| 还原后 | `src/bridge/awareness.test.ts` 9/9 通过 |

## 覆盖的验收点（Spec §12 / §35 / §40 Context Isolation）

- **长局后 Work 侧无 Go 原始历史**：400 手（每手 3 个受影响棋块）后，Work 侧投影只含最新 `GameNotice`，own keys 精确等于契约的 7 个字段，最长数组为 3（只有最新一手的 `affectedGroups`）。同一用例构造 400 条 `raw-go-turn-*` / `raw-go-thought-*` 与 400 条 `raw-board-*`，作为 `moves` / `boardStates` 未知字段送入 `updateGame`，断言抛 `BridgeSchemaError`、错误信息指向多余字段、运行时仍停在第 400 手：原始历史不能经 Bridge 进入运行时，也就不会进入任何投影。
- **对称：Go 侧无 Work 原始 transcript**：同样 400 手后，400 组 `raw-work-tool-call-*` / `raw-work-stdout-*` 作为 `transcript` 未知字段送入 `updateWork`，断言抛 `BridgeSchemaError` 且已发布的 `WorkSnapshot` 不变；Go 侧投影 own keys 等于 `WorkSnapshot` 的 4 个字段，最长数组为 2。
- **无原始历史数组**：递归扫 `Reflect.ownKeys`（含非枚举与 symbol），`history` / `moves` / `moveHistory` / `transcript` / `board` / `boards` / `boardStates` / `events` / `messages` / `toolCalls` / `toolHistory` / `sessionHistory` / `handoff` 一律不出现；最长数组分别 ≤ 3（`affectedGroups`，且只有最新一手）与 ≤ 2（`runningJobs`）。
- **不随局长增长**：400 手后的 Work 投影字节数 == 只发一条 `notice(400)` 的投影字节数，且 < 500 字节。
- **重复读取不增长、不重投影**：同一来源 200 次读取返回同一冻结对象（`toBe`），getter 读数在首次投影后不再增加。
- **投影不可再投影**：把投影拼成 `{ ...GameNotice, latestWorkSnapshot }` 重新 `updateGame` → `BridgeSchemaError`（`latestWorkSnapshot`），原通知不变。
- **交接消息不转发**：`handoff` 字段被 `assertGameNotice` 拒绝，运行时保持空/旧值；awareness 对象没有 handoff / 转发 / 队列成员。
- **隐藏载荷不外泄**：在权威 `WorkSnapshot` 上定义非枚举 `history` 与 symbol `transcript`，在 `GameNotice` 上定义非枚举 361 格 `board` 与 `moves`；`Object.keys` 校验放行，但两个泳道的投影 own keys 精确等于契约字段、无 symbol、原型为 `Object.prototype`。
- **只读**：副本冻结后对泳道视图 `push` / 赋值抛 `TypeError`，权威对象与另一泳道不受影响。

隔离证据以字段集为准：own keys 精确相等（含递归、非枚举与 symbol）、最长数组长度、隐藏载荷用例，以及「原始历史作为未知字段被 schema 拒绝且运行时不变」。早先草稿里「把 raw-* 字符串 push 进局部数组、断言投影序列化后不出现」的扫描是空断言（字符串从未进入 runtime，任何实现都会通过），已在 `e459e61` 删除并改写成上面这些可失败的断言；不要把那次字符串扫描当作长局隔离证据。

## 改了哪些文件

- 新增 `src/bridge/awareness.ts`
- 新增 `src/bridge/awareness.test.ts`
- 修改 `src/bridge/index.ts`（仅加导出）

未触碰 `src/contracts/`、`src/index.ts`、`package.json`、`pnpm-lock.yaml`、Spec、Baseline、tickets。

## 假设

- 「awareness」= 各泳道读取对方最新投影的唯一入口；投递给模型（`ctx.systemPrompt.context`）是 D-T03 的事，本票不渲染、不注入 prompt。
- 交接消息（§8.2 operational intent）是独立类别，本票不做任何转发或存储：`CrossLaneAwareness` 不接收、不持有、不返回交接文本，只断言它不可能经 Bridge 字段混入（schema 拒绝）。
- 权威 payload 在运行时不复制（保持 D-T01 的 `toBe` 语义），隔离在读取面上完成：每个泳道拿到的永远是重建+冻结的副本。
- 缓存以 payload 引用为键：若有人原地改写权威对象（不支持路径），泳道视图仍是上次投影的快照。

## 未验证

- `ctx.systemPrompt.context` 的真实注册、按需物化与 prompt 稳定性：**D-T03 / D-S01**，本票未做。
- 真实 Harness/session/tool/job 事实与 Go 侧 `GameNotice` 的生产者：本票只提供读取面，不产出事实。
- 没有真实 DSH 会话，因此「长局后模型历史里确实没有对方 transcript」只在投影层（本可注入的输入）上验证，未在真实 prompt 组装链路上端到端验证。
- 未在 Node `24.11.1` 下复跑；本机 Node `26.10.0`，仅出现 `Unsupported engine` 警告。
- 工作树原本无 `node_modules`，用 `pnpm install --frozen-lockfile` 从本地 store 安装锁定依赖；未改 `package.json` / `pnpm-lock.yaml`。
- 未推送、未开 PR、未合并；未更新 `CURRENT_IMPLEMENTATION_BASELINE.md` / ticket 状态（按仓库规则由合并后的 docs sync 处理）。

## 已知问题 / 需决定

- 每次新投影产生一个新对象；不比较内容是否变化（D-T03 若需要「渲染结果未变不重复物化」，应在投递层做，别在本读取面加内容相等的历史判断）。
- `src/index.ts` 仍不在允许改动面，`CrossLaneAwareness` 目前只从 `src/bridge/index.ts` 可见；包根暴露留给 D-T03 接线时决定。
- 没有独立的「awareness 只读」类型别名（返回冻结对象，TS 类型仍是 `GameNotice` / `WorkSnapshot`）；若后续希望编译期就禁止写入，需要新类型，属于契约变化，需另开票。
