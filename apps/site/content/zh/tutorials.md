---
description: 从第一次项目检查开始，循序渐进地学习 omdsh 的日常编程、长会话管理与可选扩展。
---

# 教程

oh-my-dsh 致力于成为 DeepSeek Harness 的最佳 TUI 补充。TUI 是可交互的终端界面，在 omdsh 中，你可以通过键盘和鼠标编写请求、阅读回复、检查 Agent 的工作。思考和工具按需展开，输入区与状态栏始终便于操作和查看。

教程按实际使用顺序组织。先成功完成一个任务，再学习如何提供更好的上下文和引导较长的工作。每篇都说明完成后能做什么，并指向下一步。命令、设置和行为的详细说明集中在参考页。

## 从这里开始

准备好 Node.js 22.19 或更高的 22.x 版本，或者 Node.js 24 及更高版本，以及一个交互式终端。发送模型请求还需要 DeepSeek 账户或 API Key。

| 教程 | 你会完成什么 |
|---|---|
| [完成第一个任务](tutorials/first-task.md) | 安装、登录、选择模型、检查项目，并学会查看界面。 |
| [调整工作环境](tutorials/environment.md) | 选择外观、语言和模型偏好。如果默认设置已经合适，可以跳过。 |

## 建立日常工作流

继续使用同一个项目和对话。在遇到具体需要时，逐步学习相应操作。

| 教程 | 你会完成什么 |
|---|---|
| [提供精确的项目上下文](tutorials/precise-context.md) | 引用文件与历史会话、附加截图、编写清楚的请求。 |
| [引导运行中的任务](tutorials/guide-a-turn.md) | 发送后续消息、纠正当前任务、审核计划、跟踪进度。 |
| [恢复并管理长会话](tutorials/long-session.md) | 恢复工作、探索分支、检查上下文占用、压缩和导出。 |

## 按需增加能力

Skills 提供可复用指令，MCP Server 接入外部工具，插件 bundle 通过 Harness 添加命令、工具和提供方。根据任务需要选择合适的扩展方式。

| 教程 | 你会完成什么 |
|---|---|
| [使用 Skills 与 MCP 扩展项目](tutorials/skills-and-mcp.md) | 添加项目 Skill，配置 MCP Server，并检查可用能力。 |
| [安装示例插件](tutorials/install-plugin.md) | 用 `omdsh plugin` 安装并试用本地 bundle。这项开发者练习需要仓库检出和 `pnpm`。 |
| [编写插件](tutorials/write-a-plugin.md) | 编写自己的命令 bundle，安装并准备分发。 |

安装已经发布的 bundle，可以直接阅读[用户插件](plugins.md)。需要代码智能时，参阅[语言服务器](language-servers.md)。

## 工作中随时查阅

| 你需要什么 | 阅读哪一页 |
|---|---|
| 查找命令或输入操作 | [命令](commands.md)和[键盘与快捷键](keyboard.md) |
| 理解设置或权限 | [设置](settings.md)和[权限与 Access](permissions.md) |
| 检查工具、上下文或文件变更 | [可观测性](observability.md)和[工具](tools.md) |
| 理解会话恢复或委派任务 | [会话与历史](sessions.md)和[子智能体与委派](subagents.md) |
| 排查启动、登录或终端问题 | [故障排查](troubleshooting.md) |
| 理解实现方式 | [架构](architecture.md)、[插件内部机制](plugin-internals.md)和[性能](performance.md) |

在 omdsh 中，`/help` 可以搜索命令，`/help full` 展示当前快捷键，`/changelog` 查看近期版本说明。
