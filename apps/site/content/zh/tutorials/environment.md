---
description: 切换 omdsh 模型与推理强度，添加额外提供方，并设置 Agent 语言与 TUI 偏好。
---

# 调整工作环境

读完本教程，你可以切换模型和推理强度、登录额外提供方、选择 Agent 默认语言，并通过 `/settings` 调整界面。

### 选择模型与推理强度

运行 `/model` 打开模型选择器：

1. 当有多家提供方处于活动状态时，先选择提供方。
2. 选择可用模型；模型支持时还可以继续选择 Reasoning Effort。

当前选择会显示在第一行状态栏中，并写入持久化会话状态。

### 登录额外提供方

若要添加另一家 catalog 提供方，运行 `/login` 并从列表中选择。已注册授权流程的提供方会给出该流程的方法，而不是通用的 API Key 提问；否则粘贴其 API Key。该路由会在下一次模型请求时生效。

选择 `custom` 可以添加 catalog 里没有的网关或本地服务：填写永久 id、Base URL、API 协议、可选 Key，以及一个或多个模型 id。`/logout` 可以停用这条路由，而不会改动环境变量中的凭据。

### 设置 Agent 语言与界面

运行 `/settings` 可以配置 Agent 默认语言、主题、颜色输出、动态效果、终端原生活动提示、默认 Tool 展开状态、更新检查、启动时 Release Notes，以及状态栏。

`/settings` 内的按键：

- `Up` / `Down` 在行间移动，`Left` / `Right` 修改当前值。
- `Tab` 和 `Shift+Tab` 在 General、Agent 与 Status line 三个分区之间切换。
- 在 Status 项上按 `Space` 可以显示或隐藏它。
- 按 `Enter` 开始移动 Status 项：`Up` / `Down` 调整顺序，`Left` / `Right` 切换左右栏，再按 `Enter` 或 `Esc` 完成移动。

Agent 分区的 Language 一行可在 `Auto`、`Simplified Chinese` 和 `English` 之间切换。非 Auto 选项会从下一个 turn 开始成为推理与面向用户沟通的默认语言；代码、标识符、命令、Tool 参数、日志、引用和文件内容仍保留准确形式，而用户对当前任务明确提出的语言要求仍然优先。该偏好是用户级设置，因此恢复会话时使用当前值，而不是历史快照。

General 分区的 Motion 只控制显示效果。`full` 会平滑揭示流式 Assistant 文本，并为 `Deep Driving` 添加流光；`reduced` 保留平滑流式显示，但不显示流光；`off` 直接跟随 Provider chunk，并使用静态活动标记。Provider 的完整输出仍会立即进入当前会话，遇到 Tool 边界或已完成的 Assistant 消息时，界面也会立即显示完整内容，不会等待动画。Terminal activity 是单独启用的忙碌/空闲提示，可显示在支持该能力的终端标签页或任务栏中。它不表示任务完成百分比，并会在任务停止或 omdsh 退出时清除。

Theme 一行可在 `dark`、`light`、`midnight`、`solarized`、`catppuccin`、`dracula`、`nord`、`gruvbox`、`rose-pine` 和 `mono` 之间切换。Preview 中的每一项（Model、Effort、Path、Git 和各遥测分组）都有自己的颜色、左右栏、显示/隐藏和顺序。Context 以百分比和已用/窗口 Token 数显示压力，并会随压力升高切换为警告色和错误色。输入框顶栏左侧是 🐳，右侧是当前 Access Level。

运行 `/help` 可以查看完整的命令与快捷键目录。命令列表由当前启用的插件共同组成，因此也会包含 Skills 和其他运行时集成贡献的能力。
