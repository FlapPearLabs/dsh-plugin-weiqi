# Handoff · C-T10 真实模型标定

> 文中的提交 SHA 指维护者本地分支 `task/c-t10-cal` 的逐步提交，未推送到公开仓库；公开仓库里这些内容合并为一个提交。

- 状态：**第 3 轮已跑**（真实、付费、主人批准）；免费修正已在第 3 轮数据上验证
- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`<worktree>`（原始本机路径已替换）
- 分支：`task/c-t10-cal`（未 push、未开 PR、未合并）
- 集成分支基线：`79ee61a`（`origin/main`，已 `git merge` 合入，无冲突）
- 代码 HEAD：`e71ee1d`（第 3 轮运行时的代码；本轮的免费修正提交在其后）
- 任务报告：`<repo>/.omo/reports/c-t10-round3-record.md`（未提交）

## 现状

三轮真实校准都已完成。第 3 轮跑在修好的框架（每局计数、live 路径申请配置上限）
上，计数误报消失，只剩 1 局因 `maxTryMoves` 用完失败：

| 轮次 | 已发出 | 已结算 | 未结算 | 完成 / 失败 | 失败构成 |
|---|---:|---:|---:|---|---|
| 第 1 轮（4000 上限） | 80 | 77 | 3 | 1 / 23 | 17 计数误报 + 3 步数用完 + 3 网络 |
| 第 2 轮（配置 16000，实际 8192） | 80 | 79 | 1 | 1 / 23 | 22 计数误报 + 1 网络 |
| 第 3 轮（实际 16000） | 81 | 81 | 0 | 23 / 1 | 1 预算用完：T13 `maxTryMoves (6/6)` |

第 3 轮细节（以 `docs/validation/C-T10-LIVE-CALIBRATION-RAW.json` 为准）：

- 时间：2026-11-09 15:50:19 – 16:19:04（墙钟 1723.7 s）；81 个请求全部 HTTP 200；
  24 局 = 23 完成 + 1 失败 + 0 预算停。
- 花费：¥1.7531 门禁估算（$0.246911 × 7.1），未结算 0；不是账单。三轮合计约 ¥4.24
  （含前两轮未结算预留 ¥0.19）。
- 输出截断：2 个请求 `finish=length`，都在 T15（打劫题），都顶到 16000。
- 长尾：打劫题 T13 用满 6 次试下后失败；T14 耗时 166.7 s；T15 耗时 486.8 s、
  输出 51231 token。
- 候选值（**仅建议，未应用**，`src/` 生产默认值未动）：

| 字段 | 候选 |
|---|---:|
| `perRequestMaxTokens` | 32000（16000 上限被顶满，×2 外推） |
| `maxTurnTokens` | 79360 |
| `maxModelSteps` | **8**（完成局最多 5 步；T13 失败局按 7 个请求记 7 步，再 +1 headroom） |
| `maxInspectCalls` | 5 |
| `maxTryMoves` | **7**（T13 用完 6/6，候选被下限抬到 7，并带截断警告） |

## 三轮文件在哪

- 第 1 轮：`docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-RAW-run1-4000cap.json`
  （sha256 `4c05ada4a649de3db33893e761abc6add0452a26cd04f1ce0da00ab4e6891175`）。
- 第 2 轮：`.../C-T10-RAW-run2-16000cfg-8192eff.json`
  （sha256 `929981c3ca51e9d98901e13983706a8dbebdeb7697fbd536a6f24146aa4a5741`）和
  `.../C-T10-LIVE-CALIBRATION-run2.md`
  （sha256 `dc57ef979b388a7220e8e1a8b24967d3afb30d195c6736bd72dee67e725c8e92`）。
  两者从 `74b1558` 原样取出，字节未改。
- 第 3 轮：主数据 `docs/validation/C-T10-LIVE-CALIBRATION-RAW.json`
  （sha256 `140170be7857efd7a0cc099c4de6f4207265efbcba82fa2b706f7f9921f42eaa`），同名副本
  `.../C-T10-RAW-run3-16000cap.json`（同上 sha），运行日志
  `.../full-live-5-run3-16000cap.txt`
  （sha256 `82e817d693b7bb6925a705905b64f73502682da309de8f7ae879e48aecdd2979`），
  以及由当前渲染器从主 RAW 生成的 `docs/validation/C-T10-LIVE-CALIBRATION.md`。
- 证据日志（`.../full-live-*.txt` 等 33 个文件）里的本机路径已替换为 `<worktree>`
  占位符，所以部分文件的 sha256 与本地原文件不同；原始内容在本地分支 `task/c-t10-cal`。
  三轮 RAW JSON 不含路径，哈希未变。

## 本轮免费修了什么（无真实/付费请求）

1. **失败分类**：凡 `Go turn budget exhausted: <field> (n/n)` 都归为
   `budget exhausted: <field>`（含 `maxModelSteps`）；live 路径的
   `did not commit ... within N model steps` 仍归 `step exhausted`，不再落进 `other`。
2. **推荐值下限**：某字段在任何一局被用完，候选至少是「当时上限 + 1」，并在
   Warnings 里写明观测值被上限截断、需提高上限重测；其余字段公式不变。
   第 3 轮 `maxTryMoves` 因此从 5 变成 7。
3. **类型检查**：修掉 `bypass[1].trim()` 的 TS2532；新增
   `tsconfig.benchmark.json`（`pnpm exec tsc -p tsconfig.benchmark.json`），
   覆盖 `tests/benchmark`，未接入 `pnpm verify` 或 CI。
4. **记录分工**：主 RAW 归第 3 轮；离线核对脚本和 record 测试改读 EVIDENCE 里的
   第 1、2 轮副本，数值断言未改。第 3 轮由 record 测试照常校验主 RAW。
5. **步数观测与取整**：失败局记录里的 `modelSteps` 是占位 0（不是测量值），推荐算法
   改用它的请求数记步（一个请求一步），并在报告 observed basis 里写明来源；最大步数
   来自失败局时再加 1 步 headroom。因此第 3 轮 `maxModelSteps` 由 5 改为 8（推导值，
   未实跑）。`maxTurnTokens` 被「上限 + 1」抬高后也按 256 取整，不再出现 64001 这类
   脱离网格的值。

## 还没验证

1. 免费修正只验证了分类、推导和类型；没有发任何真实或付费请求。
2. 32000 单次上限没有跑过；16000 仍被顶满 2 次，尾部没看到。
3. 候选值未经独立审查，也未写进 `src/` 生产默认值。
4. 本机默认 Node 26.10.0，验收用 `../toolchain/bin` 的 24.11.1；engine 警告在改动前
   就存在。

## 下一步（主人决定）

1. **是否用 32000 上限再跑一轮**（或只对打劫题加跑几局）：预计 ¥1.5–2.0，未实测；
   门禁 full ¥6.16 / smoke ¥0.5。重跑前仍要先归档当前主 RAW。
2. **打劫题长尾能否接受**：T13 用满 6 次试下失败，T15 单局近 8 分钟。这是产品体验
   决定，不是算法缺陷。
3. 候选值经独立审查后才谈冻结；`maxTryMoves 7` 只是「不低于失败局上限」的下限，
   不是对 7 是否够用的证明。

环境陷阱（与之前相同，重跑者必须知道）：

- `<home>/.hermes/.env` 不能直接 source（有未加引号的空格路径），脚本只 `grep` 读取
  `OPENCODE_GO_API_KEY`，不 echo、不落盘。
- agent 环境导出的空 `SSL_CERT_FILE` 会让 TLS 在请求发出前失败，脚本已 `unset`。
- 直连这个端点时偶尔会连接超时；脚本通过 `NODE_USE_ENV_PROXY` 使用环境里已有的
  代理设置。

## 改动范围（本轮免费修正）

```text
docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-RAW-run2-16000cfg-8192eff.json  归档
docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-LIVE-CALIBRATION-run2.md        归档
docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/C-T10-RAW-run3-16000cap.json          第 3 轮副本
docs/validation/C-T10-LIVE-CALIBRATION-EVIDENCE/full-live-5-run3-16000cap.txt         第 3 轮日志
docs/validation/C-T10-LIVE-CALIBRATION-RAW.json                                       第 3 轮数据
docs/validation/C-T10-LIVE-CALIBRATION.md                                             第 3 轮报告（重渲染）
docs/validation/verify-c-t10-correction.mjs                                           读归档副本
tests/benchmark/live-calibration-record.test.ts                                       主 RAW 照常校验
tests/benchmark/live-calibration.ts                                                   分类 + 下限
tests/benchmark/live-calibration-report.test.ts                                       红/绿测试
tsconfig.benchmark.json                                                               tests/benchmark 类型检查
docs/validation/C-T10-LIVE-CALIBRATION-CORRECTION.md                                  仅开头指引
handoffs/C-T10-calibration.md                                                         本交接
```

`src/`、`docs/spec/`、公共契约、CI、三轮原始数据内容均未改动。
