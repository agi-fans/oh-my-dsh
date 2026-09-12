---
description: "omdsh 中模型可用的工具，按能力分组，并说明 Access、LSP 配置与结果溢写如何影响它们。"
---

# 工具

挂载的工具来自已发布的 Harness 插件和会话的 Agent preset；omdsh 增加的是终端呈现层，而不是第二套工具注册表。`/tools` 精确列出当前会话暴露的内容，列表随你用 `/agent` 选择的 preset 变化。对可写工具而言，Access 仍然决定它能够触及的范围。

## Shell

| 工具 | 行为 |
|---|---|
| `bash` / `pwsh` | 在宿主对应的受限 shell 中执行一次性命令。调用带有 120 秒超时；模型可以按调用提高限制，或改为后台运行。 |
| `terminal_open`、`terminal_send`、`terminal_read`、`terminal_signal`、`terminal_close`、`terminal_list` | 持久终端会话，跨调用保留 cwd、环境与交互式子进程。 |

## 文件与搜索

`read`、`write`、`edit` 与 `str_replace_editor` 处理文件内容，`grep` 与 `glob` 搜索工作区。可写工具遵守会话的 Access preset，沙箱之外的写操作返回[权限与 Access](permissions.md)中描述的共享拒绝。超过上下文预算的结果会溢写到私有文件，转录中只保留有界预览；原始内容仍可用 `read` 或 `grep` 读取。

## Web

`web_fetch` 抓取公开网页。Web 搜索保持禁用，因为 DeepSeek 原生搜索每次查询要消耗一整个模型回合。

## 代码智能

只读的 `lsp` 工具为已配置的语言服务器提供定义、引用、实现与悬停查询。在 `lsp.json` 注册服务器之前不会出现 `lsp` 工具；见[语言服务器](language-servers.md)。

## 任务与会话

`todo_write` 跟踪实现项；当检查无法决定属于用户的取舍时，`ask_user_question` 会来问你；`present` 记录已完成的交付物，使它们在回合结束后仍可被找到；`skill` 按需加载匹配的 `SKILL.md`。

## 委派

`subagent`、`subagent_fork` 与 `subagent_isolated` 把工作委派给子代理；`workflow_run` 用脚本把工作按阶段扇出；`ralph` 用一茬茬新 agent 迭代同一个目标。见[子智能体与委派](subagents.md)。

## 相关

- [命令](commands.md) —— `/tools` 及其余命令目录
- [权限与 Access](permissions.md) —— 沙箱实际限制的范围
- [Skills 与 MCP](skills-and-mcp.md) —— 用 Skills 与 MCP 工具扩展目录
