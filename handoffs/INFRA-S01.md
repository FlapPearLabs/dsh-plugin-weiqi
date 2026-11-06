# INFRA-S01 交接包

- 仓库：`FlapPearLabs/dsh-plugin-weiqi`
- 工作树：`~/Documents/ChatGPT/dsh-plugin-weiqi-wt/INFRA-S01`
- 基线 `main`：`77dd581`（分支创建点）
- 分支：`spike/infra-s01-github-source-install`
- 状态：Spike 已执行，结论 **FAIL**；证据记录与交接包已提交；未推送、未开 PR、未合并
- 结论文件：`docs/validation/DSH_GITHUB_SOURCE_INSTALL_SPIKE_FAIL.md`

## 结论

`dsh plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` 在 pinned DSH
上 **解析 ✓、克隆 ✓、安装 ✓、Bundle 对账 ✓、激活 ✗**。

- 命令退出码 `0`，包被装进干净 `web` profile；
- `dsh.profile.bundles` 自动加入 `@flappearlabs/dsh-plugin-weiqi`；
- `--dump-config` 组合里出现 `companion-go` 行；
- 落盘目录只有 `README.md`、`cordis.patch.yml`、`package.json`，**没有 `lib/`**；
- `profile-mount-smoke.mjs` 前四条 TRACE 断言通过，真实 AgentLoop 挂载时报
  `ERR_MODULE_NOT_FOUND ... /@flappearlabs/dsh-plugin-weiqi/lib/index.js`，退出码 `1`。

根因（均有证据）：本包不声明 `prepare` 脚本；`lib/` 被 `.gitignore` 忽略、仓库
里 0 个受控文件；`files` 只收 `cordis.patch.yml` 与 `lib/**/*.js`。pinned DSH 的
`apps/cli/reference/README.md` 明确写着「git 托管的插件在安装期靠 `prepare` 构建」。
本包没有该脚本，所以 `allowBuilds` 也无济于事。

## 执行环境与产物

| 项目 | 值 |
|---|---|
| DSH 提交 | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`git rev-parse HEAD` 实测） |
| DSH 包版本 | root / agent / agent-loop / session / llm / cli 均 `0.1.1-rc.2` |
| Node | `v24.11.1`（官方 darwin-arm64 分发） |
| pnpm | `11.7.0`（确认跑）；另有一次环境 `pnpm 10.33.0` 的跑法，结论相同 |
| DSH 检出 | `~/Documents/ChatGPT/dsh-plugin-weiqi-wt/DSH-PINNED`（仓库外，未提交） |
| 运行痕迹 | `~/Documents/ChatGPT/dsh-plugin-weiqi-wt/trace-INFRA-S01/`（仓库外，含全部原始日志） |

## 命令与真实结果

| 阶段 | 命令 | 结果 |
|---|---|---|
| DSH 依赖 | `pnpm install --frozen-lockfile` | 首次因 registry 超时失败；加 `npm_config_fetch_timeout=180000` / `fetch_retries=5` 重跑 exit `0` |
| DSH 构建 | `pnpm run build:lib:host` | exit `0`，`apps/cli/lib/bin.js`、`packages/boot/app-boot/lib/index.js` 生成 |
| 源安装 | `node apps/cli/lib/bin.js plugin --profile web add github:FlapPearLabs/dsh-plugin-weiqi` | exit `0`（`Done in 11.1s using pnpm v11.7.0`） |
| 组合 | `node apps/cli/lib/bin.js --profile web --dump-config` | exit `0`，含 `- id: companion-go` |
| 挂载断言 | `DSH_SOURCE_DIR=… DSH_HOME=… DSH_PROFILE_NAME=web DSH_PROFILE_DUMP=… node tests/profile-install/profile-mount-smoke.mjs` | exit `1`，`ERR_MODULE_NOT_FOUND … lib/index.js` |
| 仓库回归 | `pnpm verify` | exit `0`（13 files / 115 tests，typecheck + build 通过） |

## 附带发现（写进证据记录，未扩大范围）

- `github:` 形式不带 ref，实际解析到默认分支 HEAD：lockfile 记录
  `codeload.github.com/.../tar.gz/82552a48566ca52a5eb573f498e5bb5a32e19428`，
  该提交就是当时的 `origin/main`（PR #77）。
- `dsh plugin` 转发的是 `PATH` 上的 pnpm；profile 清单没有 `packageManager`
  字段，所以版本由环境决定（首次落到 `pnpm 10.33.0`，确认跑用 `11.7.0`），
  两者行为一致。

## 文件清单

- `docs/validation/DSH_GITHUB_SOURCE_INSTALL_SPIKE_FAIL.md`（新增）
- `handoffs/INFRA-S01.md`（新增）

未改动：`package.json` 发布字段、任何安装代码、`src/`、`tests/profile-install/`、
`docs/planning/CURRENT_IMPLEMENTATION_BASELINE.md`。

## Baseline 建议（未直接改 Baseline 文件）

`BL-PKG-06` 保持不升级（绝不能写 `IMPLEMENTED_VERIFIED`）。建议行：

- Current Evidence：在本证据记录，写明解析/克隆/安装/对账通过、激活因缺
  `lib/index.js` 失败；
- Current State：`NOT_IMPLEMENTED`（现有 `NEEDS_SPIKE` 已过期：路径已实测，能力不存在）；
- Gap：git 源安装没有构建步骤，`prepare` 缺失且 `files` 不含源码；
- Recommended Handling：`SMALL_INFRA_TICKET`。

沿用既有惯例，Baseline 行由合并后的 `docs:` 同步提交落地，本分支不预先改写。

## 未验证

- 没有试「加 `prepare` 脚本」的变体（属于打包行为变更，超出本票范围，需另开票）。
- 没有试 `allowBuilds`（没有构建脚本可放行，无意义）。
- 没有启动完整 Web profile（未跑 DSH 前端 `pnpm run build`）；激活用仓库自带的
  真实 AgentLoop 挂载断言衡量，即票面指定的断言方式。
- 未处理 profile 的 peer 警告（缺失 `cordis` / `dsh-agent` / `dsh-llm` / `dsh-session`）；
  挂载断言自带这些核心包，失败点仅为 `lib/index.js`。
- 仅在 `darwin arm64` 本机跑过一次，未在 CI / Windows 复跑。

## 需要决定

- 是否把「GitHub 源安装」降级为安装文档里的非推荐路径（fallback = 已由
  `BL-PKG-05` 验证的 packed tarball），并为「git 源安装构建路径」另开一张
  `SMALL_INFRA_TICKET`。
