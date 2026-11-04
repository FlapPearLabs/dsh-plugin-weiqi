# Handoff · WAVE-D-S01-inject-probe

- 状态：READY_FOR_REVIEW
- 分支：task/d-s01
- 基线 BASE_SHA：1b1e612836fd3a8528c92764701767a0f54bcf34
- 待审代码 HEAD_SHA：80674c2
- 工作树：`dsh-plugin-weiqi-wt/task-d-s01`（未 push，未开 PR）
- 遵循契约：`~/.agents/engineering/CONTRACT.md`

## 目标与验收

- 目标：按 WAVE-D-S01 票面 `FAIL: record; fallback agent.inject; note D-T03 impact`，
  对 `agent.inject` 做真实可执行探针，判断它能否满足“下一自然请求只看到最新快照”。
- 验收标准：
  1. 给出 `agent.inject` 在 pinned DSH 上是否存在及 API 形状。
  2. 给出 A0→B1 后下一自然请求看到 A0 / B1 / 两者都在的可执行证据。
  3. 给出是否产生额外 model step / 持久化消息、同值是否重复物化。
  4. 给出对 WAVE-D-T03 的影响结论。
  5. 探针代码 + 可跑命令 + 原始输出，或如实的 CI 路径说明。
  6. `docs/validation/DSH_AGENT_INJECT_SEAM_PROBE.md` 记录状态、依据、原始 trace、D-T03 影响。

## 已完成

- 定位到本地 pinned DSH 检出：commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，
  包线 `0.1.1-rc.2`，依赖已安装。
- 新建 8 个实验的探针 fixture，真实跑 pinned `agent-loop` / `agent` /
  `system-prompt` / `session` / `llm` / `tools` / `scope` 实现：**8/8 passed**。
- 记录结论：`agent.inject` **不能**作为 §39.6 latest-only 的回退接缝。
- 冻结文件零改动（`git diff` 对 TICKET_GRAPH / CURRENT_IMPLEMENTATION_BASELINE /
  `docs/spec/**` 为空）；未改 `src/**`；未碰 PR #64。

## 改动

- `.github/workflows/agent-inject-gate.yml`（新增 66 行）
- `docs/validation/DSH_AGENT_INJECT_SEAM_PROBE.md`（新增 210 行）
- `tests/upgrade-gates/agent-inject/agent-inject.spec.ts`（新增 383 行）
- `tests/upgrade-gates/agent-inject/run-agent-inject.sh`（新增 94 行）
- 范围外改动：无

## 证据

- 原始 trace（逐字，详见记录文档）：

```text
DSH_INJECT_PROBE C-latest-only-fails-durable-accumulation {"requests":2,"turns":2,"steps":2,"durable":["WORK_SNAPSHOT=A0","WORK_SNAPSHOT=B1"],"requestTwoA0Count":1,"requestTwoB1Count":1,"requestTwoTexts":["WORK_SNAPSHOT=A0","start","ack-1","WORK_SNAPSHOT=B1","next"]}
DSH_INJECT_PROBE F-mid-turn-injection-extra-step {"requests":2,"turns":1,"steps":2,"requestOneHasN1":0,"requestTwoHasN1":1,"durableNotices":["GAME_NOTICE=N1"]}
DSH_INJECT_PROBE H-dt03-smoke-zero-wake-but-unbounded-delivery {"beforeNatural":{"status":"idle","requests":0,"turns":0,"steps":0,"pending":20},"requestsAfter":1,"turnsAfter":1,"stepsAfter":1,"durableNoticeCount":20,"requestNoticeCount":20,"requestHasNewest":1,"requestHasOldest":1}
```

- 探针执行命令（本地实跑）：

```sh
cp tests/upgrade-gates/agent-inject/agent-inject.spec.ts \
   "$DSH_PINNED_ROOT/packages/core/agent-loop/tests/agent-inject.spike.spec.ts"
cd "$DSH_PINNED_ROOT"
./node_modules/.bin/vitest run --no-file-parallelism --reporter=verbose \
   packages/core/agent-loop/tests/agent-inject.spike.spec.ts
```

- 探针结果：`Test Files 1 passed (1)` / `Tests 8 passed (8)`。
- 探针后 pinned 检出 `git status --porcelain` 为空（fixture 已清理）。
- CI 门禁命令（严格版本，需 Node v24.11.1 + pnpm 11.7.0）：

```sh
DSH_PINNED_ROOT=/path/to/pinned-deepseek-harness \
TRACE_LOG=/tmp/agent-inject-trace.log \
bash tests/upgrade-gates/agent-inject/run-agent-inject.sh
```

- 仓库回归：`pnpm run typecheck` 通过；`pnpm run test` 478 passed。
- 证据文件：`docs/validation/DSH_AGENT_INJECT_SEAM_PROBE.md`。

## 结论（给 D-T03）

- 零评估唤醒：满足。20 次 idle inject 产生 0 request / 0 turn。
- 下一自然请求只见最新快照：**不满足**。A0 已进入持久 `user/message` 历史，
  B1 再 inject 后下一请求同时含两者；重复同值每次都重新物化。
- 运行中注入会强制同一 turn 多一个 model step / request。
- pending 阶段可用公开 `agent.inbox.remove/replace` 合并，但已 claim 的历史不可移除。
- 因此 `agent.inject` 只能做一次性被动事实上下文，不能做反复更新的 latest-value 投递；
  D-T03 继续 BLOCKED，D-S01 记 FAIL，需按冻结权威升级：

```text
ESCALATION_REQUIRED
```

## 限制与未验证

- 本地记录运行使用 Node `v26.10.0`（DSH `engines` 允许 `^22.19.0 || >=24.0.0`），
  未使用门禁要求的 `v24.11.1`；因此 `run-agent-inject.sh` 的严格版本预检未被本地端到端执行。
- CI workflow 已按现有 `system-prompt-context` 门禁模式备好，但尚未在 CI 跑过；
  首次 CI 结果才是最终环境证据。
- 未验证 Node v24.11.1 与 v26.10.0 之间是否存在与本探针相关的行为差异；从 pinned 源码看
  相关逻辑不含版本分支，但未做跨版本对照执行。

## 已知缺陷

| ID | 级别 | 说明 | 状态 |
| --- | --- | --- | --- |
| F1 | P2 | 严格 runner 只在 CI 可端到端执行，本地缺 Node 24.11.1 | 未验证 |

## 已排除的假设

- 假设：`agent.inject` 会替换上一份上下文 ｜ 排除依据：C/D/E/H 显示 append-only。
- 假设：pending 合并能解决 latest-only ｜ 排除依据：G 显示 claim 后不可移除。
- 假设：idle inject 会唤醒 ｜ 排除依据：A/H 显示 0 request / 0 turn。

## 下一步

- 建议：接受 D-S01 的 FAIL 记录与 `ESCALATION_REQUIRED`，由主人/工程组长决定下一步：
  要么放宽/改写 §39.6 交付契约，要么另开机制（历史裁剪/非持久上下文接缝）并走 Spec 变更。
- 最小实验（如获授权）：在 pinned AgentLoop 上验证“注入前 remove 旧 pending + 不重复注入”
  能否满足连续自然请求，但已 claim 的历史仍需 DSH 层裁剪，属于新机制。

## 不要做什么

- 不要修改 `docs/planning/TICKET_GRAPH_V1.2.1.md`、
  `docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md`、`docs/spec/**`。
- 不要碰 PR #64 的分支，不要 push，不要开 PR。
- 不要把本探针的“8/8 passed”误读为 `agent.inject` 通过验收；它只证明观察到的行为可复现。
- 不要在 `src/**` 增加 Bridge 投递或任何新机制。

## 偏离记录

- 与模板的偏离：工作树路径用仓库相对名而非本机绝对路径（公共仓库不写本机绝对路径）。
- 与门禁脚本的偏离：**已闭合**。后续在 Node v24.11.1（官方 darwin-arm64 发行包，非系统 Node 26）
  下按门禁要求重跑 `run-agent-inject.sh`，含版本相等预检，全部通过：
  命令 `DSH_PINNED_ROOT=<pinned checkout> PATH=<node-24.11.1>/bin:$PATH bash tests/upgrade-gates/agent-inject/run-agent-inject.sh`
  → exit 0，`Test Files 1 passed (1)`、`Tests 8 passed (8)`，8 条 `DSH_INJECT_PROBE` 观测与本文档记录一致。
  原“本地绕过版本检查”的说明仅适用于更早那一次运行，不再是本提交的未验证项。
- 独立审查：由未参与实现的审查者在 detached worktree 上复跑并逐条核对，结论为该 FAIL 记录可作为
  D-S01 的正式证据；剩余 P3 为 spec 依赖 pinned 树的 `mock-adapter.ts` 与 workflow 尚未在 CI 跑过。
