---
description: omdsh /settings 完整指南：按真实标签页顺序（常规、模型、Agent 预设、插件、终端、高级）说明每项设置的用途、默认值与推荐配置。
---

# 设置

运行 `/settings`（别名 `/set`）会在实时状态栏正上方打开底部停靠的设置面板，上方对话记录与下方真实状态栏保持可见。

- `Tab` / `Shift+Tab`（或 `←` / `→`）切换顶部分类标签，`↑` / `↓` 移动光标，`Space` / `Enter` 修改或进入子表单；
- 按 **`/`**（或直接输入关键词）跨全部标签搜索任意设置项，按 `Esc` 依次清空搜索词并退出；
- 按 **`Ctrl+R`** 可把当前选中的配置项恢复为继承默认值；
- 终端外观和状态栏改动**立即生效并自动保存**，面板底部会闪现一行短暂确认，不会往对话记录里插噪声；Shell、子智能体、模型服务商、网页搜索抓取等多字段表单支持先改草稿再统一 **`应用`（`Apply`）** 保存。

## 按场景推荐的 5 项常用设置

| 你的需求 | 推荐位置与改法 |
|---|---|
| 实时精简或丰富底部状态栏 | `终端` → `状态栏`（修改直接反映在面板下方的真实状态栏并下划线高亮） |
| 在 tmux 里直接用鼠标拖选复制 | `终端` → `鼠标交互` 设为 `关闭`（`native`） |
| 切到其他窗口干活，希望完成或需审批时提醒 | `终端` → `通知` 设为 `失焦时`（`unfocused`） |
| 改乱代码时能按回合一键恢复文件 | `插件` → `工具` → 打开 `文件恢复快照` |
| 模型运行中习惯按 `Enter` 直接插话纠偏 | `终端` → `输入` → `繁忙时的发送行为` 设为 `插话` |

下面按 `/settings` 顶部标签页的真实顺序逐一说明。

---

## 1. 常规（`General`）

| 设置项 | 可选值 | 默认值 | 作用 |
|---|---|---|---|
| **界面语言**（`UI language`） | `自动` / `简体中文` / `English` | `自动` | 立即切换界面菜单、提示与设置文案。`自动` 按 `LC_ALL` / `LC_MESSAGES` / `LANG` 判断中文或英文；命令、模型名、文件内容与底部状态栏标签保持原文。 |
| **回复语言**（`Response language`） | `跟随界面` / `自动` / `简体中文` / `English` | 新配置默认 `跟随界面` | 从下一回合起控制助手与你沟通的自然语言（代码、标识符和日志保持原样；当前对话里的显式语言要求优先）。 |
| **默认权限**（`Default access`） | `只读` / `工作区可写` / `完全访问` | `工作区可写` | 新会话的默认权限模式，不影响已经打开的会话。 |
| **当前权限**（`Current access`） | 同 `/permission`（含 `自动审查`） | 当前会话值 | 快捷调整当前会话权限。 |
| **当前目标**（`Current goal`） | 编辑 / 暂停 / 继续 / 清除 | 无 | 管理当前会话的 `/goal` 长期目标。 |
| **文件变更摘要**（`File change summary`） | `开` / `关` | `开` | 在对话记录里显示每轮的 `Changed` 改动文件摘要；关闭后仍可用 `/diff turn` 查看。 |

---

## 2. 模型（`Models`）

| 入口 | 用途 |
|---|---|
| **模型与推理强度** | 等同 `/model`：切换全局默认或按 `Ctrl+D` 仅用于当前会话。 |
| **DeepSeek 账户** | 登录/退出共享的 DeepSeek 账户，查看账户资料、充值与赠送钱包余额及平台通知，或一键选用 `deepseek-account` 下的模型。 |
| **登录 / 添加 API Key** | 激活内置模型服务商并加密保存 API Key（或添加自定义服务商）。 |
| **退出登录 / 移除密钥** | 退出共享账户，或删除本地保存的服务商密钥（不影响环境变量）。 |
| **服务地址与模型列表** | 编辑服务商的 Base URL、协议（`OpenAI Chat Completions` / `OpenAI Responses` / `Anthropic Messages`）、模型列表（ID、上下文容量、最大输出、文本/图片输入类型与推理等级）或点击 **`获取可用模型`** 自动拉取。 |

> 密钥输入全程遮蔽，不会回显或写入普通日志；编辑服务商时密钥留空表示保留原凭据。注意 DeepSeek 原生端点仅兼容 Messages 协议，自建网关只需填写兼容的 `baseURL` 即可。

---

## 3. Agent 预设（`Agent presets`）

- **新会话默认预设**：选择之后新建会话默认使用的预设（`Standard`、`PTC`、`Minimal` 或 `Creator`）。
- **当前会话预设**：仅在尚未发送首条消息的空白会话中可切换；已有对话的会话可用 `/agent inspect` 查看当前预设构成，或用 `/agent creator` 另起插件开发会话。各预设的工具差异见[内置工具与预设](tools.md)。

---

## 4. 插件（`Plugins`）

该标签页集中管理随包自带的工具、子智能体、外部集成与可选功能开关：

### 工具（`Tools`）

- **Shell**：配置当前平台 Shell（macOS/Linux 为 Bash，Windows 为 PowerShell）的默认超时（默认 120s）、最大超时、内存输出上限、临时文件保留上限和终止宽限时间；支持 `30s`、`2m`、`512 KiB`、`2 MiB` 等直观单位。
- **工具并行度（`Tool parallelism`）**：限制单步内允许并行执行的只读/安全工具数（不影响子智能体并发上限）。
- **文件恢复快照（`File recovery snapshots`）**：默认关闭。开启后为新回合捕获文件快照，改乱代码时可在会话树按 `Alt+R` 逐文件比对恢复，详见[会话与恢复](sessions.md#三按回合恢复文件文件恢复快照)。
- **Tmux 位置上下文（`Tmux location context`）**：默认开启。仅在真实 POSIX `tmux` 窗格（`$TMUX_PANE`）内自动生效，向模型同步 session/window/pane 与布局变化（可调最短刷新间隔，默认 `0`）；非 tmux 环境零开销。
- **归档时保留 worktree**：当内置 Git Worktrees 扩展启用时显示，默认开启（`true`），在 `/resume` 归档会话时保留该会话创建的 Git worktree；关闭后归档时会一并清理。

### 子代理（`Agents` / `Subagents`）

- **通用设置（`Subagents`）**：统一配置最大派生深度（默认 `1`）、最大并行子智能体数，以及是否启用“允许的子智能体模型”白名单（修改对后续委派或新会话生效）。
- **Codex 与 Claude Code**：开关这两项内置原生子智能体集成、查看 **`安装状态`**，以及分别设置独立的**模型**（留空继承原生配置）和**权限模式**（Codex 默认 `never`，Claude Code 默认 `dontAsk`）。

### 集成（`Integrations`）

- **MCP 服务器**：打开实时 `/mcp` 管理界面，免重启添加、启停、探测、重启或移除 MCP 服务器，详见 [Skills 与 MCP](skills-and-mcp.md)。
- **网页搜索与抓取**：选择搜索与抓取后端（默认使用 DeepSeek 官方托管接口 `deepseek-search-api` / `deepseek-fetch-api`，可避免本地代理 DNS 导致的抓取出错；如需访问内网/本机地址，可将抓取切为 **`直接抓取`** `http`），支持配置每次搜索结果数（1–50）及计费鉴权来源（`auto` / `account` / `api-key`）。
- **命令钩子（`Command hooks`）**：兼容同步命令钩子（可选 `off` / `codex` / `claude-code`，默认 `off`），并可指定配置文件路径（留空默认读取 `.codex/hooks.json` 或 `.claude/settings.json`；修改文件内容后需重启或重新开关生效）。

### 可选功能开关

以下每一项都可以按需开关以节省上下文或减少噪音（修改后即时写入配置并热生效）：

| 开关 | 默认 | 关闭后的效果 |
|---|---|---|
| **记录文件变更** | 开 | 不再逐回合记录改动文件，也不做回合起止 Git 快照 |
| **会话历史工具** | 开 | 模型不再拥有历史会话检索/追踪工具（`session_search` 等） |
| **Ralph 循环** | 关 | 保持关闭，需要时再在此开启 |
| **重复工具提醒** | 开 | 不再在模型重复相同工具调用时插入防死循环提醒 |

---

## 5. 终端（`Terminal`）

### 外观、输入、通知与启动

| 设置项 | 可选值 | 默认 | 作用 |
|---|---|---|---|
| **主题（`Theme`）** | `dark` / `light` / `system` | `dark` | 基于 Catppuccin Mocha / Latte 的深浅配色，`system` 自动跟随终端调色板与明暗切换。 |
| **颜色（`Color`）** | `on` / `off` | `on` | 开关终端着色（显式设置优先于 `NO_COLOR`）。 |
| **动效（`Motion`）** | `full` / `reduced` / `off` | `full` | `full` 平滑流式 + 活动微光；`reduced` 去微光；`off` 静态输出（仅影响展示，不拖慢模型接收）。 |
| **回复中的公式（`Math in replies`）** | `auto` / `source` | `auto` | 在终端排版支持的常见数学公式，或保留原始 LaTeX 源码。 |
| **回复中的 Mermaid（`Mermaid in replies`）** | `auto` / `source` | `auto` | 在空间足够时用字符绘制流程图/时序图/状态图等，或显示原始 Mermaid 代码。 |
| **思考展示（`Thinking in turns`）** | 折叠 / 展开 | 折叠 | 控制思考块默认状态（随时可用 `Ctrl+T` 切换全局展示）。 |
| **终端标题（`Terminal title`）** | `status` / `session` / `workspace` / `off` | `status` | 同步窗口标题显示状态、会话名或工作区与 Git 分支。 |
| **终端状态（`Terminal status`）** | `auto` / `on` / `off` | `auto` | 向支持原生进度/状态的终端（含 Herdr、OSC 9;4 等）上报运行、阻塞或完成状态。 |
| **外部编辑器（`Editor`）** | `Auto` / 已探测编辑器 | `Auto` | 用于 `Ctrl+X` 编写提示与 Diff/文件预览中的 `E` 打开编辑（支持 VS Code、Cursor、VSCodium、Neovim、Vim、Nano、Vi，优先尊重 `$VISUAL`/`$EDITOR`）。 |
| **快捷键（`Keybindings`）** | 默认 / 自定义数 | 默认 | 交互式重绑与测试按键，保存到 `keybindings.json` 并立即生效。 |
| **鼠标交互（`Mouse interaction`）** | `auto` / `tui` / `native` | `auto` | `auto` 尊重 tmux `mouse off`；`tui` 强制启用点击与滚轮；`native` 完全交还终端选字。 |
| **繁忙时的发送行为** | `排队` / `插话` | `排队` | 决定运行中按 `Enter` 的默认动作（`Cmd/Ctrl+Enter` 自动对应另一种）。 |
| **粘贴保护（`Paste protection`）** | `on` / `off` | `on` | 防止不支持括号粘贴的终端把多行粘贴误提前提交。 |
| **选中即复制（`Copy on select`）** | `on` / `off` | `on` | 拖选松手即复制；关闭后用 `Alt+C`、`Enter` 或右键复制。 |
| **更新检查（`Update checks`）** | `on` / `off` | `on` | 每天至多检查一次 npm 新版本，仅提示不自动安装。 |
| **版本说明（`Release notes`）** | `summary` / `expanded` / `hidden` | `summary` | 升级后启动时展示一次更新摘要或完整说明。 |
| **通知（`Notifications`）** | `off` / `unfocused` / `always` | `off` | 长任务结束（`unfocused` 需持续 ≥ 30 秒且窗口失焦）或出现审批提问时提醒。 |

### 状态栏（`Terminal → Status line`）

调整以下选项时，**设置面板正下方的真实状态栏会实时更新并下划线标出当前聚焦项**（标签在所有语言下保持英文以确保排版稳定）：

- **会话统计（`Session metrics`）**：开关第二行指标（关闭后收回该行，保留首行模型与路径）。
- **信息密度（`Density`）**：
- `minimal`：仅占用（`Ctx` / `Cache`）；
- `standard`（默认）：增加延迟与吞吐（`TTFT` / `tok/s`）；
- `verbose`：使用完整标签与 `已用/总容量` 形式，并在屏幕足够宽时新增**第三行**展示会话累计耗时与轮次/步数。
- **固定左右语义与宽度降级**：
- 首行左为身份（Model / Effort / Session），右为位置（Path / Git）；
- 指标行左为占用与耗时（Context / Cache / Duration），右为吞吐与工作量（Tokens / TTFT / Turns）；
- 空间不足时严格按 **Turns → Duration → Latency/Tokens/Cache** 顺序从低优先级隐藏，不会乱序跳动。
- **逐项开关与重置**：按 `Space` 单独显示或隐藏某一项（切换密度时你的显式隐藏依然保留）；选 **`恢复布局`（`Restore layout`）** 一键恢复默认。

---

## 6. 高级（`Advanced`）

只有当已安装的插件声明了尚未纳入上方产品表单的额外配置项时，才会显示 **`高级`** 标签。每个字段都标明当前值来自“继承”还是“本地覆盖”，按插件 schema 实时校验，并支持 **`恢复继承`**。

---

## 配置保存位置

所有通过 `/settings`、`/model`、`/login` 修改的偏好均保存在 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`（API Key 单独加密保存在本地凭据库，共享的 DeepSeek 账户使用独立账号存储）。如果其他进程并发改写了配置文件，草稿表单会提示你载入最新值并逐项保留或合并你的修改，避免覆盖丢失。完整本地文件路径见[会话与恢复](sessions.md#八本地数据文件清单)。

## 相关

- [调好终端与模型偏好](tutorials/environment.md) —— 新手一步步调优指南
- [快捷键与鼠标](keyboard.md) —— 面板操作键与 `keybindings.json`
- [故障排查](troubleshooting.md) —— 颜色、鼠标、通知与登录问题排查
