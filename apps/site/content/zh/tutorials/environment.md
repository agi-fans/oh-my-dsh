---
description: 切换 omdsh 模型与推理强度，用 /login 添加额外提供方，并通过 /settings 调整 TUI。
---

# 调整工作环境

读完本教程，你可以切换模型和推理强度、登录额外提供方，并通过 `/settings` 调整界面。

### 选择模型与推理强度

运行 `/model` 打开模型选择器：

1. 当有多家提供方处于活动状态时，先选择提供方。
2. 选择可用模型；模型支持时还可以继续选择 Reasoning Effort。

当前选择会显示在第一行状态栏中，并写入持久化会话状态。

### 登录额外提供方

若要添加另一家 catalog 提供方，运行 `/login` 并从列表中选择。已注册授权流程的提供方会给出该流程的方法，而不是通用的 API Key 提问；否则粘贴其 API Key。该路由会在下一次模型请求时生效。

选择 `custom` 可以添加 catalog 里没有的网关或本地服务：填写永久 id、Base URL、API 协议、可选 Key，以及一个或多个模型 id。`/logout` 可以停用这条路由，而不会改动环境变量中的凭据。

### 定制界面

运行 `/settings` 可以配置主题、颜色输出、默认 Tool 展开状态、更新检查、启动时 Release Notes，以及状态栏。

`/settings` 内的按键：

- `Up` / `Down` 在行间移动，`Left` / `Right` 修改当前值。
- `Tab` 在 General 与 Status line 两个分区之间切换。
- 在 Status 项上按 `Space` 可以显示或隐藏它。
- 按 `Enter` 开始移动 Status 项：`Up` / `Down` 调整顺序，`Left` / `Right` 切换左右栏，再按 `Enter` 或 `Esc` 完成移动。

Theme 一行可在 `dark`、`light`、`midnight`、`solarized`、`catppuccin`、`dracula`、`nord`、`gruvbox`、`rose-pine` 和 `mono` 之间切换。Preview 中的每一项（Model、Effort、Path、Git 和各遥测分组）都有自己的颜色、左右栏、显示/隐藏和顺序。输入框顶栏左侧是 🐳，右侧是当前 Access Level。

运行 `/help` 可以查看完整的命令与快捷键目录。命令列表由当前启用的插件共同组成，因此也会包含 Skills 和其他运行时集成贡献的能力。
