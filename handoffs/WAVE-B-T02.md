# Handoff · WAVE-B-T02

- 状态：READY_FOR_REVIEW
- 轮次：Round 1/6
- 分支：`work/b-t02-tenuki-adapter`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-T02`
- 基线 BASE_SHA：`8249c12`（merge PR #70 后的 main；本分支起点）
- 红测试 commit：`5edc45f`
- 待审代码 HEAD_SHA：`f298ee7`（实现 + pin；随后的 `docs:` 提交只含本交接文件）
- 审查 worktree：由审查者填写
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标：按 Spec §26/§27 实现 `TenukiAdapter implements GoRulesPort`，把 tenuki 限定在本模块内，游戏创建时显式传入 area / positional-superko / komi 7.5，消费 B-S01 已验证的 `tenuki@0.3.1`。
- 验收标准（逐条）：
  1. `src/rules/tenuki-adapter.ts` 实现 `GoRulesPort` 八个方法；应用层只依赖端口类型。
  2. 每个游戏创建都显式传 `{ scoring: "area", koRule: "positional-superko", komi: 7.5 }`，不依赖 tenuki 默认值。
  3. 引擎无关 harness 对适配器全绿（13 个用例、八个方法）。
  4. `resign` 是端口层终端动作：对手胜、棋盘与 moveNumber 不变、之后 play/pass/resign 全部 `game-over` 拒绝。
  5. `getState` 返回不可变快照，公共类型里没有 tenuki 对象。
  6. `package.json` 精确 pin `tenuki@0.3.1`，且只新增这一条生产依赖。
  7. `pnpm verify` 退出码 0。

## 已完成

- 新增 `src/rules/tenuki-adapter.ts`：`TenukiAdapter` + `createTenukiGoRulesPort()`；tenuki 只在此文件出现。
- 新增 `src/rules/tenuki.d.ts`：适配器实际用到的 tenuki 最小接口声明（无 tenuki 运行时对象进入公共类型）。
- 新增 `src/rules/tenuki-adapter.test.ts`：harness 对真实适配器的 13 例 + area/komi/positional-superko 负控 + 快照形状与不可变测试。
- 新增 `src/rules/tenuki-adapter-config.test.ts`：mock tenuki，断言 `new Game(...)` 的构造参数精确等于冻结配置（含 9/13/19 棋盘尺寸透传），并显式断言不是 territory/simple/0。
- `package.json` / `pnpm-lock.yaml`：只新增 `tenuki@0.3.1` 生产依赖。
- 未改 `src/contracts/`（B-T01 契约原样复用），未改 UI / CI / 其它票文件。

## 改动

- 文件与行数（相对 BASE_SHA `8249c12`）：
  - `package.json` +3（`dependencies.tenuki: "0.3.1"`）
  - `pnpm-lock.yaml` +10（importer + resolution + snapshot）
  - `src/rules/tenuki-adapter.ts` +384（新）
  - `src/rules/tenuki.d.ts` +53（新）
  - `src/rules/tenuki-adapter.test.ts` +130（新）
  - `src/rules/tenuki-adapter-config.test.ts` +98（新）
  - `handoffs/WAVE-B-T02.md`（本文件）
- 是否有范围外改动：无。

## 关键设计决定

- **显式冻结配置**：`FROZEN_RULES = { scoring: "area", koRule: "positional-superko", komi: 7.5 } as const`；每次 `new Game(...)` 都逐项传入，快照里的配置也来自同一常量，不回读 tenuki 默认值。负控测试证明行为确实来自显式配置（见下）。
- **唯一规则权威**：提子、自杀、劫/超级劫、地盘与死子应用全部由 tenuki 判定；适配器只做 `Player<->color` 映射、端口结果包装、`inspectGroup` 派生遍历（§29 明确允许）与 resign 终端标记。未实现第二个超级劫层或第二个规则引擎。
- **非法手分类**：占用/越界/轮次由适配器直接判定；其余非法由 tenuki 的 `isIllegalAt` 拒绝，再用 tenuki 自身的不可变棋盘转移判断该手是否零气，从而区分 `suicide` 与 `superko`。因为本配置下唯一的劫规则是 positional-superko，所有劫规则拒绝一律报告为 `superko`，`ko` 枚举值不使用。
- **提子计数**：从 tenuki `currentState()` 的 `blackStonesCaptured`/`whiteStonesCaptured` 立即映射成端口 `captures`（黑白归属按 `PlayerColors`），随后即丢弃，不保存也不外泄 tenuki 对象。手动抽查：黑提一白子后 `captures.user === 1`。
- **快照不可变**：每次 `getState`/结果都新建纯对象并对顶层、`colors`、`captures`、`stones`（含每个 `point`）、`lastMove`、`outcome` 做 `Object.freeze`；测试断言冻结且改写不生效。
- **resign**：任意一方在 `playing` 中可退（沿用 B-T01 决定）；只改 `status`/`outcome`，不碰棋盘、不增 `moveNumber`；终局后所有动作返回 `game-over`。
- **settle**：`game-over` → `not-two-passes` → `disagreement` 依次校验；同意时用 `markDeadAt` 把死子交给 tenuki 计分，再由端口派生 `winner`/`loser`/`score`。
- **score 分解**：`total` 直接取 tenuki（area + komi），`stones` 按棋盘活子（扣除死子）统计，`territory = total - stones - (白方 komi)`，保证 `total = stones + territory + komi`。

## 证据

- 基线（`8249c12`，未改任何文件）：`pnpm install --frozen-lockfile` → 61 个包还原，manifest 与锁文件无改动。
- 红测试（在 `5edc45f` 上）：
  - `pnpm exec vitest run` → `Test Files 2 failed | 14 passed (16)`，`Tests 122 passed (122)`；两个新套件均因 `Cannot find module './tenuki-adapter.js'` 无法加载。
  - `pnpm run typecheck` → `src/rules/tenuki-adapter.test.ts(3,41): error TS2307`、`src/rules/tenuki-adapter-config.test.ts(56,41): error TS2307`，退出码 2。
- 绿测试（在 `f298ee7` 上）：
  - `pnpm verify` → 退出码 0（typecheck → vitest → clean → build 全通过）。
  - 计数：`Test Files 16 passed (16)`，`Tests 130 passed (130)`（122 既有 + 8 新增）。
  - harness（`pnpm exec vitest run src/rules/tenuki-adapter.test.ts --reporter=verbose`）：
    `harness: 13 cases, methods: createGame, getState, inspectGroup, pass, play, resign, score, settle, failures: 0`
    13 个用例逐条 `ok`，包含 resign 不改棋盘、resign 终端、settle 两连 pass 与分歧恢复。
  - 显式配置断言：mock tenuki 后 `new Game` 参数精确为
    `{ boardSize: 9, scoring: "area", koRule: "positional-superko", komi: 7.5 }`，并断言不含 `territory` / `simple` / `komi: 0`；9/13/19 三个尺寸同样逐项显式。
  - 负控（真实 tenuki，经端口）：
    - area：一子局 `score.black.total === 1`（tenuki 默认 territory 会计 0，见 B-S01 记录）。
    - komi：`score.white.total === 7.5`（默认 komi 0 会计 0）。
    - superko：重放 B-S01 的重复局面循环后，白方再次落子返回 `superko` 且状态不变（默认 simple ko 会接受，见 B-S01 记录）。
  - 手动抽查（未入测试）：黑提一白子后 `captures.user === 1`、`captured` 含被提白子；被黑子围死的空点由白方落子返回 `suicide`。
- pin 证据：
  - `package.json`：`"dependencies": { "tenuki": "0.3.1" }`（`pnpm add tenuki@0.3.1 --save-exact`）。
  - `pnpm-lock.yaml`：`tenuki@0.3.1` resolution `sha512-4obVv+CHn0QXrtHEZOYXE69xweUAae/iHfEz6oqM+dKTcdL8b0G44knfjLtepu4UHdwW0OzxurXDXoZKzKOIIQ==`，与 `docs/validation/TENUKI_CONFORMANCE_VERIFIED.md` 记录逐字一致。
  - 安装树 `node_modules/tenuki/package.json`：`version 0.3.1`、`sha1 d0cd7c688ccbfed6284df287267241179dae3525`，与 B-S01 记录一致。
  - `git diff 8249c12..HEAD -- package.json` 只新增 tenuki 一条依赖；锁文件只新增 tenuki 的 importer/resolution/snapshot。
- 构建产物（`lib/`，未入库）：`lib/rules/tenuki-adapter.d.ts` 只引用 `../contracts/rules.js`，没有 tenuki 类型。

## 限制与未验证

- 本机 Node **v26.10.0**，而 `package.json` 要求 `>=24.11.1 <25`；安装与 verify 只有 pnpm engine 警告。CI 固定 Node 24.11.1，本次**未在 CI 的 Node 24 运行**。
- CI 未运行：本票禁止 push/PR/merge，所有证据来自本地。
- 死子结算只验证了空 `deadStones` 路径；非空死子计分、提子/自杀/双活等 §31 夹具属 B-T04/B-T05，本票未实现也未断言。
- `classifyIllegal` 的 suicide 分支只有手动抽查，未进入提交的测试；superko 分支由负控覆盖。
- 和解分歧后的边界：tenuki 在两连 pass 后拒绝继续 pass（只接受棋盘落子恢复）。此时适配器对 pass 返回 `game-over`。这是 tenuki 自身语义与端口 `disagreement` 恢复状态的交界，留给 B-T04 的完整结算流程定夺；harness 未覆盖该后续动作。
- `score` 的 `territory` 分解在“已按死子结算”的局面没有断言（B-T03/B-T04 范围）。
- 未做 tenuki 版本自动升级；未添加其它依赖。

## 已知缺陷

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| B-T02-EDGE-1 | P3 | 和解分歧后（record 仍 playing、tenuki 已两连 pass）再请求 pass 返回 `game-over`；只有棋盘落子能恢复。 | 记录待 B-T04 |

## 已排除的假设

- 假设：需要自定义超级劫层。排除依据：B-S01 已证明 `koRule: "positional-superko"` 是 tenuki 一等选项，负控复现了重复局面拒绝；再加一层会违反 Spec §27。
- 假设：`resign` 必须交给 tenuki/棋盘处理。排除依据：Spec §26 明确 resign 是端口层终端动作、不要求 tenuki 计算或改动棋盘；实现只改状态与结果，harness 的“不改棋盘/不增 move number/终局后全部拒绝”用例通过。
- 假设：`inspectGroup` 需要 tenuki 的私有接口。排除依据：§29 允许基于当前权威棋盘的派生遍历；实现只用端口快照里的 stone 集合做 BFS。
- 假设：3x3 棋盘可做 area 负控。排除依据：契约 `BoardSize = 9 | 13 | 19`，不能传入 3；改用 9x9 一子局（area 计 1、territory 默认计 0）完成负控。

## 下一步

- 审查者按 Standards + Spec 两轴复核，重点看：显式配置是否真的到达引擎、tenuki 是否只出现在 `src/rules/tenuki-adapter.ts`、`getState` 不可变、resign 语义、`superko` 分类取舍。
- B-T03/B-T04 可直接复用 `createTenukiGoRulesPort()` 写 area/komi/超级劫与提子/自杀/结算夹具（B-T05 汇总）。

## 不要做什么

- 不要在本分支添加 §31 全量夹具、UI、第二个规则权威或第二个超级劫层。
- 不要把 tenuki 对象写进公共类型或序列化 tenuki 内部状态。
- 不要运行 `git add .`；不要 push / 开 PR / merge（本票禁止）。

## 偏离记录

- 为运行测试在 worktree 内执行了 `pnpm install --frozen-lockfile`（仅还原锁文件依赖，未改 manifest/锁）。
- 红测试提交 `5edc45f` 的提交信息换行被 shell 转义成了字面 `\n`；因团队规则禁止 `amend`，未改写历史，特此记录（内容本身完整可读）。
- 默认 vitest reporter 不打印 harness 的 `console.log`；查看逐例覆盖需加 `--reporter=verbose`。
