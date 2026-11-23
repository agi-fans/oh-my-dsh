---
description: 从第一次安装与代码改动开始，循序渐进地掌握 omdsh 的日常编程、多智能体协作、长会话恢复与扩展能力。
---

# 教程导读

omdsh 是一个运行在终端里的编程助手。你在底部输入框里描述任务，它会读取项目、修改代码、执行命令，并把过程以清晰可读的方式呈现在终端里。

这套教程按真实使用顺序编排：先跑通第一次代码改动，再逐步掌握上下文输入、长任务控制、多智能体协作和项目扩展。你不需要一口气全部读完——按当前需要挑选对应章节即可。

## 第一阶段：快速上手

开始前请准备 Node.js 24.22.3+（24.x）或 Node.js 26.13.1+、一个交互式终端，以及 DeepSeek 账户或 API Key。

| 教程 | 学完后你能做到 |
|---|---|
| [快速上手：完成第一个改动](tutorials/first-task.md) | 安装、登录、选模型，让助手读项目并完成一处小改动，学会权限确认与 `/diff` 验收。 |
| [调好终端与模型偏好](tutorials/environment.md) | 用底部停靠的 `/settings` 调整主题、语言、状态栏、常用模型和推理强度（默认顺手可跳过）。 |

## 第二阶段：日常高效编程

这一阶段覆盖真实开发中最常用的功能，帮你在复杂需求下始终握住方向盘。

| 教程 | 学完后你能做到 |
|---|---|
| [精准上下文与快捷操作](tutorials/precise-context.md) | 区分 `@文件`、`/attach`、`@历史会话` 与截图粘贴，用 `!命令` 跑 Shell、用 `/btw` 旁路查问题。 |
| [掌控长任务与后台作业](tutorials/guide-a-turn.md) | 用 `/plan` 先定方案再动手，学会在运行中排队、插话或打断，并用 `/goal`、`/jobs`、`/schedule` 跟进任务。 |
| [多智能体协作与 Agent Teams](tutorials/multi-agent.md) | 分清内置子智能体、Codex/Claude Code 集成与 `/team` 团队模式，把大任务拆开并行推进。 |
| [管理长会话与安全回退](tutorials/long-session.md) | 恢复历史会话、在会话树里开分支试方案、用文件恢复快照安全撤销改动，以及压缩与导出对话。 |

## 第三阶段：按需扩展项目

当你需要沉淀团队规范、连接外部系统或启用更多工具时，再看这两篇：

| 教程 | 学完后你能做到 |
|---|---|
| [用 Skills 与 MCP 扩展能力](tutorials/skills-and-mcp.md) | 看懂 Skills、MCP、LSP、插件怎么选；写一个项目 Skill，并在 `/mcp` 中免重启接入外部服务。 |
| [安装插件与内置集成](tutorials/install-plugin.md) | 在 `/plugins` 中浏览和安装第三方插件，启停内置的 Codex、Claude Code、Git Worktree、自动审查与 Tmux 上下文。 |

如果需要代码跳转和引用查找，可以直接阅读[语言服务器（LSP）](language-servers.md)。

## 第四阶段：开发者进阶

如果你希望自己为团队或社区编写新命令、新工具或新模型服务商扩展：

| 教程 | 学完后你能做到 |
|---|---|
| [开发者进阶：编写与发布插件](tutorials/write-a-plugin.md) | 借助 `/agent creator` 或脚手架从零编写插件包，在本地安装调试并准备发布。 |

## 工作中随时查阅

| 遇到什么问题 | 直接看这一页 |
|---|---|
| 查某个斜杠命令或快捷键 | [命令参考](commands.md)、[快捷键与鼠标](keyboard.md) |
| 搞不清权限模式或审批弹窗 | [权限与安全](permissions.md) |
| 调整设置项或自定义快捷键 | [设置](settings.md) |
| 查看上下文占用、执行轨迹或 Diff | [状态与诊断](observability.md) |
| 找回会话、理解压缩与文件快照 | [会话与恢复](sessions.md) |
| 在 CI 或脚本里无交互运行 | [命令行与脚本模式](cli.md) |
| 启动报错、登录失败、按键或鼠标异常 | [故障排查](troubleshooting.md) |
| 了解内置工具、插件原理与架构 | [内置工具与预设](tools.md)、[插件开发内部机制](plugin-internals.md)、[架构概览](architecture.md) |

在 omdsh 里，随时输入 `/help` 搜索命令，输入 `/help full` 查看当前生效的全部快捷键，输入 `/changelog` 查看近期更新。
