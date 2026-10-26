---
description: "omdsh 的子智能体与委派：三种 transport、Agent Hub、子代理引导、Workflow 与 Ralph 编排工具，以及后台任务。"
---

# 子智能体与委派

omdsh 的委派建立在 Harness 的 subagent 服务之上，而不是产品私有的任务运行器。何时委派由模型决定；你可以用键盘跟进子代理、就地打开本地子转录，并引导支持继续的运行。

## 传输通道

三种 transport 并存，按每次委派选择而不是全局配置。随包发布的 persona 会把重度或可并行的自包含工作路由到隔离通道，把可能需要引导或继续的工作留在进程内。

| Transport | 运行位置 | 继承父对话 | 派发后可引导 | 适用场景 |
|---|---|---|---|---|
| `subagent` | 进程内，与 TUI 同一事件循环 | 否 | 是 | 你可能需要引导或追问的工作 |
| `subagent_fork` | 进程内，与 TUI 同一事件循环 | 是——父会话已完成的回合作为子会话前缀，保持缓存可复用 | 是 | 需要父会话上下文的工作 |
| `subagent_isolated` | 独立进程，通过 ACP | 否 | 否 | 不应占用渲染循环的重度或并行自包含工作 |

隔离通道以功能换取隔离：它不接受 model、persona 或 tool filter，没有父级强制的递归上限，派发后也无法引导或追问。它从独立的 home 启动自己的 Harness profile，因此需要 `PATH` 上有一个能提供 `acp` profile 的 `dsh`；`OMDSH_ACP_COMMAND` 与 `OMDSH_ACP_ARGS` 可以覆盖启动方式。

宿主 `subagent` 设置段的 `maxDepth` 默认为 1，供继承它的工具使用：直接孩子不能再通过这些工具委派。工具显式配置的深度（包括 `provider-managed`）优先。`maxActiveSubagents` 默认为 8，限制同一 activation tree 中活动或正在创建的本地与外部孩子；根父代理不占名额。等待、待处理输入和正在停止的孩子仍计入名额，清理后才释放。调高设置可以接纳更多孩子；调低会保留现有孩子，并在占用下降前拒绝新的创建。超过上限的委派会被拒绝，而不是排队。

每次委派会先返回 activation id，执行、结束与结果回传由 Harness 运行时负责。本地孩子可接受追问；ACP 等外部执行没有本地 Session 转录，其结果返回父对话。管道模式下，EOF 会等待仍在推进的孩子及其引发的父级工作完成后退出。会话释放时先清理受管理的后代，再释放父代理。

## 跟进与引导

Codex 与 Claude Code bundle 随 omdsh 安装且初始关闭，可从 `/settings → Integrations` 或 `/plugins → Bundles` 启用和配置。它们使用自带的固定版本运行时及原生登录／设置，向所有 preset 提供全局 `subagent_codex` 和 `subagent_claude_code` 工具，执行不支持追问的独立纯文本任务。Model and Permissions 编辑其原生权限策略，独立于父级 Access。Installation status 只报告注册状态；认证与运行时启动成功仍需真实委派验证。见[插件](plugins.md)。

子代理运行时，队列与 composer 上方会显示一份 roster，包含任务名与生命周期状态；运行中、等待中和已完成的孩子分开计数。composer 为空时按 `Down` 聚焦它、按 `Enter` 打开所选孩子，或直接按 `Alt+A`。

Agent Hub 是全屏视图：roster 加检查面板。`Enter` 就地打开孩子的转录，`Tab` 与方向键切换面板，`PgUp`/`PgDn` 滚动，`T` 切换树视图。子转录在孩子运行期间保持实时；可继续的孩子会接受你的下一条 composer 消息或 `/steer <message>`，因此无需取消就能重定向正在运行的工作。历史一次性转录保持只读。外部执行在 Agent Hub 显示生命周期状态；尝试打开其转录时，会提示结果位于父会话。完整浮层按键见[键盘与快捷键](keyboard.md)。

Agent Hub 还显示最近三次已记录的 Workflow 运行、结果和最新记录的阶段。可用子任务的检查面板显示所属 Workflow、阶段及成员结果，与实时生命周期状态分别呈现。恢复会话后重放这些记录；Enter 仍可打开子会话查看详细错误。完整事件历史可通过 `/trajectory` 查看；该界面不提供拓扑编辑器或 worker 脚本日志。

## 独立咨询

在 `/settings → Integrations` 启用随包安装的 Codex 或 Claude Code 集成，再在 `/settings → Integrations → Advisor` 选定它。这一个选择同时回答两个问题——是否存在顾问、是哪一个——且默认没有配置，因此未配置时 `/advisor` 指向设置而不是向另一家厂商发起计费请求。选定后 `/advisor <question>` 只问问题；在命令行写出 `codex` 或 `claude` 会覆盖该次请求的配置。运行期间，主转录流会渲染一张实时的 `Advisor · Codex` 或 `Advisor · Claude Code` 子代理卡片并流式展示其只读探查步骤，输入栏上方的子代理状态栏与 Agent Hub（`Alt+A`）也会同步跟踪运行状态与近期动作（按 `Ctrl+C` 可取消并等待进程清理）。完成后卡片收起为完成态，紧接着在下方渲染 Markdown 格式的顾问意见，并写入当前会话上下文以便后续追问。调用产生原生模型费用。

配置了顾问后，主模型也可以调用 `consult_advisor`，提供 `question` 和可选 `context`，在难题上请求第二意见；配置的顾问决定访问哪个模型，因此 agent 不再另行选择。未配置时该工具根本不出现在 schema 中，而不是存在但总是失败。不设额度上限：开启顾问即视为已知情咨询会产生费用。Native 和 PTC 工具呈现共享同一结构化结果：来源、问题、意见及截断标记。主模型会对照工作区证据独立评估顾问意见，再决定是否采纳。

每次咨询在当前工作区目录中启动，并使用独立的私有临时状态目录、明确提供的问题、上下文（未提供时自动附带受限工作区结构与清单快照）及原生 provider 配置的 model／environment，不自动复制对话历史。问题最多 8,000 字符，上下文最多 48,000 字符；超限输入会被拒绝。意见最多显示 48,000 字符，并明确标记截断。顾问作为外部孩子出现在 Agent Hub，共享 Harness activation 容量，不支持继续对话，也没有本地转录。

顾问在外层操作系统文件系统沙箱内使用独立权限绑定。Codex 关闭 web 搜索、hooks、apps 和原生委派，在外层只读沙箱保护下允许免审批执行只读工作区探查命令，并在临时私有 home 中仅放入原生 `auth.json` 的不解析副本。请在原生 provider 的 profile 设置中配置模型或显式凭证；自定义原生配置和依赖 home 的 keychain 凭证不会导入私有 home。Claude 保留原生认证，使用 safe mode、开启只读探查工具（`Read`、`Grep`、`Glob`）、关闭 MCP 与 hooks，并采用 plan 权限。外层 Harness 沙箱只允许写入私有状态目录和平台临时目录，不受普通子代理权限设置影响。需要写入其他位置的认证刷新可能失败。Codex 的私有认证副本不会写回原文件。这是文件系统写入边界，不是网络或读取权限沙箱。

无法完整隔离时（包括当前 Windows 后端仅提供部分隔离的情况），咨询会失败，不会降级成可写运行。位于平台临时目录中的工作区也会被拒绝，因为该策略允许写入这些目录。普通 `subagent_codex` 和 `subagent_claude_code` 保持现有原生权限与设置。

## 编排工具

挂载的 Harness 组合在普通委派之外还提供两个编排工具：

- `workflow_run` 接受一段 JavaScript 脚本，把工作按阶段扇出到多个子代理并收集结构化结果。脚本运行在 worker 线程而不是宿主事件循环上，因此大规模扇出不会卡住界面。
- `ralph` 用一茬茬新 agent 迭代同一个目标，直到某个 worker 报告完成或遇到阻塞。它默认关闭，与上游 base bundle 一致：工具描述本身已把它限制在你明确要求的运行上，而是否完成是 worker 的自述而非独立评估。home overlay 在其行上写 `disabled: false` 即可恢复。

`code`（PTC）preset 会 deny `workflow_run`：PTC 把工具注册表呈现为 `run_code` 之上的生成 SDK，否则就会暴露第二个由模型编写的编排面。

使用 `/plan` 进入规划，`/plan off` 返回直接工作。Plan 状态与工作流编排独立。见[命令](commands.md)。

## 后台任务

回合结束后继续运行的长任务会出现在 `/jobs` 中，带状态与已用时间；`/jobs kill <id>` 停止其中一个。后台任务完成时会在会话里发布一条完成通知。任务属于会话作用域，切换或恢复会话后不会保留。

## 相关

- [架构](architecture.md) —— 子智能体的归属与生命周期边界
- [命令](commands.md) —— `/steer`、`/jobs` 及其余命令目录
- [引导运行中的任务](tutorials/guide-a-turn.md) —— 排队、Loop 与任务进度
