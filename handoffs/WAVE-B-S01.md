# WAVE-B-S01 交接包（r1 审查修复轮）

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-S01`
- 分支：`spike/b-s01-tenuki-conformance`
- 审查基线（r1 reviewed HEAD）：`0a64ec6`
- 修复后代码 HEAD：`cfe93e8`
- 修复提交：`2b27859`（test：CI 断言 PASS 标记 + artifact 缺失改 error）、`cfe93e8`（fix：runner 成功路径触发 `finish` 并清理）
- 交接包提交：见 `git log -- handoffs/WAVE-B-S01.md`（`docs:` 单独一笔）
- r1 结论：CHANGES_REQUESTED，P0 0 / P1 1 / P2 2 / P3 1

## 本轮修了什么

1. **P1（r1 唯一 P1）**：`TRACE_LOG` 模式把 `main` 放进管道子 shell（`main 2>&1 | tee "$TRACE_LOG"`）。函数**正常 return** 不会触发子 shell 里注册的 `EXIT` trap，所以成功路径上 `finish()` 不执行：上传的 artifact 缺 `FINAL RESULT: PASS (tenuki@0.3.1 conformance)` 终态行，`cleanup()` 也不跑，每次绿灯泄漏一个临时安装目录。修复：`main()` 末尾在 `final_result=PASS` 之后显式 `exit 0`，由子 shell 退出触发 trap。FAIL 路径原本就走 `exit 1`，trap 已触发，行为未变。
2. **回归门禁（P1 的测试）**：`.github/workflows/tenuki-conformance-gate.yml` 新增 `Assert terminal PASS marker in trace` 步骤，要求 trace 非空、含 `FINAL RESULT: PASS (tenuki@0.3.1 conformance)`，且该标记必须是**最后一行**（只 grep 不够：截断的 trace 里若有别处的同名文本会漏）。
3. **P2（指定要修的那条）**：artifact 上传 `if-no-files-found: warn` → `error`，与 `session-ownership-gate.yml` / `request-token-hard-cap-gate.yml` 一致。
4. **文档**：`docs/validation/TENUKI_CONFORMANCE_VERIFIED.md` 补一句：门禁断言 trace 末行为 PASS 标记，artifact 缺失即失败。

未改动：tenuki 版本/完整性常量、conformance spec、`src/` 任何生产代码、`package.json`。

## 复现证据（修复前，提交 `0a64ec6`）

命令（工作树内，先 `pnpm install --frozen-lockfile`，否则 `node_modules/vitest` 不存在）：

```bash
TRACE_LOG=/tmp/tenuki-trace-before.log EXPECTED_NODE=$(node --version) \
  bash tests/upgrade-gates/tenuki-conformance/run-tenuki-conformance.sh
```

结果：**exit 0**（模块测试 6/6 全过），但 trace 尾部停在 Vitest 汇总，没有终态行；`grep -c 'FINAL RESULT: PASS'` = `0`：

```text
TRACE installed tenuki@0.3.1 package.json sha1=d0cd7c688ccbfed6284df287267241179dae3525
TRACE running conformance spec

 RUN  v4.1.8 /Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-S01

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  12:31:51
   Duration  131ms (transform 10ms, setup 0ms, import 15ms, tests 8ms, environment 0ms)
```

（`tail -n 1` 该 trace 得到空行，末行不是标记。）同一轮泄漏证据：系统临时目录下含 `tenuki-0.3.1.tgz` 的 `tmp.*` 目录数在修复前为 4 个（`12:23:03`、`12:23:14`、`12:23:33` 来自 r1 审查的运行，`12:31:48` 来自本次复现），即成功路径从未清理。

## 修复后证据（提交 `cfe93e8`）

同一命令改为 `TRACE_LOG=/tmp/tenuki-trace-after.log`：

```text
TRACE installed tenuki@0.3.1 package.json sha1=d0cd7c688ccbfed6284df287267241179dae3525
TRACE running conformance spec

 RUN  v4.1.8 /Users/songshiyao/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-B-S01

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  12:32:45
   Duration  99ms (transform 10ms, setup 0ms, import 15ms, tests 8ms, environment 0ms)

FINAL RESULT: PASS (tenuki@0.3.1 conformance)
```

- exit 0，`tail -n 1` = `FINAL RESULT: PASS (tenuki@0.3.1 conformance)`，`grep -c` = `1`。
- 清理生效：含 `tenuki-0.3.1.tgz` 的 `tmp.*` 目录数 **4（run 前）→ 4（run 后）**，没有新增泄漏。
- FAIL 路径未变（`EXPECTED_NODE=v0.0.0`）：exit 1，trace 末行 `FINAL RESULT: FAIL (tenuki@0.3.1 conformance)`。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红（复现 P1） | 上文 before 命令 | exit 0 但 trace 无 `FINAL RESULT: PASS`，scratch 残留 | `0a64ec6` |
| 绿（修复后） | 同上，after 路径 | trace 末行 PASS，scratch 无新增 | `cfe93e8` |
| FAIL 路径回归 | `EXPECTED_NODE=v0.0.0` | exit 1，末行 FAIL | `cfe93e8` |
| 门禁断言自测 | 用工作流同样的 `assert_step` 跑两份 trace | before = `FAIL_EXPECTED`，after = `PASS_EXPECTED` | `cfe93e8` |
| 脚本语法 | `bash -n run-tenuki-conformance.sh` | 通过 | `cfe93e8` |
| 工作流 YAML | `ruby -ryaml` 解析 | 7 个 step 顺序正确，`if-no-files-found=error` | `2b27859` |
| 全量回归 | `pnpm verify` | typecheck PASS、6 files / **48 tests passed**、clean+build PASS，**exit 0** | `cfe93e8` |

## 未验证

- **未在 GitHub Actions 跑过**：本轮按要求不推送、不开/改 PR，所以新增的门禁断言尚未在云端 Ubuntu 24.04 / Node `v24.11.1` 上执行；它是否真的能拦下截断产物，目前只有本地 `assert_step` 对 before/after 两份 trace 的对照结果支撑。下次推送后 CI 会首次真正执行该断言。
- 本地是 Node `v26.10.0`（仓库 `engines` 要 `>=24.11.1 <25`），全部运行都靠 `EXPECTED_NODE=$(node --version)` 覆盖，未在 `v24.11.1` 下复跑。

## 遗留（本轮范围外，未修）

- r1 的另一条 **P2**：`scratch_dir=$(cygpath -w ...)` 与后续正斜杠拼接在部分 MINGW/MSYS 下可能异常。仓库没有 Windows gate 在跑，本轮任务清单也未列入。
- r1 的 **P3**：`./node_modules/vitest/vitest.mjs` 硬编码，建议改 `pnpm exec vitest`；需要确认 CI 里 pnpm hoisting 与 `--no-file-parallelism` 参数透传，属独立小改。
- 本地系统临时目录仍留着 4 个修复前泄漏的 tenuki scratch 目录（含 `tenuki-0.3.1.tgz`，合计约几十 MB），是修复前行为的证据，未删除。

## 需决定

- r1 的剩余 P2 / P3 是否随本票一并修（我的建议：另开一笔小改，避免和 P1 修复混在一个提交里；P3 改完需在 CI 再验一次）。
- 推送 / 开 PR / 合并：按本轮任务约束**未做**，等主人或 Code 验收后决定。
