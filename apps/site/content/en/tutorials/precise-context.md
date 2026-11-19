---
description: Choose between @file, /attach, @session, and screenshots, run quick shell commands with !cmd, and ask side questions with /btw.
---

# Give precise context and quick inputs

The fastest way to get accurate edits from a coding agent is to hand it exact context up front—and to run quick lookups or shell checks without derailing your main conversation. This guide covers the six everyday input habits that pay off immediately.

## Choose the right way to share context

| Method | What it does | Best for |
|---|---|---|
| `@path` or `./path` | Inserts a highlighted file path so the agent reads the file on demand | **Everyday default.** Pointing to source, config, or test files inside your repo without flooding context. |
| `/attach <path>` | Explicitly attaches a file to your next message | Sharing reference specs, logs, or files outside the current directory. |
| `@session` (type `@` and pick a session) | Inserts a read-only snapshot of an earlier session without switching away | Carrying yesterday’s debugging conclusions into a fresh task. |
| Paste or attach an image | Sends a screenshot or mockup to a vision-capable model | Error screenshots, UI layout bugs, terminal comparisons, or diagrams. |

## 1. Point to files and past sessions with `@`

Type `@` in the input box and keep typing any part of a filename (for example `@auth` or `@user.spec`). A completion list appears below the input box:

- Use `↑` / `↓` to pick an entry and `Tab` or `Enter` to insert it.
- Typing `./` or `~/` also triggers path completion for relative or home-directory paths.

A strong prompt states **the goal, the exact files, and the boundary or verification**:

- Vague: `Login seems broken, please check.` (forces the agent to search broadly and guess your intent)
- Precise:

```text
@src/auth/session.ts @src/auth/session.spec.ts
Check whether token refresh has a race condition when two requests expire at once. Keep the public signature unchanged, add a failing test first, then fix it.
```

### Reference an earlier session

To pull context from a previous conversation without dragging in hundreds of old turns, type `@` and select the earlier session:

```text
Using the findings from @payment-timeout-investigation, check whether @src/orders/checkout.ts has the same retry timeout risk.
```

omdsh attaches a read-only snapshot of that session while leaving the original session untouched.

## 2. Attach files explicitly with `/attach`

When a file lives outside your workspace or you want to attach it directly to the message:

```text
/attach ../specs/api-v2.md
```

You can attach multiple files before sending your prompt. Running `/attach` with no arguments opens the viewer for stored image attachments.

## 3. Paste and preview screenshots

> **Check model vision support first:** Many default text models reject images. With DeepSeek, switch via `/model` to an image-capable model (such as `deepseek-flash`) before sending screenshots.

Three ways to attach an image:

- **Paste from clipboard:** `Cmd+V` (or `Ctrl+V`) on macOS, `Ctrl+V` on Linux, `Ctrl+Alt+V` on Windows/WSL.
- **Drag and drop** an image file onto the terminal, or run `/attach /path/to/screenshot.png`.

The input box displays a compact placeholder like `[Image #1]`:

- Press `Alt+M` to preview draft images (inline in Kitty, Ghostty, WezTerm, iTerm2, and compatible terminals, with an `Open` option for your system viewer).
- Press `Backspace` on the placeholder to remove the whole image.
- **Size note:** Individual images can be up to 20 MiB; oversized resolutions are automatically scaled before sending to protect your context budget. See [Commands](../commands.md) for exact limits.

## 4. Draft long prompts cleanly

- **Multiline and external editor:** Press `Shift+Enter` or `Ctrl+J` for newlines. For long specs or detailed review feedback, press `Ctrl+X` to write in your external editor and return automatically when you save and close.
- **Stash a draft:** Need to ask something else mid-draft? Press `Ctrl+S` to stash the current text and press `Ctrl+S` again later to restore it.
- **Large pastes:** Multi-line pastes fold into a `[Pasted N lines]` token so the input box stays tidy. Press `Alt+I` to expand and edit inline. Pasted text starting with `/` is kept literal rather than accidentally running as a slash command.

## 5. Run quick shell commands with `!command`

When you want to check `git status`, run a single test, or inspect a port without leaving omdsh or spending model tokens:

- Type **`!`** in an empty input box (the border turns green), then your command:

```text
!git status -sb
```

- **`!command` (single bang):** Runs locally and prints output for you only—**never added to model context**.
- **`!!command` (double bang):** Runs locally and **automatically shares the output with the agent** so it can analyze the error or test output immediately.
- The shortcut shell is **persistent**, so `!cd packages/api` carries over to the next `!` command. Press `Ctrl+C` (or `Esc` from an empty input box) to stop a long-running command.

## 6. Ask side questions with `/btw` without cluttering the thread

If a side question pops up mid-refactor (“Does Node 22 support `AbortSignal.any`?” or “Is that status enum hardcoded in our SQL migrations?”), send it with `/btw`:

```text
/btw Is the OrderStatus enum we just changed hardcoded anywhere in the migration scripts?
```

- `/btw` runs a **read-only side query** using the committed conversation context, without editing files or adding the answer to future main-thread context.
- The answer streams into a compact side view; press `Esc` to dismiss it and keep going.
- You can always re-expand the collapsed `/btw` row later with `Ctrl+O` or copy it with `/copy`.

## Next steps

Now that your inputs are sharp, learn how to steer the agent once it is actively running:

- [Steer long tasks and background work](guide-a-turn.md) — `/plan`, queueing vs. steering vs. interrupting, `/goal`, `/jobs`, and `/schedule`.
