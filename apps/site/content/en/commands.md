---
description: Complete omdsh slash-command reference with arguments for sessions, configuration, turn control, observability, clipboard output, and Skills.
---

# Commands

Command completion prioritizes common tasks and matches names, aliases and description keywords. Arguments that name something in the running process complete too — `/model dee` lists matching models across providers, `/resume` lists existing sessions, `/login` lists registered providers — and Enter runs the line as typed. `/help` groups commands by task; third-party contributions remain discoverable.

Type `/` in the composer to browse the live catalog with inline argument hints, or run `/help` to print the command list plus the essential shortcuts into the conversation (`/help full` adds the complete keyboard catalog); a result longer than twelve rows folds to one line, and `Ctrl+O` opens it. The catalog is assembled from the active plugins, so commands contributed by Skills and user bundles appear beside the built-ins. `/help` groups the catalog by user task, including extension commands. Inside a document reader — file recovery, plugin settings, session composition — `/` opens a find line over the rendered rows: the count updates as you type, Enter jumps to the first hit, and Ctrl+N/Ctrl+P walk them. Command results, including `/help` and `/changelog`, stay in the conversation instead, folded when long.

`[brackets]` mark optional arguments and `|` separates alternatives. A command with a picker runs without arguments.

## Sessions

| Command | What it does |
|---|---|
| `/new` | Start a new session. |
| `/resume [session-id\|query]` | Without an argument, open the Session Library; with a query, search durable session content and resume the chosen hit; with an id, resume it directly. In the library, `p` pins a session and `r` renames it. |
| `/session` | Show the current session's details. |
| `/continue` | Continue an eligible failed model generation without resending the prompt. |
| `/retry` | Resend the latest human prompt with its images and files as a new turn. |
| `/clear` | Clear the visible transcript, leaving a seam. The running turn, status, todos, and queued follow-ups keep their state. |

## Session configuration

| Command | What it does |
|---|---|
| `/agent` | Choose the Agent preset: Standard, PTC, Minimal, or Creator. Available on blank sessions; unavailable presets show their failure. `/agent inspect [preset-id]` reads declarations and this session's retained composition. The `code` (PTC) preset presents the registry as a generated SDK and hides `workflow_run`. |
| `/agent creator` | Enter Creator (`cordis`) to author plugins. Reuses a blank session or starts a new one after existing conversation content; preserves session drafts and does not change the default preset or submit a prompt. |
| `/permission` | Choose the session Access level, or inspect and revoke remembered approval rules. |
| `/login` | Sign in to a provider: a catalog entry, an API key, a DeepSeek account browser sign-in (or an existing shared grant), or a custom provider with its own id, base URL, protocol, and model ids. |
| `/logout` | Remove a file-stored provider credential or sign out the shared DeepSeek account; environment-owned values are left untouched. |
| `/settings` | Open General, Models, Agent presets, Plugins, Terminal and Advanced settings. Alias: `/set`. |

### `/model`

| Form | Effect |
|---|---|
| `/model` | Open one searchable list of every model across every provider, with the current model marked. `Enter` switches the saved default; `Ctrl+D` applies the choice to this session only. The selected model’s default reasoning effort applies without a second prompt; use `/model reasoning` to change it. |
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
| `/btw <question>` | Ask a separate question from the current committed conversation snapshot, answered in a pane above the composer. |
| `/questions` | Answer questions left pending after a timed wait, including in resumed sessions. |
| `/plan [off\|<message>]` | Enter Plan mode and optionally send the first planning request, or leave it with `off`. Composer images and files travel with the planning request. |
| `/goal [<objective>\|clear\|edit <objective>\|pause\|resume]` | Set or inspect a long-running goal for the session. |
| `/compact` | Compact older conversation history; keep typing and queue input during compaction, then read the saved summary with Ctrl+O. |
| `/jobs [<id>\|kill <id>]` | Browse live jobs, inspect retained output, or confirm stopping a job. Line mode prints a snapshot and observer narration. |

## Goal controls

`/goal` keeps the Harness command syntax. Press `Alt+G`, or open **Settings → General → Current goal**, to edit, pause, resume or clear the current goal without submitting the composer draft. Clearing requires confirmation. Edits keep their draft after a rejected concurrent change; reopening Edit uses that draft until saved or the manager closes. The goal bar distinguishes durable active state from live continuation authority: **Goal waiting** means the goal is saved but this process is not armed to continue. Cold resume does not itself authorize another round; choose Resume goal. A used-up round limit disables Resume; ask the agent to raise the limit first.

## Background jobs

`/jobs` opens a searchable list with running jobs first, progress, elapsed time and terminal reasons. Select a job for **View output** or **Stop job**; stopping defaults to **Keep running** and rechecks the task after confirmation. Lists update while open, retain the last state after refresh failure, and offer Refresh to retry. A failed read disables task actions until a successful refresh.

The output reader observes stdout, stderr and narration through the non-consuming Harness API, so viewing output never advances the model’s read cursor. It follows new output at the bottom; scrolling up or searching freezes the displayed snapshot, and End resumes following. Each snapshot shows at most the latest roughly 256K characters and 10,000 lines, with a notice for clipped or discarded output. Output retention belongs to Harness and does not promise persistence after process exit. Closing the reader releases its subscription without stopping the job; session replacement, plugin unload and cancellation close the browser. Approval prompts take precedence. In line mode, `/jobs <id>` retains its narration-only output and `/jobs kill <id>` requests a stop directly.

## Plan mode

`/plan` enters Plan mode; `/plan off` leaves it. Idle changes apply immediately, while changes during a turn take effect at the next step boundary. The English footer shows the active or pending Plan state, and the empty composer invites a planning task when Plan is the effective target. Plan guides the model to investigate and propose before implementation; it does not change Access or enforce a filesystem sandbox.

When the model submits a plan, the review reader shows its original text. Use PgUp/PgDn to scroll, Tab/Shift+Tab to select **Approve** or **Keep planning**, and Enter to confirm. Approve leaves Plan mode and lets execution continue. Keep planning opens an optional feedback field; submit changes or choose **Continue without feedback** to continue planning. Esc from feedback returns to the review and retains the draft. Esc from the review ends the current turn without approval and keeps Plan mode for your next message. Interrupting or losing the review never counts as approval.

Plans remain in the session’s tool history after review, resume, and a fork that includes the call. Use Ctrl+O to open the completed run and Alt+O to show full tool inputs and results. Composer images and files can accompany `/plan <message>` in their displayed order. `/plan off` rejects attachments and restores the complete draft for correction.

## Side questions

`/btw` uses the current model and reasoning selection in a separate, durable session. The question captures committed messages at invocation; later main-session messages and unfinished streaming text are excluded. The consultation cannot use tools, even after resume; it starts with Read only Access and clears copied Goal and Plan execution state without changing the parent. Replies have an 8,192-token output limit.

The answer streams into a pane docked above the composer while the consultation runs. The pane is not part of the conversation: it belongs to the side session, so nothing about it is written into the transcript, and `Esc` closes it and returns the composer exactly as it was. `↑`/`↓` scroll it. Closing the pane folds the exchange into one `/btw <question>` line in the transcript, with the answer behind `Ctrl+O`, so reclaiming the screen never costs the text; `/copy` also offers it. Ctrl+C interrupts only the consultation, and parent approvals take priority. The advice is not sent to the primary model: quote it into the composer with `Alt+C` or your usual copy path if you want the conversation to continue from it. Model requests, including the copied input context, incur separate charges; the displayed usage covers only this consultation’s latest request attempts, not inherited history. The consultation’s own session log is stored under `OMDSH_HOME`.

## Observability

| Command | What it does |
|---|---|
| `/context` | Print an inline, projection-backed breakdown of context usage that stays in the transcript. |
| `/diff [path\|turn [number]]` | Review current Git changes in an interactive file picker, or a retained Turn snapshot with `turn`. Plain mode keeps the text summary. Never stages or commits. |
| `/trajectory` | Inspect the session's event ledger: turns, the steps inside them and the records inside each step, live following, search, folding, the wall time each turn took, per-record duration and token usage, and tool payloads. This is the Harness's event-sourced history made visible — the record every projection is derived from — so it shows the shape of a run rather than only its output. Requires an interactive terminal. |
| `/schedule` | Manage this session's durable reminders: pause, resume, run now, edit a name or instruction, delete, and browse delivery history. |
| `/plugins` | Inspect profile plugins and bundles; enable, disable, install, or remove them, or browse a configured plugin index under **Discover**. Installation can be cancelled before application. |
| `/tools` | List the tools visible to the agent as a transcript result. |
| `/mcp` | Browse MCP registration diagnostics, available tools and the session’s latest ten calls; refresh the snapshot. Live connection and authentication status are unavailable. |

### Scheduled reminders

`/schedule` lists reminders involving the current session. The list and task details refresh as tasks change; use the arrow keys and Enter to choose an action, and Esc to go back. **Run now** delivers the instruction without moving the scheduled occurrence. Tasks that are queued or running cannot be edited, paused, resumed, deleted, or triggered again; the page explains minimum run intervals and unavailable archived destinations. Creating reminders and changing their timing or time zone still use the agent's `schedule_*` tools.

**View delivery history** loads twenty saved receipts at a time; **Load older records** adds the next page. Open a receipt to read its saved instruction, scheduled and delivered times, and destination session. A receipt confirms inbox delivery, not completed model execution. Retention limits and unavailable historical instructions are reported explicitly. Failed refreshes keep the loaded records, and **Refresh** retries from the newest page. Deleting a reminder requires confirmation and leaves destination sessions and messages already delivered intact.

## Files and terminals

| Command | What it does |
|---|---|
| `/attach [path]` | Stream a file into durable storage and stage a reference in the composer without submitting a message. Without a path, open this session’s stored attachments, where **Add a file** stages another one. |

Type `!command` in the composer to run a line in a persistent Shell without adding output to model context, or `!!command` to share the output to the conversation on return; see [Composer Shell](keyboard.md#composer-shell).

File documents scroll with arrows, PgUp/PgDn and Home/End. `N`/`P` change files; `V` switches diff/preview, `O` opens the original, `E` uses the editor selected in Settings, and `Q` quotes `@path:line` into the composer. Esc returns to the picker. Source views retain the reading position and search query separately for each file and diff, including after an editor action. External editors temporarily receive the real terminal and omdsh restores raw input afterward.

Tool cards and Changed files also open this reader through right-click when no text is selected. `Alt+V` previews declared tool files at the reading position, otherwise retaining its Turn-comparison behavior. The preview uses the original invocation or summary directory and reads current file contents; provider-declared line locations initialize the source position within the loaded prefix. These actions do not submit a model message, change Access, or create a file checkpoint.

In source views, `/` or `Ctrl+F` opens a case-insensitive literal search over the loaded text; Enter keeps the query, `Ctrl+N`/`Ctrl+P` cycle through matching lines, and Esc cancels an edit without closing the reader. `G` or `Ctrl+G` jumps to a file line. Diff views show both line-number columns, use new-file line numbers for jumps, and navigate hunks with `[`/`]`; lines outside the displayed hunks cannot be reached. Text loads start at 128 KiB; `L` or **Load more** doubles the loaded prefix up to 4 MiB. Open reads the original beyond that limit; other binary formats open in their application.

PNG, JPEG, WebP and GIF files open in an image preview page. The `/attach` list includes stored images from user messages and declared tool/model output, and previews their bytes when the provider has no local path; `Alt+M` previews composer images, or the newest conversation image when the composer has none. Known direct Kitty, Ghostty, WezTerm, Warp, Herdr, Rex and iTerm2 terminals display the image within the page; set `OMDSH_IMAGE_PROTOCOL=kitty`, `iterm2` or `none` when detection is wrong, and `omdsh doctor` reports the detected protocol. tmux, screen, Zellij and unknown terminals show image information with an Open action when an original is available. Esc restores the previous view and draft. Previews preserve aspect ratio, fit the available cells and show the first frame of animated images; decoding is limited to 32 MiB and 40 million pixels, and preview PNGs are at most 2048 px per side. These limits do not change the original attachment or the model’s image admission rules.

Code previews use Prism syntax highlighting with the selected terminal theme. Language detection uses the filename, including `Dockerfile` and `Makefile`. Markdown files open as source with line numbers; `M` switches between source and rendered Markdown. Search and line jumps are available in the source view. Multiline comments and strings retain their syntax colors within the highlighting budget; large previews fall back to plain text. Unknown languages remain plain, and disabling colors preserves the source text.

Use Tab or Left/Right to select a document action, then Enter to activate it; `›` marks the selection. Letter shortcuts accept either case. A preview opened from a tool card includes its sibling files for Previous/Next navigation; those actions are omitted when only one file is available. `F` returns to the file list. Open uses the system’s default application; Editor uses **Terminal → Editor** in `/settings`, with installed-editor detection by default. Save and close the editor’s file to return to omdsh. Failures and external-open confirmations stay visible in the preview, and file navigation does not send attention notifications.

A staged `/attach` draft displays a file marker and byte-count receipt; deleting the marker removes that draft. Add your message and press Enter to send both. File-only submissions work, and queued messages and rewind retain file references. Deliberately typed slash commands carry their attachments through Harness command admission, including while a turn runs. Commands that do not accept attachments, unknown commands, and failed or cancelled submissions restore the text, images and files to the original session. Pasted literal text and explicit Steer submissions remain model messages. Mixed attachments retain their displayed order through retries and queue recall. Cancel the attachment operation with Ctrl+C; cancelled operations do not stage a draft.

## Clipboard and output

| Command | What it does |
|---|---|
| `/copy` | Choose what to copy in the composer card: the last assistant reply, its fenced code blocks, the last bash command and its output, and a finished `/btw` answer. `Alt+C` copies the selection first when there is one. |
| `/export [html\|markdown\|archive] [path]` | Export a Markdown/HTML transcript, or a ZIP of logical logs, descendant sessions, and original attachments. |
| `/changelog [full]` | Show recent release notes, or the complete packaged release history with `full`. |

## Skills

User-invocable Skills appear as `/<name>`, with descriptions and a **User only** marker when model invocation is disabled. Type `/` and the name to find a skill, then submit it with optional images and files. Commands take precedence over same-named skills; invoke those skills within a sentence, such as “Please use `/review` to check these changes.” See [Skills and MCP](skills-and-mcp.md).

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
