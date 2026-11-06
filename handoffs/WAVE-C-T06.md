# Handoff · WAVE-C-T06

- 状态：READY_FOR_REVIEW
- 分支：`work/c-t06-turn-budget-contract`
- 开发 worktree：`<dev worktree>`（本机绝对路径不入库，仓库为公开仓库）
- 基线 BASE_SHA：`8249c12f91e992ed7e562c47f8eea25a3f2e66da`
- 红测试 commit：`d27641a3f74521d1ea1777794c768d48789a9820`
- 初始绿代码 commit：`9610851bbf793580da6f1ffeb556fc10b1b3c6dd`
- r1 审查 HEAD_SHA：`dd6d8d01a48b83ef9cf1a752877819307733c3a1`（9610851 + 本文件）
- r1 P2 修复 commit：`b2d12c60347096ffe11dc1442c2832434f384ef4`
- 审查 worktree：由审查者填写
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标（BL-BUD-01：NOT_IMPLEMENTED → IMPLEMENTED_VERIFIED）：按 Spec §22 定义 `GoTurnBudget` 契约，并提供可注入值的配置加载器；不声称、不写入任何生产数值。
- 票据验收标准（逐条）：
  1. 类型层面契约测试。
  2. 可注入配置能加载显式 fixture 值。
  3. 文档明确说明这些值不是生产标定（BL-BUD-06 / WAVE-C-T10 拥有标定）。
  4. `pnpm verify` 退出码 0。

## 已完成

- 新增 `src/contracts/budget.ts`：`GoTurnBudget` 类型、`GO_TURN_BUDGET_FIELDS` 键表、`GoTurnBudgetField` 键联合。
- 新增 `src/budget/config.ts`：`loadGoTurnBudget(source: unknown)`、`GoTurnBudgetConfigError`、`GoTurnBudgetConfigIssue`；无任何隐式默认值。
- `src/contracts/index.ts` 追加契约导出（包根经 `src/index.ts` 的 `export *` 一并暴露）。
- 新增 `src/contracts/budget.test.ts`（3 个测试）与 `src/budget/config.test.ts`（7 个测试，r1 P2-1 修复后 10 个），均为 TDD 红测试先行。

## 字段清单（Spec §22，逐字）

```ts
type GoTurnBudget = {
  maxModelSteps: number
  maxInspectCalls: number
  maxTryMoves: number
  perRequestMaxTokens: number
  maxTurnTokens: number
}
```

- 五个字段全部必填，无可选字段、无 `Partial`。
- `perRequestMaxTokens`（§22.1 单请求硬上限）与 `maxTurnTokens`（§22.2 回合上限）保持两个独立字段，不合并。
- `maxInspectCalls` / `maxTryMoves` 分别对应 `go.inspect_*` / `go.try_move` 的 §22.3 工具计数。

## 改动

- 文件与行数（相对 BASE_SHA）：
  - `src/contracts/budget.ts` +36（新）
  - `src/budget/config.ts` +76（新）
  - `src/contracts/index.ts` +2
  - `src/contracts/budget.test.ts` +54（新）
  - `src/budget/config.test.ts` +92（新）
- 范围外改动：无。未改 `package.json` / `pnpm-lock.yaml`，未加依赖，未动主检出、C-T07/C-T08/C-T10 范围或 CI。

## 关键契约决定

- **加载器只接受显式注入值**：五个字段必须由调用方给出；缺字段直接报错，不回落任何默认值。行为测试用 `{}` 之外的“缺一个字段”证明不会补齐。
- **校验规则（r1 P2-1 后）**：每个字段必须是整数并满足各自的整数下界（`MINIMUM_BY_FIELD`）。`maxModelSteps` 下界为 1；`maxInspectCalls` / `maxTryMoves` / `perRequestMaxTokens` / `maxTurnTokens` 下界为 0。负数、小数、`NaN`、`Infinity`、字符串、布尔、`null` 一律拒绝（非零下界字段报 `not-positive-integer`，零下界字段报 `not-non-negative-integer`）。
- **为什么 0 是合法值**：Spec §22 只把字段类型定为 `number`，§22.4 的耗尽语义是「到达上限即拒绝」，因此计数类上限取 0 就是「该操作本轮禁止」，两个 token 上限取 0 就是「不发请求」，都是合法配置；C-T07 的零预算边界测试需要它。`maxModelSteps: 0` 仍被拒绝：没有任何模型步的回合产生不了 Go 认知，那不是预算。
- **本加载器只管整数下界**：0 上限在运行时的具体行为（拒绝什么、如何记账）由 WAVE-C-T07（BL-BUD-02/04）决定，本票不发明 enforcement 策略。
- **聚合报错**：一次抛出一个 `GoTurnBudgetConfigError`，`issues` 列出全部问题（`missing` / `not-positive-integer` / `not-non-negative-integer` / `not-an-object`），消息同时包含所有缺失与非法字段；测试断言全部问题一次返回，避免逐个试错。
- **非对象来源**：`undefined` / `null` / 字符串 / 数字 / 数组 / 函数均以 `not-an-object` 拒绝。
- **忽略无关键**：加载器只读 §22 五个键，允许上层把预算嵌入更宽的配置对象；测试断言返回对象只含五个键。这是记录在案的取舍（严格拒绝未知键会把 C-T07 之后更宽的配置对象挡掉）。
- **返回新对象**：返回由校验后的值新建的对象，不与输入共享引用；只做普通对象返回，不调用 `Object.freeze`（避免与“不冻结生产数值”的措辞混淆）。
- **加载器位置**：放在 `src/budget/config.ts`，未从 `src/contracts/index.ts` 导出（契约桶只导出类型与字段常量）。`package.json` 的 exports 未改，因此本票不新增公共包导出路径；C-T07 在包内通过相对导入消费，若需对外暴露应作为显式契约变更处理。

## 证据

- 基线（`8249c12`，未改动时）：红灯运行中既有套件 `Test Files 14 passed`、`Tests 122 passed`。
- 红测试（`d27641a`）：
  - `pnpm test` → `Test Files 2 failed | 14 passed (16)`，`Tests 122 passed (122)`；失败原因为 `Error: Cannot find module './budget.js'` 与 `Cannot find module '../contracts/budget.js'`（两个新套件 0 test）。
  - `pnpm typecheck` → 退出码 2：`TS2307`（两个新套件无法解析模块）、`TS2305: Module '"./index.js"' has no exported member 'GoTurnBudget'`。
- 绿测试（`9610851`）：
  - `pnpm verify` → 退出码 0（`typecheck` → `test` → `clean` → `build` 全部通过）。
  - 计数：`Test Files 16 passed (16)`，`Tests 132 passed (132)`（122 既有 + 10 新增）。
  - 新增用例（`pnpm exec vitest run src/contracts/budget.test.ts src/budget/config.test.ts --reporter=verbose`）：`Test Files 2 passed (2)`，`Tests 10 passed (10)`。
- 类型契约的牙齿（活体验证）：
  - 临时从 `GoTurnBudget` 与 `GO_TURN_BUDGET_FIELDS` 删除 `maxTryMoves` 后 `pnpm typecheck` → 退出码 2，报 `TS2344`：`Type '"maxModelSteps" | ... | "maxTryMoves"' does not satisfy ...`，即 `expectTypeOf<keyof GoTurnBudget>()` 失败；同时三处 fixture 报 `TS2353`。
  - 用备份复原后 `md5 -q src/contracts/budget.ts` 与删除前一致（`78918178a6430d894e84608103d04ea4`），`pnpm typecheck` 退出码 0。
- 措辞检查（无生产数值被冻结）：
  - `grep -nE '[0-9]' src/contracts/budget.ts src/budget/config.ts`：生产模块中除注释里的 § 编号与 `MINIMUM_BY_FIELD` 的下界字面量（`0` / `1`，不是预算数值）外，只有 5 处与 0 的下界/长度比较（`value < MINIMUM_BY_FIELD[field]`、`issues.length > 0`、`missing.length > 0`、`notPositive.length > 0`、`notNonNegative.length > 0`），没有任何预算数值。（r1 审查在旧 HEAD 上数到 4 处，那是修复前的数字；修复后新增一个原因分桶，故为 5 处，结论不变。）
  - `src/contracts/budget.ts` 头部声明：字段名由 Spec 冻结、数值不冻结，生产值由 BL-BUD-06 / WAVE-C-T10 从基准得出。
  - `src/budget/config.ts` 的 `loadGoTurnBudget` 文档：无隐式默认，注入值在 C-T10 之前都只是测试配置。
  - 两个测试文件的 fixture 均命名为 `NON_PRODUCTION_FIXTURE`，并显式写明“NOT production calibration / BL-BUD-06 / WAVE-C-T10 owns benchmark-derived values”。
- P2 修复轮（`b2d12c6`，r1 之后）：
  - `pnpm verify` → 退出码 0：typecheck → `Test Files 16 passed (16)` / `Tests 135 passed (135)`（132 既有 + 3 新增）→ clean → build。
  - `pnpm exec vitest run src/contracts/budget.test.ts src/budget/config.test.ts --reporter=verbose` → 退出码 0，`Test Files 2 passed (2)`、`Tests 13 passed (13)`（3 + 10）。
  - 新增用例（`src/budget/config.test.ts`）：`accepts a zero cap for the counted operations and the token caps`、`still rejects negative and non-integer values on zero-accepting fields`、`rejects a zero model-step budget because a turn still needs one model step`。
  - `pnpm run typecheck` → 退出码 0（Node v26.10.0，engine 警告与首轮相同）。
- 证据日志：本机 `/tmp/budget.ts.bak`、`/tmp/budget.md5`（临时文件，未入库）。

## 限制与未验证

- 未接执行路径：本票只定义契约与加载器；计数、扣减、耗尽拒绝属 WAVE-C-T07（BL-BUD-02/04），本票没有运行时消费者。
- 未接 §38 基准：所有 fixture 数值都只是注入示例，未做任何延迟/token/步数测量；生产数值标定归 WAVE-C-T10（BL-BUD-06）。
- 未定义 boost（C-T08）、无 bypass 测试（C-T09）。
- 加载器未从包出口暴露：`package.json` exports 未改，`src/index.ts` 未改（均在本票允许范围外）；外部消费者目前只能经 `@flappearlabs/dsh-plugin-weiqi/contracts` 拿到 `GoTurnBudget` 类型与 `GO_TURN_BUDGET_FIELDS`。
- 未加校验“上限必须 ≥ 某下限”或跨字段关系（如 `perRequestMaxTokens <= maxTurnTokens`）：Spec 未要求，且会提前固化尚未标定的关系；留给 C-T07/T10 在有证据时决定。
- 分支基于 `8249c12`，`origin/main` 已前进 2 个 docs-only 提交（B-T01 合并后同步）；未 rebase/merge（禁止项），合并方需自行决定合入方式。
- 本机 Node v26.10.0，而 `package.json` 声明 `>=24.11.1 <25`；`pnpm` 有 engine 警告，CI 固定 Node 24.11.1。本票证据来自本机。

## 已知缺陷

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| P2-1 | P2 | 加载器对五个字段统一要求正整数，挡住合法的 0 预算（r1） | 已修 `b2d12c6`：按字段设整数下界，计数与 token 字段允许 0 |
| P2-2 | P2 | `handoffs/WAVE-C-T06.md` 写入本机绝对路径（r1） | 已修：改为 `<dev worktree>` 占位，本文件不再包含本机绝对路径 |

## 已排除的假设

- 假设：加载器应提供“生产默认值”，调用方不传就取默认。排除依据：票据与 BL-BUD-06 明确要求数值来自基准，冻结默认即触发 `ESCALATION_REQUIRED`；因此缺字段必须报错。
- 假设：预算数值可以为 0 或小数 —— 已修正（r1 P2-1）。原排除依据「0 会让回合无法开始」只对 `maxModelSteps` 成立；§22.4 的耗尽语义下工具计数与 token 上限取 0 都是合法的「禁止该操作 / 不发请求」。现规则：五个字段都必须是整数，`maxModelSteps` ≥ 1，其余四个 ≥ 0；小数与负数仍然拒绝。
- 假设：`maxTurnTokens` 与 `perRequestMaxTokens` 可合并为一个 token 字段。排除依据：§22.1 的单请求硬上限与 §22.2 的回合上限语义不同，合并会让长单请求绕过回合预算。
- 假设：应拒绝配置中的未知键。排除后决定忽略：C-T07 之后的配置对象可能更宽，严格拒绝会造成不必要的耦合；契约只承诺读取五个键。

## 下一步

- 唯一假设：C-T07 可以拿 `GoTurnBudget` 直接做运行时计数与耗尽判断，并用 `loadGoTurnBudget` 加载注入配置。
- 最小实验：C-T07 在 enforcement 边界用 `loadGoTurnBudget({ ...fixture })` 装载预算，跑一条“单次请求上限 + 回合耗尽 + 事后不再分析”的确定性序列；若需要加载器新增能力（例如读取嵌套配置段），应作为契约变更处理。
- 需要谁做什么：审查者按 Standards + Spec 两轴复核；C-T07 执行者消费本契约。

## 不要做什么

- 不要在本分支写入任何生产预算数值或默认值（需 §38 基准证据，归 C-T10）。
- 不要实现计数/扣减/耗尽/事后分析禁令（C-T07）、boost（C-T08）、benchmark（C-T10）。
- 不要把 fixture 数值复制进生产代码或文档当作建议默认值。
- 不要 `git add .`；不要 push/PR/merge（本票禁止）。

## 偏离记录

- 与 AGENTS.md 的偏离：为运行测试，在 worktree 内执行了 `pnpm install --frozen-lockfile`（仅还原锁文件依赖，`pnpm-lock.yaml` 与 `package.json` 无改动，未新增依赖）。
- `src/contracts/index.ts` 只追加导出，不改既有导出顺序或内容。
