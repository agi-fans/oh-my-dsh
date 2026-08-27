---
description: Point omdsh at exact files and sessions with @ mentions, paste clipboard images, and write structured multiline prompts.
---

# Give the agent precise context

By the end of this walkthrough you can point the agent at exact files and sessions, attach screenshots, and write structured multi-line prompts.

### Mention files and sessions

Type `@` followed by part of a project path or session title. The popup lists workspace files first, then other sessions; move with the arrow keys and press `Tab` to insert the selected row.

A file mention inserts the path only: the agent reads the file with its normal tools, and no file contents are uploaded with your message. A session mention inserts a marker that omdsh replaces with a read-only snapshot of that session for the model; it does not resume or fork the source session. Mentions stay highlighted in the composer.

```text
Compare @packages/tui/omdsh-tui/src/chrome/renderer.ts with @packages/tui/omdsh-tui/src/chrome/renderer.spec.ts and explain the missing edge case before editing.
```

Typing `./` or `~/` opens plain path completion. It inserts a path; it does not bypass tool permissions or upload contents.

### Add screenshots and images

Copy an image and press `Ctrl+V`. The composer inserts a compact image marker; add any explanatory text and submit them as one message, or send the image with `/goal` or `/plan`. Pasting an image file path also imports that image when it can be read.

Image paste needs the platform clipboard reader. On Linux it uses `wl-paste` under Wayland or `xclip` under X11; if neither is installed, text paste keeps working but clipboard images are unavailable.

The default DeepSeek catalog includes the image-capable `deepseek-v4-flash-vision-exp`; the other default DeepSeek models stay text-only. A deployment that wants native image requests on another model must list `inputModalities: [text, image]` on that model.

Pasted images are checked on admission and normalized for storage:

- Sources are accepted up to 20 MiB, 64,000,000 pixels, and 8192px per side.
- An accepted image is stored at a 2048px long edge and a 4 MiB encoded cap.
- A refused image shows an error notice and stays out of the prompt.
- A message with several images is admitted as one ordered batch; if any image is refused, the composer text and drafts stay put.

These checks apply at paste and storage time; the vision model applies its own image budget later, when the request is prepared.

### Write structured prompts

Use `Shift+Enter`, `Alt+Enter`, or `Ctrl+J` for a newline. For a longer request, press `Ctrl+X` to edit the current draft in `$VISUAL` or `$EDITOR`; leaving the editor returns the text to the composer.

```text
Goal: remove the duplicate loading row.

Constraints:
- keep the composer anchored
- preserve CJK display width
- add a regression test

Verification: run the focused TUI test and typecheck.
```
