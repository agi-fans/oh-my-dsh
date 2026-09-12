---
description: "omdsh 的子智能体与委派：三种 transport、Agent Hub、子代理引导、Workflow 与 Ralph 编排工具，以及后台任务。"
---

# 子智能体与委派

omdsh 的委派建立在 Harness 的 subagent 服务之上，而不是产品私有的任务运行器。何时委派由模型决定；你可以用键盘跟进子代理、就地打开任何一个子转录，并引导支持继续的运行。

## 传输通道

三种 transport 并存，按每次委派选择而不是全局配置。随包发布的 persona 会把重度或可并行的自包含工作路由到隔离通道，把可能需要引导或继续的工作留在进程内。

| Transport | 运行位置 | 继承父对话 | 派发后可引导 | 适用场景 |
|---|---|---|---|---|
| `subagent` | 进程内，与 TUI 同一事件循环 | 否 | 是 | 你可能需要引导或追问的工作 |
| `subagent_fork` | 进程内，与 TUI 同一事件循环 | 是——父会话已完成的回合作为子会话前缀，保持缓存可复用 | 是 | 需要父会话上下文的工作 |
| `subagent_isolated` | 独立进程，通过 ACP | 否 | 否 | 不应占用渲染循环的重度或并行自包含工作 |

隔离通道以功能换取隔离：它不接受 model、persona 或 tool filter，没有父级强制的递归上限，派发后也无法引导或追问。它从独立的 home 启动自己的 Harness profile，因此需要 `PATH` 上有一个能提供 `acp` profile 的 `dsh`；`OMDSH_ACP_COMMAND` 与 `OMDSH_ACP_ARGS` 可以覆盖启动方式。

## 跟进与引导

子代理运行时，队列与 composer 上方会显示一份 roster，包含任务名与生命周期状态；运行中、等待中和已完成的孩子分开计数。composer 为空时按 `Down` 聚焦它、按 `Enter` 打开所选孩子，或直接按 `Alt+A`。

Agent Hub 是全屏视图：roster 加检查面板。`Enter` 就地打开孩子的转录，`Tab` 与方向键切换面板，`PgUp`/`PgDn` 滚动，`T` 切换树视图。子转录在孩子运行期间保持实时；可继续的孩子会接受你的下一条 composer 消息或 `/steer <message>`，因此无需取消就能重定向正在运行的工作。一次性与隔离运行是只读视图。完整浮层按键见[键盘与快捷键](keyboard.md)。

## 编排工具

挂载的 Harness 组合在普通委派之外还提供给模型两个编排工具：

- `workflow_run` 接受一段 JavaScript 脚本，把工作按阶段扇出到多个子代理并收集结构化结果。脚本运行在 worker 线程而不是宿主事件循环上，因此大规模扇出不会卡住界面。
- `ralph` 用一茬茬新 agent 迭代同一个目标，直到某个 worker 报告完成或遇到阻塞。

`/workflow` 斜杠命令是另一回事：它选择会话的 Default 或 Plan workflow。见[命令](commands.md)。

## 后台任务

回合结束后继续运行的长任务会出现在 `/jobs` 中，带状态与已用时间；`/jobs kill <id>` 停止其中一个。后台任务完成时会在会话里发布一条完成通知。任务属于会话作用域，切换或恢复会话后不会保留。

## 相关

- [架构](architecture.md) —— 子智能体的归属与生命周期边界
- [命令](commands.md) —— `/steer`、`/jobs` 及其余命令目录
- [引导运行中的任务](tutorials/guide-a-turn.md) —— 排队、Loop 与任务进度
