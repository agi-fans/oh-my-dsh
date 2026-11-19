---
description: Complete omdsh slash-command reference — sessions, models and settings, turn and team control, /diff and file/image readers, clipboard/export, and Skills.
---

# Commands

Type `/` in the input box to search commands by name, alias, description, or localized task keywords. Commands that operate on existing items—such as `/model` and `/resume`—also complete their arguments. `[brackets]` mark optional arguments, `|` marks alternatives, and commands with interactive pickers work without arguments.

> Common document-reader keys (`/help full`, `/changelog`, `/context` details, and `[Read]` on long command output): wheel or `↑`/`↓`/`PgUp`/`PgDn` to scroll, `/` to find, `Ctrl+N`/`Ctrl+P` to cycle matches, `S` for sections, `Y` to copy the page or a field, `Esc` to go back.

## Sessions

| Command | Action |
|---|---|
| `/new` | Start a fresh, empty session (use `/agent` before sending the first message to change presets). |
| `/resume [session-id\|query]` | Open the current directory’s Session Library; pass a query for full-text search, or an ID to resume directly. |
| `/continue` | Continue a transiently failed generation without re-sending your prompt (`Alt+R` when empty). |
| `/retry` | Re-send your last user prompt with its original text, images, and files as a new turn. |
| `/clear` | Clear visible transcript below a labeled divider (native scrollback, active queues, and Todos stay intact). |
| `/name <title>` | Rename the active session (manual titles are not overwritten by auto-titling). |

## Models, accounts, and configuration

| Command | Action |
|---|---|
| `/login` | Sign in with a DeepSeek account, save an API key, activate a built-in provider, or add a custom API provider. |
| `/logout` | Sign out of the shared DeepSeek account or remove locally stored API keys (environment variables stay untouched). |
| `/settings` (alias `/set`) | Open the bottom-docked settings panel directly above the live status footer. |
| `/permission` | Switch session access (`Read only` / `Workspace write` / `Full access` / `Auto review`) or manage remembered approval rules. |
| `/agent` | Pick an Agent preset on a blank session (`Standard`, `PTC`, `Minimal`, `Creator`); `/agent inspect [preset-id]` inspects composition; `/agent creator` launches Creator without changing your default preset. |

### `/model` forms

| Form | Effect |
|---|---|
| `/model` | Open the searchable model picker across all providers: `Enter` updates the saved default, `Ctrl+D` applies to this session only; `Alt+F` toggles favorite, `Alt+A` switches all/favorites, `Alt+R` refreshes. |
| `/model <query>` | Resolve `provider/model` or fuzzy match; switches immediately on an exact hit or opens a filtered picker. |
| `/model --session [query]` | Switch for this session only without changing the saved default. |
| `/model favorite` / `/model unfavorite` | Add or remove the active model from your quick-cycle favorites (`Ctrl+P` / `Alt+P`). |
| `/model favorites` | Open the favorite-models picker. |
| `/model next` / `/model previous` | Cycle to the next or previous favorite model. |
| `/model reasoning` | Cycle reasoning effort for the active model. |

## Turn control, long tasks, and teams

| Command | Action |
|---|---|
| `/plan [off\|<message>]` | Enter Plan mode (optionally sending an initial prompt with attachments); `off` exits. |
| `/btw <question>` | Ask a read-only side question against committed conversation context without polluting the main thread. |
| `/queue` | Inspect, edit, reorder, promote to steer, or delete pending messages (`Alt+Q`). |
| `/goal [<objective>\|edit <objective>\|pause\|resume\|clear]` | Set or manage a multi-turn session goal (`Alt+G` opens the panel). |
| `/team [on\|off\|status]` | Toggle Agent Teams (`on`/`off`), open the interactive shared task board (`/team`), or print a Markdown summary (`/team status`). |
| `/jobs [<id>\|kill <id>]` | Browse background jobs, tail output live, or confirm stopping a job. |
| `/schedule` | Manage scheduled reminders for this session (pause, resume, run now, edit, delete, delivery history). |
| `/questions` | Answer questions left waiting after a countdown (including after `/resume`). |
| `/compact [focus]` | Summarize earlier conversation history while keeping queued inputs working (`Ctrl+O` opens the saved summary). |

### Key workflow details

- **Plan mode (`/plan`):** The agent investigates and submits a plan in a scrollable review view. Choose **`Approve`** to exit Plan mode and implement, or **`Keep planning`** to send revision feedback (`Ctrl+X` opens your external editor). Execution permissions remain controlled by `/permission`.
- **Side queries (`/btw`):** Runs in an isolated read-only context using the active model and effort (no tools, 8,192-token output cap) and streams above the input box. Dismissing with `Esc` folds it into a `/btw <question>` row without adding it to future main-thread context; expand later with `Ctrl+O` or copy with `/copy`.
- **Long goals (`/goal`):** Press `Alt+G` for the control panel. After restarting and resuming a session with an active goal, the bar waits in **`Goal waiting`** until you explicitly authorize continuing.
- **Agent Teams (`/team`):** `/team on` exposes `team_task_*` tools to the root agent and continuable subagents. The interactive board shows status (`pending (ready)`, `pending (blocked)`, `in progress`, `completed`), owner, and write-scope overlap warnings; press `Enter` on any task for full details. Running `/team` inside a subagent resolves to the root agent. See [Subagents and Agent Teams](subagents.md).
- **Background jobs (`/jobs`):** Streams up to the latest ~256 KiB / 10,000 lines (scroll up to pause, `End` to follow) **without affecting the agent’s own output reading**. Stopping requires confirmation.
- **Scheduled reminders (`/schedule`):** Supports one-click `Run now` (without altering the schedule) and paginated delivery history (20 receipts per page; receipts confirm inbox delivery, not model completion). Creating or changing schedules is done via the agent’s `schedule_*` tools.

## Diagnostics, extensions, and tools

| Command | Action |
|---|---|
| `/context` | Open the live 5×8 occupancy grid, estimated breakdown, and session stats, with `Details`, `Copy session ID`, and `Compact` actions. |
| `/diff [path\|turn [number]]` | Open the interactive diff viewer for current Git changes or a saved turn snapshot (`/diff turn`); never stages or commits. |
| `/trajectory` | Inspect turns, steps, and tool calls with duration, status, decoded input/result, and raw events; supports slowest-first (`s`), errors-only (`e`), and full search (`/`). |
| `/mcp` | Add, enable/disable, `probe`, `restart`, and remove live MCP servers, plus inspect static `mcp.json` entries, tools, and the last 10 calls. |
| `/plugins` | Browse `Discover`, install/update/remove plugins, configure built-in integrations (Codex, Claude Code, Worktree, Auto review), or launch `/agent creator`. |
| `/tools` | Search every tool visible to the agent and read its full description. |

## `/diff`, file attachments, and image viewer

| Command | Action |
|---|---|
| `/attach [path]` | Stage a file attachment in your draft without sending; run without a path to list stored session attachments and preview images. |

Start a line with `!command` in an empty input box to run a persistent shell command locally (`!!command` shares output with the model). See [Keyboard and mouse](keyboard.md#shortcut-shell-command-and-command).

### Diff and source reader controls

- **Layout:** Side-by-side file list and viewer at ≥100 columns, single-pane on narrower terminals (`Tab` switches panes, `Enter` opens, `A` actions menu, `?` help).
- **Views & movement:** `V` toggles diff vs. current file; `[` / `]` jumps hunks; `/` or `Ctrl+F` searches (`Ctrl+N`/`Ctrl+P` matches); `G` jumps to a line; `W` toggles wrap and `Alt+←`/`Alt+→` pans horizontally; `M` toggles Markdown source/rendered view.
- **Large files:** Loads the first 128 KiB and doubles with `L` (`Load more`) up to 4 MiB. Press `O` to open in your system app or `E` for your configured external editor.
- **Quote straight into your prompt:** Select lines and press **`Alt+Y`** or **`Q`** to append a Markdown quote into the input box (with no selection, `Q` inserts `@path:line`).

### Image preview and attachment notes

- Press **`Alt+M`** to preview draft images (or the latest session image), or open stored images from `/attach` (supports PNG, JPEG, WebP, GIF).
- Inline graphics render automatically in Kitty, Ghostty, WezTerm, Warp, iTerm2, and compatible terminals; in tmux/screen/Zellij use **`Open`** for your system viewer, or override detection with `OMDSH_IMAGE_PROTOCOL=kitty|iterm2|none`.
- Preview decoding supports up to 32 MiB / 40 MP (scaled to 2048 px per side); model attachments support up to 20 MiB per image.

## Clipboard, export, Skills, and app

| Command | Action |
|---|---|
| `/copy` | Pick what to copy: recent assistant replies, individual fenced code blocks, recent shell output, or completed `/btw` answers (`Alt+C` copies active text selections first). |
| `/export [markdown\|html\|archive] [path]` | Export as Markdown, HTML, or a ZIP archive with child subagents and original attachments (refuses to overwrite existing files). |
| `/changelog [full]` | Browse release notes by version (`S` for categories); `full` shows the complete packaged history. |
| `/<skill-name>` | Run an installed project or user Skill (accepts images and files); built-in commands take precedence on name collisions. See [Skills and MCP](skills-and-mcp.md). |
| `/help [full]` (aliases `/h`, `/?`) | Search and insert commands; `Alt+K` or `full` opens active keyboard shortcuts. |
| `/quit` (aliases `/q`, `/exit`) | Exit omdsh. |

## Related

- [Keyboard and mouse](keyboard.md) — editing, navigation, and `keybindings.json`
- [Settings](settings.md) — every option under `/settings`
- [Permissions and safety](permissions.md) — access levels and approval rules
- [Command line](cli.md) — CLI flags, `omdsh doctor`, and `omdsh exec`
