---
description: "检查 omdsh 正在做什么：/trajectory 事件账本、基于 projection 的 /context 用量、/session 详情，以及 /diff 工作区摘要。"
---

# 可观测性

omdsh 展示的一切都读自 Harness 的 projection 和持久会话日志；下面的视图只是这些数据的呈现，而不是 TUI 自造的计数器。

## 会话账本：`/trajectory`

`/trajectory` 为活动会话打开键盘驱动的事件账本。事件按 Turn 与 Step 分组，回合运行期间账本会跟随实时尾端。在账本中可以：

- 用 `/` 搜索整个账本，再用 `n`/`N` 或 `Ctrl+N`/`Ctrl+P` 在匹配间跳转；`Enter` 会定位到匹配处，并展开藏着它的折叠回合或工具调用；
- 用 `t` 折叠或展开回合，用 `c` 折叠或展开工具调用；
- 用 `Enter` 打开记录详情，包括工具载荷、结果、schema、耗时与 Token 用量；
- 用 `Tab` 与方向键在详情分区之间切换。

匹配会扫描整个账本，因此折叠的回合和隐藏的子工具调用同样会被计入。`/trajectory` 需要交互式终端。

## 上下文：`/context` 与状态栏

`/context` 会在转录中打印基于 projection 的上下文用量分解。它读取与状态栏相同的、客户端可见的 Harness projection，并区分 provider 记账的占用与启发式的提示组成。状态栏的 `Ctx` 组以百分比加已用/窗口 Token 数显示压力，压力升高时会转为警告色与错误色。可配置的状态项见[调整工作环境](tutorials/environment.md)。

## 会话详情：`/session`

`/session` 在转录中报告活动会话的详细信息，包括其身份与当前配置。需要精确的会话 id 用于 `omdsh --resume` 时可以查看它。

## 工作区差异：`/diff`

`/diff` 以按文件表格汇总工作区改动，列出新增与删除行数，并列出未跟踪文件；`/diff <path>` 打印单个文件的 patch。它只读 git 状态，不会暂存或提交。

## 工具与集成：`/tools` 与 `/mcp`

`/tools` 按注册表暴露的方式分组列出 agent 可见的工具。`/mcp` 按 MCP 服务器分组显示已连接的工具；MCP 重连后工具列表变化时，两个视图都会自动更新。超过上下文预算的工具结果会溢写到私有文件，转录中只保留有界预览；原始内容仍可用 `read` 或 `grep` 读取。

## 相关

- [命令](commands.md) —— `/trajectory`、`/context`、`/session`、`/diff` 及其余命令目录
- [键盘与快捷键](keyboard.md) —— 账本与浮层按键
- [性能](performance.md) —— 长会话下转录与账本保持快速的方式
