# Give the agent precise context

[English](precise-context.md) | [简体中文](precise-context.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Complete your first task](first-task.md) · Next: [Guide an active turn](guide-a-turn.md)

### Mention project files

Type `@` followed by part of a project path. The popup searches the workspace; use the arrow keys to move and `Tab` to insert the selected path. Mentions stay highlighted in your message and give the agent an explicit file target that it can inspect with its normal tools.

```text
Compare @packages/tui/omdsh-tui/src/chrome/renderer.ts with @packages/tui/omdsh-tui/src/chrome/renderer.spec.ts and explain the missing edge case before editing.
```

`./` and `~/` also open path completion. The completion inserts a path; it does not bypass tool permissions or silently upload file contents.

### Add screenshots and images

Copy an image and press `Ctrl+V`. When the platform clipboard reader is available, the composer inserts a compact image marker instead of a temporary path; submit it with any explanatory text as one message. Pasting an image file path also imports that image when it can be read.

On Linux, native image paste uses `wl-paste` under Wayland or `xclip` under X11. If neither command is available, text paste continues to work but direct clipboard-image capture is unavailable.

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
