# Companion Go · 设计文档 V4

> 对应实现：`companion-go-apple-style-v4.html`（单文件，零依赖，浏览器直接打开）
> 上游约束：`COMPANION_GO_UI_DESIGN_FREEZE_V1.md`（结构冻结）· dsh-all-in Holdem UX 模式 · Apple DESIGN.md（视觉 token，来源 VoltAgent/awesome-design-md）

---

## 1. 设计定位

Companion Go 是 DeepSeek Harness 内的嵌入式围棋对局视图。用户的第一感受必须是"我还在用 Harness"，其次才是"这里有一张棋桌"。

三条不妥协的原则：

1. **Harness 原生外壳**：白底、侧栏、Tabs，不另起游戏 App 风格
2. **棋盘是绝对主角**：工作信息、模式、音效全部让位，右栏和控制条承接
3. **Apple 级质感**：克制用色、真实材质、磨砂层级，杜绝廉价感装饰

---

## 2. 设计来源

### 2.1 结构（冻结，不可漂移）

来自 `COMPANION_GO_UI_DESIGN_FREEZE_V1.md`：

- 双栏：左侧主舞台（Stage）+ 右侧信息栏（Rail）
- 信息层级：Level 1 棋盘与对局 > Level 2 控制条 > Level 3 背景上下文（Work / Jobs / Summary）
- Level 3 禁止侵入棋盘区；控制项固定在棋盘下方，不漂浮

### 2.2 对局空间（dsh-all-in Holdem UX 模式）

- **Spatial Presence**：椭圆共享桌面，双方对坐，座位压桌沿
- **Actor Highlight**：轮到谁，谁的座位亮蓝色光环；DeepSeek 思考时头像瓷贴外圈扩散脉冲
- **Self Identity**：用户永远在下方座位，白棋
- **Settlement**：终局弹出毛玻璃结算卡（winner banner 模式），附 New game 按钮

### 2.3 视觉（Apple DESIGN.md）

| Token | 值 | 用途 |
|---|---|---|
| canvas | `#ffffff` | 主画布 |
| parchment | `#f5f5f7` | 侧栏、交替区块（Apple 招牌米白） |
| pearl | `#fafafc` | 幽灵按钮 / mini-stat 填充 |
| text | `#1d1d1f` | 主文字 |
| sub / faint | `#6e6e73` / `#86868b` | 次级 / 弱化文字 |
| primary (link) | `#0066cc` | 链接、着色态图标 |
| primary-focus | `#0071e3` | 主按钮、focus ring、激活态 |
| green / red | `#34c759` / `#ff3b30` | 成功 / 警示（Apple 系统色） |
| hairline | `rgba(0,0,0,.08)` | 所有描边，禁止深边线 |

**DeepSeek 品牌色**：瓷贴渐变 `#6f92ff → #4a6ef5 → #3556e8`，鲸鱼反白。

---

## 3. 字体与排版

- 字体栈：`SF Pro Text / SF Pro Display, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC`
- 标题：600 字重 + 负字距（-0.01em ~ -0.02em）
- 正文 13px；次级 11–12px；标签 9.5–10px 全大写、字距 .07em
- 所有计数（Move / Captures / 计时）使用 `font-variant-numeric: tabular-nums`，防止数字跳动

---

## 4. 组件规范

### 4.1 通用规则

- 按钮、Pill、下拉、Toast 一律胶囊形（`border-radius: 980px`）
- 按压反馈用 `transform: scale(.97)`，不换色（Apple press 行为）
- 键盘聚焦：`outline: 2px solid #0071e3`
- 磨砂玻璃：`background: rgba(255,255,255,.72-.92)` + `backdrop-filter: saturate(180%) blur(20px)`
- 阴影三档：卡片 `sh-card`（轻）/ 浮层 `sh-float`（中）/ 结算弹窗 `sh-pop`（重），除此之外禁止投影

### 4.2 品牌位（Sidebar）

- DeepSeek 鲸鱼 SVG `<symbol id="ds-whale">`：椭圆鲸身 + 尾鳍 + 白眼微笑，全局 `<use>` 复用
- iOS 风格圆角瓷贴（radius 26% 连续曲率），内高光 + 品牌蓝渐变
- 字标 `deepseek` 小写 600 字重，下挂小号全大写 `HARNESS`

### 4.3 外壳三段

1. **Sidebar（256px, parchment）**：品牌位 → New Session 胶囊 → Workspace/Session 列表（active 态 `rgba(0,0,0,.07)`）→ 底部 All in / Settings
2. **Topbar（磨砂）**：标题 + Move 计数 + Agent 状态点（思考时蓝色脉冲）+ Reset / Close
3. **Tabs**：Chat / **Go** / Trajectory，激活 tab 蓝色下划线
4. **Subbar（磨砂）**：四个摘要 Pill——Go 轮次 / Work 状态 / Mode / Sound，只展示摘要不承担详情

### 4.4 舞台（Stage）

- 椭圆桌：`aspect-ratio 1.42/1`，径向渐变 `#fff → #f5f5f7`，内嵌 14px 白色内圈，外投影 20px/44px/6%
- **座位卡**：磨砂白（.82 透明度）、radius 18px、hairline 描边；`.active` 态 = `#0071e3` 描边 + 3px 蓝色泛光
- DeepSeek 头像 = 鲸鱼瓷贴；用户头像 = 浅灰圆形 "YOU"
- **Thinking 胶囊**：顶部居中，三点跳动动画 + 秒数计时
- **结算横幅**：全桌毛玻璃遮罩 + 居中白卡（radius 22px，弹性入场 `scale(.97)→1`）

### 4.5 棋盘（SVG，viewBox 600×600）

- 19×19，边距 30、格距 30；边线 1.5px、内部 1px，色 `#6f5230` @ 82%
- 坐标：四边标注，列 `A–T`（跳过 I）、行 `19–1`，8px 木色
- 星位 9 颗（3/9/15 线交点）
- 棋子：径向渐变球面（黑 `#6c6c6c→#000`，白 `#fff→#ced1d6`），`drop-shadow` 投影
- **落子动画**：`born` 关键帧 `scale(1.45)→1`，cubic-bezier(.2,.9,.3,1.2) 微回弹
- **最后一手**：棋子中心异色圆点标记（非外描边圈）
- **Ghost 预览**：轮到你且为空点时，半透明白子跟随鼠标
- 木纹：155° 渐变 `#f3d8a5→#e6c48b` + 3% 透明度重复纹理 + 内凹厚度

### 4.6 控制条（棋盘下方，三栏）

- 左：Move / Captures / Komi 统计（大数字 + 大写小标签）
- 中：Pass（蓝实心胶囊主 CTA）/ Resign（系统红文字）/ Reset（珍珠幽灵）
- 右：Mode 下拉（自绘 chevron，四档）/ Sound 开关（SF 风格喇叭 SVG，激活态蓝底）

### 4.7 右栏（Rail，296px）

三张白卡（radius 18px，hairline + 轻阴影）：

1. **Work**：圆点列表，蓝=进行中 / 红=失败 / 绿=通过
2. **Jobs**：名称 + 状态 chip（Running 蓝底 / Passed 绿底）+ 耗时
3. **Go Summary**：2×2 mini-stat——Status / Current move / To move / Attention mode

---

## 5. 交互与规则引擎

### 5.1 对局规则

- 中国规则简化版：提子（无气即提）、禁自杀、**positional superko**（局面哈希历史，重复即禁着，提示 "Ko · position may not repeat"）
- 双方连续 Pass → 终局；Resign → 立即结算
- Komi 6.5（展示位）

### 5.2 流程

```
用户点击交叉点 → 校验(占位/自杀/劫) → 落子+提子 → 音效
  → DeepSeek 思考(座位脉冲+胶囊计时) → AI 落子/Pass → 回到 your turn
```

AI 候选：80% 概率在上一手 3 格邻域内随机，20% 全盘随机；最多试 80 个候选直至合法。

### 5.3 Attention Mode（改变 AI 思考时长）

| Mode | 基础延迟 |
|---|---|
| Mofish | 650ms |
| Normal | 1100ms |
| Strict | 1700ms |
| Manual | 2200ms |

均叠加 0–900ms 随机抖动；切换同步刷新 Subbar 与 Go Summary。

### 5.4 音效（WebAudio 合成，可一键关）

- 落子：triangle，用户 610Hz / DeepSeek 430Hz，50ms
- 提子：520→390Hz 双音
- Pass：300Hz 70ms；终局：340→228Hz 双音

### 5.5 反馈

- Toast：底部居中深色毛玻璃胶囊，1.6s 自动消失
- 非法落子分类提示：占位 / 自杀 / 劫

---

## 6. 响应式

- `<1180px`：右栏折到舞台下方，卡片自适应横排
- `<900px`：侧栏收窄至 200px，控制条三栏改纵排居中

---

## 7. 已知边界与后续

**当前不做**：数目/数子结算、SGF 导出、悔棋、KataGo 分析接入

**后续只允许这些方向演进**（继承冻结文档）：

- 官方鲸鱼 SVG 替换手画近似版（`<symbol>` 一处替换即可全局生效）
- mini-board / Trajectory 视图
- 更精致的 Go Summary（胜率、形势曲线）
- 音效微调
