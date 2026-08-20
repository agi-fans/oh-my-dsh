# 提供精确的项目上下文

[English](precise-context.md) | 简体中文

[教程](../tutorials.zh-CN.md) · Previous: [完成第一个任务](first-task.zh-CN.md) · Next: [引导运行中的任务](guide-a-turn.zh-CN.md)

### 提及文件和会话

输入 `@`，再输入项目路径或会话标题中的一部分。弹出列表会先列出工作区文件，再列出其他会话；使用方向键移动，并按 `Tab` 插入选中的行。选中文件会通过 Harness file-reference 发现插入路径，不会上传文件内容；选中会话会插入 mention，omdsh 随后会为模型捕获该会话的只读快照。

Mention 会在消息中保持高亮。文件 mention 为 Agent 提供明确路径，随后 Agent 可以使用普通工具读取它，不会上传文件内容。会话 mention 不会 resume 或 fork 源会话。

```text
对比 @packages/tui/omdsh-tui/src/chrome/renderer.ts 与 @packages/tui/omdsh-tui/src/chrome/renderer.spec.ts，编辑前先解释缺失的边界场景。
```

输入 `./` 和 `~/` 也会打开路径补全。补全只负责插入路径，不会绕过工具权限，也不会静默上传文件内容。

### 添加截图和图片

复制图片后按 `Ctrl+V`。当平台剪贴板读取器可用时，Composer 会插入紧凑的图片标记，而不是临时文件路径；补充说明文字后即可作为一条消息发送，也可以随 `/goal` 或 `/plan` 一起提交。粘贴可读取的图片文件路径时，也会导入对应图片。默认 DeepSeek catalog 模型仍是纯文本；若部署需要原生图片请求，须在该模型上声明 `inputModalities: [text, image]`。

在 Linux 上，原生图片粘贴在 Wayland 下使用 `wl-paste`，在 X11 下使用 `xclip`。如果两者都不存在，文本粘贴仍然可用，但无法直接捕获剪贴板图片。

### 编写结构化 Prompt

使用 `Shift+Enter`、`Alt+Enter` 或 `Ctrl+J` 插入换行。对于更长的任务，按 `Ctrl+X` 可以在 `$VISUAL` 或 `$EDITOR` 中编辑当前草稿，退出编辑器后内容会返回 Composer。

```text
目标：移除重复的加载状态行。

约束：
- 保持 Composer 固定在底部
- 保持 CJK 显示宽度正确
- 增加回归测试

验证：运行相关 TUI 测试和 typecheck。
```

[教程](../tutorials.zh-CN.md) · Previous: [完成第一个任务](first-task.zh-CN.md) · Next: [引导运行中的任务](guide-a-turn.zh-CN.md)
