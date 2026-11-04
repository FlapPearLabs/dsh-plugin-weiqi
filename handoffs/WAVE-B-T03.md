# Handoff · WAVE-B-T03

- 状态：READY_FOR_REVIEW
- 分支：`work/b-t03-rules-scoring`
- 开发 worktree：`/Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-T03`
- 基线 BASE_SHA：`7b65210`（merge PR #83 后的 main，B-T02 已合并）
- 测试 commit：`8351b3d`
- 文档 commit：本文件所在提交（`docs: ...`）
- 待审代码 HEAD_SHA：`8351b3d`
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标（BL-GR-04 / Spec §25、§27）：用端口级确定性测试证明 pinned 栈确实呈现 Chinese area scoring、komi 7.5、positional superko；生产代码不依赖 tenuki 的 territory / simple / komi 0 默认值，也不出现原型里的 komi 6.5。
- 验收标准（逐条）：
  1. 固定残局的 area 分数等于手算值。
  2. komi 7.5 被精确施加。
  3. 重复局面在 positional superko 下被拒；同一循环在 simple ko 下合法（负控）。
  4. 生产代码不依赖 territory / simple / komi-0 默认值。
  5. 生产代码没有 6.5。
  6. `pnpm verify` 退出码 0。

## 改动

- 新增 `src/rules/tenuki-adapter-scoring-superko.test.ts`（+220 行，10 个用例）。
- 未改 `src/rules/tenuki-adapter.ts`：测试在当前实现上直接通过，未发现真 bug。
- 未改契约、依赖、UI、CI 或其它票的文件；`package.json` / `pnpm-lock.yaml` 无改动。

## 手算（固定 9x9 残局）

落子顺序：黑（user）填第 4 行 `y=4`，白（deepseek）填第 5 行 `y=5`，从 `x=0` 到 `x=8` 交替共 18 手，双方都不被提子；随后 user、deepseek 各 pass 一次，使残局收束（tenuki 在 `isOver()` 前不计空地，见「设计决定」）。

```text
第 0-3 行：36 个空点，只与黑第 4 行墙和棋盘边相邻 -> 黑空 36
第 4 行：9 个黑子
第 5 行：9 个白子
第 6-8 行：27 个空点，只与白第 5 行墙和棋盘边相邻 -> 白空 27

黑 = 9 子 + 36 空 + 0 贴目      = 45
白 = 9 子 + 27 空 + 7.5 贴目    = 43.5
胜者 user（黑）；差 |45 - 43.5| = 1.5
```

Territory scoring 下黑只有 36（不计子），所以断言 `black.total === 45` 同时区分了 area 与库默认值。

## 证据

- 基线（`7b65210`，未改文件，`pnpm install --frozen-lockfile` 后）：
  `pnpm exec vitest run` -> `Test Files 24 passed (24)`，`Tests 272 passed (272)`。
- 绿（`8351b3d`）：
  `pnpm verify` -> `EXIT=0`；`Test Files 25 passed (25)`，`Tests 282 passed (282)`
  （基線 272 + 新增 10；typecheck -> vitest -> clean -> build 全通过）。
- 新增用例清单（`pnpm exec vitest run src/rules/tenuki-adapter-scoring-superko.test.ts --reporter=verbose`，10/10 绿）：
  1. 残局 area 分数 = 手算：`black {stones 9, territory 36, komi 0, total 45}`、
     `white {stones 9, territory 27, komi 7.5, total 43.5}`、`winner user`、`margin 1.5`。
  2. `total = stones + territory + komi` 双边成立。
  3. 同一残局重放结果完全一致（确定性）。
  4. 空盘 white 总分恰为 7.5、black 0、`margin 7.5`，且不等于 6.5。
  5. 残局中 white 盘面点（子+空）为 36，总分 = 36 + 7.5。
  6. 端口层重复局面：`reason === 'superko'`，拒绝后状态与拒绝前完全相等，随后 pass 仍被接受。
  7. simple ko 负控：同一 27 手循环在 `koRule: 'simple'` 下 `isIllegalAt(0,1) === false` 且落子被接受。
  8. 源码扫描自检：确实遍历到 `tenuki-adapter.ts` / `contracts/rules.ts`，文件数 > 20（防空遍历假绿）。
  9. 生产源码（`src/**/*.ts`，排除 `*.test.ts`）不含 `6.5`。
  10. 两处 `new Game({...})`（`createGame`、`replayHistory`）都显式传
      `scoring: FROZEN_RULES.scoring` / `koRule: FROZEN_RULES.koRule` / `komi: FROZEN_RULES.komi`，
      且 `FROZEN_RULES` 字面量为 `'area'` / `'positional-superko'` / `7.5`。

## 变异证据（均临时修改后已 `cp` 还原，工作区复核干净）

| 变异 | 结果 | 代表断言 |
| --- | --- | --- |
| 删除两处 `new Game` 里的三行显式配置 | 6 failed / 4 passed | `expected undefined to be 'area'`；`expected undefined to be 7.5`；重复局面被接受 |
| `scoring: FROZEN_RULES.scoring` -> `'territory'` | 3 failed / 7 passed | `expected 'territory' to be 'area'`；残局 white 盘面点 27 而非 36 |
| `komi: FROZEN_RULES.komi` -> `0` | 5 failed / 5 passed | `white.total` 0 而非 7.5；`total = stones + territory + komi` 不变式破裂 |
| `koRule: FROZEN_RULES.koRule` -> `'simple'` | 2 failed / 8 passed | `expected true to be false`（重复局面被接受） |

每次变异只改 `src/rules/tenuki-adapter.ts`，还原后 `git status --short` 无残留，并重跑 `pnpm verify` 得 `EXIT=0`。

## 设计决定

- **残局必须收束后才读分**：tenuki `Game.prototype.territory()` 在 `!isOver()` 时返回空数组，因此 `score()` 在终局前只计活子、不计空地。测试按 Spec §25 的「两 pass -> 结算」时序先 pass 两次再读分；只断言分数，不调用 `settle`，结算/死子归 B-T04。
- **唯一直接使用 tenuki 的地方是 simple-ko 负控**：生产路径仍然只经 `GoRulesPort`；负控直接构造 `new Game({koRule:'simple'})`，用于证明端口层的拒绝来自劫规则而不是别的限制（与 B-S01 记录同法）。
- **源码守卫防止默认值回潮**：断言两处 `new Game` 构造点都显式传三个冻结值，并扫描生产源码无 `6.5`；同时断言源码扫描确实找到了目标文件，避免空遍历导致的假绿。
- **未改适配器**：没有发现需要修复的实现缺陷；`komi: 0` 只出现在黑方 `ScoreBreakdown`（黑方贴目恒为 0），不是引擎配置。

## 未验证 / 风险

- 未推送、未开 PR、未跑 CI（任务约束禁止）。CI 结论待合并流程给出。
- 本机 Node `v26.10.0` 与 `engines: ">=24.11.1 <25"` 不符，`pnpm` 仅打印 WARN；CI 使用仓库固定版本，B-S01 记录同样按 `EXPECTED_NODE` 覆盖。
- 观察项（不在本票范围，交 B-T04 / E-T01 评估）：`port.score()` 在未收束局面（tenuki 未 `isOver()`）只计活子、不计空地；最终分应在两次 pass / 结算之后读取。本票未改该语义。

## 复现命令

```bash
cd /Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-T03
pnpm install --frozen-lockfile
pnpm exec vitest run src/rules/tenuki-adapter-scoring-superko.test.ts
pnpm verify
```
