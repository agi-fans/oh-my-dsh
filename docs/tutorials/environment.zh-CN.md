# 调整工作环境

[English](environment.md) | 简体中文

[教程](../tutorials.zh-CN.md) · Previous: [恢复并管理长会话](long-session.zh-CN.md) · Next: [使用 Skills 与 MCP 扩展项目](skills-and-mcp.zh-CN.md)

### 选择模型与推理强度

运行 `/model` 打开模型选择器。当有多家提供方处于活动状态时，omdsh 会先询问使用哪一家，再让你选择可用模型；模型支持时还可以继续选择 Reasoning Effort。当前选择会显示在第一行 Status Line 中，并写入持久化会话状态。

若要添加另一家 catalog 提供方，运行 `/login`，选择提供方并粘贴 API Key。该路由会在下一次模型请求时生效。选择 `custom` 可以添加 catalog 里没有的网关或本地服务：填写永久 id、Base URL、API 协议、可选 Key，以及一个或多个模型 id。`/logout` 可以停用这条路由，而不会改动环境变量中的凭据。

### 定制界面

运行 `/settings` 可以配置主题、颜色输出、默认 Tool 展开状态、更新检查、启动时 Release Notes，以及 Status Line。Theme 一行可在 `dark`、`light`、`midnight`、`solarized`、`catppuccin`、`dracula`、`nord`、`gruvbox`、`rose-pine` 和 `mono` 之间切换。Preview 中的每一项（Model、Effort、Path、Git 和各遥测分组）都有自己的颜色、左右栏、显示/隐藏和顺序。使用 `Up` 和 `Down` 移动，使用 `Left` 和 `Right` 修改值，使用 `Tab` 在 General 与 Status line 分区之间切换。在 Status 项上按 `Space` 可以显示或隐藏；按 `Enter` 后再用 `Up`/`Down` 改顺序，或用 `Left`/`Right` 改左右栏，再按 `Enter` 或 `Esc` 完成移动。输入框顶栏左侧是 🐳，右侧是当前 Access Level。

运行 `/help` 可以查看完整的命令与快捷键目录。命令列表由当前启用的 Harness 插件共同组成，因此也会包含 Skills 和其他运行时集成贡献的能力。

[教程](../tutorials.zh-CN.md) · Previous: [恢复并管理长会话](long-session.zh-CN.md) · Next: [使用 Skills 与 MCP 扩展项目](skills-and-mcp.zh-CN.md)
