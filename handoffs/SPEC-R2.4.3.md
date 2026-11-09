# Handoff — Spec R2.4.3（Bridge 混合投递）

## 基线

- 分支：`docs/spec-r2.4.3-hybrid-bridge`（PR #113，合并 `f7b9951`），基线 `main` @ `f8bdd1e`
- 依据：主人 2026-11-06 批准的混合投递决定，任务书 `.omo/briefs/bridge-hybrid-delivery.md`
- 前置证据：`docs/validation/DSH_SYSTEM_PROMPT_CONTEXT_SEAM_VERIFIED.md`（context 接缝 FAIL）、
  `docs/validation/DSH_SYSTEM_PROMPT_SECTION_SEAM_PROBE.md`（section+variable PASS，PR #109）、
  PR #108（`agent.inject` 排除）

## 改动文件

| 文件 | 改动 |
|---|---|
| `docs/spec/SPEC_LEAN_V0.1_R2.4.3_VERIFIED.md` | 新增；只在 R2.4.2 上改文件头 Status/Version、§9.1、§39.6 |
| `AGENTS.md` | 现行 Spec 指针改到 R2.4.3（仅此一行） |
| `docs/context/DECISION_LOG.md` | 新增一行：混合投递决定，状态 `Approved contract change (owner 2026-11-06)`，权威含 R2.4.3 §9.1/§39.6、PR #108/#109 与 context 接缝记录 |

## 范围证明

```text
$ git diff --no-index docs/spec/SPEC_LEAN_V0.1_R2.4.2_VERIFIED.md docs/spec/SPEC_LEAN_V0.1_R2.4.3_VERIFIED.md
@@ -1,7 +1,7 @@        文件头 Status / Version
@@ -582,...  @@          §9.1 DSH-native delivery
@@ -1868,... @@          §39.6 Bridge delivery / prompt stability / call-volume smoke
```

没有第四处改动；R2.4.2 及更早 Spec 文件零改动；没有引入队列、事件总线、裁剪、
冷却定时器、epoch、focus lease 或 exactly-once。

## §39.6 的数字上限

`L = 296` 字符由渲染形状与 400 手合成序列的参数逐行推出：行正文 284 字符 + 12 个
换行。详见 Spec §39.6 与收尾报告。可执行断言在 D-T03 的
`src/bridge/delivery.test.ts` 与 `tests/integration/bridge-delivery/`。

## 验证

- `pnpm verify`（Node `v24.11.1`、pnpm `11.7.0`）：typecheck 通过，
  49 文件 / 580 测试通过，clean + build 通过。
- 对抗审查：见 PR 评论与 `.omo/reviews/bridge-spec/`。

## 未验证 / 风险

- Q7 token 成本（一次 section 值变化对 DeepSeek 缓存命中的实际影响）仍未测量：
  环境无 provider 凭据，付费调用不在本次授权范围。
- 多步工具回合内切换快照、resume 重放旧 system 文本两条路径未测量。
- 仓库里还有若干处仍写 R2.4.2 为现行 Spec（`PROJECT_STATUS.md`、`README.md`、
  票图页首、Baseline 第 221 行）。这些不在本次授权范围内，需另开对账票。
