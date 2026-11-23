---
description: 了解 omdsh 内置工具与 4 种 Agent 预设（Standard、PTC、Minimal、Creator）的能力差异，以及何时该切换预设。
---

# 内置工具与预设

运行 `/tools` 可以搜索当前会话对模型可见的所有工具并阅读完整说明。这些工具由当前会话的 **Agent 预设**以及已启用的插件、MCP 服务器和语言服务器共同决定。

## 四种 Agent 预设怎么选

在空白会话（发送第一条消息之前）运行 `/agent` 可以切换预设，也可以在 `/settings` → **`Agent 预设`** 里设置新会话的默认预设：

| 预设 | 定位 | 包含的工具 | 适用场景 |
|---|---|---|---|
| **`Standard`**（默认） | 全功能日常编程助手 | 文件读写搜索、受限 Shell、持久交互终端、网页搜索/抓取、Todo、目标/后台任务/定时提醒、计划模式、子智能体、会话历史工具、团队任务板（开启 `/team` 后） | **95% 的日常开发、调试与重构** |
| **`PTC`**（`code`） | 程序化工具编排模式 | 通过 **`run_code`** 将全部工具以生成 SDK 形式暴露给一段脚本集中编排（隐藏 `workflow_run`）；默认运行在会话级持久内存 REPL 中，在同会话连续调用间保留变量状态，且不接受顶层 `return` | 需要在一个步骤里批量组合几十次文件读取、分析或过滤操作，减少多轮往返 |
| **`Minimal`** | 极简双工具模式 | 仅保留最基础的文件与 Shell 双工具目录 | 极低上下文预算、极简提示或对比测试 |
| **`Creator`**（`cordis`） | 插件开发专用模式 | 在标准目录上增加内置 `dsh-doc` 插件开发指南和只读运行时检查工具（`cordis_inspect`） | 用 `/agent creator` 编写或调试 omdsh 插件（不改默认预设） |

> 已开始对话的会话预设会锁定（保证模型工具历史一致）；随时运行 `/agent inspect` 可查看当前会话实际挂载了哪些组件。

## 内置核心工具一览

### 1. 文件与代码检索
- **文件读写、编辑与搜索**（`read` / `write` / `edit` / `glob` / `grep` 等）：严格遵循当前权限模式（`/permission`）；超大输出会自动截断预览并保留完整内容供按需查阅，不撑爆上下文。
- **代码智能（`lsp`）**：仅在配置了 `lsp.json` 语言服务器时出现，提供精准跳转定义、查找引用、查看实现和类型悬浮文档，详见[语言服务器（LSP）](language-servers.md)。

### 2. Shell 与持久终端
- **受限 Shell（`bash` / `pwsh`）**：按平台挂载（macOS/Linux 用 Bash，Windows 用 PowerShell），适合运行构建、测试与一次性命令；默认超时 120 秒，可在 `/settings` → **`插件` → `Shell`** 调整。
- **持久交互终端（`terminal_*`）**：适合需要维持会话状态、持续输出或交互式操作的长期终端进程。
- **后台任务（`jobs`）**：跟踪和读取回合结束后仍在运行的后台命令输出，用户在终端里用 `/jobs` 查看不会干扰模型读取。

### 3. 网页搜索与抓取
- **`web_search` 与 `web_fetch`**：默认使用 DeepSeek 托管接口（`deepseek-search-api` / `deepseek-fetch-api`），直接请求官方服务，避免本地代理 DNS 导致的抓取失败。
- 需要访问 `localhost` 或公司内网页面时，可在 `/settings` → **`插件` → `集成` → `网页搜索与抓取`** 将抓取后端改为 **`直接抓取`（`http`）**。

### 4. 任务规划、长期目标与定时提醒
- **Todo 与计划模式（`exit_plan_mode`）**：拆解多步骤任务并在 `/plan` 模式下提交方案供你审核。
- **长期目标（`goal`）**：配合 `/goal` 与 `Alt+G` 跨回合追踪大目标。
- **定时提醒（`schedule_*`）**：创建和调整基于时间规则的持久提醒，配合 `/schedule` 管理与查看投递历史。

### 5. 多智能体、团队协作与外部扩展
- **子智能体与团队工具**：内置 `subagent` / `subagent_fork` / `subagent_isolated`、`workflow_run`（`Standard` 预设可用，`PTC` 隐藏），以及开启 `/team on` 后开放的 `team_task_*` 共享任务板工具；启用内置集成后增加 `subagent_codex` / `subagent_claude_code`。详见[子智能体与团队协作](subagents.md)。
- **会话历史检索（`session_*`）**：让模型检索历史会话与事件记录；如需节省上下文，可在 `/settings` → **`插件` → `可选功能`** 中关闭。
- **MCP 工具与资源（`mcp__*`、`mcp-resources`）**：在 `/mcp` 连接任意 MCP 服务器后自动出现对应工具与资源读取能力。

## 按需开关可选工具

绝大多数常用开关不需要手改配置文件，直接去 `/settings` → **`插件`** 即可：
- 可选功能区可直接开关 **记录文件变更**、**会话历史工具**、**Ralph 循环** 和 **重复工具提醒**；
- 仅在需要对底层插件做更细粒度覆写时（例如关闭 `tool-web` 的搜索但保留抓取，或启用默认关闭的 `interrupt_agent`），才需要编辑 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`。

## 相关

- [权限与安全](permissions.md) —— 4 种权限模式如何约束文件与 Shell 工具
- [子智能体与团队协作](subagents.md) —— 子智能体与 `/team` 任务板工具详解
- [Skills 与 MCP](skills-and-mcp.md) —— 给模型接入外部 MCP 工具
- [语言服务器（LSP）](language-servers.md) —— 配置只读 `lsp` 代码导航工具
