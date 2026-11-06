# Handoff · WAVE-B-T01

- 状态：READY_FOR_REVIEW
- 轮次：Round 1/6
- 分支：`work/b-t01-gorulesport-contract`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-T01`
- 基线 BASE_SHA：`2a2e5b4d6ff4b4161f8f30925aec77600409d40c`
- 红测试 commit：`fb6d5c685ddc25ac731d9526e73585438b6943d2`
- 待审代码 HEAD_SHA：`bb121aba21d4db338206a41f01101778ae7494dc`
- 审查 worktree：由审查者填写
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标：按 Spec §26/§30 定义 `GoRulesPort`（含 `resign` 终端动作），并提供对任意实现都可运行的引擎无关测试骨架；实现 BL-GR-01 契约层，不含任何规则引擎实现。
- 验收标准（逐条）：
  1. `src/contracts/rules.ts` 暴露 `createGame/play/pass/resign/getState/inspectGroup/score/settle` 八个方法，类型层面可断言 `resign` 存在。
  2. `resign` 是端口层终端动作，返回 `ResignResult`，不产生第二个规则权威。
  3. 引擎无关 harness 接受任意 `GoRulesPort` 实现，覆盖八个方法、非法落子不改状态、resign 终端语义。
  4. harness 对确定性 stub 全绿；带牙齿（对故意破坏 resign 不变量的实现会报失败）。
  5. `pnpm verify` 退出码 0。

## 已完成

- 新增 `src/contracts/rules.ts`：全部端口类型与接口，无 Tenuki/引擎类型。
- 新增 `tests/rules/port-harness.ts`：13 个用例的引擎无关 harness（只依赖 `GoRulesPort` 与契约类型），返回逐用例报告，失败不隐藏其他用例。
- 新增 `tests/rules/stub-port.ts`：确定性 stub，仅供 harness 使用，不实现提子/自杀/劫/超级劫/地盘/死子规则。
- 新增 `src/contracts/rules.test.ts`：4 个类型/运行期契约测试 + 3 个 harness 测试（含反例控制）。
- `src/contracts/index.ts` 导出新契约（包根经 `export *` 一并暴露）。

## 改动

- 文件与行数（相对 BASE_SHA）：
  - `src/contracts/rules.ts` +200（新）
  - `src/contracts/index.ts` +29
  - `src/contracts/rules.test.ts` +132（新）
  - `tests/rules/port-harness.ts` +286（新）
  - `tests/rules/stub-port.ts` +262（新）
- 是否有范围外改动：无。未改 `package.json`/`pnpm-lock.yaml`，未加依赖，未动主检出与其它票的文件。

## 关键契约决定（Spec 只给了方法名，签名由本票确定）

- 端口为同步 API；规则违例通过结果联合体返回，并携带未变化的状态；未知 `gameId` 视为编程错误，可抛异常。
- `GameConfig` 强制显式 `scoring: "area"`、`koRule: "positional-superko"`、`komi: 7.5`，并要求显式 `PlayerColors` 映射，避免任何引擎默认值或隐式黑白归属（§27）。
- `GameState` 是不可变快照：结构化 `Point`、`stones`、`lastMove`、`outcome`（无值时为 `null`），不含引擎对象。
- `resign`：仅 `playing` 时接受；立即 `status: "over"`，`outcome = { winner: 对手, loser: 退方, reason: "resignation" }`；不改棋盘、不改 `moveNumber`；终局后 play/pass/resign 一律以 `game-over` 拒绝且状态不变。
- `inspectGroup` 只做连通块/气/块大小感知（§29），空点返回 `null`。
- `ScoreResult` 按中国面积法：`total = stones + territory + komi`，`komi` 只计白方 7.5；`settle` 区分 `game-over` / `not-two-passes` / `disagreement`。

## 证据

- 基线（BASE_SHA，未做任何改动）：`pnpm test` → 6 files / 48 tests passed；`pnpm typecheck` → 无输出（通过）。
- 红测试（在 `fb6d5c6` 上）：
  - 命令：`pnpm test` → `FAIL src/contracts/rules.test.ts`，`Error: Cannot find module './rules.js' imported from .../src/contracts/rules.test.ts`；7 个文件中 1 个失败，48 个既有测试仍通过。
  - 命令：`pnpm typecheck` → `TS2307: Cannot find module './rules.js'`（rules.test.ts 两处、harness 两处、stub 一处）与 `TS2305: Module './index.js' has no exported member 'GoRulesPort'`；退出码 2。
- 绿测试（在 `bb121ab` 上）：
  - 命令：`pnpm verify` → 退出码 0（typecheck → test → clean → build 全通过）。
  - 计数：`Test Files 7 passed (7)`，`Tests 55 passed (55)`（48 既有 + 7 新增）。
  - harness 输出（`pnpm exec vitest run src/contracts/rules.test.ts --reporter=verbose`）：
    `harness: 13 cases, methods: createGame, getState, inspectGroup, pass, play, resign, score, settle, failures: 0`
  - 类型层面：`expectTypeOf<GoRulesPort>().toHaveProperty('resign')`、`parameters.toEqualTypeOf<[string, Player]>()`、`returns.toEqualTypeOf<ResignResult>()`、`Extract<ResignResult, { ok: true }>['outcome']['reason'] === "resignation"`、`PublicGoRulesPort` 与 `GoRulesPort` 同型。
  - 反例控制：`BoardMutatingResignPort`（resign 后棋盘多一子）被 harness 捕获，失败用例恰为 resign 用例，证明 harness 不是空转。
- 证据日志：本机 `/tmp/b-t01-verify.log`（未入库）。

## 限制与未验证

- 未接真实引擎：Tenuki 版本与适配器属 WAVE-B-S01/B-T02，本票 harness 只对 stub 验证过。
- 未实现 §31 十一项规则夹具（B-T05）；提子、自杀、劫、超级劫、面积计分、死子结算在 stub 中均无实现，`ScoreResult.territory` 恒为 0。
- `settle` 的 `deadStones` 在 stub 中被忽略（死子应用属 B-T04/B-T05）。
- 端口签名是依据 Spec 方法名与 §28 语义确定的设计，尚未经过 B-T02 真实适配器检验；后续如必须改签名，应按公共契约变更处理。
- CI 触发策略（BL-CI-01）仍是 bootstrap 时代配置，本票未改 CI；`pnpm verify` 证据来自本地。
- 本机 Node v26.10.0，而 `package.json` 声明 `>=24.11.1 <25`；安装与 verify 仅有 pnpm engine 警告，CI 固定 Node 24.11.1。
- 分支基于 `2a2e5b4`；期间 `origin/main` 已前进（`git status` 显示 behind 13），本票未 rebase/merge（禁止项），合并方需自行决定合入方式。

## 已知缺陷

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| — | — | 本票范围内未发现缺陷 | — |

## 已排除的假设

- 假设：`resign` 只能在轮到自己时执行。排除依据：§25/§26 把 resign 定义为终端动作而非棋盘着法，且 §31 只要求「立即终局、对手胜、无棋盘变更」；因此端口允许任意一方在 `playing` 中退，未引入轮次限制。
- 假设：`GameState` 需要携带 `scoring/koRule/komi/colors`。排除依据：§28 规范记录要求这些字段，快照自描述可避免消费方再查配置。

## 下一步

- 唯一假设：B-T02 可直接实现 `TenukiAdapter implements GoRulesPort` 并复用本 harness。
- 最小实验：B-T02 用 `runGoRulesPortContract(createTenukiPort)` 跑通；若不通过，先定位端口语义与 Tenuki 行为的差异，再决定改端口还是适配器（改端口 = 契约变更）。
- 需要谁做什么：审查者按 Standards + Spec 两轴复核；B-T02 执行者消费本契约。

## 不要做什么

- 不要在本分支加 Tenuki 依赖、规则夹具或 `GameLifecycleController`。
- 不要把 stub 当成规则权威或在生产代码中引用 `tests/rules/`。
- 不要 `git add .`；不要 push/PR/merge（本票禁止）。

## 偏离记录

- 与 AGENTS.md 的偏离：为能运行测试，在 worktree 内执行了 `pnpm install --frozen-lockfile`（仅还原锁文件依赖，`pnpm-lock.yaml` 与 `package.json` 无改动，未新增依赖）。
- 默认 vitest reporter 不打印 harness 的 `console.log`；需要看覆盖输出时使用 `--reporter=verbose`。
