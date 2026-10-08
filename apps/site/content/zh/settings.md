---
description: "omdsh 的全部设置：外观、动效、通知、Agent 语言、可选功能，以及可配置的两行状态栏，含默认值与持久化位置。"
---

# 设置

`/settings` 打开设置浮层。`Tab` 与 `Shift+Tab` 在 General、Agent、Features、Status line 和 Plugins 之间切换；`↑`/`↓` 移动行，`←`/`→` 修改值。完整浮层按键见[键盘与快捷键](keyboard.md)。

## 插件配置

打开 `/settings`，切换到 **Plugins**，选中插件后按 `Enter` 编辑字段。`Esc` 返回 Settings 并保留原来的选中行。该分区列出当前已激活且有可编辑配置的插件，字段列表支持筛选。字段来自插件已发布的实时 schema，包括 Shell 超时与输出限制、Subagent 深度/并发/模型策略、Agent loop 工具并行度，以及 Web search 的端点/模型/token/调用次数限制。

每个字段显示有效值及其来自继承还是当前 Profile 覆盖。**Reset to inherited** 只移除该字段的覆盖；**Set value** 按插件 schema 校验，并带上表单读取时的版本保存。若期间配置发生变化，写入会被拒绝，避免覆盖并发修改。字符串直接输入；数组、字典等结构化字段使用 JSON。schema 中隐藏或禁用的字段不显示。包含密钥的复合字段保持受保护，请使用 `/auth` 或其所属配置入口。

密钥输入会被遮蔽，也不会出现在 notice 中。为带有 `apiKeyEnv` 的 `apiKey` 设置值时，密钥通过 Harness credentials 保存，Profile 只记录引用。重置该密钥会同时移除这两个 Profile 字段，恢复继承规则；不会撤销继承凭据或删除凭据库中的密钥。凭据引用字段继续遵循 Harness 的环境变量与凭据源继承规则。

修改实时生效，影响使用同一 Profile 的所有会话。这里仅显示已激活插件 schema 声明的实时字段；普通部署选项仍写在 Profile 补丁中。启停及安装见[插件](plugins.md)。

在 **Plugins** 中选择 **Subagent model selection settings**（`subagent-model-selection-settings`），可配置子代理模型选择。先把 `allowedModels` 设为 JSON 列表，例如 `[{"provider":"deepseek-official","model":"deepseek-flash"}]`，再把 `enabled` 设为 `true`。新会话读取该白名单，只向 `subagent` 暴露这些精确路由；已有会话保留原选择，`subagent_fork` 继承父代理路由。默认关闭。

插件名称使用易读标签，说明中仍保留 namespace；字段旁显示 schema 的帮助文字。

### 命令 Hooks

在 Plugins 中选择 **Hook settings**（`hook-settings`）。先设置 `configPath`，再把 `bridge` 改为 `codex` 或 `claude-code`；默认 `off` 不执行 Hooks。路径为空时，使用进程工作目录下的 `.codex/hooks.json` 或 `.claude/settings.json`。可以指向已有兼容配置；修改文件内容后，需要重启或将 bridge 关闭再开启。

所选的已发布 bridge 执行其支持的同步 command hooks。Codex 映射 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse 和 Stop；Claude Code 遵循其已发布事件子集。不执行不受支持的 async、prompt 和 agent hooks。阻断决定和失败显示在转录中并保留日志；启用后不会为已有会话补跑 SessionStart。一次只启用一个 bridge。

## General

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Theme | dark、light、midnight、solarized、catppuccin、dracula、nord、gruvbox、rose-pine、mono | dark | 配色方案。 |
| Color | on / off | on | SGR 着色。 |
| Motion | full / reduced / off | full | `full` 带平滑流式与工作微光；`reduced` 保留平滑流式、去掉微光；`off` 直接跟随 provider 分块并使用静态活动标记。 |
| Math in replies | auto / source | auto | 将支持的公式排版为终端文字，或保留 LaTeX 分隔符和命令。 |
| Mermaid in replies | auto / source | auto | 绘制能够完整容纳的图形，或显示 Mermaid 源码。 |
| Editor | Auto / 已探测到的编辑器 | Auto | 文件预览与 `Ctrl+X` 提示编辑使用的应用。 |
| Mouse interaction | auto / tui / native | auto | 需要时接管滚动与选择；Auto 尊重 tmux 的 mouse off，也可将鼠标交给终端。 |
| Paste protection | on / off | on | 识别未标记的多行粘贴和快速按键流，避免其中的 Enter 提交消息。 |
| Copy on select | on / off | on | 松开鼠标时复制；关闭后用 `Alt+C`、`Enter` 或右键复制。 |
| Terminal activity | on / off | off | 支持的终端标签页与任务栏中的忙碌/空闲状态。 |
| Update checks | on / off | on | 每天检查一次 npm，有新版本时通知。 |
| Release notes | summary / expanded / hidden | summary | 升级后展示一次新版本说明。 |
| Notifications | off / long-running / always | off | 回合结束或需要输入时通知。 |
| Notify when | unfocused / always | unfocused | 终端报告获得焦点时不发通知；没有焦点报告的终端沿用所选通知策略。 |
| Long turn | 15s / 30s / 1m / 2m | 30s | 触发长任务通知的最短时长。 |

通知会合并短时间内的事件，问题、审批和失败优先于成功完成提醒。当 **Notify when** 为 `unfocused` 时，在待发通知送出前回到终端会取消该通知。

工具预览使用当前主题的背景色，四周保留内边距。用户消息和工具卡片的背景有配套文字色，普通回复正文继续使用终端默认前景色。浅色终端应选择 `light`，深色终端选择其他主题。16 色模式下，卡片使用中性背景，保留状态说明和符号。回合采用统一展示方式，详见[键盘与快捷键](keyboard.md#转录)，不再提供转录密度设置。旧的 `foldDensity` 和 `expandTools` 配置仍可读取，但不再影响视图。

Editor 列出已安装的 VS Code、Cursor、VSCodium、Neovim、Vim、Nano 和 Vi。Auto 兼容已有的 `$VISUAL` 或 `$EDITOR` 配置，否则优先使用探测到的图形代码编辑器，再选择终端编辑器。即使命令不在 PATH 中，也会检查 macOS 应用包和 Windows 的标准安装位置。手动选择立即生效，并在下次启动时保留；保存并关闭打开的文件即可返回。已保存但不再可用的编辑器会标为 unavailable，方便重新选择；若未发现编辑器，安装后重新打开 Settings 即可。

Motion 只影响呈现：provider 输出仍会立即进入实时会话，工具边界或已落定的助手消息会立即冲刷可见流，不等待动画。

Math in replies 立即应用于实时回复和思考视图。Auto 转换行内希腊字母、符号和上下标，并用终端字符排版独立的分式、根号、极限、矩阵、分段函数与对齐方程。不支持、不完整或尺寸过大的公式保留完整 LaTeX 原文，避免原文与部分转换结果混杂。这只支持有限的 TeX 语法，不是浏览器公式渲染器。复制回复和导出会话保留原始文本；终端历史保留已经显示过的行。

Mermaid in replies 用终端字符绘制支持的流程图、时序图、状态图、类图、ER 图、思维导图、时间线、饼图和 Git 图。Auto 等待围栏代码块闭合，仅在解析没有警告且整个图形能够容纳时绘制。不支持、不完整、被截断或尺寸过大的图形保留源码；图形连线不会为适应宽度而折行或裁剪。图形颜色跟随当前主题。Source 模式和思考视图显示 Mermaid 代码。复制和导出保留原始 Markdown；切换设置会刷新实时视图，不会重写终端历史。

## Agent

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Language | Auto / Simplified Chinese / English | Auto | 推理与回复的偏好语言。 |

非 Auto 的选择从下一个回合开始生效；代码、标识符、命令、工具参数、日志、引用与文件内容保持准确形式，当前任务的显式语言要求仍然优先。该偏好是用户级的，因此恢复的会话使用当前值而不是历史快照。

## 功能

可选的产品功能，各自消耗上下文、运行时间或转录噪声。每一行关闭一个组合行。

| 行 | 默认 | 关闭后 |
|---|---|---|
| 改动文件汇总 | 开 | 不再逐回合记录改动文件，也不再在回合起止各做一次 Git 快照。 |
| 会话历史工具 | 开 | 模型失去 `session_search`、`session_event_search`、`session_trace`、`session_event_trace` 与 `session_event_read`。 |
| Ralph 循环 | 关 | 该循环工具保持缺席，直到你在这里打开。 |
| 重复工具提醒 | 开 | 模型不再收到"别重复同一个工具调用"的提醒。 |

运行中的 Profile 会监视该补丁，在写入稳定后应用修改；关闭 HMR 的宿主在下次启动生效。`disabled` 是 Loader 选项而非插件配置，settings 服务无法表达它；因此这些行改为写入 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` 里一个由注释界定的托管块，那正是 Harness 组装组合树时读取的入口。该块之外你手写的内容不会被改动。

支撑某个命令的行（`session-query` 支撑 `/sessions`，`workspace` 支撑 `@` 提及）以及会让 agent 不可用的行（`tool-fs`、`tool-bash`、`todo`）刻意不列出。`web_search` 同样缺席：它与 `web_fetch` 共用一行，行级开关表达不了"关搜索、留抓取"。

## Status line

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Telemetry | on / off | on | 显示页脚第二行的会话指标；模型和工作区信息仍然显示。 |
| Context label | compact / full | compact | 在占用值前显示 `Ctx` 或 `Context`。 |
| Context style | percent / bar / tokens / detailed | percent | 显示百分比、十格占用条、已用/窗口 Token 数，或百分比与 Token 数。 |

状态项可以就地重排与换色：`Space` 显示或隐藏一项，`Enter` 开始移动（`↑`/`↓` 重排，`←`/`→` 选择列），每一项都有自己的颜色。

第一行默认顺序：Model（`deepseek`）、Effort（`max`）、Path（`~/project`）、Git（`main *1`）与 Session；Session 默认关闭，因为终端窗口标题无论如何都会显示会话标题。

第二行的遥测分组默认全部显示：Context（`Ctx 1.6%`）、Cache（`Cache 99%`）、Tokens（`5.9M in`）、Latency（`TTFT 1.2s`）、Time（`LLM 16m51s`）与 Activity（`3 turns`）。Context style 只改变显示形式：`tokens` 显示 `Ctx 16.4K/1M`，`detailed` 显示 `Ctx 1.6% · 16.4K/1M`，`bar` 显示占用条，不同时显示百分比。所有样式都会在占用升高时使用警告和错误颜色。终端较窄时，按配置顺序选择能完整放下的分组。默认优先保留上下文、缓存、Token 和延迟，再考虑时长和活动计数；放不下的分组会被跳过，后续较小的分组仍有机会显示。

## 持久化

设置、模型偏好与登录写入的凭据都是实时插件配置，持久化到当前 Profile 的 Cordis 补丁 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`（home 本身依次回退到 `$DSH_HOME`、`~/.dsh`）；`/settings`、`/model` 与 `/login` 都写入这里。更早版本留下的 `settings.yaml` 会在启动时导入一次——每个设置段按同名 id 写入 Profile 行——随后文件被重命名为 `settings.yaml.imported`；已不再对应任何行 id 的设置段会被记录日志，并且只留在重命名后的文件里。完整文件清单见[会话与历史](sessions.md)。

## 插件设置

已挂载的 Harness 插件把设置保存在各自 Profile 行的 config 中。`llm-deepseek` 路由只接受 Messages 兼容端点，配置 `protocol` 键时会报错 `protocol is not configurable; remove it and use a Messages-compatible baseURL`。自建 gateway 需要设置兼容的 `baseURL`；DeepSeek 端点由 base URL 选择。

## 相关

- [键盘与快捷键](keyboard.md) —— 设置浮层按键与键位覆盖
- [故障排查](troubleshooting.md) —— 颜色环境变量与更新行为
- [命令](commands.md) —— `/settings`、`/model`、`/login`
