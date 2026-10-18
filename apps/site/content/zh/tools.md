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

## 工作目录

`working_directory` 读取当前目录，也可以用 `cd` 切换到已存在的目录。后续文件操作、新启动的 shell、文件补全与底部路径跟随该目录。会话仍按原始项目归类并沿用已有权限；切换目录不会扩大 Access，也不会移动已经运行的终端。Minimal 保持双工具目录。

## Git worktree

在 `/plugins` → Bundles 启用 `@deepseek-ai/dsh-experimental-tool-worktree`，模型即可使用 `create_worktree`。bundle 随 omdsh 提供，默认关闭；Minimal 仍限制其模型工具。`/worktree` 可从本地 revision 创建 checkout、进入已有注册 checkout，或用 `/worktree return` 返回会话原始目录。对话、原始项目和 Access 保持不变，文件操作、新 shell 和状态栏跟随当前目录。

创建需要同一执行环境中的 Git 2.45 或更高版本及 Node。它只检出已提交的文件，跳过配置的 Git filter，不初始化 submodule 或安装依赖；源 checkout 的改动留在原处。离开、禁用 bundle 或取消创建都不会自动删除分支或文件，失败也可能留下部分产物。请明确返回，并检查保留的产物后再用 Git 管理它们。

## 文件与搜索

`read`、`write`、`edit` 与 `str_replace_editor` 处理文件内容，`grep` 与 `glob` 搜索工作区。可写工具遵守会话的 Access preset，沙箱之外的写操作返回[权限与 Access](permissions.md)中描述的共享拒绝。超过上下文预算的结果会溢写到私有文件，转录中只保留有界预览；原始内容仍可用 `read` 或 `grep` 读取。

## Web

`web_fetch` 抓取公开网页。`web_search` 与 `web_fetch` 默认走 DeepSeek 的 Search 与 Fetch API：每次操作一次直接 API 请求，不消耗辅助模型回合，并使用 `/login` 保存的凭据引用。因此抓取不依赖本机 DNS，在代理的 fake-IP 解析环境下也能工作；目标 URL 由 DeepSeek 的 Fetch API 代为抓取，而不是从本机直接访问。Messages 搜索与本地 HTTP 抓取仍保留在组合中，可在 **设置 → Integrations → Web providers** 切换。不需要搜索的部署在自己 overlay 的 `tool-web` 行上关闭 `search`。

## 代码智能

只读的 `lsp` 工具为已配置的语言服务器提供定义、引用、实现与悬停查询。在 `lsp.json` 注册服务器之前不会出现 `lsp` 工具；见[语言服务器](language-servers.md)。

## 任务与会话

`todo_write` 跟踪实现项；当检查无法决定属于用户的取舍时，`ask_user_question` 会来问你；`present` 记录已完成的交付物，使它们在回合结束后仍可被找到；`skill` 按需加载匹配的 `SKILL.md`。

omdsh 使用 `timed` 问答，默认等待 120 秒。编辑答案或按 `Ctrl+T` 会暂停问答倒计时；`Ctrl+S` 明确跳过单题，`Esc` 将有限时等待的问题留为待答。等待结束后，模型可以继续独立工作，但超时不代表批准。待答提示和 `/questions` 可用于之后补答，恢复会话后也能使用。补答会显示在转录中，并进入下一个模型步骤。`Ctrl+C` 表示中断，不会提交空答案。行输入模式下，空答案行明确跳过单题；EOF 取消回答界面。

模型可在必须一直等待时设置 `timeout: -1`，Profile 也仍可选择 `legacy` 模式。PTC 有独立的执行预算，默认 180 秒；Take time 不会让 `run_code` 程序无限存活。若 PTC 程序在记录问答结果前结束，该问题就无法恢复用于补答。

五个只读工具让 agent 能取到它自己早先会话里做过的工作：`session_search` 与 `session_event_search` 负责查找，`session_trace` 与 `session_event_trace` 追溯谱系与关联，`session_event_read` 返回精确的事件数据。没有它们，一个曾经解决过某问题的模型只能被重新告知一遍，因为 `/resume` 是你才能触及的能力，而不是 agent 的。

它们按工作区授权：跨会话读取只在目标会话的工作目录与调用方完全一致时才被授权，而没有工作目录的会话只能检查自己。在 home overlay 里写 `disabled: true` 关掉这一行，即可移除全部五个工具及其引导语。

## 运行时检查

`cordis` preset 在原生目录之外增加只读的运行时检查：`cordis_inspect_list` 发现 provider，`cordis_inspect_query` 读取精确的 Service、Event 与 Tool API。它还增加已发布的 Harness 开发 Skills 和用于 Profile 管理的 `plugin_manager` 工具。该工具要求完整宿主访问或逐次审批，依赖脚本另需显式授权。人类管理入口为 `/plugins`。

## 委派

`subagent`、`subagent_fork` 与 `subagent_isolated` 把工作委派给子代理，`workflow_run` 用脚本把工作扇出到多个子代理。`ralph` 用一茬茬新 agent 迭代同一个目标，但默认关闭，与上游 base bundle 一致；home overlay 在其行上写 `disabled: false` 即可恢复。`code` preset 会 deny `workflow_run`，因此 PTC 会话只通过 `run_code` 编写编排。见[子智能体与委派](subagents.md)。

`consult_advisor` 在用户要求第二意见时，基于明确的问题与文本上下文获取 Codex 或 Claude Code 的意见。它返回带来源的建议供主模型独立判断，并使用独立的文件系统隔离。调用产生原生模型费用；Settings 可关闭模型咨询。设置与限制见[独立咨询](subagents.md#独立咨询)。

## 相关

- [命令](commands.md) —— `/tools` 及其余命令目录
- [权限与 Access](permissions.md) —— 沙箱实际限制的范围
- [Skills 与 MCP](skills-and-mcp.md) —— 用 Skills 与 MCP 工具扩展目录
