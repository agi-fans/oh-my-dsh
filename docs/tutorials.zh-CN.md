# 教程

[English](tutorials.md) | 简体中文

这些任务式教程覆盖从首次安装到日常可靠使用、再到编写可安装插件的完整路径。开始前请准备 Node.js 22.19 或更高的 22.x 版本，或者 Node.js 24 及更高版本、支持 TTY 的终端，以及用于真实模型对话的 DeepSeek API Key。编写插件还需要 `PATH` 上有 `pnpm`。

每篇教程单独成页，后续改一条路径时不必改整份文档。

| 教程 | 内容 |
|---|---|
| [完成第一个任务](tutorials/first-task.zh-CN.md) | 安装、`/login`、Agent / Workflow / Tools / Access，以及第一条请求 |
| [提供精确的项目上下文](tutorials/precise-context.zh-CN.md) | `@` mention、图片粘贴和结构化 Prompt |
| [引导运行中的任务](tutorials/guide-a-turn.zh-CN.md) | 队列、Loop、Plan、Todo 和 `/goal` |
| [恢复并管理长会话](tutorials/long-session.zh-CN.md) | 恢复、回退、压缩和导出 |
| [调整工作环境](tutorials/environment.zh-CN.md) | `/model`、为额外提供方 `/login`，以及 `/settings` |
| [使用 Skills 与 MCP 扩展项目](tutorials/skills-and-mcp.zh-CN.md) | 项目 Skills 与 `mcp.json`；完整说明见 [Skills 与 MCP](skills-and-mcp.zh-CN.md) |
| [安装示例插件](tutorials/install-plugin.zh-CN.md) | `omdsh plugin add ./examples/hello` |
| [编写插件](tutorials/write-a-plugin.zh-CN.md) | 编写、安装、检查并发布一个 `dsh.bundle` 包 |

插件兼容性约定见 [用户插件](plugins.zh-CN.md)。

## 快速参考

| 目标 | 操作 |
|---|---|
| 浏览命令与快捷键 | `/help` |
| 搜索历史 Prompt | `Ctrl+R` |
| 滚动 Transcript | `PgUp` / `PgDn` 或 `Shift+Up` / `Shift+Down` |
| 打开 Agent Hub | 在空 composer 中按 `↓` 再按 `Enter`，或按 `Alt+A` |
| 复制最近的回复、代码块或命令 | `/copy` |
| 选择 Agent preset | `/agent` |
| 选择 Default 或 Plan Workflow | `/workflow` |
| 选择 Native、Code 或 Both Tools | `/tool-mode` |
| 选择会话 Access | `/access` |
| 查看会话统计 | `/session` |
| 查看可用工具 | `/tools` |
| 每个回合完成后重复工作 | `/loop [次数\|时长] [Prompt]` |
| 阅读版本说明 | `/changelog` |
| 安装最新版本 | `npm install --global @agi-fans/oh-my-dsh@latest` |
| 安装本地插件 bundle | `omdsh plugin add ./examples/hello` |
| 编写插件 | [编写插件](tutorials/write-a-plugin.zh-CN.md) |

每日更新检查只会提示存在新的 npm 版本，不会自动安装。
