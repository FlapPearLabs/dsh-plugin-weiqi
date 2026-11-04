# WAVE-D-T04 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/WAVE-D-T04`
- 基线 `main`：`2a2e5b4`
- 分支：`work/d-t04-companion-state`
- 红测试提交：`0210f21`
- 代码 HEAD：`758cb9a`
- 状态：Phase A 核心完成，`pnpm verify` 本地通过；未推送、未开 PR、未合并

## 做了什么

- 新增 `src/companion/state.ts`
  - `CompanionStateHolder<TCompiledPersona, TMoodState>`：持有唯一一份最新 `CompanionState`；
  - `update(patch)`：按字段替换（latest wins），返回新状态；不做 mood delta、clamp 或历史累积；
  - `current`：始终只暴露最新状态，旧快照不被原地修改。
- 新增 `src/companion/persistence.ts`
  - `saveLatestCompanionState(filePath, state)`：写 `{ version: 1, state }` JSON，先写 `${filePath}.tmp` 再 `rename`，目录自动创建；
  - `loadLatestCompanionState(filePath)`：首次保存前返回 `undefined`（`ENOENT`），版本不匹配抛错；
  - 只保留最新快照，不产生 journal、`.jsonl` 或历史文件。
- 新增 `src/companion/index.ts`：导出上述 holder、update 类型与两个持久化函数。
- 未修改 `src/contracts/companion.ts`、`src/contracts/index.ts` 或 `src/index.ts`：现有泛型契约已够用，且根入口不在本票允许范围内。

## 红 / 绿 / 回归

| 阶段 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 红 | `pnpm test` | 2 个 suite 失败：`Cannot find module './state.js'` 与 `Cannot find module './persistence.js'`；原有 6 files / 48 tests 仍通过 | `0210f21` |
| 绿 | `pnpm test` | 8 files / **56 tests passed** | `758cb9a` |
| 回归 | `pnpm verify` | typecheck PASS、56/56 PASS、clean+build PASS，exit 0 | `758cb9a` |

红测试覆盖：

- 最新更新获胜，旧快照不被修改；
- persona / mood 占位字段原样保留（引用不变）；
- mood 更新整体替换，超出常规范畴的值也原样存储（证明没有 reducer）；
- 状态形状固定为 4 个字段，连续更新不累积历史；
- 持久化 round-trip；
- 第二次保存覆盖第一次，目录中只有一个状态文件，文件键仅为 `state` + `version`；
- 首次保存前加载返回 `undefined`。

## 文件清单

- `src/companion/state.ts`
- `src/companion/state.test.ts`
- `src/companion/persistence.ts`
- `src/companion/persistence.test.ts`
- `src/companion/index.ts`
- `handoffs/WAVE-D-T04.md`

## 未验证

- **未接线到插件入口**：`src/index.ts` 未创建 holder 或决定持久化路径。路径选择与启动恢复属于集成票（如 WAVE-F-T01 crash/resume）；本票只交付可复用的 holder + 持久化原语。
- **未做真实进程重启验证**：单测在 vitest 中完成 round-trip，没有通过 DSH Profile 启动、退出、重启读取的端到端证据。
- **未在 Node `24.11.1` 下复跑**：本机 Node `26.10.0`，仅有 `Unsupported engine` 警告，typecheck/test/build 均通过。
- **未验证并发写入**：默认单写者；两个进程同时保存会争用同一个 `${filePath}.tmp`。V0.1 只有单 Companion 所有者，未加锁。

## 已知问题 / 需决定

- `loadLatestCompanionState` 只校验版本号，不校验 `attentionMode` 或 persona/mood 结构；契约刻意不冻结 persona/mood，运行时校验留给消费方或后续 schema freeze（WAVE-D-T05）。
- 未从包根 `src/index.ts` 重导出；消费方目前需从 `src/companion/index.js` 导入，是否提升为公共入口由后续集成票决定。
- `.tmp` 固定后缀：正常保存后无残留；若进程在 write 与 rename 之间被杀，会留下一个 `.tmp`，下次保存覆盖它。
