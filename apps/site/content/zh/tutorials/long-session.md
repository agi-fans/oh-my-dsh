---
description: 恢复、回退、压缩并导出长 omdsh 会话，包括两次 Ctrl-C 退出后的 omdsh --resume 提示。
---

# 恢复并管理长会话

读完本教程，你可以在退出后恢复会话、回退到更早的回合、压缩旧历史，并导出 Transcript。

### 退出后恢复

第一次 `Ctrl+C` 会清空输入或中断，第二次则退出。当活动会话可以持久化时，omdsh 会输出一条以后可以直接粘贴的命令：

```sh
omdsh --resume <session-id>
```

在 TUI 内运行 `/resume` 会打开可搜索的会话选择器，其中包含最近一条用户消息的预览、更新时间、Event 数量和完成状态。如果已经知道会话 ID，可以使用 `/resume <session-id>` 跳过选择器。

### 在不破坏历史的情况下回退

当 Agent 处于空闲且 Composer 为空时，连续按两次 `Esc` 可以打开对话轮次选择器。选择一条用户消息后，omdsh 会从该消息之前的历史创建一个新分支，并把原始 Prompt 恢复到 Composer。原会话仍然保留在 `/resume` 中，因此回退是可恢复的，而不是破坏性操作。

两个邻近命令覆盖回退之外的场景：

- `/retry` 把最近一条用户 Prompt 作为新回合重新提交。
- `/new` 从空白状态开始新会话，而不是从当前会话分支。

### 压缩与导出

Agent 空闲时运行 `/compact`，可以用摘要替换一段有价值的旧历史。压缩状态会一直保持到持久化检查点完成；完成前请等待，不要开始其他会话操作。如果历史不足，命令会直接说明当前没有可压缩内容。

运行 `/export` 会在当前目录将完整 Transcript 写入 `omdsh-transcript-<session-id>.md`，也可以提供目标路径：

```text
/export docs/session-review.md
```
