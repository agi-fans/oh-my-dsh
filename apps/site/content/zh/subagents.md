---
description: "omdsh 的子智能体与委派：三种 transport、读取子会话转录、子代理引导、Workflow 与 Ralph 编排工具，以及后台任务。"
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

Composer 上方的名册就是全部：`↓` 选中一行，`Enter` 就地打开该子会话的转录。`Enter` 就地打开孩子的转录，`Tab` 与方向键切换面板，`PgUp`/`PgDn` 滚动，`T` 切换树视图。子转录在孩子运行期间保持实时；可继续的孩子会接受你的下一条 composer 消息，或按 `Alt+S` 发送的草稿，因此无需取消就能重定向正在运行的工作。历史一次性转录保持只读。外部执行没有本地转录，因此在外部行上按 `Enter` 会把生命周期状态与近期活动打印成转录结果，并说明结果落在哪里。完整按键见[键盘与快捷键](keyboard.md)。

名册还会为每条已记录的 Workflow 运行显示一行状态与最新阶段，运行中的 workflow 无需打开任何界面即可看到。完整事件历史可通过 `/trajectory` 查看。

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
- [命令](commands.md) —— `/jobs` 及其余命令目录
- [引导运行中的任务](tutorials/guide-a-turn.md) —— 排队、Loop 与任务进度
