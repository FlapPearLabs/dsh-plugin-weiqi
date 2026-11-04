# Handoff · WAVE-B-T02

- 状态：READY_FOR_REVIEW（Round 1 审查 CHANGES_REQUESTED，P1/P2 已返修，待复审）
- 轮次：Round 2/6
- 分支：`work/b-t02-tenuki-adapter`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-T02`
- 基线 BASE_SHA：`8249c12`（merge PR #70 后的 main；本分支起点）
- 红测试 commit：`5edc45f`（首轮）；`45b6f71`（返修轮 P1/P2 回归测试）
- 修复 commit：`e0534b2`（P1 + P2）
- 待审代码 HEAD_SHA：`e0534b2`（Round 1 审的是 `3180083`）
- Round 1 审查报告：`.omo/reviews/WAVE-B-T02/r1.md`（P0 0 / P1 1 / P2 1 / P3 1，CHANGES_REQUESTED）
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

- 文件与行数（相对 BASE_SHA `8249c12`，Round 2 返修后）：
  - `package.json` +3（`dependencies.tenuki: "0.3.1"`）
  - `pnpm-lock.yaml` +10（importer + resolution + snapshot）
  - `src/rules/tenuki-adapter.ts` +461（新）
  - `src/rules/tenuki.d.ts` +53（新）
  - `src/rules/tenuki-adapter.test.ts` +279（新）
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
- **分歧回滚（Round 1 P1 返修）**：`GameRecord` 记录适配器已接受的动作序列（`history`）；`settle({agreed:false})` 与“未经结算的第三手 pass”都把末尾两手 pass 从历史去掉，再用同一份冻结配置重建 tenuki 引擎并重放剩余动作。恢复后的状态就是两手 pass 之前的局面：棋盘不变、`toPlay` 不变、`consecutivePasses = 0`、`lastMove`/`moveNumber` 随被丢弃的 pass 一起回退；因此双方可以重新走完收官再结算。重建只重放 tenuki 自己已经接受过的动作，没有引入第二个规则权威；positional superko 依赖的历史也随重放保留。
- **认输后的 score（Round 1 P2 返修）**：冻结的 `ScoreResult` 形状（`black`/`white`/`winner`/`margin`）无法表达“认输终局”，因此 `score()` 在 `outcome.reason === 'resignation'` 时抛出明确错误（`score is undefined after a resignation (...); read state.outcome instead`），而不是返回可能与 `state.outcome` 相反的棋盘 winner。按分数结算的终局仍可正常调用且与 `state.outcome` 一致。契约类型未改动。

## 证据

- 基线（`8249c12`，未改任何文件）：`pnpm install --frozen-lockfile` → 61 个包还原，manifest 与锁文件无改动。
- 红测试（在 `5edc45f` 上）：
  - `pnpm exec vitest run` → `Test Files 2 failed | 14 passed (16)`，`Tests 122 passed (122)`；两个新套件均因 `Cannot find module './tenuki-adapter.js'` 无法加载。
  - `pnpm run typecheck` → `src/rules/tenuki-adapter.test.ts(3,41): error TS2307`、`src/rules/tenuki-adapter-config.test.ts(56,41): error TS2307`，退出码 2。
- 绿测试（在 `f298ee7` 上）：
  - `pnpm verify` → 退出码 0（typecheck → vitest → clean → build 全通过）。
  - 计数：`Test Files 16 passed (16)`，`Tests 130 passed (130)`（122 既有 + 8 新增）。返修后同一命令为 `Tests 136 passed (136)`（见「审查返修」）。
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

## 审查返修（Round 1 → Round 2）

Round 1 审查（`.omo/reviews/WAVE-B-T02/r1.md`，model `opencode-go/deepseek-v4.1-flash`，针对 `3180083`）结论 CHANGES_REQUESTED：P0 0 / P1 1 / P2 1 / P3 1。逐条处理：

| 编号 | 处理 | 证据 |
| --- | --- | --- |
| P1 分歧后合法 pass 被当成 `game-over` 拒绝 | 已修复（`e0534b2`）：分歧时回滚末尾 pass 对并用接受过的动作重建引擎；结算前 tenuki 拒绝 pass 时走同一回滚路径，不再向仍为 `playing` 的状态回报 `game-over` | `settlement disagreement` 四条回归测试；返修轮红测试 `45b6f71` 在 `3180083` 上 2 failed |
| P2 认输后 `score()` 返回与 `outcome` 相反的 winner | 已修复（`e0534b2`）：认输终局下 `score()` 明确拒绝并提示读 `state.outcome`；按分数结算的终局仍正常返回 | `terminal score boundary` 两条回归测试 |
| P3 红测试提交信息里的字面 `\n` | 仅记录，不改写历史（团队规则禁止 amend）；`45b6f71` 起改用 `git commit -F <file>` | 本文件「偏离记录」 |

返修轮红测试（`45b6f71`，在未修复的 `3180083` 上运行）：

```text
pnpm exec vitest run src/rules/tenuki-adapter.test.ts
  -> Test Files 1 failed (1); Tests 2 failed | 8 passed (10)
  -> "accepts a pass after a disagreed settlement": consecutivePasses 2，下一手 pass 返回 game-over
  -> "rejects score() after a resignation": score() 返回 winner "user"，而 outcome winner 是 "deepseek"
```

修复前后探针（脚本 `/tmp/bt02-fix/probe.mjs`，导入 `pnpm build` 生成的 `lib/rules/tenuki-adapter.js`；before 在 `3180083` 构建上、after 在 `e0534b2` 构建上）：

```text
P1-SETTLE    before {"settled":false,"reason":"disagreement","state":{"status":"playing","consecutivePasses":2,...}}
             after  {"settled":false,"reason":"disagreement","state":{"status":"playing","toPlay":"user","moveNumber":0,"consecutivePasses":0,"lastMove":null}}
P1-PASS      before {"ok":false,"reason":"game-over","state":{"status":"playing",...}}
             after  {"ok":true,"state":{"status":"playing","toPlay":"deepseek","consecutivePasses":1,"lastMove":{"type":"pass","by":"user",...}}}
P1-PLAY-CTRL before ok:true / after ok:true（棋盘落子恢复在两条构建上都成立）
P2-SCORE-AFTER before {"returned":true,"winner":"user",...}（outcome winner 是 deepseek）
             after  {"returned":false,"error":"score is undefined after a resignation (game p2: deepseek wins by resignation); read state.outcome instead"}
```

返修后验证（`e0534b2`）：

- `pnpm verify` → 退出码 0；`Test Files 16 passed (16)`，`Tests 136 passed (136)`（130 + 6）。
- harness：`harness: 13 cases, methods: createGame, getState, inspectGroup, pass, play, resign, score, settle, failures: 0`（共享 harness 文件未改动）。
- 新增 6 条测试：分歧后 pass、分歧后落子、分歧回滚还原被否认前的快照、未经结算的第三手 pass、认输后 score 拒绝、按分数结算后 score 一致。
- 范围：只改 `src/rules/tenuki-adapter.ts` 与 `src/rules/tenuki-adapter.test.ts`；`src/rules/tenuki.d.ts`、契约、harness、pin 均未动。

## 限制与未验证

- 本机 Node **v26.10.0**，而 `package.json` 要求 `>=24.11.1 <25`；安装与 verify 只有 pnpm engine 警告。CI 固定 Node 24.11.1，本次**未在 CI 的 Node 24 运行**。
- CI 未运行：本票禁止 push/PR/merge，所有证据来自本地。
- 死子结算只验证了空 `deadStones` 路径；非空死子计分、提子/自杀/双活等 §31 夹具属 B-T04/B-T05，本票未实现也未断言。
- `classifyIllegal` 的 suicide 分支只有手动抽查，未进入提交的测试；superko 分支由负控覆盖。
- 分歧恢复的语义是本轮新增决定：被否认的两手 pass 视为被丢弃（`moveNumber`/`lastMove` 随之回退），恢复后的快照与走完收官前的快照逐字段相等；这一取舍已由测试与探针固定，但 Spec §25 只写“resume play”，没有规定 pass 计数与 moveNumber 的细节，B-T04 的完整结算夹具若要采用别的语义需回到 Spec。
- `score()` 在认输终局下是「明确拒绝」而不是返回结果：调用方必须读 `state.outcome`。这是 `ScoreResult` 形状无法表达认输终局的直接后果；若后续票需要终局统一的 score 视图，须改契约（本轮禁止）。
- `score` 的 `territory` 分解在“已按死子结算”的局面没有断言（B-T03/B-T04 范围）。
- 未做 tenuki 版本自动升级；未添加其它依赖。

## 已知缺陷

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| B-T02-EDGE-1 | P3 → P1（Round 1） | 分歧后（record 仍 playing、tenuki 已两连 pass）再请求 pass 被返回 `game-over`。 | 已修复（`e0534b2`），回归测试见「审查返修」 |
| B-T02-EDGE-2 | P2（Round 1） | 认输后 `score()` 仍算盘面，可能返回与终局 `outcome` 相反的 winner。 | 已修复（`e0534b2`）：认输终局明确拒绝，分数终局保持一致 |

## 已排除的假设

- 假设：需要自定义超级劫层。排除依据：B-S01 已证明 `koRule: "positional-superko"` 是 tenuki 一等选项，负控复现了重复局面拒绝；再加一层会违反 Spec §27。
- 假设：`resign` 必须交给 tenuki/棋盘处理。排除依据：Spec §26 明确 resign 是端口层终端动作、不要求 tenuki 计算或改动棋盘；实现只改状态与结果，harness 的“不改棋盘/不增 move number/终局后全部拒绝”用例通过。
- 假设：`inspectGroup` 需要 tenuki 的私有接口。排除依据：§29 允许基于当前权威棋盘的派生遍历；实现只用端口快照里的 stone 集合做 BFS。
- 假设：3x3 棋盘可做 area 负控。排除依据：契约 `BoardSize = 9 | 13 | 19`，不能传入 3；改用 9x9 一子局（area 计 1、territory 默认计 0）完成负控。

## 下一步

- 审查者按 Standards + Spec 两轴复核，重点看：显式配置是否真的到达引擎、tenuki 是否只出现在 `src/rules/tenuki-adapter.ts`、`getState` 不可变、resign 语义、`superko` 分类取舍；Round 2 另请重点核对分歧回滚（被丢弃的两手 pass 与 `moveNumber` 回退）和认输后 `score()` 的拒绝是否符合 Spec §25。
- B-T03/B-T04 可直接复用 `createTenukiGoRulesPort()` 写 area/komi/超级劫与提子/自杀/结算夹具（B-T05 汇总）。

## 不要做什么

- 不要在本分支添加 §31 全量夹具、UI、第二个规则权威或第二个超级劫层。
- 不要把 tenuki 对象写进公共类型或序列化 tenuki 内部状态。
- 不要运行 `git add .`；不要 push / 开 PR / merge（本票禁止）。

## 偏离记录

- 为运行测试在 worktree 内执行了 `pnpm install --frozen-lockfile`（仅还原锁文件依赖，未改 manifest/锁）。
- 红测试提交 `5edc45f` 的提交信息换行被 shell 转义成了字面 `\n`（Round 1 审查 P3 亦已指出）；因团队规则禁止 `amend`，未改写历史，特此记录（内容本身完整可读）。`45b6f71` 起的提交改用 `git commit -F <message-file>`，不再有该问题。
- 默认 vitest reporter 不打印 harness 的 `console.log`；查看逐例覆盖需加 `--reporter=verbose`。
