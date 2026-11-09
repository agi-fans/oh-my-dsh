---
description: "omdsh 的全部设置：外观、动效、通知、界面与回复语言、可选功能，以及可配置的两行状态栏，含默认值与持久化位置。"
---

# 设置

`/settings` 打开设置浮层。`Tab` 与 `Shift+Tab` 在 General、Models、Agent presets、Plugins 和 Terminal 之间切换；仅当 Profile 中存在未收编的插件字段时才显示 Advanced；`↑`/`↓` 移动行，`←`/`→` 修改值。直接输入名称或按 `/` 可跨分类搜索，也支持字段名称。编辑返回后保留查询和选中结果。`Esc` 依次清空查询、返回分类浏览、关闭 Settings；`Ctrl+U` 直接清空查询。窄终端显示当前分类及其序号，便于发现 `Tab` 切换。完整浮层按键见[键盘与快捷键](keyboard.md)。

**Thinking in turns** 默认折叠。Shown 在运行时展开思考，已有的显式偏好继续生效。`Ctrl+T` 切换默认展示，`Ctrl+O` 可独立展开或收起思考和工具调用，不改变偏好。详见[转录导航](keyboard.md)。

## 产品配置

自带能力按用户任务归入产品设置。Command hooks 兼容模式直接显示当前值，可用 `←`/`→` 或 `Space` 修改。选中配置行后按 `Enter` 打开设置，`Esc` 返回原来的选中行；启用集成导致可用设置变化时，也保持原行。没有内容的分类不显示。

| 分类 | 配置 |
|---|---|
| General | 按语言、会话控制和转录显示分组。会话控制包括默认权限、当前权限和当前目标。文件变更摘要排在最后。 |
| Models | 按模型选择、账户与密钥、连接配置分组展示，各组有独立标题。 |
| Agent presets | “新会话”组设置默认预设，“当前会话”组调整空白会话的预设。 |
| Plugins | 按插件管理、工具、子代理、集成和可选功能分组。工具包括 Shell、并行度和恢复快照，子代理包括通用设置、Codex 和 Claude Code。 |
| Terminal | 外观、输入、通知、启动偏好，以及 Status line 分组。 |
| Advanced | “补充配置”显示已有产品表单的额外字段，“插件配置”显示尚无产品表单的设置。存在条目时才显示此分类。 |

Plugins 中的 Codex 与 Claude Code 提供 Enable／Disable、直接编辑的 Model 与 Permissions、恢复继承值以及 Installation status。概览从 Plugin Manager 读取并显示 Enabled、Disabled、Unavailable 或 Load error。Installation status 检查包注册情况，不验证原生认证，结果页保持打开直到关闭。Provider 激活后才显示模型设置；安装和卸载仍在 `/plugins`，其中的 **Integration settings** 打开同一套表单。原生环境变量覆盖留在 Profile 补丁中，不在通用表单展示。

插件中的**网页搜索与抓取**将服务商选择、Search API 结果数和旧版 Messages 设置合并为一份草稿。其他网页插件选项保留在高级设置中。

Advanced 遵守插件的自动表单策略，不重复展示已有产品控件覆盖的字段，包括 TUI 外观、语言与结构化状态栏编辑器。隐藏、禁用和弃用字段不显示；上游新增但尚未收编的字段仍可访问，不重复整个所属表单。

每个字段显示有效值及其来自继承还是当前 Profile 覆盖。产品字段直接进入编辑，预选或预填当前值；时长和字节限制支持 `30s`、`2m`、`512 KiB`、`2 MiB` 等可读单位。**Restore inherited setting…** 打开字段选择与确认；设置行上的 `Ctrl+R` 也可恢复继承。Advanced 保留 **Set value**／**Reset to inherited** 操作。修改按插件 schema 校验，并使用表单显示时的版本保存。若期间配置发生变化，写入会被拒绝，避免覆盖并发修改。字符串直接输入；Subagent 允许模型使用目录选择器。Advanced 中的其他数组、字典等结构化字段使用 JSON。schema 中隐藏或禁用的字段不显示。包含密钥的复合字段保持受保护，请使用 `/login` 或其所属配置入口。

密钥输入会被遮蔽，也不会出现在 notice 中。为带有 `apiKeyEnv` 的 `apiKey` 设置值时，密钥通过 Harness credentials 保存，Profile 只记录引用。重置该密钥会同时移除这两个 Profile 字段，恢复继承规则；不会撤销继承凭据或删除凭据库中的密钥。凭据引用字段继续遵循 Harness 的环境变量与凭据源继承规则。

设置保存到当前 Profile。外观立即生效，回复语言从下一回合生效，子代理模型选择作用于新会话。这里仅显示已激活插件 schema 声明的实时字段；普通部署选项仍写在 Profile 补丁中。启停及安装见[插件](plugins.md)。

Shell、工具并行度、模型服务商和网页搜索与抓取的草稿表单，在固定摘要位置展示 Profile 作用范围及待保存修改数。多阶段保存中，已经成功的部分会在后续阶段失败时保留。子 Agent 设置的冲突处理方式见下文对应小节。

### Shell 和工具并行度

**Plugins → Shell** 和 **Plugins → Tool parallelism** 各自使用一份草稿。编辑、清空输入及 **Restore inherited setting…** 都先暂存，点击 **Apply** 后保存。在对应设置行按 `Ctrl+R` 会打开恢复继承选择器，修改同样先暂存。**Cancel** 或 `Esc` 放弃草稿。每行区分 **Draft**、**Profile override** 和 **Inherited**；Apply 将该表单修改过的字段一次写入，并校验原版本。保存失败保留草稿供重试；发生并发变更后，选择 **Load latest and keep draft** 载入最新设置并保留草稿。无冲突修改继续暂存，冲突字段可选择 **Keep my change** 保留自己的修改，或 **Use latest value** 使用最新值。核对合并后的草稿，再次 Apply。取消冲突处理会保留处理前的草稿。

Shell 保留 `30s`、`2m`、`512 KiB`、`2 MiB` 等便捷单位。**Default timeout** 用于未指定超时的命令，**Maximum timeout** 限制默认及显式请求的超时时间；默认值更大时由执行器按上限处理。**Output limit** 是每个输出流在内存中保留末尾内容的默认上限，**Retained output limit** 则限制每个临时文件的保留量；命令可单独指定标准输出的内存上限。**Shutdown grace** 是强制终止前的等待时间。Shell 数值必须大于 0 且有限，终止宽限时间不得超过 2147483647 ms。这些设置作用于新命令。编辑器跟随当前挂载的 Bash 或 PowerShell，平台专有字段保留在 Advanced。

**Parallel tool calls** 必须是正整数，限制单步内可安全并行的工具调用数量，其他调用仍串行执行。修改作用于之后的工具调用批次，不改变子代理并发数。

### 子代理

**Plugins → Subagents** 将委派深度、并行子代理数和模型选择放在同一份草稿中。编辑字段和 **Restore inherited setting…** 均先暂存，点击 **Apply** 后保存；退出表单会放弃尚未保存的修改。模型选择开关和允许名单一起保存；启用时至少需要一个模型，关闭后保留名单。默认关闭。

深度从主代理的 0 开始，直接子代理为 1，子代理的子代理为 2；工具自身的深度限制优先。并发数统计同一主代理下各层仍在运行的子代理，不包含主代理。这些限制作用于之后的委派，降低并发上限不会停止已有子代理。模型选择只作用于新会话：已有会话保留原策略，`subagent_fork` 继承父代理路由。

在 **Allowed models** 中搜索目录，用 `Space` 勾选模型、`Enter` 保留到草稿。已保存但不在目录中的路由仍可移除，并标记为 **Currently unavailable**。适配器和设置变化会刷新目录，保留正在勾选的项目；部分服务商失败不影响其他服务商显示。返回 **Subagents → Refresh models** 可重试，加载过程不阻塞取消。

Apply 按各部分最初读取的版本保存。限制和模型策略分别写入：失败部分保留草稿供重试，成功部分保持已保存状态，不重复写入。有版本冲突的草稿不能覆盖新配置；取消并重新打开即可载入最新设置。

产品表单与保存提示使用任务和字段标签，Advanced 保留技术 namespace 与字段路径；字段旁显示 schema 的帮助文字。设置继续写回原插件条目，不复制到 TUI 偏好中。

### 命令 Hooks

在 **Plugins** 中选择 **Command hooks**。先设置 **Configuration file**，再把 **Hook compatibility** 改为 `codex` 或 `claude-code`；默认 `off` 不执行 Hooks。路径为空时，使用进程工作目录下的 `.codex/hooks.json` 或 `.claude/settings.json`。可以指向已有兼容配置；修改文件内容后，需要重启或将 bridge 关闭再开启。

所选的已发布 bridge 执行其支持的同步 command hooks。Codex 映射 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse 和 Stop；Claude Code 遵循其已发布事件子集。不执行不受支持的 async、prompt 和 agent hooks。阻断决定和失败显示在转录中并保留日志；启用后不会为已有会话补跑 SessionStart。一次只启用一个 bridge。

## Models

Models 分类按任务组织设置，只显示当前 Profile 可用的入口。

| 分组 | 入口 | 用途 |
|---|---|---|
| 模型选择 | 模型与推理强度 | 选择当前模型与推理强度，可保存为默认值或仅用于本会话。 |
| 账户与密钥 | DeepSeek 账户 | 管理共享账户的登录、资料和钱包余额。 |
| 账户与密钥 | 登录 / 添加 API Key | 选择服务商，登录其账户或保存 API Key。 |
| 账户与密钥 | 退出登录 / 移除密钥 | 选择账户退出登录，或移除本地保存的服务商凭据。 |
| 连接配置 | 服务地址与模型列表 | 添加或编辑服务商、API 地址、协议和模型目录。 |

## DeepSeek 账户

打开**模型 → DeepSeek 账户**，管理登录并查看账户资料和钱包余额。`/login` → **DeepSeek 账户**使用同一页面，未登录时开始浏览器授权。浏览器通过本地回调完成登录；授权可以取消，登录成功后自动返回账户页。退出登录需要确认，会移除共享的本地授权并在后台撤销远端授权，保留 API 密钥和浏览器登录状态。

账户资料与余额分别加载。**刷新**可重试失败的查询，余额查询失败显示不可用，不会显示为零。充值和赠送钱包分别显示，保留币种，金额显示两位小数；不足一分的正余额显示为 `<0.01`。外部授权变更会清除旧资料，实时登录失效只显示一次短提示，不在恢复会话时重播。账户请求使用当前界面语言和时区偏移。

**使用账户模型**打开现有模型选择器，只列出 `deepseek-account` 路由。回车保存所选默认模型，**仅此会话**只修改当前会话。浏览账户页不会改变当前模型。

## 模型服务商

打开 **模型 → 连接配置 → 服务地址与模型列表**，查看已配置的服务商、凭据状态、模型数量和目录诊断。服务商名称在所有界面语言下保持原文。列表响应 Harness 的配置、凭据和适配器事件自动刷新，也可选择**刷新**重新载入。DeepSeek 账户有可用模型时会出现，选择后打开共用账户页。

选择服务商后可编辑 API 密钥、基础 URL 和有序的模型 ID 列表。自定义 API 还提供显示名称和协议；服务商 ID 不可更改。修改先保留为草稿，选择**应用**才保存。**取消**或 Esc 放弃尚未应用的修改，经服务商列表返回 Settings 原选中行。已有密钥不会读回输入框，密钥留空保留现有认证。保存、添加或删除服务商均不改变当前模型选择；使用 `/model` 选择可用路由。

**模型列表**支持逐项编辑模型 ID、显示名称、上下文容量、最大输出 Token 数和文本／图片输入类型。ID 不能重复，容量必须是正整数，输入类型至少选择一种。可选名称和容量留空恢复继承，输入类型提供独立的恢复入口。在列表中添加模型，在模型详情中确认删除，用 Alt+Up/Down 调整选中模型的顺序。**保留模型**和**保留列表**只将修改放入服务商草稿，选择**应用**才会保存。取消或 Esc 放弃当前模型或列表编辑器中的修改。仅查看继承的模型目录不会生成覆盖配置，未编辑字段保持原值。

自定义 API 模型还提供**推理等级**，选项读取已安装 Harness 的配置定义。选择等级后可以编辑各思考等级的 API 值，留空使用等级名称。Off 表示关闭推理，不提供 API 值编辑。启用推理时至少保留一个非 off 等级。编辑会保留未知的已有等级，并提供关闭推理和恢复继承的操作。内置目录和 DeepSeek 模型继续使用适配器提供的推理能力。

**获取可用模型**在适配器支持时读取安装的模型目录，否则查询配置的端点。可搜索的选择列表只更新草稿，保留已有模型参数以及响应中未列出的已配置模型。内置服务商的**恢复默认模型**移除模型目录覆盖；先应用恢复，再编辑恢复后的列表。编辑继承的 pi-ai 目录时，已有逐模型覆盖参数会带入替换列表。将 DeepSeek 模型改为纯文本输入，或恢复其默认的纯文本输入时，会同时移除该模型的图片限制。

**添加模型服务商**在对应适配器设置可用时提供未启用的目录服务商和自定义 API。自定义 API 必须有唯一 ID、HTTP(S) 地址、受支持协议及至少一个模型。**删除服务商**仅适用于完全由用户配置层提供的服务商，确认前会显示其名称。只清理由 omdsh 管理且属于该路由的本地密钥，保留共享引用和外部凭据。

写入会校验当前显示的配置版本。发生冲突时保留草稿，并提供 **Load latest and keep draft**，逐项选择冲突字段使用哪个值。凭据引用变化时，需要为当前引用重新输入密钥。其他保存失败会保留编辑界面供重试。如果配置已经保存、但密钥保存失败，选择应用只重试密钥阶段；此时取消仍会保留已保存的配置。凭据状态只说明检测到的来源，不代表连接验证成功。

## 网页搜索与抓取

打开**插件 → 网页搜索与抓取**，从实时注册的服务商中选择搜索和抓取后端。官方服务商排在前面，其后显示插件服务商 ID。已保存但未注册的服务商保留在列表中并标记为**未加载**，已注册但不可用的服务商标记为**不可用**。选择列表会随注册变化刷新；目录读取失败时保留上次列表，并提供**刷新**。服务商说明介绍认证和执行方式，可用状态不代表已成功测试网络连接。

默认继续使用 `deepseek-search-api` 和 `deepseek-fetch-api`，直接请求 DeepSeek，不经过辅助模型回合；托管抓取可避免本地 fake-IP DNS 导致的失败。这是与 Harness Web 默认直接抓取的有意差异。选择**直接抓取**（`http`）可从本机获取网页，选择 **DeepSeek（旧版）**（`deepseek-official`）可通过辅助 Messages 模型回合搜索。在支持的端点上，账号会话使用当前会话的 DeepSeek 账号，其他请求使用配置的密钥引用；`/login` 提供默认的 `DEEPSEEK_API_KEY` 引用。

**每次搜索结果数**接受 1 到 50 之间的整数。旧版搜索提供密钥、独立的 Messages 基础 URL，以及正整数的**每次请求最多搜索次数**。数字或地址留空恢复继承，选择部署默认的服务商会移除本地选择覆盖。只有部署未指定对应服务商时才提供**自动**；环境设置仍可能生效，没有明确选择且有多个可用服务商时无法自动决定。未编辑的配置保持不变。

只有**应用**会写入草稿。先保存参数，再保存凭据和服务商选择，因此参数或密钥保存失败时不会切换服务商。已成功保存的部分会保留，重试只写入剩余修改，取消不能撤销已成功保存的部分。版本冲突时可通过 **Load latest and keep draft** 合并变更字段，再次应用。切离旧版搜索会丢弃其未保存密钥，但保留地址和次数限制草稿。已有密钥不会显示；替换密钥会写入现有凭据引用，其他功能可能共用该引用。引用被外部修改时，其密钥草稿会丢弃。外部管理的凭据不能在此替换，仍优先生效的继承明文密钥须在来源处修改。

## Terminal

设置分为 Appearance、Input、Notifications 与 Startup。

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Theme | dark、light、system | dark | 配色方案。omdsh 提供一套深色、一套浅色，以及 `system`；后者根据终端报告的颜色生成卡片底色与文字颜色，并跟随浅色终端，支持配色通知的终端还会在会话中跟随明暗切换。状态文字和符号是主要标识，底色辅助区分进行中、成功和失败。 |
| Color | on / off | on | SGR 着色。 |
| Motion | full / reduced / off | full | `full` 带平滑流式与工作微光；`reduced` 保留平滑流式、去掉微光；`off` 直接跟随 provider 分块并使用静态活动标记。 |
| Math in replies | auto / source | auto | 将支持的公式排版为终端文字，或保留 LaTeX 分隔符和命令。 |
| Mermaid in replies | auto / source | auto | 绘制能够完整容纳的图形，或显示 Mermaid 源码。 |
| Terminal title | status / session / workspace / off | status | 显示根 Agent 状态与会话名、仅保留会话名、显示状态与工作区及 Git 分支，或停止设置标题。 |
| Terminal status | auto / on / off | auto | 报告根 Agent 生命周期和进度。Auto 等待能力响应后发送生命周期报告，On 强制报告，Off 关闭生命周期和进度报告。 |
| Editor | Auto / 已探测到的编辑器 | Auto | 文件预览与 `Ctrl+X` 提示编辑使用的应用。 |
| Keybindings | Default / 自定义数量 | Default | 打开快捷键重绑选择器，保存到 `keybindings.json` 并立即生效。 |
| Mouse interaction | auto / tui / native | auto | 需要时接管滚动、点击展开与选择；Auto 尊重 tmux 的 mouse off，也可将鼠标交给终端。 |
| 运行时 Enter 行为 | 排队 / 插话 | 排队 | 选择 Enter 是等待下一回合还是指导下一次模型步骤。排队与插话快捷键含义固定；空闲发送和命令不受影响。 |
| Paste protection | on / off | on | 识别未标记的多行粘贴和快速按键流，避免其中的 Enter 提交消息。 |
| Copy on select | on / off | on | 松开鼠标时复制；关闭后用 `Alt+C`、`Enter` 或右键复制。 |
| Update checks | on / off | on | 每天检查一次 npm，有新版本时通知。 |
| Release notes | summary / expanded / hidden | summary | 升级后展示一次新版本说明。 |
| Notifications | off / unfocused / always | off | 回合结束或需要输入时通知。`unfocused` 等到终端失去焦点才通知；`always` 无论焦点都通知。 |

通知会合并短时间内的事件，问题、审批和失败优先于成功完成提醒。在 `unfocused` 模式下，待发通知送出前回到终端会取消该通知。该模式还要求回合持续至少三十秒才报告结束。`always` 会报告每个结束的回合。支持的终端通过原生生命周期通道接收一次通知，其余情况回退到 OSC 9 通知。桌面通知的具体呈现由终端控制。

Terminal title 和 Terminal status 与 Herdr 共用根 Agent 生命周期。等待用户输入优先于运行状态，查看子 Agent 时仍以根状态为准。OSC 7501 报告生命周期状态，并区分等待授权、回答问题和登录。可选文本元数据包含会话名。通知设置也约束可能触发原生提醒的生命周期状态。静默的等待与失败状态通过标题和 OSC 9;4 进度提示呈现。进度显示运行中、暂停等待输入或失败，完成后清除。已发送的完成和失败通知保留到开始新工作或切换会话。

OSC 7 将终端目录同步到当前查看的会话，方便新标签页和分屏继承目录。设置立即生效。挂起、外部编辑器和退出会清除自己写入的标题、生命周期和进度元数据，并恢复启动目录。恢复运行时重新同步当前会话的元数据。输入或输出被重定向时不发送终端控制序列。

深浅配色以 [Catppuccin Mocha 和 Latte](https://catppuccin.com/palette/) 为基础，用蓝色标识交互，并加强终端文字的对比度。设置仍只有 `dark`、`light` 和 `system`。普通回复正文和页面背景继续由终端控制：浅色终端选 `light`，深色终端选 `dark`，或用 `system` 跟随终端报告的颜色。工具详情以底色区分进行中、成功和失败，四周保留内边距。用户消息和工具卡片的背景有配套文字色；终端色数有限、底色合并时，状态文字和符号仍可辨认。回合采用统一展示方式，详见[键盘与快捷键](keyboard.md#转录)，不再提供转录密度设置。旧的 `foldDensity` 和 `expandTools` 配置仍可读取，但不再影响视图。

Editor 列出已安装的 VS Code、Cursor、VSCodium、Neovim、Vim、Nano 和 Vi。Auto 兼容已有的 `$VISUAL` 或 `$EDITOR` 配置，否则优先使用探测到的图形代码编辑器，再选择终端编辑器。即使命令不在 PATH 中，也会检查 macOS 应用包和 Windows 的标准安装位置。手动选择立即生效，并在下次启动时保留；保存并关闭打开的文件即可返回。已保存但不再可用的编辑器会标为 unavailable，方便重新选择；若未发现编辑器，安装后重新打开 Settings 即可。

Motion 只影响呈现：provider 输出仍会立即进入实时会话，工具边界或已落定的助手消息会立即冲刷可见流，不等待动画。

Math in replies 立即应用于实时回复和思考视图。Auto 转换行内希腊字母、符号和上下标，并用终端字符排版独立的分式、根号、极限、矩阵、分段函数与对齐方程。不支持、不完整或尺寸过大的公式保留完整 LaTeX 原文，避免原文与部分转换结果混杂。这只支持有限的 TeX 语法，不是浏览器公式渲染器。复制回复和导出会话保留原始文本；终端历史保留已经显示过的行。

Mermaid in replies 用终端字符绘制支持的流程图、时序图、状态图、类图、ER 图、思维导图、时间线、饼图和 Git 图。Auto 等待围栏代码块闭合，仅在解析没有警告且整个图形能够容纳时绘制。不支持、不完整、被截断或尺寸过大的图形保留源码；图形连线不会为适应宽度而折行或裁剪。图形颜色跟随当前主题。Source 模式和思考视图显示 Mermaid 代码。复制和导出保留原始 Markdown；切换设置会刷新实时视图，不会重写终端历史。

## General

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| 界面语言（UI language） | 自动 / 简体中文 / English | 自动 | 立即切换界面文字。 |
| 回复语言（Response language） | 跟随界面 / 自动 / 简体中文 / English | 新配置档案默认跟随界面 | 从下一回合开始使用的面向用户沟通语言。 |
| 文件变更摘要（File change summary） | On / Off | On | 在实时转录中显示 Changed 摘要。点击标题打开该回合保存的差异，点击文件行直接选中该文件。关闭显示后仍可通过 `/diff turn` 查看已记录的比较。 |

**Models → Model and reasoning** 打开 `/model`，修改当前选择并保存默认路由；选择 **This session only** 则仅作用于当前会话。模型选择采用目标模型的默认推理强度，`/model reasoning` 可明确修改强度。**General → Default access** 和 **Agent presets → Default Agent preset** 写入 Harness 的新会话默认设置，不改变现有会话。对应的 **Current session** 操作打开 `/permission` 和 `/agent`；preset 只能在首条提示之前切换。`Ctrl+R` 恢复继承值。Creator 是 `cordis` preset 的用户名称；`/agent creator` 或 **/plugins → Let the agent create a plugin** 进入该模式，不提交提示，也不改变默认 preset。

界面语言覆盖设置、输入区、常用菜单、审批控件与通知。自动依次读取 `LC_ALL`、`LC_MESSAGES`、`LANG`：中文环境使用简体中文，其余或未设置的环境使用英语。命令、快捷键、模型名、用户文字、工具输出与文件保留原文；尚未翻译的扩展文字回退到原语言。切换只刷新实时视图，不改写终端原生历史。

回复语言独立设置。“跟随界面”在下一回合开始时读取界面语言；“自动”不注入语言指令。已有配置档案保留明确保存的偏好，未保存时继续使用自动；只有新建配置档案默认跟随界面，恢复继承会回到自动。这是沟通语言偏好，不保证控制模型内部思考的语言；代码、标识符、命令、工具参数、日志、引用与文件内容保持准确形式，当前任务的显式语言要求仍然优先。该偏好是用户级的，因此恢复的会话使用当前值而不是历史快照。

## Plugins

Shell 提供当前平台的超时与输出限制：POSIX 的 Bash 和 Windows 的 PowerShell 使用同一套表单，分别写回各自配置。可选功能各自消耗上下文、运行时间或转录噪声；每一行关闭一个组合行。

**File recovery snapshots** 默认关闭。开启后为新 Turn 保存私有文件内容，并通过 Session Tree 的 `Alt+R` 恢复选中文件。捕获消耗磁盘空间并增加工作。设置修改从下一个 Turn 生效；关闭开关时，已经开始的捕获仍会完成。关闭后仍可读取已有完整快照。见[恢复 Turn 文件](sessions.md#恢复-turn-文件)。该开关修改恢复插件的配置；下方功能行则启用或禁用组合行。

| 行 | 默认 | 关闭后 |
|---|---|---|
| 记录文件变更 | 开 | 不再逐回合记录改动文件，也不再在回合起止各做一次 Git 快照。 |
| 会话历史工具 | 开 | 模型失去 `session_search`、`session_event_search`、`session_trace`、`session_event_trace` 与 `session_event_read`。 |
| Ralph 循环 | 关 | 该循环工具保持缺席，直到你在这里打开。 |
| 重复工具提醒 | 开 | 模型不再收到"别重复同一个工具调用"的提醒。 |

**Plugins → 可选功能 → 记录文件变更**控制回合差异的采集。**General → 转录显示 → 文件变更摘要**控制它们在实时转录中的显示。

运行中的 Profile 会监视该补丁，在写入稳定后应用修改；关闭 HMR 的宿主在下次启动生效。`disabled` 是 Loader 选项而非插件配置，settings 服务无法表达它；因此这些行改为写入 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` 里一个由注释界定的托管块，那正是 Harness 组装组合树时读取的入口。该块之外你手写的内容不会被改动。

支撑某个命令的行（`session-query` 支撑 `/resume`，`workspace` 支撑 `@` 提及）以及会让 agent 不可用的行（`tool-fs`、`tool-bash`、`todo`）刻意不列出。`web_search` 同样缺席：它与 `web_fetch` 共用一行，行级开关表达不了"关搜索、留抓取"。

## Terminal → Status line

底部状态栏和预览始终使用英文标签，不随界面语言切换。设置控件和说明跟随界面语言。预览明确标为示例数据，开启会话标题项后也会显示示例标题。

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Session metrics | on / off | on | 显示首行页脚之下的会话指标；模型和工作区信息仍然显示。关闭后会收回它占用的行。 |
| Density | minimal / standard / verbose | standard | 页脚显示多少内容。`minimal` 只保留占用——Context 与 Cache——并使用 `Ctx` 标签；`standard` 增加 Latency / speed（`TTFT`）；`verbose` 把 Tokens 加在同一行，并给 Duration 与 Turns / steps 单独一行，同时使用长标签（`Context`）与详细上下文形式。 |

在任意页脚项上按 `Space` 可显示或隐藏该项；隐藏是对该数字的判断，因此在切换 Density 后依然生效，而密度自己决定的分组不受影响。**Restore layout** 经确认后恢复继承的 Density 与可见性。

每一项都有固定位置。逐项的开关表示显示偏好：已开启的统计项还需要开启“会话统计”、足够的终端宽度和对应的会话数据。关闭会话统计时，选中行的说明会提示这一原因。第一行左侧是身份——Model（`deepseek`）、Effort（`max`）与 Session，右侧是位置——Path（`~/project`）与 Git（`main *1`）。Session 在 `verbose` 以下默认关闭，可以独立于终端窗口标题开启。

首行之下从两端回答两个问题。左侧是占用与已花时间：Context（`Ctx 1.6%`）、Cache（`Cache 99%`）与 Duration（`LLM 16m51s`）。右侧是吞吐与工作量：Tokens（`5.9M in`）、Latency / speed（`TTFT 1.2s`）与 Turns / steps（`3 turns`）。两侧不互换，因此同一个数字在每次会话里都在同一位置。

`verbose` 把会话累计放到第三行——左侧 Duration、右侧 Turns / steps——这样上面一行不必为了塞下而舍弃它们。该行只在上一行完整时才出现；低于这个宽度不会按乱序补回内容。

上下文表示形式跟随 Density：`standard` 与 `minimal` 显示百分比，`verbose` 显示 `Context 1.6% · 16.4K/1M`；所有形式都会在占用升高时使用警告和错误颜色。终端较窄时可见集是目录顺序的前缀：放不下就从末尾丢弃，因此 Turns / steps 先于 Duration 消失，Duration 先于 Latency / speed，也不会因终端变宽而乱序重现。需要引起注意的角色保留自己的颜色：脏工作区分支保持 `warning`，缓存命中率保持成功色。

## 持久化

外观与状态栏修改只写入实际变更的字段，其余字段继续继承默认值；保存期间立即预览；保存失败时恢复已保存的偏好，错误提示保留到主动返回。功能开关仅在 Profile 补丁写入成功后更新显示；已有补丁不可读时保持原文件不变。

设置、模型偏好与凭据引用持久化到当前 Profile 的 Cordis 补丁 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`（home 本身依次回退到 `$DSH_HOME`、`~/.dsh`）；`/settings` 和 `/model` 在此保存配置，`/login` 也可以添加服务商配置。API Key 的值通过 Harness 凭据存储保存，共享的 DeepSeek 账号授权使用独立的账号存储。更早版本留下的 `settings.yaml` 会在启动时导入一次——每个设置段按同名 id 写入 Profile 行——随后文件被重命名为 `settings.yaml.imported`；已不再对应任何行 id 的设置段会被记录日志，并且只留在重命名后的文件里。完整文件清单见[会话与历史](sessions.md)。

## 配置归属

已挂载的 Harness 插件把设置保存在各自 Profile 行的 config 中。`llm-deepseek` 路由只接受 Messages 兼容端点，配置 `protocol` 键时会报错 `protocol is not configurable; remove it and use a Messages-compatible baseURL`。自建 gateway 需要设置兼容的 `baseURL`；DeepSeek 端点由 base URL 选择。

## 相关

- [键盘与快捷键](keyboard.md) —— 设置浮层按键与键位覆盖
- [故障排查](troubleshooting.md) —— 颜色环境变量与更新行为
- [命令](commands.md) —— `/settings`、`/model`、`/login`
