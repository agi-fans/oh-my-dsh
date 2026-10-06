---
description: Complete omdsh slash-command reference with arguments for sessions, configuration, turn control, observability, clipboard output, and Skills.
---

# Commands

Type `/` in the composer to browse the live catalog with inline argument hints, or run `/help` for the command list plus the essential shortcuts (`/help full` adds the complete keyboard catalog). The catalog is assembled from the active plugins, so commands contributed by Skills and user bundles appear beside the built-ins. `/help` groups what the TUI handles as terminal commands and what the mounted Harness composition provides as agent commands.

`[brackets]` mark optional arguments and `|` separates alternatives. A command with a picker runs without arguments.

## Sessions

| Command | What it does |
|---|---|
| `/new` | Start a new session. |
| `/sessions [query]` | Without an argument, open the Session Library; with a query, search durable session content through the full-text index and resume the chosen hit. In the library, `p` pins a session and `r` renames it. |
| `/resume [session-id]` | Resume a durable session. Without an id, choose from the recent-session list. |
| `/tree` | Browse the current conversation’s turns and forks with content previews, edit from a historical message, or continue an existing branch. |
| `/session` | Show the current session's details. |
| `/retry` | Run the most recent human prompt again. |
| `/todo` | Print the current session todo list into the transcript. |
| `/clear` | Clear the visible transcript, leaving a seam. The running turn, status, todos, and queued follow-ups keep their state. |

## Session configuration

| Command | What it does |
|---|---|
| `/agent` | Choose the Agent preset: Standard, PTC, Minimal, or Cordis. Available on blank sessions; unavailable presets show their failure. `/agent inspect [preset-id]` reads declarations and this session's retained composition. The `code` (PTC) preset presents the registry as a generated SDK and hides `workflow_run`. |
| `/workflow` | Choose the Default or Plan workflow. |
| `/permission` | Choose the session Access level: Read only, Workspace write, or Full access. |
| `/login` | Sign in to a provider: a catalog entry, an API key, or a custom provider with its own id, base URL, protocol, and model ids. |
| `/logout` | Remove an omdsh-managed provider choice. |
| `/settings` | Open appearance, Agent, feature, status-line, and plugin settings. Alias: `/set`. |
| `/plugins` | Inspect profile plugins and bundles; enable, disable, install, or remove them. Installation can be cancelled before application. |

### `/model`

| Form | Effect |
|---|---|
| `/model` | Open the provider, model, and reasoning-effort picker. |
| `/model <query>` | Resolve a `provider/model` or fuzzy model name; an exact match switches immediately and an ambiguous match opens the picker. |
| `/model --session <query>` | Switch the active session without writing the saved default. Does not combine with a subcommand. |
| `/model next` / `/model previous` | Cycle to the next or previous favorite model. |
| `/model reasoning` | Cycle the current model's reasoning effort. |
| `/model favorite` / `/model unfavorite` | Add or remove the current model from the local favorites list, stored in `$OMDSH_HOME/omdsh/model-favorites.json`. |
| `/model favorites` | List the favorite models. |

## Turn control

| Command | What it does |
|---|---|
| `/queue` | Review, edit, delete, and reorder pending human messages. |
| `/steer <message>` | Guide the active turn before its next model step. |
| `/questions` | Answer questions left pending after a timed wait, including in resumed sessions. |
| `/loop [count\|duration] [prompt]` | Repeat a prompt after every completed turn: a count or a duration repeats a fixed number of times or until the time elapses, and a bare count makes the next composer message the repeated prompt. Run `/loop` again to disable it. See [Guide an active turn](tutorials/guide-a-turn.md). |
| `/plan [off\|<message>]` | Enter Plan mode and optionally send the first planning request, or leave it with `off`. Composer images travel with the planning request. |
| `/goal [<objective>\|clear\|edit <objective>\|pause\|resume]` | Set or inspect a long-running goal for the session. |
| `/compact` | Compact older conversation history. |
| `/jobs [kill <id>]` | List background jobs, or stop one by id. |

## Observability

| Command | What it does |
|---|---|
| `/context` | Print an inline, projection-backed breakdown of context usage that stays in the transcript. |
| `/trajectory` | Open the event ledger: Turn and Step grouping, live following, search, folding, timings, token usage, and tool payloads. Requires an interactive terminal. |
| `/diff [path\|turn [number]]` | Review current Git changes in an interactive file picker, or a retained Turn snapshot with `turn`. Plain mode keeps the text summary. Never stages or commits. |
| `/tools` | List the tools visible to the agent. |
| `/mcp` | Show connected MCP servers and their tools. |
| `/feedback <text>` | Record a private note about the current session. It appends a log-only event the model never sees — nothing leaves the machine — and confirms the session and anonymous user id. |

## Files and terminals

| Command | What it does |
|---|---|
| `/files [path]` | Browse directories or preview a file. `Shift+P` in the directory picker opens this session’s deliverables. |
| `/attach [path]` | Stream a file into durable storage and stage a reference in the composer. Without a path, ask for one. It does not submit a message. |
| `/attachments` | Preview or externally open original file and image attachments from this session’s user messages. |
| `/terminal [terminal-id]` | Open this session’s persistent terminal console, or create a shell using its sandbox. |

File documents scroll with arrows, PgUp/PgDn and Home/End. `N`/`P` change files; `V` switches diff/preview, `O` opens the original, and `E` uses the editor selected in Settings. Esc returns to the picker. Source views retain the reading position and search query separately for each file and diff, including after an editor action. External editors temporarily receive the real terminal and omdsh restores raw input afterward.

In source views, `/` or `Ctrl+F` opens a case-insensitive literal search over the loaded text; Enter keeps the query, `Ctrl+N`/`Ctrl+P` cycle through matching lines, and Esc cancels an edit without closing the reader. `G` or `Ctrl+G` jumps to a file line. Diff views show both line-number columns, use new-file line numbers for jumps, and navigate hunks with `[`/`]`; lines outside the displayed hunks cannot be reached. Text loads start at 128 KiB; `L` or **Load more** doubles the loaded prefix up to 4 MiB. Open reads the original beyond that limit; other binary formats open in their application.

PNG, JPEG, WebP and GIF files open in an image preview page. `/attachments` includes stored images from user messages and declared tool/model output, and previews their bytes when the provider has no local path; `Alt+M` previews composer images. Known direct Kitty, Ghostty, WezTerm and iTerm2 terminals display the image within the page. tmux, screen, Zellij, Herdr and unknown terminals show image information with an Open action when an original is available. Esc restores the previous view and draft. Previews preserve aspect ratio, fit the available cells and show the first frame of animated images; decoding is limited to 32 MiB and 40 million pixels, and preview PNGs are at most 2048 px per side. These limits do not change the original attachment or the model’s image admission rules.

Code previews use Prism syntax highlighting with the selected terminal theme. Language detection uses the filename, including `Dockerfile` and `Makefile`. Markdown files open as source with line numbers; `M` switches between source and rendered Markdown. Search and line jumps are available in the source view. Multiline comments and strings retain their syntax colors within the highlighting budget; large previews fall back to plain text. Unknown languages remain plain, and disabling colors preserves the source text.

Use Tab or Left/Right to select a document action, then Enter to activate it; `›` marks the selection. Letter shortcuts accept either case. `/files` previews include sibling files for Previous/Next navigation; those actions are omitted when only one file is available. `F` returns to the file list. Open uses the system’s default application; Editor uses **General → Editor** in `/settings`, with installed-editor detection by default. Save and close the editor’s file to return to omdsh. Failures and external-open confirmations stay visible in the preview, and file navigation does not send attention notifications.

`/attach` displays a file marker and byte-count receipt; deleting the marker removes that draft. Add your message and press Enter to send both. File-only submissions work, and queued messages and rewind retain file references. A draft containing files treats slash-prefixed text as a model message rather than executing a command. Cancel the attachment operation with Ctrl+C; cancelled operations do not stage a draft.

The terminal console opens at the newest 300 retained lines. Up/PageUp, Home, or searching pause following and freeze the displayed snapshot; End refreshes the latest page and follows new output again. `L` or **Earlier output** prepends up to 300 older retained lines while keeping your reading position and search, with a reader limit of 10,000 lines or 4 MiB. `/` or `Ctrl+F` searches loaded text, `Ctrl+N`/`Ctrl+P` cycles matching lines, and `G` or `Ctrl+G` jumps to a displayed line number. Line numbers refer to the backend's retained output at the time of the snapshot, not a permanent log. A clipped or changed history is reported instead of joining mismatched pages; output already discarded by the backend cannot be recovered.

`I` sends a line and `C` interrupts. Cancelling input or returning from a console action preserves the reading position, search, and follow mode. Esc detaches without killing the shell; **Close terminal** requires confirmation. Busy terminals retain exclusive input ownership. Browsing stays quiet and yields to tool questions. This is a line-input console, not raw PTY attachment for fullscreen programs.

## Clipboard and output

| Command | What it does |
|---|---|
| `/copy [text\|code\|cmd]` | Copy the last assistant reply, the last fenced code block, or the last bash command; without an argument, open the copy picker. `command` is accepted for `cmd`. |
| `/export [html\|markdown\|archive] [path]` | Export a Markdown/HTML transcript, or a ZIP of logical logs, descendant sessions, and original attachments. |
| `/changelog [full]` | Show recent release notes, or the complete packaged release history with `full`. |

## Skills

Every user-invocable Skill appears as `/skill:<name>`, with the description from its `SKILL.md`. Type `/skill:` to filter the list and press Enter to invoke one. The older `/code-review` form of a Skill command is still accepted for compatibility but is no longer advertised. See [Skills and MCP](skills-and-mcp.md).

## Application

| Command | What it does |
|---|---|
| `/help [full]` | Show commands and essential shortcuts; `full` adds the complete keyboard catalog. Aliases: `/h`, `/?`. |
| `/quit` | Quit the application. Aliases: `/q`, `/exit`. |

## Related

- [Keyboard and keys](keyboard.md) — editing keys, overlays, and `keybindings.json`
- [Settings](settings.md) — every row behind `/settings`
- [Permissions and access](permissions.md) — the presets behind `/permission`
- [Command line](cli.md) — the `omdsh` binary, flags, and environment variables
- [Tutorials](tutorials.md) — task-based walkthroughs for these commands
- [Skills and MCP](skills-and-mcp.md) — Skills discovery and MCP configuration
