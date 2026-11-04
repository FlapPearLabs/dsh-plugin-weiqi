# WAVE-C-T01 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-C-T01`
- 分支：`work/c-t01-go-registry`
- 基线 SHA：`81979dd83986ba8542002f8716dee85278633ad6`（`origin/main`，含 C-T04 合并）
- 红测试提交：`1e6f2c77685d6ebd0f02c63cf055a028b75d0085`
- 实现提交：`1214f32c6e5566530803f20de2bf226d94ebf81c`
- 状态：本地 `pnpm verify` 通过（19 files / **186 tests**）；**未推送、未开 PR、未合并**

## 做了什么

WAVE-C-T01 只做**注册表结构/策略**，不注册任何工具（注册归 WAVE-C-T02）。

- 新增 `src/tools/go-lane-registry.ts`：
  - `GO_LANE_REGISTRY`：冻结声明，`lane: 'go'`、`specPhase: 'A'`、
    `registrationState: 'structure-only'`、`registeredPaths: []`（冻结空数组）。
  - `GO_LANE_ADMITTED_PATHS` 直接复用冻结的 `GO_PRESET.toolPaths`（同一对象，
    测试用 `toBe` 钉死），不复制第二份 8 条路径清单。
  - `GO_LANE_FORBIDDEN_SURFACE_SEGMENTS`：策略词表（solver/engine/katago/
    leela/gnugo/mcts/best/bestmove/win/winrate/score/recommend/advice/search/
    eval/exec/shell/bash/python/script/spawn/subagent/mcp），按路径分词后小写匹配。
  - `goLanePathViolation(path: unknown)`：全函数、确定性，返回拒绝原因或 `undefined`。
  - `admitGoLaneToolPath(path: unknown)`：接受则返回 `GoToolPath`，否则抛
    `GoLaneRegistryError`（带 `toolPath` 与 `reason`）。
- 新增 `src/tools/index.ts`：只导出上述结构与策略，**没有**任何注册入口。
- 新增 `src/tools/go-lane-registry.test.ts`：9 条用例（结构、策略、拒绝、
  无注册入口、无 solver/engine 依赖）。

## 策略表（Phase A）

判定顺序固定：非字符串 → 泳道前缀 → 禁止面 → 精确白名单。

| 输入 | 结果 | 原因 |
|---|---|---|
| 8 条 Spec §20 `go.*` 路径 | 接受 | — |
| `companion.affect` / `companion.request_focus` / `companion.handoff` | 拒绝 | `tool-path` |
| `solver.best_move` / `katago.analyze` / `fs.read` | 拒绝 | `tool-path` |
| `go.best_move` / `go.bestMove` / `go.win_rate` / `go.winrate` / `go.score_lead` / `go.recommend` / `go.try_move_best` | 拒绝 | `forbidden-surface` |
| `go.solver` / `go.engine` / `go.katago` / `go.leela` / `go.gnugo` / `go.mcts` / `go.search` / `go.exec` / `go.bash` / `go.python` / `go.subagent` | 拒绝 | `forbidden-surface` |
| `go.arbitrary` / `go.state.extra` | 拒绝 | `not-in-surface` |
| `undefined` / `null` / `42` / `{}` / `['go.state']` | 拒绝 | `invalid-tool-path` |

8 条被接受的路径：`go.state`、`go.inspect_group`、`go.inspect_region`、
`go.try_move`、`go.play`、`go.pass`、`go.resign`、`go.request_deep_think`。

## 红 / 绿证据（真实输出）

红（`1e6f2c7`，模块尚未存在）：

```text
pnpm vitest run src/tools/go-lane-registry.test.ts
 1 file failed, 0 tests run
 Error: Cannot find module './go-lane-registry.js' imported from .../src/tools/go-lane-registry.test.ts
```

首轮红是模块链接失败，不是断言级；断言级红由下面的变异检查提供。

绿（`1214f32`）：

```text
pnpm run typecheck                                   -> exit 0
pnpm vitest run src/tools/go-lane-registry.test.ts   -> 9 passed (9)
pnpm verify                                          -> exit 0
   19 files / 186 tests passed（本票前为 18 files / 177 tests）
```

变异检查（删策略分支 → 断言级红，每次事后还原并 `cmp` 确认字节一致）：

| 删除的分支 | 结果 |
|---|---|
| `forbidden-surface` 判定 | 3 failed / 6 passed |
| `not-in-surface` 判定 | 1 failed / 8 passed |
| `tool-path` 前缀判定 | 2 failed / 7 passed |

## 刻意没有做的事

- **没有注册任何工具**：`registeredPaths` 恒为空，barrel 无注册入口；测试
  断言 `GO_LANE_REGISTRY.registeredPaths === []`、`registrationState ===
  'structure-only'`、且导出里没有任何名字带 `register` 的函数。**不声称 8 个
  工具已注册**——那是 C-T02 的验收（注册后枚举集合恰为 8 条）。
- 没有改 `src/index.ts` / `src/preset/go-preset.ts` / `src/runtime/*`：
  `src/tools/` 目前不挂载到插件入口，注册表结构先独立存在。
- 没有改 `src/contracts/index.ts`（不需要新导出）。
- 没有引入任何依赖，没有 solver/engine 导入（测试静态扫描注册表模块的
  import 说明符，唯一一条是 `../preset/go-preset.js`；`package.json` 三类依赖
  里没有 katago/leela/gnugo/mcts/solver/go-engine 字样）。

## 环境与过程备注

- 工作树创建时没有 `node_modules`，用 `pnpm install --frozen-lockfile
  --offline` 从本机 pnpm store 复用 61 个包（lockfile 未变，未新增依赖）。
- 红测试提交里 `go.try_move_best` 同时出现在 `not-in-surface` 循环和
  `forbidden-surface` 断言中，自相矛盾；在实现提交里修正为只按策略归属断言
  （`forbidden-surface`），实现未因此放宽。
- Node 版本告警：`engines` 要求 `>=24.11.1 <25`，本机为 `v26.10.0`；`pnpm`
  只告警不失败，`verify` 全绿，与本次改动无关。

## 未验证 / 留给后续

- 注册表与执行期守卫（`GoCapabilityGuard`）的接线未做：C-T02 注册时必须同时
  过注册表策略与守卫铸造；本票没有替它决定接线位置。
- 注册后枚举断言（恰好 8 条、无禁止面）属 C-T02 验收，本票只证明结构。
- Phase B 的 `companion.*` 放行未做，属 C-T03；本票策略明确拒绝。
