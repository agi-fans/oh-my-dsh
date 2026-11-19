---
description: Symptom-driven troubleshooting for omdsh startup, sign-in, credentials, keys, mouse and tmux, inline images, MCP/LSP, and plugins.
---

# Troubleshooting

Start any investigation with the built-in health check—it catches most runtime, credential, config, and plugin problems in one pass:

```sh
omdsh doctor
```

Run `omdsh doctor --json` for machine-readable output. Below are fixes organized by symptom.

## 1. Sign-in, credentials, and model errors

### DeepSeek account sign-in opens Desktop or never returns to the terminal
- Running `/login` → **`DeepSeek account`** opens the authorization flow with a local callback URL and finishes on a page containing `login_source=web` (“Authorization complete”). You can close that browser tab once it reports success; omdsh returns automatically.
- If the browser launches DeepSeek Harness Desktop (`login_source=desktop` or missing `login_source`), close that tab and start a fresh `/login` flow from omdsh instead of reusing an old link.
- **Over SSH:** Forward the local callback port printed by omdsh (`ssh -L <port>:127.0.0.1:<port> ...`) so your local browser can reach the remote TUI.

### Saved API key does not take effect, or credential file permission errors
- Environment variables such as `DEEPSEEK_API_KEY` take precedence over stored files and are never modified by `/login` or `/logout`. Check `env | grep DEEPSEEK` for stale exports.
- On macOS/Linux, `$OMDSH_HOME/.credentials.yaml` must be owner-readable only (`chmod 600 ~/.dsh/.credentials.yaml`).

### Content refusal (`CONTENT_REFUSED`)
- When DeepSeek refuses a request for policy reasons, the interactive TUI displays the refusal message directly and `omdsh exec --json` returns error code `CONTENT_REFUSED`. Rephrase or trim the triggering input and retry.

## 2. Keyboard, newline, and paste issues

### `Alt+...` inserts characters like `å` or `¥` on macOS
- macOS terminals default `Option` to special characters instead of sending `Alt/Meta`.
- **Fix:** Enable “Use Option as Meta key” in your terminal preferences (iTerm2, Ghostty, WezTerm, Apple Terminal), then verify in `/settings` → **`Terminal` → `Input` → `Keybindings` → `Test keys`**.

### `Shift+Enter` sends the message instead of inserting a newline
- Legacy terminals do not distinguish `Shift+Enter` from `Enter`. Use **`Ctrl+J`** (works everywhere), or switch to a terminal supporting the Kitty keyboard protocol (Kitty, Ghostty, WezTerm, modern iTerm2).

### Multi-line paste submits early, or typing feels slightly delayed
- **Paste protection** uses heuristics to stop unmarked multi-line pastes from submitting prematurely. If it interferes with your terminal, turn it off under `/settings` → **`Terminal` → `Input`**; terminals that support bracketed paste still protect pastes safely.

### `Esc` or `Ctrl+C` behaves oddly in your shell after a crash
- omdsh restores your terminal’s original keyboard mode on exit, `Ctrl+Z`, and external editor handoff. If a hard kill leaves Kitty keyboard mode active, run:

```sh
printf '\033[<u'
```

## 3. Mouse selection, scrollback, colors, and tmux

### Dragging with the mouse does not select text
- `Mouse interaction` defaults to `Auto` so scroll-wheel and click controls work inside omdsh. Hold **`Shift`** (or **`Option`** in some macOS terminals) while dragging for native terminal selection, or set `/settings` → **`Terminal` → `Mouse interaction`** to **`Off`** (`native`) to hand mouse selection completely back to your terminal.
- When in-app selection is enabled, releasing the drag copies automatically unless you disable `Copy on select` (then use `Alt+C` or `Enter`).

### Garbled layout after resizing tmux/screen, or older lines look different when scrolling up
- **Stale screen after resize/reattach:** Press **`Alt+L`** to repaint the live view without clearing scrollback.
- **Why do scrolled-off lines still show older expanded states?** omdsh never rewrites lines that have crossed into native terminal scrollback—they remain immutable snapshots of what appeared at the time. **Only the live view below the latest divider is the current transcript.**

### Missing colors or wrong palette
- `NO_COLOR` or `FORCE_COLOR=0` disables colors unless you explicitly enable colors in `/settings` (which takes effect immediately).
- Apple Terminal falls back to 256 colors due to unreliable truecolor support; export `COLORTERM=truecolor` to force 24-bit color.

## 4. Inline images, sessions, MCP/LSP, and plugins

### Inline image preview does not render (or fails inside tmux)
- Inline previews require Kitty or iTerm2 graphics support (Kitty, Ghostty, WezTerm, Warp, iTerm2). In unsupported terminals, click **`Open`** in the preview to launch your system image viewer.
- Override protocol detection with `OMDSH_IMAGE_PROTOCOL=kitty|iterm2|none`.

### `/resume` does not show yesterday’s session
- `/resume` lists sessions tied to your **current working directory**. Change back to the original project folder, or launch with `omdsh --resume <session-id>`. Use `/resume <query>` inside the original directory to search full session text.

### MCP server shows `waiting for credentials` or `failed`
- Open `/mcp` and select the server:
- `waiting for credentials`: Store the missing `${credential:...}` secret and choose **`Restart`**.
- `failed`: Read the error detail, verify the binary with `!which <cmd>`, then run **`Probe`**.

### Language server (`lsp`) unavailable
- Verify the language server binary (`typescript-language-server`, `gopls`, `rust-analyzer`, etc.) is on `PATH` and your `lsp.json` is valid. See [Language servers](language-servers.md).

### Plugin fails to load or its command is missing
- Run `omdsh doctor` and `omdsh --dump-config` to check DeepSeek Harness version compatibility, missing `dsh.bundle.patch`, or duplicate dependencies.
- Remove a broken package with `omdsh plugin remove <package>`.
- In interactive runs, plugin `console` logs are redirected to **`$OMDSH_HOME/omdsh/logs/omdsh.log`** so they never corrupt the TUI—inspect or delete that file anytime.

### Interrupting, exiting, and piped runs
- **Interrupt vs. exit:** While busy, `Esc` or `Ctrl+C` (on an empty input box) interrupts only the active turn. At idle, press **`Ctrl+C` twice** (or `Ctrl+D` when empty) to exit and print `omdsh --resume <session-id>`.
- **Stuck background job or missed prompt:** Check `/jobs` to stop runaway commands or `/questions` for pending questions.
- **Non-TTY / CI usage:** When stdin or stdout is not a TTY, omdsh switches to line-oriented append-only output. For scripts and CI, prefer `omdsh exec --json`—see [Command line](cli.md).

## Related

- [Command line](cli.md) — `omdsh doctor`, `omdsh exec`, and environment variables
- [Sessions and recovery](sessions.md) — local file paths and legacy log compatibility
- [Settings](settings.md) — mouse, theme, notifications, and keybindings
