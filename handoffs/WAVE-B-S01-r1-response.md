# WAVE-B-S01 — r1 审查回应

审查记录：`.omo/reviews/WAVE-B-S01/r1.md`（main 检出内，reviewed HEAD `0a64ec6`）
回应时分支 HEAD：`cfe93e8`
裁决：接受 P1、接受指定的 P2、接受 P3 判断但不在本轮修（范围外）；见下逐条。

## P1 — `run-tenuki-conformance.sh` 成功路径不触发 `finish`

**接受，已修（`cfe93e8`）。** 审查的根因判断正确：`main 2>&1 | tee "$TRACE_LOG"` 让 `main` 在管道子 shell 里跑，函数体正常 return 不触发该子 shell 的 `EXIT` trap，于是成功路径既无终态行也不清理。

修复用审查给的最小方案：`main()` 里 `final_result=PASS` 之后加 `exit 0`。没有重构成"main 不进管道"，因为那会改变 `TRACE_LOG` 未设置时的输出路径与退出码传播方式，超出这条缺陷的范围。

证据（`handoffs/WAVE-B-S01.md` 有完整尾部）：

- 修复前：exit 0，trace 的 `grep -c 'FINAL RESULT: PASS'` = 0，末行是空行；含 `tenuki-0.3.1.tgz` 的临时目录 4 个。
- 修复后：exit 0，末行 `FINAL RESULT: PASS (tenuki@0.3.1 conformance)`，临时目录 4 → 4（无新增）。
- FAIL 路径（`EXPECTED_NODE=v0.0.0`）：exit 1，末行 `FINAL RESULT: FAIL (tenuki@0.3.1 conformance)`，与修复前一致。

## 回归门禁（P1 的测试）

**新增（`2b27859`）。** `.github/workflows/tenuki-conformance-gate.yml` 加 `Assert terminal PASS marker in trace`：

```bash
test -s "$trace"
grep -q 'FINAL RESULT: PASS (tenuki@0.3.1 conformance)' "$trace"
test "$(tail -n 1 "$trace")" = 'FINAL RESULT: PASS (tenuki@0.3.1 conformance)'
```

只要求"含标记"不够——截断的 trace 只要别处出现过该字符串就会漏；所以额外断言标记是**最后一行**。用同一段断言对修复前/后两份 trace 自测：before = 失败，after = 通过。云端 CI 尚未跑（本轮未推送），此项在交接包里列为"未验证"。

## P2（第一条）— `if-no-files-found: warn`

**接受，已修（`2b27859`）。** 改为 `error`，与 `session-ownership-gate.yml`、`request-token-hard-cap-gate.yml` 对齐。

## P2（第二条）— `cygpath -w` 与正斜杠混用

**接受判断，本轮不修。** 原因：本轮任务清单只列了 P1、回归门禁与 `if-no-files-found`；仓库目前没有 Windows runner 执行这个 gate，改它属于独立的可移植性改动，混进 P1 修复会扩大 diff。已记入交接包"遗留"。

## P3 — 硬编码 `./node_modules/vitest/vitest.mjs`

**接受判断，本轮不修。** 同上属范围外；换 `pnpm exec vitest` 需要确认 CI 里 `--no-file-parallelism` 的参数透传和版本选择，建议单开一笔并在 CI 验证。

## 审查提出的"未能验证"项

审查说未能在 GitHub Actions 云端跑。本轮同样未跑（按要求不推送、不开/改 PR）：本地 macOS arm64 + Node `v26.10.0`，靠 `EXPECTED_NODE` 覆盖，全部证据来自本地真实执行。CI 断言的真实拦截能力要等下次推送后首次 CI 才能证明。
