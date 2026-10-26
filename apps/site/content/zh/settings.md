---
description: "omdsh 的全部设置：外观、动效、通知、Agent 语言、可选功能，以及可配置的两行状态栏，含默认值与持久化位置。"
---

# 设置

`/settings` 打开设置浮层。`Tab` 与 `Shift+Tab` 在 Interface、Agent、Tools、Status line 和 Integrations 之间切换；仅当 Profile 中存在未收编的插件字段时才显示 Advanced；`↑`/`↓` 移动行，`←`/`→` 修改值。直接输入名称或按 `/` 可跨分类搜索，也支持字段名称。编辑返回后保留查询和选中结果。`Esc` 依次清空查询、返回分类浏览、关闭 Settings；`Ctrl+U` 直接清空查询。窄终端显示当前分类及其序号，便于发现 `Tab` 切换。完整浮层按键见[键盘与快捷键](keyboard.md)。

## 产品配置

自带能力按用户任务归入产品设置。Advisor、Command hooks 兼容模式和 Subagent models 模型选择直接显示当前值，可用 `←`/`→` 或 `Space` 修改。选中配置行后按 `Enter` 打开设置，`Esc` 返回原来的选中行；启用集成导致可用设置变化时，也保持原行。没有内容的分类不显示。

| 分类 | 配置 |
|---|---|
| Interface | 外观、输入、通知与启动偏好。 |
| Agent | Model and reasoning、Access、Agent preset、Language、Subagents 与 Subagent models。 |
| Tools | Tool parallelism、Shell 超时／输出限制与可选功能开关。shell executor 的宿主级 `cwd` 有意不提供：每个会话都在当前工作目录中运行。 |
| Status line | 状态栏布局、可见性、上下文样式与颜色。 |
| Integrations | Web providers、Web search · API、Web search · Messages、Advisor、Command hooks、Codex 与 Claude Code。 |
| Advanced | 尚未收编的实时字段，以及没有产品表单的已安装插件；为空时隐藏。 |

Integrations 中的 Codex 与 Claude Code 提供 Enable／Disable、直接编辑的 Model 与 Permissions、恢复继承值以及 Installation status。概览从 Plugin Manager 读取并显示 Enabled、Disabled、Unavailable 或 Load error。Installation status 检查包注册情况，不验证原生认证，结果页保持打开直到关闭。Provider 激活后才显示模型设置；安装和卸载仍在 `/plugins`，其中的 **Integration settings** 打开同一套表单。原生环境变量覆盖留在 Profile 补丁中，不在通用表单展示。

**Web providers** 选择 search 与 fetch 后端；默认是 `deepseek-search-api`/`deepseek-fetch-api`，每次操作只发一次直连 DeepSeek API 请求，不消耗辅助模型回合。**Web search · API** 配置它的 API 密钥引用、端点、结果数与是否发送触发问题；在 `deepseek-account` 会话中，共享账户 token 优先于 API 密钥；`/login` 会把官方密钥存到上游 `DEEPSEEK_API_KEY` 引用，因此官方 API 登录后即可搜索。**Web search · Messages** 保留备用 Messages Provider 的限额、密钥引用、端点、模型和 API 版本；要使用它，在 Web providers 中选择 `deepseek-official`，本地抓取兜底则选择 `http`。

Advanced 遵守插件的自动表单策略，不重复展示已有产品控件覆盖的字段，包括 TUI 外观、语言与结构化状态栏编辑器。隐藏、禁用和弃用字段不显示；上游新增但尚未收编的字段仍可访问，不重复整个所属表单。

每个字段显示有效值及其来自继承还是当前 Profile 覆盖。产品字段直接进入编辑，预选或预填当前值；时长和字节限制支持 `30s`、`2m`、`512 KiB`、`2 MiB` 等可读单位。**Restore inherited setting…** 打开字段选择与确认；设置行上的 `Ctrl+R` 也可恢复继承。Advanced 保留 **Set value**／**Reset to inherited** 操作。修改按插件 schema 校验，并使用表单显示时的版本保存。若期间配置发生变化，写入会被拒绝，避免覆盖并发修改。字符串直接输入；Subagent 允许模型使用目录选择器。Advanced 中的其他数组、字典等结构化字段使用 JSON。schema 中隐藏或禁用的字段不显示。包含密钥的复合字段保持受保护，请使用 `/login` 或其所属配置入口。

密钥输入会被遮蔽，也不会出现在 notice 中。为带有 `apiKeyEnv` 的 `apiKey` 设置值时，密钥通过 Harness credentials 保存，Profile 只记录引用。重置该密钥会同时移除这两个 Profile 字段，恢复继承规则；不会撤销继承凭据或删除凭据库中的密钥。凭据引用字段继续遵循 Harness 的环境变量与凭据源继承规则。

设置保存到当前 Profile。外观立即生效，Agent 语言从下一回合生效，子代理模型选择作用于新会话。**Advisor** 默认关闭，选择 Codex 或 Claude Code 后启用。所选模型就是 `consult_advisor` 访问的对象，也是 `/advisor` 的默认对象；在命令行显式指定 provider 只对该次请求生效。咨询是向另一家厂商模型发起的付费请求，不设额度上限——开启即视为已知情。这里仅显示已激活插件 schema 声明的实时字段；普通部署选项仍写在 Profile 补丁中。启停及安装见[插件](plugins.md)。

在 **Agent → Subagent models → Allowed models** 中搜索模型目录，用 `Space` 勾选、`Enter` 保存。当前路由会预选，不在目录里的已配置路由也会保留。启用模型选择前需至少选一个模型。新会话采样允许列表，`subagent` 只暴露这些精确路由；已有会话保留原选择，`subagent_fork` 继承父路由。默认关闭。

产品表单与保存提示使用任务和字段标签，Advanced 保留技术 namespace 与字段路径；字段旁显示 schema 的帮助文字。设置继续写回原插件条目，不复制到 TUI 偏好中。

### 命令 Hooks

在 **Integrations** 中选择 **Command hooks**。先设置 **Configuration file**，再把 **Hook compatibility** 改为 `codex` 或 `claude-code`；默认 `off` 不执行 Hooks。路径为空时，使用进程工作目录下的 `.codex/hooks.json` 或 `.claude/settings.json`。可以指向已有兼容配置；修改文件内容后，需要重启或将 bridge 关闭再开启。

所选的已发布 bridge 执行其支持的同步 command hooks。Codex 映射 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse 和 Stop；Claude Code 遵循其已发布事件子集。不执行不受支持的 async、prompt 和 agent hooks。阻断决定和失败显示在转录中并保留日志；启用后不会为已有会话补跑 SessionStart。一次只启用一个 bridge。

## Interface

设置分为 Appearance、Input、Notifications 与 Startup。通知依赖保持可见：通知关闭时 **Notify when** 不生效，**Long turn** 仅用于 long-running 策略。

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Theme | dark、light、system | dark | 配色方案。omdsh 提供一套深色、一套浅色，以及 `system`；后者根据终端报告的颜色生成卡片底色与文字颜色，并跟随浅色终端，支持配色通知的终端还会在会话中跟随明暗切换。工具卡片用底色表明状态：进行中为中性灰，成功为绿色，失败为红色。 |
| Color | on / off | on | SGR 着色。 |
| Motion | full / reduced / off | full | `full` 带平滑流式与工作微光；`reduced` 保留平滑流式、去掉微光；`off` 直接跟随 provider 分块并使用静态活动标记。 |
| Math in replies | auto / source | auto | 将支持的公式排版为终端文字，或保留 LaTeX 分隔符和命令。 |
| Mermaid in replies | auto / source | auto | 绘制能够完整容纳的图形，或显示 Mermaid 源码。 |
| Terminal title | status / session / workspace / off | status | 显示根 Agent 状态与会话名、仅保留会话名、显示状态与工作区及 Git 分支，或停止设置标题。 |
| Program status | auto / on / off | auto | 向支持的终端报告根 Agent 生命周期；Auto 等待能力响应，On 强制报告，Off 关闭。 |
| Editor | Auto / 已探测到的编辑器 | Auto | 文件预览与 `Ctrl+X` 提示编辑使用的应用。 |
| Keybindings | Default / 自定义数量 | Default | 打开快捷键重绑选择器，保存到 `keybindings.json` 并立即生效。 |
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

Terminal title 和 Program status 与 Herdr 共用根 Agent 生命周期。等待用户输入优先于运行状态；完成和失败保留到开始新工作或切换会话。查看子 Agent 不会替换根状态。Program status 使用 OSC 7501，可选元数据仅包含会话名，不包含提问正文、工具参数或错误。设置立即生效，退出时清除自己写入的元数据；输入或输出被重定向时不发送终端控制序列。Terminal activity 仍是单独启用的 OSC 9 进度提示。

工具预览使用当前主题的背景色，四周保留内边距。用户消息和工具卡片的背景有配套文字色，普通回复正文继续使用终端默认前景色。浅色终端应选择 `light`，深色终端选择 `dark` 或 `system`。卡片底色本身就表明状态——进行中为中性色、成功为绿色、失败为红色——这一区分在 16 色终端上依然成立，只有进行中与成功这一对在该模式下会共用同一底色。回合采用统一展示方式，详见[键盘与快捷键](keyboard.md#转录)，不再提供转录密度设置。旧的 `foldDensity` 和 `expandTools` 配置仍可读取，但不再影响视图。

Editor 列出已安装的 VS Code、Cursor、VSCodium、Neovim、Vim、Nano 和 Vi。Auto 兼容已有的 `$VISUAL` 或 `$EDITOR` 配置，否则优先使用探测到的图形代码编辑器，再选择终端编辑器。即使命令不在 PATH 中，也会检查 macOS 应用包和 Windows 的标准安装位置。手动选择立即生效，并在下次启动时保留；保存并关闭打开的文件即可返回。已保存但不再可用的编辑器会标为 unavailable，方便重新选择；若未发现编辑器，安装后重新打开 Settings 即可。

Motion 只影响呈现：provider 输出仍会立即进入实时会话，工具边界或已落定的助手消息会立即冲刷可见流，不等待动画。

Math in replies 立即应用于实时回复和思考视图。Auto 转换行内希腊字母、符号和上下标，并用终端字符排版独立的分式、根号、极限、矩阵、分段函数与对齐方程。不支持、不完整或尺寸过大的公式保留完整 LaTeX 原文，避免原文与部分转换结果混杂。这只支持有限的 TeX 语法，不是浏览器公式渲染器。复制回复和导出会话保留原始文本；终端历史保留已经显示过的行。

Mermaid in replies 用终端字符绘制支持的流程图、时序图、状态图、类图、ER 图、思维导图、时间线、饼图和 Git 图。Auto 等待围栏代码块闭合，仅在解析没有警告且整个图形能够容纳时绘制。不支持、不完整、被截断或尺寸过大的图形保留源码；图形连线不会为适应宽度而折行或裁剪。图形颜色跟随当前主题。Source 模式和思考视图显示 Mermaid 代码。复制和导出保留原始 Markdown；切换设置会刷新实时视图，不会重写终端历史。

## Agent

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Language | Auto / Simplified Chinese / English | Auto | 推理与回复的偏好语言。 |

**Model and reasoning**、**Access** 与 **Agent preset** 在命令可用时打开现有的 `/model`、`/permission` 与 `/agent` 选择器。模型选择保存默认路由；Access 和 Agent preset 作用于当前会话。

非 Auto 的选择从下一个回合开始生效；代码、标识符、命令、工具参数、日志、引用与文件内容保持准确形式，当前任务的显式语言要求仍然优先。该偏好是用户级的，因此恢复的会话使用当前值而不是历史快照。

## Tools

Shell 提供当前平台的超时与输出限制：POSIX 的 Bash 和 Windows 的 PowerShell 使用同一套表单，分别写回各自配置。可选功能各自消耗上下文、运行时间或转录噪声；每一行关闭一个组合行。

**File recovery snapshots** 默认关闭。开启后为新 Turn 保存私有文件内容，并通过 Session Tree 的 `Alt+R` 恢复选中文件。捕获消耗磁盘空间并增加工作。设置修改从下一个 Turn 生效；关闭开关时，已经开始的捕获仍会完成。关闭后仍可读取已有完整快照。见[恢复 Turn 文件](sessions.md#恢复-turn-文件)。该开关修改恢复插件的配置；下方功能行则启用或禁用组合行。

| 行 | 默认 | 关闭后 |
|---|---|---|
| 改动文件汇总 | 开 | 不再逐回合记录改动文件，也不再在回合起止各做一次 Git 快照。 |
| 会话历史工具 | 开 | 模型失去 `session_search`、`session_event_search`、`session_trace`、`session_event_trace` 与 `session_event_read`。 |
| Ralph 循环 | 关 | 该循环工具保持缺席，直到你在这里打开。 |
| 重复工具提醒 | 开 | 模型不再收到"别重复同一个工具调用"的提醒。 |

运行中的 Profile 会监视该补丁，在写入稳定后应用修改；关闭 HMR 的宿主在下次启动生效。`disabled` 是 Loader 选项而非插件配置，settings 服务无法表达它；因此这些行改为写入 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` 里一个由注释界定的托管块，那正是 Harness 组装组合树时读取的入口。该块之外你手写的内容不会被改动。

支撑某个命令的行（`session-query` 支撑 `/resume`，`workspace` 支撑 `@` 提及）以及会让 agent 不可用的行（`tool-fs`、`tool-bash`、`todo`）刻意不列出。`web_search` 同样缺席：它与 `web_fetch` 共用一行，行级开关表达不了"关搜索、留抓取"。

## Status line

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Telemetry | on / off | on | 显示页脚第二行的会话指标；模型和工作区信息仍然显示。 |
| Context label | compact / full | compact | 在占用值前显示 `Ctx` 或 `Context`。 |
| Context style | percent / bar / tokens / detailed | percent | 显示百分比、十格占用条、已用/窗口 Token 数，或百分比与 Token 数。 |

状态项上的 `Ctrl+R` 只恢复继承颜色；**Restore layout** 经确认后恢复完整的继承布局、可见性和颜色。

状态项可以就地重排与换色：`Space` 显示或隐藏一项，`Enter` 开始移动（`↑`/`↓` 重排，`←`/`→` 选择列），每一项都有自己的颜色。

第一行默认顺序：Model（`deepseek`）、Effort（`max`）、Path（`~/project`）、Git（`main *1`）与 Session；Session 默认关闭，因为终端窗口标题无论如何都会显示会话标题。

第二行的遥测分组默认全部显示：Context（`Ctx 1.6%`）、Cache（`Cache 99%`）、Tokens（`5.9M in`）、Latency（`TTFT 1.2s`）、Time（`LLM 16m51s`）与 Activity（`3 turns`）。Context style 只改变显示形式：`tokens` 显示 `Ctx 16.4K/1M`，`detailed` 显示 `Ctx 1.6% · 16.4K/1M`，`bar` 显示占用条，不同时显示百分比。所有样式都会在占用升高时使用警告和错误颜色。终端较窄时，按配置顺序选择能完整放下的分组。默认优先保留上下文、缓存、Token 和延迟，再考虑时长和活动计数；放不下的分组会被跳过，后续较小的分组仍有机会显示。

## 持久化

外观与状态栏修改只写入实际变更的字段，其余字段继续继承默认值；保存期间立即预览；保存失败时恢复已保存的偏好，错误提示保留到主动返回。功能开关仅在 Profile 补丁写入成功后更新显示；已有补丁不可读时保持原文件不变。

设置、模型偏好与登录写入的凭据都是实时插件配置，持久化到当前 Profile 的 Cordis 补丁 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`（home 本身依次回退到 `$DSH_HOME`、`~/.dsh`）；`/settings`、`/model` 与 `/login` 都写入这里。更早版本留下的 `settings.yaml` 会在启动时导入一次——每个设置段按同名 id 写入 Profile 行——随后文件被重命名为 `settings.yaml.imported`；已不再对应任何行 id 的设置段会被记录日志，并且只留在重命名后的文件里。完整文件清单见[会话与历史](sessions.md)。

## 配置归属

已挂载的 Harness 插件把设置保存在各自 Profile 行的 config 中。`llm-deepseek` 路由只接受 Messages 兼容端点，配置 `protocol` 键时会报错 `protocol is not configurable; remove it and use a Messages-compatible baseURL`。自建 gateway 需要设置兼容的 `baseURL`；DeepSeek 端点由 base URL 选择。

## 相关

- [键盘与快捷键](keyboard.md) —— 设置浮层按键与键位覆盖
- [故障排查](troubleshooting.md) —— 颜色环境变量与更新行为
- [命令](commands.md) —— `/settings`、`/model`、`/login`
