---
description: 用 @ 提及把 omdsh 指向精确的文件和会话，粘贴剪贴板图片，并编写结构化的多行 Prompt。
---

# 提供精确的项目上下文

读完本教程，你可以把 Agent 精确指向某个文件或会话、附加截图，并编写结构化的多行 Prompt。

### 提及文件和会话

输入 `@`，再输入项目路径或会话标题中的一部分。弹出列表会先列出工作区文件，再列出其他会话；使用方向键移动，并按 `Tab` 插入选中的行。

文件 mention 只插入路径：Agent 会用普通工具自行读取文件，消息不会上传文件内容。会话 mention 会插入一个标记，omdsh 随后把它替换为该会话的只读快照提供给模型；它不会 resume 或 fork 源会话。Mention 在 Composer 中保持高亮。

```text
对比 @packages/tui/omdsh-tui/src/chrome/renderer.ts 与 @packages/tui/omdsh-tui/src/chrome/renderer.spec.ts，编辑前先解释缺失的边界场景。
```

输入 `./` 或 `~/` 会打开普通路径补全。它只插入路径，不会绕过工具权限，也不会上传内容。

### 添加截图和图片

复制图片后按 `Ctrl+V`。Composer 会插入一个紧凑的图片标记；补充说明文字后即可作为一条消息发送，也可以随 `/goal` 或 `/plan` 一起提交。粘贴可读取的图片文件路径时，也会导入对应图片。

图片粘贴依赖平台剪贴板读取器。在 Linux 上，它在 Wayland 下使用 `wl-paste`，在 X11 下使用 `xclip`；如果两者都不存在，文本粘贴仍然可用，但无法直接捕获剪贴板图片。

默认 DeepSeek catalog 包含可处理图片的 `deepseek-v4-flash-vision-exp`；其余默认 DeepSeek 模型仍是纯文本。若部署要让其他模型接受原生图片请求，须在该模型上声明 `inputModalities: [text, image]`。

粘贴的图片会先通过准入检查，再规范化存储：

- 源图最大 20 MiB、64,000,000 像素、单边 8192px。
- 获准的图片存储为长边 2048px、编码数据不超过 4 MiB。
- 被拒绝的图片会显示错误提示，不会进入 Prompt。
- 一条消息携带多张图片时会按顺序一次性准入；任一图片被拒绝时，Composer 文本和草稿都会保留。

这些检查发生在粘贴与存储阶段；之后视觉模型在准备请求时还会应用自己的图片预算。

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
