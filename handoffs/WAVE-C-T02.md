# WAVE-C-T02 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-C-T02`
- 分支：`work/c-t02-go-tools`
- 基线 SHA：`57b93f8eecf33fd64e4c04d793c1fa147054ef07`（`origin/main`，含 B-T02 / C-T07 / C-T01 / C-T05 合并）
- 红测试提交：`6334b78`
- 测试修正：`9026e38`（修正两处红测试期望）、`6b31eb5`（对齐错误模块与结果联合类型，并把 C-T01 的 barrel 断言收回策略模块）
- 实现提交：`53e3f12`
- 状态：本地 `pnpm verify` 通过（26 files / **305 tests**）；**未推送、未开 PR、未合并**

## 做了什么

WAVE-C-T02 注册并实现 Spec §20 Phase A 的 8 个 `go.*` 工具，全部落在 `src/tools/go/`：

| 文件 | 职责 |
|---|---|
| `go-tools.ts` | 8 个工具定义（name/description/JSON schema/run）+ `createGoToolRuntime` |
| `go-tool-registry.ts` | 过 C-T01 策略 → `nativeGoCapability` 铸造 → `GoCapabilityGuard.register`；枚举恰好 8 条 |
| `board.ts` | 本地棋盘观测：`observeLocalMove`（不落子）、`inspectRegion` |
| `notice.ts` | 权威状态 → `GameNotice`（§11） |
| `arguments.ts` | 严格参数读取，未知键直接拒绝 |
| `errors.ts` | `GoToolArgumentError` / `GoToolSurfaceError` |
| `types.ts` / `index.ts` | 类型与 barrel |

`src/tools/index.ts` 增加 `export * from './go/index.js'`。没有改 `src/index.ts`：工具 barrel 尚未挂到插件入口。

## 每工具形态（§20）

| 工具 | 参数 | 成功返回 | 端口调用 | 预算（C-T07） |
|---|---|---|---|---|
| `go.state` | `gameId` | `{ ok, state }` | `getState` | 不计（§22.3 只计 inspect/try_move） |
| `go.inspect_group` | `gameId`, `point` | `{ ok, group: GroupInfo \| null }` | `inspectGroup` | `beginInspect()` |
| `go.inspect_region` | `gameId`, `point`, `radius?`（默认 2） | `{ ok, region: { center, radius, stones, emptyPoints, liberties } }` | `getState` | `beginInspect()` |
| `go.try_move` | `gameId`, `point` | `{ ok, point, basis: 'local-board', legal, captures, localLiberties, reason? }` | 只 `getState`（**从不** `play`） | `beginTryMove()` |
| `go.play` | `gameId`, `point` | `{ ok: true, state, captured, notice }` \| `{ ok: false, reason, state }` | `play` | 成功才 `recordCommittedAction('play')` |
| `go.pass` | `gameId` | `{ ok: true, state, notice }` \| `{ ok: false, reason, state }` | `pass` | 成功才 `'pass'` |
| `go.resign` | `gameId` | `{ ok: true, state, outcome, notice }` \| `{ ok: false, reason: 'game-over', state }` | `resign` | 成功才 `'resign'` |
| `go.request_deep_think` | 无 | `{ ok: true, requested: true, applied: false }` | 无 | `beginDeepThink()` |

预算顺序：先校验参数 → 再记账 → 再执行。参数非法不扣预算也不碰端口；预算不足抛
`GoTurnBudgetExhaustedError` 且端口未被调用；回合已 commit 后再调分析工具抛
`GoTurnAnalysisEndedError`。两个错误都原样向上传播，工具层不吞。

`go.try_move` 的 schema 只有 `gameId` / `point`；结果键在合法时恰为
`basis, captures, legal, localLiberties, ok, point`，非法时多一个 `reason`。测试递归扫描
全部 8 个工具的 schema 属性名与 try_move 结果键，禁止
best/win/score/eval/recommend/danger/critical/urgency/strategy 等评估面。

## 注册与枚举（真实输出）

构建产物（`pnpm verify` 末尾 `tsc -p tsconfig.build.json`）上跑：

```text
registeredPaths: ["go.state","go.inspect_group","go.inspect_region","go.try_move","go.play","go.pass","go.resign","go.request_deep_think"]
count: 8
```

注册路径：每个定义先过 `admitGoLaneToolPath`（C-T01 策略：前缀 → 禁止面 → 精确白名单），
再由 `nativeGoCapability` 铸造（唯一写 native kind 的地方），再 `guard.register`。注册完把
实际集合与冻结的 `GO_PRESET.toolPaths` 比对：缺一条、多一条、重复一条都抛
`GoToolSurfaceError`，不会“注册一部分也算过”。

测试覆盖的拒绝面：`go.best_move` / `go.score_lead` / `go.exec`（`forbidden-surface`）、
`companion.affect`（`tool-path`）、`go.arbitrary`（`not-in-surface`）；被拒后
`guard.execute('go.best_move')` 仍抛 `ForbiddenGoCapabilityError`。缺一条（7 条）与重复
（8 条里有 `go.state` 两次）各自断言 `GoToolSurfaceError` 的 `reason` / `missing` / `extra` / `toolPath`。

## resign 路由断言

真实 `TenukiAdapter` 上跑（9x9，DeepSeek 执黑，先下两子再 resign）：

- 端口调用序列恰为 `['resign']`（没有 `play` / `pass` / `score` / `settle`）；
- `state.status === 'over'`，`outcome = { winner: 'user', loser: 'deepseek', reason: 'resignation' }`；
- `stones`、`moveNumber`、`captures` 与 resign 前完全一致（无棋盘变更）；
- `GameNotice` 发布 1 条且 `status: 'over'`，`moveNumber` 与 resign 前一致；
- `enforcement.snapshot()` 为 `committedAction: 'resign'`、`gameTerminal: true`；
- 之后 `go.inspect_group` / `go.try_move` / `go.request_deep_think` 全部抛 `GoTurnAnalysisEndedError`；
- 再 resign 返回 `{ ok: false, reason: 'game-over' }`，不再发通知。

## 红 / 绿证据（真实输出）

红（`6334b78`，模块尚不存在）：

```text
pnpm vitest run src/tools/go
 2 files failed | 1 passed (3)
 Tests 9 passed (9)
 Error: Cannot find module './go-tools.js' ...
```

绿（最终 `53e3f12`）：

```text
pnpm run typecheck  -> exit 0
pnpm vitest run src/tools -> 3 files / 42 tests passed
pnpm verify         -> exit 0
   26 files / 305 tests passed（本票前为 24 files / 272 tests，新增 2 文件 / 33 用例）
```

变异检查（每次事后还原，`restored=true` 字节一致）：

| 变异 | 结果 |
|---|---|
| `go.try_move` 改成走 `port.play` 取 state | 1 failed（“without touching the board”） |
| `go.play` 成功路径去掉 `recordCommittedAction('play')` | 1 failed（“ends the analysis loop”） |
| 注册时只取前 7 个定义 | 5 failed / 5 passed（枚举 + 调用面） |
| `go.try_move` 结果多一个 `best: true` | 1 failed（结果键断言） |

## 关键假设（票面没写死的地方）

1. `go.try_move.legal` 是**本地棋盘观测**，结果带 `basis: 'local-board'`。端口不暴露棋谱历史，
   ko / positional superko 无法本地判定，因此本地合法仍以 `GoRulesPort.play` 的权威结果为准。
   这不是第二套规则权威：它不落子、不返回胜负/分值。
2. `GameNotice.captures` 取双方被提子总数（§11 只给了一个 `number`，未写语义）。
3. `GameNotice` 的 sequence 用本 runtime 内的发布序号：resign 不推进 `moveNumber`，用序号才能
   覆盖前一条 play 通知（`LatestValueSlot` 会丢弃 `<=` 的值）。
4. `radius` 默认 2，非负整数，区域按棋盘裁剪。
5. 工具固定以 `deepseek` 身份行动（`GO_LANE_PLAYER`）；用户经棋盘 UI 直接走 port。
6. `go.play/pass/resign` 先执行端口、成功后才记账/结束回合：被拒绝的落子不改状态、不结束回合。

## 刻意没有做的事

- 没有 `companion.*`（Phase B，C-T03）、没有 deep-think 加速（C-T08）、没有
  `GameLifecycleController`、没有第二个规则权威；`go.resign` 只调 `GoRulesPort.resign`。
- 没有新增依赖、没有改 `src/contracts/`、`src/runtime/`、`src/budget/`、`src/rules/`、
  `src/preset/`。`pnpm install --frozen-lockfile --offline` 复用本机 store 的 62 个包，
  lockfile 未变。
- 没有把工具挂到 `src/index.ts` / AgentLoop：真实注册与 dispatch 属 C-T05/F-T03。
- 没有改 `GO_LANE_REGISTRY`（仍是 `registrationState: 'structure-only'`、`registeredPaths: []`）。
  它继续是 Phase A 策略声明；实际注册集合由 `GoToolRegistry.registeredPaths` 给出。

## 唯一一处超出“只加新文件”的改动

`src/tools/go-lane-registry.test.ts` 的用例「exposes no registration entry point yet」原本扫描
**共享 barrel**，C-T02 往同一 barrel 加注册入口后必然失败。已把它收回策略模块本身
（`registryModule` 内没有任何 `register*` 导出），C-T01 真正要保的保证不变；冻结声明
`registeredPaths === []` / `registrationState === 'structure-only'` 的断言原样保留。

## 环境与过程备注

- Node 版本告警：`engines` 要求 `>=24.11.1 <25`，本机 `v26.10.0`；`pnpm` 只告警不失败，
  `verify` 全绿，与本改动无关。
- 首条 `test:` 提交的提交信息曾被 shell 引号写成字面 `\n`；该提交尚未推送，用
  `git reset --soft HEAD~1` 后以 `git commit -F` 重做（未用 `amend`/`rebase`，未触碰任何已推送历史）。

## 未验证 / 留给后续

- **未接 AgentLoop**：工具只在 `src/tools/` 内注册与调用，插件入口没有挂载；真实工具 dispatch、
  每回合 enforcement 实例的创建时机，都要 C-T05/F-T03 决定。
- **UI 未消费**：`GameNotice` 只发布到注入的 sink（测试用内存收集器），没有接 `BridgeRuntime`。
- **序号空间未统一**：本 runtime 的 notice sequence 是内部计数；与 `BridgeRuntime` 其它发布者
  （如未来 UI 直接发布）的序号关系未定义，接线时需统一。
- **真实引擎覆盖有限**：resign 路由跑在 `TenukiAdapter` 上；其余行为用 stub 端口 + 本地观测测试。
  ko/superko 情形下 try_move 报“本地合法”而 play 拒绝的差异没有专门用例（属 B-T05/C-T10 范围）。
- **未跑集成夹具**：本票不改 DSH 版本或协作 yield，未重跑 cooperative-yield fixture。
