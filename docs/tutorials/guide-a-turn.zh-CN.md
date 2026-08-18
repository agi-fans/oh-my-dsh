# 引导运行中的任务

[English](guide-a-turn.md) | 简体中文

[教程](../tutorials.zh-CN.md) · Previous: [提供精确的项目上下文](precise-context.zh-CN.md) · Next: [恢复并管理长会话](long-session.zh-CN.md)

### 将后续消息加入队列

继续一个运行中的任务不需要特殊命令。在 `Deep Driving` 状态下照常提交消息，omdsh 会将它放入 next-turn 队列。队列会立即显示在 Composer 上方，便于确认当前回合结束后将要执行的内容。

Composer 为空时，按 `Up` 可以取回最新的队列消息进行编辑。连续按 `Up` 会继续向更早的队列消息移动；修改选中文本后按 `Enter`，即可将其重新放回队列。这样可以在不中断当前工具调用的情况下修正后续要求。

按一次 `Ctrl+C` 会中断当前回合。在退出时间窗口内再次按 `Ctrl+C` 会离开 omdsh，因此如果还要继续当前会话，请不要立刻重复按键。

### 使用 Loop 重复执行 Prompt

需要在每个回合完成后再次执行同一项工作时，可以使用 `/loop`。`/loop 5 检查测试并修复下一个失败` 会立即发送 Prompt，并在之后再重复五次。时长限制支持紧凑写法，例如 `/loop 10m 检查最新结果` 或 `/loop 1h30m 持续改进实现`。

如果希望用下一条普通消息作为循环 Prompt，可以先运行不带内联 Prompt 的 `/loop 5`。Loop 启用后，之后提交的普通消息仍会进入现有 next-turn 队列，同时替换下一轮要重复的 Prompt。固定 Footer 会显示 Loop 正在等待、运行、暂停还是刚刚完成；次数限制使用明确的重复进度，时长限制显示倒计时，并且这些控制反馈不会写入 Transcript。

再次运行 `/loop` 可以关闭。循环执行期间按 `Ctrl+C` 会中断当前回合并暂停 Loop；再发送一条普通消息即可用新的 Prompt 恢复。Loop 被刻意设计为进程内状态，因此切换、恢复或重新打开会话时不会在后台意外重启。

### 修改文件前先制定计划

对于需要先调查再提出实现方案的任务，运行 `/plan`。Plan mode 会指导模型先进行只读检查，再通过 Harness 审批流程提交可审阅的计划。运行 `/plan off` 可以直接退出；也可以使用 `/plan <message>`，在进入 Plan mode 的同时发送第一条规划要求。

### 跟踪任务进度

当 Agent 写入 Todo 列表后，Composer 和队列上方会出现紧凑的任务树，分别表示已完成、当前和待处理工作。需要将当前状态固定到 Transcript 中时，可以运行 `/todo` 查看最新列表。Todo 描述当前回合的工作，而 `/goal <objective>` 用于控制更长时间运行的 Harness Goal；不带参数运行 `/goal` 可以查看当前状态和可用操作。

[教程](../tutorials.zh-CN.md) · Previous: [提供精确的项目上下文](precise-context.zh-CN.md) · Next: [恢复并管理长会话](long-session.zh-CN.md)
