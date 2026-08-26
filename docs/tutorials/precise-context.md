# Give the agent precise context

[English](precise-context.md) | [简体中文](precise-context.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Complete your first task](first-task.md) · Next: [Guide an active turn](guide-a-turn.md)

### Mention files and sessions

Type `@` followed by part of a project path or session title. The popup lists workspace files first, then other sessions; use the arrow keys to move and `Tab` to insert the selected row. File picks insert a path through Harness file-reference discovery; they do not upload file contents. Session picks insert a mention that omdsh later replaces with a read-only snapshot of that session for the model.

Mentions stay highlighted in your message. File mentions give the agent an explicit path that it can inspect with its normal tools; they do not upload file contents. Session mentions do not resume or fork the source session.

```text
Compare @packages/tui/omdsh-tui/src/chrome/renderer.ts with @packages/tui/omdsh-tui/src/chrome/renderer.spec.ts and explain the missing edge case before editing.
```

`./` and `~/` also open path completion. The completion inserts a path; it does not bypass tool permissions or silently upload file contents.

### Add screenshots and images

Copy an image and press `Ctrl+V`. When the platform clipboard reader is available, the composer inserts a compact image marker instead of a temporary path; submit it with any explanatory text as one message, or send it with `/goal` or `/plan`. Pasting an image file path also imports that image when it can be read. The default DeepSeek catalog includes the image-capable `deepseek-v4-flash-vision-exp`; the other default DeepSeek models stay text-only. A deployment that wants native image requests on another model must list `inputModalities: [text, image]` on that model.

On Linux, native image paste uses `wl-paste` under Wayland or `xclip` under X11. If neither command is available, text paste continues to work but direct clipboard-image capture is unavailable. Images are checked against Harness source admission as they are pasted — 20 MiB, 64,000,000 pixels, and 8192px per side by default. An admitted source is then normalized for storage to a 2048px long edge and 4 MiB encoded cap. Those source and storage limits are not the later request-image budgets a vision route applies when preparing a model request. A refused image shows an error notice and stays out of the prompt. Sending a message with several images admits them as one ordered batch: if any image is refused, the composer text and drafts stay put.

### Write structured prompts

Use `Shift+Enter`, `Alt+Enter`, or `Ctrl+J` for a newline. For a longer request, press `Ctrl+X` to edit the current draft in `$VISUAL` or `$EDITOR`, then return it to the composer.

```text
Goal: remove the duplicate loading row.

Constraints:
- keep the composer anchored
- preserve CJK display width
- add a regression test

Verification: run the focused TUI test and typecheck.
```

[Tutorials](../tutorials.md) · Previous: [Complete your first task](first-task.md) · Next: [Guide an active turn](guide-a-turn.md)
