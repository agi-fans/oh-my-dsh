---
description: 切换 omdsh 模型与推理强度，添加额外提供方，并设置界面与回复语言与 TUI 偏好。
---

# 调整工作环境

读完本教程，你可以切换模型和推理强度、登录额外提供方、选择界面与回复语言，并通过 `/settings` 调整界面。

### 设置语言与界面

运行 `/settings`。`Tab` 和 `Shift+Tab` 在 General、Models、Agent presets、Plugins 和 Terminal 之间切换；插件提供额外字段时还会显示 Advanced。方向键选择和修改值，`Enter` 打开配置表单，直接输入或按 `/` 跨分类搜索。表单显示作用范围和待保存修改，Apply 保存草稿，Cancel 放弃尚未应用的修改。完整选项及持久化规则见[设置](../settings.md)。

General 分开设置**界面语言**和**回复语言**。界面语言的自动选项跟随环境区域设置。回复语言提供跟随界面、自动、简体中文和英语。新配置档案默认跟随界面，在下一回合开始时解析；已有档案保留已保存偏好，自动不添加语言指令。当前任务明确要求的语言优先，代码、命令、日志与文件内容保留原文。

Terminal 中的 Theme 提供 `dark`、`light` 和 `system`，深浅配色以 Catppuccin Mocha 和 Latte 为基础，System 跟随终端报告的颜色。Motion 的 `full` 平滑显示流式文字并提供活动动画，`reduced` 保留平滑文字并弱化活动效果，`off` 直接跟随服务商分块。消息完成或遇到工具边界时立即显示完整内容。

**Terminal → Status line** 控制密度和各项可见性。`minimal` 显示占用，`standard` 增加延迟，`verbose` 在空间允许时增加 Token 与会话累计。选中项目后按 `Space` 显示或隐藏。模型和工作区各有固定位置，遥测指标在终端变窄时按稳定顺序收起。状态栏标签始终使用英文。

运行 `/help` 搜索可用命令，或用 `/help full` 查看当前快捷键。

### 选择模型与推理强度

运行 `/model`，在同一个可搜索列表中浏览所有活动服务商的模型。各服务商独立加载目录，可用模型会先显示。服务商报错后用 `Alt+R` 刷新，`Alt+F` 收藏或取消收藏，`Alt+A` 在全部模型和收藏之间切换。

按 `Enter` 选择模型并保存为默认，或按 `Ctrl+D` 选择 **This session only**。切换模型时使用目标模型的默认推理强度，通过 `/model reasoning` 或 `Shift+Tab` 可明确修改；`Ctrl+T` 控制思考内容的显示。当前模型和强度显示在页脚，并随会话持久化。

如果当前模型切换成功、但保存默认值失败，可以选择 **Retry saving default** 重试，或 **Keep for this session** 仅保留当前会话的选择。

### 登录额外提供方

DeepSeek 本身是第一项：`/login` 可以启动 DeepSeek 账户的浏览器登录（通过 loopback 回调），也可以保存 API Key。账户路由会出现在 `/model`；`/logout` 可以登出账户 grant 或删除文件中的 Key。

若要添加另一家 catalog 提供方，运行 `/login` 并从列表中选择。已注册授权流程的提供方会给出该流程的方法，而不是通用的 API Key 提问；否则粘贴其 API Key。该路由会在下一次模型请求时生效。

选择 `custom` 添加目录外的网关或本地服务，填写永久 ID、Base URL、API 协议、可选密钥及至少一个模型 ID。之后可通过 **Settings → Models → Model providers** 编辑或删除自定义服务商。`/logout` 管理已保存的认证。

### 诊断本地安装

在平时使用的工作区运行诊断：

```sh
omdsh doctor
omdsh doctor --json
```

Doctor 读取启动环境、Profile、Bundle 补丁、插件入口文件与 DSH peer 要求、Shell 可执行文件、MCP/LSP 配置与可执行文件，以及凭证文档元数据。它不会初始化或改写 Profile、执行配置表达式、导入已配置插件、启动服务器、发送终端探测或发起模型请求。缺少 Profile 时报告产品默认配置；有配置层被拒绝时会明确提示检查覆盖不完整。凭证值和原始解析错误不会输出。

每一项用 `ok` 表示该项明确说明的本地事实成立，用 `failed` 表示发现问题，用 `not-configured` 表示可选配置不存在，用 `not-checked` 表示仍需运行时验证。配置有效、可执行文件可用，不代表认证或连接成功。动态凭证路径需要运行时解析；默认凭证存储会单独检查。按提示修复失败项，再通过 `/model` 或 `/login` 验证所选模型，并在正常运行流程中验证集成。

JSON 包含 `schemaVersion: 1`、`version` 与 `checks` 数组；检查项包含 `id`、`status`、`summary` 和可选的 `remedy`。退出码 `0` 表示没有失败项，即使存在未检查的能力；`1` 表示检查失败；`2` 表示 CLI 参数无效。两种输出格式都不含 ANSI 着色。

### 下一步

接下来学习[提供精确的项目上下文](precise-context.md)，把文件、截图和清楚的请求交给 Agent。
