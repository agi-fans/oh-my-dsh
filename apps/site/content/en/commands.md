---
description: Complete omdsh slash-command reference with arguments for sessions, configuration, turn control, observability, clipboard output, and Skills.
---

# Commands

Command completion prioritizes common tasks and matches names, aliases and description keywords. `/help` groups commands by task; third-party contributions remain discoverable.

Type `/` in the composer to browse the live catalog with inline argument hints, or run `/help` for the command list plus the essential shortcuts (`/help full` adds the complete keyboard catalog). The catalog is assembled from the active plugins, so commands contributed by Skills and user bundles appear beside the built-ins. `/help` groups the catalog by user task, including extension commands.

`[brackets]` mark optional arguments and `|` separates alternatives. A command with a picker runs without arguments.

## Sessions

| Command | What it does |
|---|---|
| `/new` | Start a new session. |
| `/resume [session-id\|query]` | Without an argument, open the Session Library; with a query, search durable session content and resume the chosen hit; with an id, resume it directly. In the library, `p` pins a session and `r` renames it. |
| `/tree` | Browse turns and forks, edit from a historical message, continue a branch, or restore selected Turn files with `Alt+R` when snapshots exist. |
| `/session` | Show the current session's details. |
| `/retry` | Run the most recent human prompt again. |
| `/todo` | Print the current session todo list into the transcript. |
| `/clear` | Clear the visible transcript, leaving a seam. The running turn, status, todos, and queued follow-ups keep their state. |

## Session configuration

| Command | What it does |
|---|---|
| `/agent` | Choose the Agent preset: Standard, PTC, Minimal, or Cordis. Available on blank sessions; unavailable presets show their failure. `/agent inspect [preset-id]` reads declarations and this session's retained composition. The `code` (PTC) preset presents the registry as a generated SDK and hides `workflow_run`. |
| `/permission` | Choose the session Access level, or inspect and revoke remembered approval rules. |
| `/login` | Sign in to a provider: a catalog entry, an API key, a DeepSeek account browser sign-in (or an existing shared grant), or a custom provider with its own id, base URL, protocol, and model ids. |
| `/logout` | Remove a file-stored provider credential or sign out the shared DeepSeek account; environment-owned values are left untouched. |
| `/settings` | Open Interface, Agent, Tools, Status line, Integrations and Advanced settings. Alias: `/set`. |
| `/plugins` | Inspect profile plugins and bundles; enable, disable, install, or remove them. Installation can be cancelled before application. |

### `/model`

| Form | Effect |
|---|---|
| `/model` | Open one searchable list of every model across every provider, with the current model marked. `Enter` switches the saved default; `Ctrl+D` applies the choice to this session only. The reasoning effort is asked for only when the new model does not offer the current one. |
| `/model <query>` | Resolve a `provider/model` or fuzzy model name; an exact match switches immediately and an ambiguous match opens the list filtered to the matches. |
| `/model --session` | The same list, scoped to the active session without writing the saved default. Accepts a query as well. Does not combine with a subcommand. |
| `/model next` / `/model previous` | Cycle to the next or previous favorite model. |
| `/model reasoning` | Cycle the current model's reasoning effort. |
| `/model favorite` / `/model unfavorite` | Add or remove the current model from the local favorites list, stored in `$OMDSH_HOME/omdsh/model-favorites.json`. |
| `/model favorites` | List the favorite models. |

## Turn control

| Command | What it does |
|---|---|
| `/queue` | Review, edit, delete, and reorder pending human messages. |
| `/steer <message>` | Guide the active turn before its next model step. |
| `/btw [question]` | Ask a separate question from the current committed conversation snapshot, or reopen a saved topic. |
| `/questions` | Answer questions left pending after a timed wait, including in resumed sessions. |
| `/loop [count\|duration] [prompt]` | Repeat a prompt after every completed turn: a count or a duration repeats a fixed number of times or until the time elapses, and a bare count makes the next composer message the repeated prompt. Run `/loop` again to disable it. See [Guide an active turn](tutorials/guide-a-turn.md). |
| `/plan [off\|<message>]` | Enter Plan mode and optionally send the first planning request, or leave it with `off`. Composer images travel with the planning request. |
| `/goal [<objective>\|clear\|edit <objective>\|pause\|resume]` | Set or inspect a long-running goal for the session. |
| `/compact` | Compact older conversation history. |
| `/jobs [kill <id>]` | List background jobs, or stop one by id. |

## Side questions

`/btw` uses the current model and reasoning selection in a separate, durable session. The first question captures committed messages at invocation; later main-session messages and unfinished streaming text are excluded. Follow-ups keep that original snapshot and the topic’s own questions and answers. The consultation cannot use tools, even after resume; it starts with Read only Access and clears copied Goal and Plan execution state without changing the parent. Replies have an 8,192-token output limit.

The reader streams the answer; Esc or Ctrl+C cancels only the consultation. Parent approvals take priority. After completion, choose **Follow-up**, **Share to conversation** (posting the answer to the main transcript and session context), **Quote to composer**, **Topics**, or return to the conversation. Advice is not sent to the primary model unless shared. Model requests, including the copied input context, incur separate charges; displayed usage covers only this consultation’s latest request attempts, not inherited history. An interrupted or failed topic remains in history with any retained output. Topics and their session logs are stored under `OMDSH_HOME`.

## Observability

| Command | What it does |
|---|---|
| `/context` | Print an inline, projection-backed breakdown of context usage that stays in the transcript. |
| `/trajectory` | Open the event ledger: Turn and Step grouping, live following, search, folding, timings, token usage, and tool payloads. Requires an interactive terminal. |
| `/advisor [codex\|claude] [question]` | Request an independent opinion from an installed native advisor inline in the transcript. The advisor chosen in Settings decides which model is reached, so `/advisor <question>` asks only the question; naming a provider overrides that choice for one request. No advisor is configured by default, and the command points at the setting instead of consulting when none is. Automatically supplies a read-only workspace snapshot and records the advice for follow-up turns. See [Subagents and delegation](subagents.md#independent-advice). |
| `/diff [path\|turn [number]]` | Review current Git changes in an interactive file picker, or a retained Turn snapshot with `turn`. Plain mode keeps the text summary. Never stages or commits. |
| `/tools` | List the tools visible to the agent. |
| `/mcp` | Print MCP plugin registration and available tools grouped by server inline in the transcript; transport health and authentication are not verified. |
| `/schedule` | List this session's durable reminders, edit a name or instruction, open retained delivery records, or delete one. Each row answers how soon it fires (`in 12m`) alongside the absolute instant, and a reminder that can no longer fire reads `ended` instead of `next`. Creating or retiming reminders goes through the model-facing `schedule_*` tools. |

## Files and terminals

| Command | What it does |
|---|---|
| `/attach [path]` | Stream a file into durable storage and stage a reference in the composer without submitting a message. Without a path, open this session’s stored attachments, where **Add a file** stages another one. |
| `/worktree [return]` | Browse and switch Git worktrees. Enable the Git Worktrees bundle in `/plugins` to create a checkout; `return` restores the session’s original directory. |

Type `!command` in the composer to run a line in a persistent Shell without adding output to model context, or `!!command` to share the output to the conversation on return; see [Composer Shell](keyboard.md#composer-shell).

File documents scroll with arrows, PgUp/PgDn and Home/End. `N`/`P` change files; `V` switches diff/preview, `O` opens the original, `E` uses the editor selected in Settings, and `Q` quotes `@path:line` into the composer. Esc returns to the picker. Source views retain the reading position and search query separately for each file and diff, including after an editor action. External editors temporarily receive the real terminal and omdsh restores raw input afterward.

Tool cards and Changed files also open this reader through right-click when no text is selected. `Alt+V` previews declared tool files at the reading position, otherwise retaining its Turn-comparison behavior. The preview uses the original invocation or summary directory and reads current file contents; provider-declared line locations initialize the source position within the loaded prefix. These actions do not submit a model message, change Access, or create a file checkpoint.

In source views, `/` or `Ctrl+F` opens a case-insensitive literal search over the loaded text; Enter keeps the query, `Ctrl+N`/`Ctrl+P` cycle through matching lines, and Esc cancels an edit without closing the reader. `G` or `Ctrl+G` jumps to a file line. Diff views show both line-number columns, use new-file line numbers for jumps, and navigate hunks with `[`/`]`; lines outside the displayed hunks cannot be reached. Text loads start at 128 KiB; `L` or **Load more** doubles the loaded prefix up to 4 MiB. Open reads the original beyond that limit; other binary formats open in their application.

PNG, JPEG, WebP and GIF files open in an image preview page. The `/attach` list includes stored images from user messages and declared tool/model output, and previews their bytes when the provider has no local path; `Alt+M` previews composer images, or the newest conversation image when the composer has none. Known direct Kitty, Ghostty, WezTerm, Warp, Herdr, Rex and iTerm2 terminals display the image within the page; set `OMDSH_IMAGE_PROTOCOL=kitty`, `iterm2` or `none` when detection is wrong, and `omdsh doctor` reports the detected protocol. tmux, screen, Zellij and unknown terminals show image information with an Open action when an original is available. Esc restores the previous view and draft. Previews preserve aspect ratio, fit the available cells and show the first frame of animated images; decoding is limited to 32 MiB and 40 million pixels, and preview PNGs are at most 2048 px per side. These limits do not change the original attachment or the model’s image admission rules.

Code previews use Prism syntax highlighting with the selected terminal theme. Language detection uses the filename, including `Dockerfile` and `Makefile`. Markdown files open as source with line numbers; `M` switches between source and rendered Markdown. Search and line jumps are available in the source view. Multiline comments and strings retain their syntax colors within the highlighting budget; large previews fall back to plain text. Unknown languages remain plain, and disabling colors preserves the source text.

Use Tab or Left/Right to select a document action, then Enter to activate it; `›` marks the selection. Letter shortcuts accept either case. A preview opened from a tool card includes its sibling files for Previous/Next navigation; those actions are omitted when only one file is available. `F` returns to the file list. Open uses the system’s default application; Editor uses **Interface → Editor** in `/settings`, with installed-editor detection by default. Save and close the editor’s file to return to omdsh. Failures and external-open confirmations stay visible in the preview, and file navigation does not send attention notifications.

A staged `/attach` draft displays a file marker and byte-count receipt; deleting the marker removes that draft. Add your message and press Enter to send both. File-only submissions work, and queued messages and rewind retain file references. A draft containing files treats slash-prefixed text as a model message rather than executing a command. Cancel the attachment operation with Ctrl+C; cancelled operations do not stage a draft.

The terminal console opens at the newest 300 retained lines. Up/PageUp, Home, or searching pause following and freeze the displayed snapshot; End refreshes the latest page and follows new output again. `L` or **Earlier output** prepends up to 300 older retained lines while keeping your reading position and search, with a reader limit of 10,000 lines or 4 MiB. `/` or `Ctrl+F` searches loaded text, `Ctrl+N`/`Ctrl+P` cycles matching lines, and `G` or `Ctrl+G` jumps to a displayed line number. Line numbers refer to the backend's retained output at the time of the snapshot, not a permanent log. A clipped or changed history is reported instead of joining mismatched pages; output already discarded by the backend cannot be recovered.

`I` sends a line and `C` interrupts. Cancelling input or returning from a console action preserves the reading position, search, and follow mode. Esc detaches without killing the shell; **Close terminal** requires confirmation. Busy terminals retain exclusive input ownership. Browsing stays quiet and yields to tool questions. This is a line-input console, not raw PTY attachment for fullscreen programs.

## Clipboard and output

| Command | What it does |
|---|---|
| `/copy [text\|code\|cmd]` | Copy the last assistant reply, the last fenced code block, or the last bash command; without an argument, open the copy picker. `command` is accepted for `cmd`. |
| `/export [html\|markdown\|archive] [path]` | Export a Markdown/HTML transcript, or a ZIP of logical logs, descendant sessions, and original attachments. |
| `/import <archive.zip>` | Import a portable `/export archive` ZIP bundle into local storage and resume its root session. |
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
