# Handoff — WAVE-D-S01 收尾（PR #64，Closes #28）

## 基线

- 分支：`spike/d-s01-systemprompt-section-fallback`，合并 `origin/main`（`f8bdd1e`）之后
- 票：WAVE-D-S01 / issue #28（合并 `bbc3d97`），Baseline BL-BR-03
- 权威：R2.4.3 §9.1 / §39.6（PR #113，混合投递决定）

## 结论

`ctx.systemPrompt.context` 不能承担 Go 方向（更新的值会让旧值留在模型可见历史里），
`agent.inject` 已被 PR #108 排除，`agent.ctx.systemPrompt.section` + `variable` 满足
latest-only / 无唤醒 / 不污染消息历史。因此投递按方向拆开：Go 用 section + variable，
Work 用 context（追加式，DSH 标记被取代，两次请求之间的多次变化合并成一条）。

BL-BR-03：`NEEDS_SPIKE` → `VERIFIED_FACT_NOT_INTEGRATED`，投递实现归 WAVE-D-T03。

## 改动文件

| 文件 | 改动 |
|---|---|
| `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md` | BL-BR-03 改写为混合接缝并置为 `VERIFIED_FACT_NOT_INTEGRATED`；BL-BR-05 指向 R2.4.3 上限；保留 main 上 BL-BR-01/02/04 的 `IMPLEMENTED_VERIFIED` 行；BL-BR-03 移出 spike 候选表 |
| `docs/planning/TICKET_GRAPH_V1.2.1.md` | D-S01 条目标为已完成并写清混合结论；D-T03 条目改为双方向交付并写入 §39.6 数字上限；BL-BR-03 覆盖行与统计随之更新 |
| `docs/validation/DSH_SYSTEM_PROMPT_SECTION_SEAM_PROBE.md` | 唯一保留的 section 接缝记录，补 CI 门禁与混合结论两节 |
| `docs/validation/DSH_SYSTEMPROMPT_SECTION_SEAM_VERIFIED.md` | 删除（内容并入上一条，仓库只留一份说法） |
| `.github/workflows/system-prompt-section-gate.yml` | 保留并入 main 的 CI 门禁，触发路径改指唯一记录 |
| `tests/upgrade-gates/system-prompt-section/*` | 采用 main 上已审查版本（fixture 通过 `systemPrompt.variable` 取值，`run-mutation-check.sh` 的锚点仍有效） |

## 冲突解决说明

合并 `main` 时三处冲突：

1. Baseline：取 main 的 BL-BR-01/02/04 行，BR-03 按混合决定重写，BR-05 指向 R2.4.3。
2. section fixture 与 runner：取 main 版本。本分支原有一套 13 条断言的 fixture，但它把值
   直接拼进 section 文本；R2.4.3 依赖「值必须经 variable 传入」，main 版本正是这样写的，
   且 `run-mutation-check.sh` 的变异锚点锚在它上面。
3. 验证文档：保留一份。

## 验证

- `pnpm verify`（Node `v24.11.1`、pnpm `11.7.0`）：49 文件 / 580 测试通过。
- pinned 门禁实测：
  `DSH_PINNED_ROOT=../dsh-plugin-weiqi-wt/DSH-PINNED bash tests/upgrade-gates/system-prompt-section/run-system-prompt-section.sh`
  → 6/6 通过，pinned 树跑完 `git status --porcelain` 为空。
- 对抗审查：见 `.omo/reviews/bridge-ds01/`。

## 未验证 / 已知问题

- 仓库里仍有多处把 R2.4.2 写作现行 Spec（`PROJECT_STATUS.md`、`README.md`、票图页首、
  Baseline 第 221 行）。超出本次授权，另开对账票。
- 票图汇总计数在本次改动前就与 Baseline 有出入（如 BL-GR-03 已 `VERIFIED_FACT_NOT_INTEGRATED`
  但汇总行仍写 `NEEDS_SPIKE`）；本次只校正 BL-BR-03 相关行，其余留作对账票内容。
- 探针未覆盖：多步工具回合内快照变化、resume 重放旧 system 文本、`complete` 段与压缩交互。
