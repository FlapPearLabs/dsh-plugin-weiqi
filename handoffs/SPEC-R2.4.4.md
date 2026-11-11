# Handoff — Spec R2.4.4（界面目标改为官方 DSH 桌面 App）

## 基线

- 分支：`docs/spec-r2.4.4-desktop-target`（本地分支），基线 `origin/main` @ `9c65afc`
- 状态：本地提交，未 push、未开 PR、未合并
- 依据：主人 2026-11-11 决定「可以不支持浏览器只支持dsh插件桌面端」，随后确认「改成桌面端」；
  任务书 `.omo/briefs/spec-r2.4.4-desktop-target.md`
- 前置：Spec R2.4.3（PR #113，合并 `f7b9951`）。R2.4.3 及更早的 Spec 文件零改动。
- r2（2026-11-11）：按独立审查意见小修（P2-1/P2-2 决策日志、P2-3 暂缓清单范围、两处 P3 措辞、
  README / PROJECT_STATUS 措辞、本交接包修正），逐条记录见 `.omo/reports/spec-r2.4.4-desktop-target.md` 的 r2 节。

## 改动文件

| 文件 | 改动 |
|---|---|
| `docs/spec/SPEC_LEAN_V0.1_R2.4.4_VERIFIED.md` | 新增；只在 R2.4.3 上改文件头 Status/Version/Target、# 3. Non-Goals 一条、§33 P0、§33 Desktop、§34（目标 + `Pinned-version note`）、§39.7、§41 暂缓清单一条、R2-13 |
| `AGENTS.md` | 现行 Spec 指针改到 R2.4.4（仅此一行） |
| `docs/context/DECISION_LOG.md` | 新增一行（紧贴表格末行，diff 为 +1 / -0）：界面验收目标改为官方 DSH 桌面 App；并注明只取代旧行「DSH Web and V4 are the future production UI baseline」中「DSH Web」的那一半，V4 设计参考不受影响；状态 `Approved contract change (owner 2026-11-11)`；权威 R2.4.4 §33/§34/§39.7；注明钉住版本未变、桌面接缝未验证 |
| `README.md` | 状态行 R2.4.3 → R2.4.4，并注明 `not yet verified on the desktop App` |
| `PROJECT_STATUS.md` | 状态行 R2.4.3 → R2.4.4，并注明 `not yet verified on the desktop App` |

## 范围证明

```text
$ git diff --no-index -U0 docs/spec/SPEC_LEAN_V0.1_R2.4.3_VERIFIED.md docs/spec/SPEC_LEAN_V0.1_R2.4.4_VERIFIED.md
@@ -3,3 +3,3 @@        文件头 Status / Version / Target
@@ -127 +127 @@         # 3. Non-Goals（桌面专属工作 / TUI）
@@ -1462 +1462,3 @@    §33 P0
@@ -1529 +1531,3 @@    §33 Desktop（目标句）
@@ -1531 +1535 @@      §33 Desktop（No separate desktop UX）
@@ -1543 +1547 @@        §34 目标句
@@ -1545 +1549 @@        §34 smoke 列表前句
@@ -1554,0 +1559,4 @@    §34 末尾 Pinned-version note（新增）
@@ -1930 +1938,5 @@      §39.7 UI integration smoke
@@ -2051 +2063 @@        §41 Phase C 暂缓清单一条
@@ -2097 +2109 @@        R2-13 UI 一句话
```

11 个 hunk 全部落在任务书列出的位置上，没有第 12 处改动；r2 的措辞修正只改这些 hunk 内部的
行（# 3. Non-Goals、§33 Desktop、§39.7、§41），没有新增 hunk。`Web` 的三处非界面含义
（第 937、960、1849 行：联网搜索 / `no web` / 反作弊清单）未动；版本钉住
（`b150a551`、`0.1.1-rc.2`、Node 24.11.1、pnpm 11.7.0、Vitest 4.1.8）未动。

## 未验证 / 风险

- 桌面 App 上的 `conversation.view` 接缝**未验证**。已有证据取自钉住的 `0.1.1-rc.2`
  的 Web 客户端测试运行时（`tests/upgrade-gates/conversation-view/`，jsdom +
  `@deepseek-ai/dsh-client-test-runtime`）；Spec §39.7 已写明须在桌面目标上重新证明，
  证明前不得视为已验证。
- 桌面壳是否用与 Web 相同的方式加载插件客户端代码：未知。兼容性体检
  `.omo/reports/desktop-0.2.2-compat-survey.md` 不在本次范围，本文件不引用其结论。
- DSH 仍钉在 `0.1.1-rc.2`（`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`）；桌面目标
  `0.2.2-rc.1`（upstream tag `dsh-v0.2.2-rc.1`，`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`）
  的迁移是独立步骤，需要自己的门禁证据（含 cooperative-yield fixture 重跑）。
- 仓库里仍有若干处把 R2.4.3（或更早的 R2.4）写成 Spec 权威（见下节），本次按任务书边界未改。

## 验证

- r1：`pnpm install --frozen-lockfile --offline` 通过（62 包复用本地 store）；`pnpm verify`
  （Node `v24.11.1`、pnpm `11.7.0`）typecheck 通过，57 文件 / 627 测试通过、2 skipped，
  clean + build 通过，退出 0。
- r2：在官方 Node `v24.11.1` 下重跑 `pnpm verify`：typecheck 通过；57 文件 / 627 测试通过、
  2 skipped；clean + build 通过；退出 0。`git diff origin/main -- docs/context/DECISION_LOG.md`
  为 +1 / -0。改动文件仍只有新 Spec、`AGENTS.md`、`README.md`、`PROJECT_STATUS.md`、
  `DECISION_LOG.md`、本 handoff；R2.4.3 及更早 Spec 零改动；绝对路径 grep 无输出。
- `git diff --name-only origin/main` 只有：新 Spec、`AGENTS.md`、`DECISION_LOG.md`、
  `README.md`、`PROJECT_STATUS.md`、本 handoff。
- 任务书最后一条本机路径扫描（`git grep` 查绝对路径前缀）：无输出。

## 后续要做的事（不在本次）

1. Baseline 与票图文字对账：以下位置仍按 R2.4.3 / DSH Web 表述，需要按 R2.4.4 的新目标重述，
   本次按任务书边界未改：
   - `docs/planning/TICKET_GRAPH_V1.2.1.md:6`（`Current Spec Authority: … R2.4.3`）、票图
     Wave E「Harness Web UI」文字（第 539 行）、E-T01 的验收文字；
   - `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` 的 BL-UI-02（写作 Spec §32/§33 (R2.4.2)）、
     BL-UI-03（Desktop wrapper，DEFERRED）、BL-UI-04（DSH Web seam，`VERIFIED_FACT_NOT_INTEGRATED`），
     以及第 205 行附近「DSH Web conversation.view extension seam」小节；
   - `docs/roadmap/BUILD_PHASES.md:45-47`（Wave E 仍写 DSH Web experience）；
   - `README.md:70`（Foundation boundary 仍把 desktop wrappers 列为后续）；
   - `docs/context/PROJECT_CONTEXT.md:11`（Truth sources 指向早已陈旧的
     `SPEC_LEAN_V0.1_R2.4_VERIFIED.md`，比 R2.4.3 还旧）。

   **为什么对账必须紧跟本次合并**：合并后 §34 要求在桌面目标上重新证明 UI 接缝，而基线
   BL-UI-04 仍是 `VERIFIED_FACT_NOT_INTEGRATED`；`AGENTS.md` 同时规定
   「Verified facts cannot be re-spiked」与「Any Ticket / Baseline / Spec contradiction →
   `ESCALATION_REQUIRED`」。只要基线还按 DSH Web 记、Spec 已要求在桌面目标重证，任何按基线
   排的 UI 票一开工就会撞上矛盾并被迫停摆。Phase A 的 §34 出口最终取决于钉住版本迁移
   （见下条）：迁移完成前 §34 无法关闭。

2. 桌面 App `0.2.2-rc.1` 兼容性体检结论落盘后，决定钉住版本迁移票；迁移必须先跑
   cooperative-yield fixture，任何需要改本 Spec 其他条款的迁移都要再走一次修订。
3. 在桌面目标上重做 §34 / §39.7 的 UI capability smoke，重新证明 `conversation.view`。
