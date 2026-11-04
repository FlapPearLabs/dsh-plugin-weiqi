# Handoff · WAVE-C-T05

- 状态：READY_FOR_REVIEW
- 分支：`work/c-t05-anti-cheat`
- 开发 worktree：`<dev worktree>`（本机绝对路径不入库，仓库为公开仓库）
- 基线 BASE_SHA：`81979dd83986ba8542002f8716dee85278633ad6`（`origin/main`，C-T04 合并提交）
- 测试套件 commit：`1729283e5523aad3d8065f4a0572ced0e7a87d53`
- CI gate commit：`a03c84882dce55efff2fa404a4d452456c9a5c99`
- 文档 commit：本文件（送审 HEAD 为含本文件的提交）
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标（BL-CAP-03：NOT_IMPLEMENTED → IMPLEMENTED_VERIFIED）：按 Spec §39.3 与 §40 Anti-Cheat，从 Go lane 尝试每一种被禁止的能力，断言它们都在执行授权边界失败。
- 票据验收标准（逐条）：
  1. 每种禁止尝试都确定性失败 —— 见「逐能力拒绝输出」与套件断言（同时断言拒绝类、`reason`、`toolPath`、`presetId`，且重复执行结果一致）。
  2. CI 运行证据 —— 新增专用 gate workflow；本地已跑通，GitHub Actions 实跑待 PR（见「未验证」）。
  3. `pnpm verify` 退出码 0。
- 明确非目标（票据原文）：不新增 guard 代码、不做 UI。本次未改任何产品源码，未加依赖。

## 做了什么

### 测试套件（`1729283`）

新增 `tests/anti-cheat/go-capability-anti-cheat.test.ts`（398 行，19 个用例），全部通过**真实** `GoCapabilityGuard` 与**真实**组合作用域执行，未 mock guard：

- **逐能力矩阵**（8 个独立用例，名字即能力名）：Code Mode / `run_code`、bash / shell、Python、Web、subagent、generic MCP、external solver（KataGo）、general execution 别名。每种能力：
  - 注册期：声明该禁止 `kind` 的描述符抛 `ForbiddenGoCapabilityError`，`reason = 'forbidden-kind'`，`kind` / `toolPath` / `presetId` 全部断言；
  - 执行期：同一路径连续两次执行，回放同一 `forbidden-kind` 拒绝（确定性）；
  - 哨兵 `run()` 调用次数为 0（被拒能力的代码从未运行）。
- **组合作用域**：`composeGoLaneScope(new Context())` 取出 `goCapabilities` 服务——即 `src/index.ts` 交给 Go agent 的同一组合——对 8 种能力重复注册 + 执行拒绝；另有一条「从未尝试注册也拒绝」（`not-in-surface`）。
- **外部求解器**：`go.katago` / `go.leela` / `go.mcts` / `go.gnu_go` 在铸造、注册、执行三处全拒。
- **别名与伪造**：
  - `go.exec` 五个入口全拒：铸造（`not-in-surface`）、手写描述符注册（`not-in-surface`）、执行（`not-in-surface`）、组合作用域（`not-in-surface`）、直接边界断言（`ForgedGoCapabilityError`）；
  - 非 Go 泳道别名 `bash.run` / `fs.read` / `mcp.call` / `gonzo.state`：铸造、注册、执行均为 `tool-path`；
  - 伪造 `kind: 'model-native'` 描述符挂在真实表面路径 `go.try_move` 上：注册 `ForgedGoCapabilityError`，执行 `forged-descriptor`，直接边界与组合作用域同样拒绝，`run()` 未运行；
  - 复制已铸造描述符（`{ ...minted }`）同样按伪造拒绝，provenance 无法克隆。
- **防空洞对照**：精确 8 条原生表面路径全部可铸造、可执行（哨兵各命中 1 次），组合作用域执行 `go.state` 成功——证明套件不是「什么都拒绝所以全绿」。
- **拒绝类型收口**：只有 `ForbiddenGoCapabilityError` / `ForgedGoCapabilityError` 才被计为拒绝；guard 若因代码损坏抛 `TypeError`，测试直接失败而不是当成拒绝通过。

### CI（`a03c848`）

- 新增 `.github/workflows/anti-cheat-capability-gate.yml`：PR 触及套件、guard、preset、`package.json` 或锁文件时，在固定 Node 24.11.1 / pnpm 11.7.0 上运行 `pnpm exec vitest run tests/anti-cheat --reporter=verbose`；另支持 `workflow_dispatch`。
- 同时说明：现有 `.github/workflows/ci.yml` 的 `pnpm verify` 本来就包含 `vitest run`（默认 glob 覆盖 `tests/anti-cheat/**`，仅排除 `tests/upgrade-gates/**`），因此该套件在主 CI 中也会跑；专用 gate 只是让 §39.3 有一个具名检查。

## 逐能力拒绝输出

`pnpm verify` 构建 `lib/` 后，对构建产物运行一次性探针（`/tmp` 脚本，未入库；等价矩阵已固化在套件断言里）：

```text
preset=companion-go-native-only lane=go paths=8

| capability | attempt path | registration | execution | run() calls |
|---|---|---|---|---|
| Code Mode / run_code | `go.run_code` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |
| bash / shell | `go.bash` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |
| Python | `go.python` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |
| Web | `go.web` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |
| subagent | `go.subagent` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |
| generic MCP | `go.mcp` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |
| external solver (KataGo) | `go.katago` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |
| general execution alias | `go.exec` | ForbiddenGoCapabilityError/forbidden-kind | ForbiddenGoCapabilityError/forbidden-kind | 0 |

forged kind:model-native @ go.try_move -> register ForgedGoCapabilityError/-, execute ForbiddenGoCapabilityError/forged-descriptor, run() calls 0
control native go.state -> execute EXECUTED, run() calls 1
forbidden kinds declared by preset: code-mode, bash, python, web, subagent, generic-mcp, external-solver, general-execution
preset id used in every rejection: companion-go-native-only
```

套件 verbose 输出中每个能力是一条具名用例（`Code Mode / run_code is refused at registration and at execution` 等），reviewer 可用 `pnpm exec vitest run tests/anti-cheat --reporter=verbose` 复现。

## 变异牙齿证据

在 `/tmp/c-t05-mutation` 的完整副本上（`rsync` 复制 + 软链 `node_modules`，**未提交、未改主工作树**），每次只改一处 guard 检查，运行同一套件：

| 变异 | 改动 | 结果 |
|---|---|---|
| 基线（未变异副本） | — | 19 passed，exit 0 |
| M1 | `goCapabilityKindViolation` 恒返回 `undefined`（删除 kind 策略） | **10 failed / 9 passed**，exit 1 |
| M2 | `goSurfaceViolation` 恒返回 `undefined`（删除精确表面白名单） | **3 failed / 16 passed**，exit 1；失败信息含 `anti-cheat: a forbidden capability attempt was admitted` |
| M3 | `isNativeGoCapability` 只判对象、不查 provenance（删除铸造检查） | **3 failed / 16 passed**，exit 1；3 条 `a forbidden capability attempt was admitted`（伪造描述符真的执行了） |
| M4 | `goToolPathViolation` 恒返回 `undefined`（删除泳道前缀） | **1 failed / 18 passed**，exit 1 |

M1 失败的是 8 条逐能力用例 + 组合作用域用例 + 求解器用例（拒绝原因从 `forbidden-kind` 变成 `not-in-surface`，断言咬住原因）；M2 失败的是 `go.exec` 用例、未注册执行用例与求解器用例；M3 失败的是 `go.exec`、伪造 `model-native`、克隆描述符三条，且哨兵证明放行后代码真的执行了；M4 失败的是非 Go 别名用例。副本在跑完后已还原为未变异版本。

## 验证命令与结果

```text
$ pnpm exec vitest run tests/anti-cheat --reporter=dot
 Test Files  1 passed (1)
      Tests  19 passed (19)

$ pnpm verify
EXIT=0
 Test Files  19 passed (19)
      Tests  196 passed (196)

$ ruby -ryaml -e '...' .github/workflows/anti-cheat-capability-gate.yml
name: Go lane anti-cheat capability gate
jobs: anti-cheat
steps: Checkout | Set pinned Node | Install pinned pnpm | Fresh install | Run Spec §39.3 anti-cheat capability suite
```

- 基线（改动前）：`pnpm test` → 18 files / 177 tests passed。
- 改动后：19 files / 196 tests passed（+1 文件 / +19 用例），typecheck 与 build 均通过。

## 未验证与边界

- **真实 DSH 工具执行不在本票**：本套件固定在 guard 拥有的授权边界（铸造 / 注册 / 执行 / 组合作用域 / 直接边界断言）。真实 DSH 工具注册与逐工具执行接线是 WAVE-C-T02；pinned 依赖面没有工具执行服务，C-T04 交接包已记录。
- **无 GitHub Actions 实跑**：workflow 已本地做 YAML 解析校验，但尚未推送、未开 PR，因此没有 CI run URL / 检查状态。票据要求「CI run evidence」，需在 PR 上补齐。
- **本地 Node 版本**：本机为 v26.10.0（pnpm 报 engine 警告），CI 固定 24.11.1；本地绿不等价于 24.11.1 上的绿，需 CI 确认。
- **授权边界说明（不是绕过）**：guard 约束的是能力 `kind`、工具路径、精确表面与模块 provenance；已铸造描述符的 `run` 函数体属于包内实现（C-T02 拥有），Go 模型无法调用 `nativeGoCapability`，因此模型侧不存在「合法铸造 + 恶意 run」路径。若未来把铸造入口暴露给非包内代码，需要另行评审。
- **`tests/` 不在 `pnpm typecheck` 覆盖内**：`tsconfig.json` 的 `include` 只有 `src/**/*.ts`（既有仓库配置，本次未改），套件由 vitest/esbuild 转译执行；新文件已通过编辑器 LSP 类型检查，但仓库级 typecheck 不覆盖它。
- **Baseline 状态未改**：`docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` 的 BL-CAP-03 仍是 `NOT_IMPLEMENTED`；按既有流程由合并后的 post-merge sync PR 翻转，本票不改。

## 已知问题 / 遗留

- 套件与 C-T04 的 `src/runtime/go-capability-guard.test.ts` 在「单条能力拒绝」上有意重叠：guard 单测锁机制，本套件锁 §39.3 的逐能力验收矩阵与组合作用域路径。未修改或弱化任何既有测试。
- C-T01（注册表结构）并行开发中：本套件只依赖 preset 的路径白名单与 guard 的公开导出，不依赖 C-T01 的 API。
