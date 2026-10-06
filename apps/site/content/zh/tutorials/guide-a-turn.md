---
description: 在任务运行时用 next-turn 队列、Loop、Plan mode、待办和 /goal 引导 omdsh。
---

# 引导运行中的任务

读完本教程，你可以排队后续消息、用 Loop 重复任务、进入 Plan mode，并查看任务进度。

### 将后续消息加入队列

继续一个运行中的任务不需要特殊命令。在 `Deep Driving` 状态下照常提交消息，omdsh 会将它放入 next-turn 队列，队列显示在 Composer 正上方。

要在队列消息执行前修正它：在空 Composer 中按 `Up` 选中最新一条队列消息（再按 `Up` 可向更早的消息移动），修改文本后按 `Enter` 放回队列。整个过程不会中断当前工具调用。

如果想纠正当前任务，可输入指导文本后按 `Alt+S`，或使用 `/steer <message>`。Harness 会在下一次模型步骤前接收它，不会中断正在执行的工具调用。**Guidance · next step** 保留到消息被接收；**Queued · next turn** 则等待当前 Turn 结束。Enter 仍然进入下一轮队列。快捷键仅接受文本，附件请用 Enter 排队；被拒绝的纠正消息会留在输入框中。

按一次 `Ctrl+C` 会中断当前回合。在退出时间窗口内再次按 `Ctrl+C` 会离开 omdsh，因此如果还要继续当前会话，请不要立刻重复按键。

使用 `/queue` 或 `Alt+Q` 逐条管理待处理消息。实时列表分为当前 Turn 的 **Guidance**、下一 Turn 的 **Next turn** 和尚未交给 Agent 的 **Waiting**。输入文字可以筛选，方向键或 Tab 选择条目；Enter 编辑文本并保留图片和文件引用。`Alt+D` 删除一条，`Alt+↑`/`Alt+↓` 在同组内调整顺序，不跨越插件拥有的队列消息。Esc 取消，保留 composer 草稿和已接收的消息。

工具问答优先于队列页面。若编辑被问答打断，修改后的文本会回到 composer 作为未发送草稿，原队列条目保持不变。若模型在保存编辑之前取走原消息，修改内容同样还原为草稿，不会自动创建另一条消息。Guidance 和 follow-up 的修改由 Harness inbox 持久化；Waiting 中的消息在交付前只保存在内存中。

### 使用 Loop 重复执行 Prompt

用 `/loop` 处理每个回合完成后都需要再次执行的工作：

- `/loop 5 check the tests and fix the next failure` 会立即发送该 Prompt，并再重复五次。
- `/loop 10m inspect the latest result` 或 `/loop 1h30m keep improving the implementation` 则按时长重复。
- `/loop 5` 不带内联 Prompt 时，下一条普通 Composer 消息会成为被重复的 Prompt。

Loop 启用后，之后提交的普通消息会先进入现有的 next-turn 队列，随后替换要重复的 Prompt。固定 Footer 会显示 Loop 正在等待、运行、暂停还是刚刚完成：次数限制使用明确的重复进度，时长限制显示倒计时。Loop 不会向 Transcript 写入控制消息。

再次运行 `/loop` 可以关闭。循环执行期间按 `Ctrl+C` 会中断当前回合并暂停 Loop；再发送一条普通消息即可用新的 Prompt 恢复。Loop 被刻意设计为进程内状态，因此切换、恢复或重新打开会话时不会在后台意外重启。

### 修改文件前先制定计划

对于需要先调查再提出实现方案的任务，运行 `/plan`。Plan mode 会指导模型先进行只读检查，再通过审批流程提交可审阅的计划。

- `/plan <message>` 在进入 Plan mode 的同时发送第一条规划要求。
- `/plan off` 直接退出 Plan mode。

Composer 中的图片会随 `/plan` 和 `/goal` 一起提交（当这些命令接受附件时）；`/plan off` 以及其他不能使用图片的子命令会把草稿退回 Composer。

### 跟踪任务进度

当 Agent 写入 Todo 列表后，Composer 和队列上方会出现紧凑的任务树，分别表示已完成、当前和待处理工作。需要把当前状态固定到 Transcript 中时，运行 `/todo` 查看最新列表。

Todo 描述当前回合的工作，而 `/goal <objective>` 用于控制更长时间运行的目标。不带参数运行 `/goal` 可以查看当前状态和可用操作。被委派的子代理会出现在 composer 上方的 roster 和 Agent Hub 中；[子智能体与委派](../subagents.md)介绍了三种 transport 以及如何引导可继续的孩子。
