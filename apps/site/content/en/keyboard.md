---
description: "Keyboard reference for omdsh: composer editing, transcript navigation, session lifecycle, overlay keys, and keybindings.json overrides."
---

# Keyboard and keys

`/help` prints the live shortcut catalog beside the command list, and `/help full` adds the complete version; the catalog reads the bindings actually in effect. Application bindings are overridable through `keybindings.json`, while the editor keeps a fixed Vi-like key set.

## Navigation

| Shortcut | Action |
|---|---|
| Arrow keys | Move the cursor, or browse history when the composer is empty. |
| `Ctrl+A` / `Home` | Move to the start of the line. |
| `Ctrl+E` / `End` | Move to the end of the line. |
| `Alt+B` / `Alt+Left` | Move one word left. |
| `Alt+F` / `Alt+Right` | Move one word right. |
| `Ctrl+]` then a character | Jump forward to that character. |
| `Ctrl+Alt+]` then a character | Jump backward to that character. |

## Editing

| Shortcut | Action |
|---|---|
| `Enter` | Send the message. |
| `Shift+Enter` / `Alt+Enter` / `Ctrl+J` | Insert a new line. |
| `Ctrl+W` / `Alt+Backspace` | Delete the previous word. |
| `Alt+D` | Delete the next word. |
| `Ctrl+U` | Delete to the start of the line. |
| `Ctrl+K` | Delete to the end of the line. |
| `Ctrl+Y` | Yank deleted text. |
| `Alt+Y` | Cycle the yank ring. |
| `Ctrl+-` | Undo the last edit or restore a cleared draft. |
| `Ctrl+D` | Delete forward, or quit when the composer is empty. |
| `Ctrl+V` | Paste clipboard text or an image. |
| `Alt+M` | Preview composer images without sending them. |
| `Alt+I` | Expand a folded pasted block for editing. |
| `Alt+Up` | Recall the latest queued message into the composer when the composer is empty. |
| `Alt+Q` | Open Message Queue without submitting the composer draft. |
| `Ctrl+S` | Stash or restore the current composer draft; a stashed draft returns automatically after you send a message. |
| `Alt+S` | Send text guidance to the active Turn’s next model step. |
| `Alt+C` | Copy the selected text, or the current prompt when nothing is selected. |
| `Ctrl+Alt+C` | Copy the current line. |
| `Ctrl+X` | Edit the prompt in the editor selected in Settings. |

Pastes longer than ten lines or 1,000 characters appear as `[Pasted #1: 120 lines]` or a character-count marker. Arrow keys and deletion treat each block as one unit; `Alt+I` expands the block at or nearest the caret for editing, and `Ctrl+-` undoes insertion, deletion, or expansion. Copying the prompt, using the external editor, and sending a message use the full text. Temporary questions and queued-message editing retain the source. A draft beginning with a folded paste sends its source as a message even if it begins with `/`.

**Paste protection** also recognizes long text chunks, multiline reads, and rapid ASCII key streams when a terminal does not mark pasted input, keeping embedded Enter keys from submitting a message. Wait briefly after the paste finishes, then press Enter to send. Normal typing and individual IME commits appear immediately. This detection is heuristic; turn it off in Settings if it interferes with your terminal. Explicit bracketed paste remains safe with this setting off.

## Transcript

While a turn runs, thinking appears as quiet italic text, replies use ordinary Markdown, and tools show padded result previews in the active theme. Shell output keeps its last five visual lines; successful file reads show the call without the file body. Completed steps stay visible until the turn ends. The process then folds to a duration summary such as `Worked for 16s`, followed by the complete final answer; failures remain visible.

Narrow tables show labelled records when their columns would become unreadable. Complete supported Mermaid diagrams draw with terminal characters when they fit; unsupported, incomplete or oversized diagrams stay visible as code. **Mermaid in replies** in [Settings](settings.md) switches between Auto and Source. Reply formulas follow the **Math in replies** preference in [Settings](settings.md).

`Ctrl+O` restores that process view for a completed turn. `Alt+O` opens complete tool Input and Output sections for the turn being read, including PTC sub-calls; pressing it again restores previews while leaving the process view open. It also works during a running turn, and new calls in that turn inherit the detailed view. On a folded turn it opens the process and tool details together. `Ctrl+O`, `End`, or scrolling past the end closes inspection and resets tool details. Opening details never rewrites native terminal history.

Details show all text received by the TUI; they cannot recover content already truncated or spilled to a file by a tool. `/trajectory` provides event-level inspection, and `Ctrl+F` searches content outside the previews and reveals matches.

When earlier messages are in view, a `Jump to latest message · End` label appears above the composer area. Once a user prompt scrolls out of view, a one-line summary stays at the top while its reply is visible. The pinned prompt follows the turn being read. These labels are viewport controls, not conversation content.

| Shortcut | Action |
|---|---|
| `PgUp` / `PgDn` | Scroll one page. |
| `Shift+Up` / `Shift+Down` | Scroll quickly. |
| Mouse wheel | Scroll the transcript from the live tail or while inspecting a turn; expanding a turn is not required. |
| `End` / click jump label | Return to the latest message and close turn inspection. At the live tail, `End` moves to the end of the composer line. |
| `Ctrl+O` | Restore the completed turn under the viewport to its running presentation; press again to return to the folded live tail. Running turns are unchanged. On the tool catalog, toggle descriptions. |
| `Alt+O` | Toggle complete tool inputs and results for the turn being read, including a running turn. |
| `Alt+V` | Preview the tool’s declared files when a tool is under the reading position; otherwise review the Turn’s changed files or current workspace. |
| `Ctrl+F` | Search the current transcript when the composer is empty; `n`/`N` step across matches. |
| `Alt+A` | Open the Agent Hub; continuable child agents can be steered from their transcript. |

When the transcript can scroll or contains actionable files, omdsh supports mouse dragging within the current viewport in both folded and expanded views. Double-click selects a word or path; triple-click selects a line, and Shift-click extends a selection. Releasing the mouse copies by default. Turn off **Copy on select** in Settings to copy explicitly with `Alt+C`, `Enter`, or right-click; `Esc` clears the selection, and `Ctrl+C` retains its interrupt/exit behavior. Scrolling, resizing, typing, or changed selected rows clears the selection.

Without a text selection, right-click a tool card with declared file locations to preview its files, or a Changed files row to preview that file. The reader reuses Open and the configured Editor. Relative tool paths retain the invocation’s directory; Changed files retain the summary’s directory. These previews show current host-file contents. `Alt+V` still opens retained Turn comparisons outside a tool, and a completed Turn summary does not make hidden tool cards clickable. Native mouse mode keeps keyboard access. An approval or another human prompt cancels a file action rather than competing for input.

**Mouse interaction** defaults to `auto`, which respects tmux mouse off; `tui` explicitly enables application handling and `native` leaves mouse input to the terminal while keyboard scrolling and `End` remain available. Native terminal history is retained and uses terminal selection or tmux copy-mode.

Full-screen pages temporarily suspend application mouse handling. Reading views such as `/trajectory` restore the inspected position on close; commands that return transcript text move to the live tail to show their result.

File and Diff source readers use `/` or `Ctrl+F` to search loaded text, `Ctrl+N`/`Ctrl+P` to cycle matching lines, and `G` or `Ctrl+G` to jump to a file line. `[`/`]` navigate diff hunks. `L` loads more text, `Q` quotes `@path:line` into the composer, and `M` toggles Markdown rendering when available. Enter applies a search or line entry; Esc cancels the entry before returning to the file list. See [File commands](commands.md) for preview limits and view behavior.

Source readers wrap long lines by default. `W` toggles wrapping; `Alt+Left`/`Alt+Right` pans eight display cells and switches to unwrapped mode. Line numbers stay fixed, and wrapping and horizontal position are retained across reader actions. Ordinary Left/Right still select the action buttons. The terminal console uses the same reading keys.

The `/terminal` console uses the same search and matching-line keys. `L` loads earlier retained output, scrolling or searching pauses following, and `End` returns to the latest output and resumes following. `I` sends a line; `C` interrupts the shell.

## Session

| Shortcut | Action |
|---|---|
| `Esc` twice | Open the Session Tree to browse turns and branches. |
| `Ctrl+C` once | Interrupt the active turn, or clear the composer. |
| `Ctrl+C` twice | Exit; a durable session prints an `omdsh --resume <session-id>` hint. |
| `Ctrl+Z` | Suspend to the background. |
| `Alt+L` | Reset the terminal display. |
| `Ctrl+R` | Search prompt history. |
| `Alt+R` | Retry the latest human prompt. |
| `Ctrl+P` / `Alt+P` | Cycle to the next or previous favorite model. |
| `Ctrl+T` | Cycle the current model's reasoning effort. |
| `/` | Open slash-command completion. |
| `@` / `./` / `~/` | Complete file paths. |
| `Tab` | Accept command or path completion. |

## Overlays

| Overlay | Keys |
|---|---|
| Settings (`/settings`) | `↑`/`↓` move between rows, `←`/`→` change a value, `Space` change a value or show/hide a status item, `Enter` open configuration, change a value, or start moving a status item, `Tab`/`Shift+Tab` switch sections, `Home`/`End` jump to the edges, `/` or typing searches all categories, `Backspace`/`Ctrl+U` edit the query, `Ctrl+R` restores inheritance (status items restore color), `Esc`/`Ctrl+C` clear search, return to browsing, or close. |
| Copy picker (`/copy`) | `↑`/`↓` or `Tab` navigate, `PgUp`/`PgDn` page, `Home`/`End` edges, `Enter`/`Space` copy, `Esc`/`Ctrl+C` close. |
| Agent Hub (`Alt+A`, or `↓` on an empty composer) | `↑`/`↓` navigate, `Home`/`End` edges, `Enter` open the child transcript, `Tab`/`←`/`→` switch the inspector pane, `PgUp`/`PgDn` scroll, `T` toggle the tree, `Esc`/`Ctrl+C` close. |
| History search (`Ctrl+R`) | Type to filter, `↑`/`↓`/`Tab`/`PgUp`/`PgDn`/`Home`/`End` navigate, `Enter` select, `Esc`/`Ctrl+C` cancel; the query accepts the line-editing keys. |
| Transcript search (`Ctrl+F`) | Type the query, `Ctrl+N`/`Ctrl+P` step while editing, `Enter` confirm, `n`/`N` step across matches, `/` edit the query, `Esc`/`Ctrl+C` close. |
| Trajectory (`/trajectory`) | `↑`/`↓`, `Home`/`End`, `PgUp`/`PgDn` navigate, `Enter` open details, `Tab`/`←`/`→` switch sections, `/` search, `n`/`N` and `Ctrl+N`/`Ctrl+P` step matches, `t` collapse turns, `c` collapse calls, `Esc`/`Ctrl+C` close. |
| Session Library | `p` pins/unpins and `r` renames with an empty search; `Alt+A` archives/restores the selection, `Alt+V` switches active/archived lists even when empty or searching. |
| Session Tree | Type to search; `↑`/`↓`/`Tab` select, `←`/`→` fold, `Ctrl+↑`/`Ctrl+↓` scroll the preview, `Enter` edits a Turn or continues a branch, `Alt+Enter` continues the selected node’s branch, `Alt+L` labels a node, `Alt+U` clears its label, `Alt+B` toggles marked nodes, `Alt+R` reviews Turn file recovery, `Esc` clears search then closes, `Ctrl+C` cancels. |
| Prompts (resume, permission, model, agent, workflow, login) | Type to filter, `↑`/`↓`/`Tab` navigate, `←`/`→` choose, `Alt+Left` return to the previous question in multi-question prompts, `Ctrl+X` edit Plan Review feedback in the external editor, `PgUp`/`PgDn` and `Home`/`End` move, `Space` multi-select, `Enter` select or submit, `Ctrl+J` submit, `Esc` go back or cancel, `Ctrl+C` cancel. |

Searchable choice lists accept multiple words, such as `official flash`; every word must match a name, identifier, preview, or description. Short abbreviations such as `flsh` match within a word. Exact names and name prefixes rank ahead of description-only matches, and clearing the query restores the original order. This applies to filtering a picker; transcript search, prompt history, and `/sessions <query>` retain their own search rules.

## Custom keybindings

Application bindings live in `$OMDSH_HOME/omdsh/keybindings.json` (falling back to `$DSH_HOME`, then `~/.dsh`), the same home that stores sessions, settings, and MCP files. You can remap or unbind shortcuts interactively in `/settings` under **Interface → Input → Keybindings** (which saves and applies changes immediately), or edit the JSON file directly:

```json
{
  "ctrl+j": "search-transcript",
  "ctrl+r": "retry",
  "ctrl+s": null
}
```

Key ids join modifiers with `+` (`ctrl`, `alt`, `shift`, `super`) and spell named keys in lower case (`pageup`, `pagedown`, `escape`, `left`, `right`, `up`, `down`). Values must be one of the action ids below, or `null` to unbind a default key; an unknown action or a malformed file leaves the shipped binding in place for that entry. `/help` shows the effective keys.

| Action id | Default key | Effect |
|---|---|---|
| `preview-images` | `Alt+M` | Preview draft images. |
| `expand-paste` | `Alt+I` | Expand a pasted block for editing. |
| `manage-queue` | `Alt+Q` | Manage individual pending messages. |
| `steer-turn` | `Alt+S` | Send text guidance to the active Turn’s next model step. |
| `stash-draft` | `Ctrl+S` | Stash or restore the current composer draft. |
| `external-editor` | `Ctrl+X` | Edit the prompt in the editor selected in Settings. |
| `retry` | `Alt+R` | Run the most recent human prompt again. |
| `paste-clipboard` | `Ctrl+V` | Paste clipboard text or an image. |
| `copy-prompt` | `Alt+C` | Copy the selected text, or the current prompt when nothing is selected. |
| `copy-line` | `Ctrl+Alt+C` | Copy the current line. |
| `inspect-subagent` | `Alt+A` | Open the Agent Hub. |
| `cycle-model-forward` | `Ctrl+P` | Cycle to the next favorite model. |
| `cycle-model-backward` | `Alt+P` | Cycle to the previous favorite model. |
| `cycle-reasoning` | `Ctrl+T` | Cycle the current model's reasoning effort. |
| `toggle-tools` | `Ctrl+O` | Restore the completed turn under the viewport to its running presentation; press again to return to the folded live tail. Running turns are unchanged. On the tool catalog, toggle descriptions. |
| `toggle-tool-details` | `Alt+O` | Toggle complete tool inputs and results for the turn being read. |
| `review-changes` | `Alt+V` | Preview tool files or review the current Turn’s changes. |
| `scroll-page-up` | `PgUp` | Scroll one page up. |
| `scroll-page-down` | `PgDn` | Scroll one page down. |
| `scroll-fast-up` | `Shift+Up` | Scroll quickly up. |
| `scroll-fast-down` | `Shift+Down` | Scroll quickly down. |
| `search-history` | `Ctrl+R` | Search prompt history. |
| `search-transcript` | `Ctrl+F` | Search the current transcript. |

## Composer Shell

Type `!command` in the composer to run a line in this session’s persistent Shell, or `!!command` to run it and share the output to the conversation on return. Both open the live terminal reader directly. The Shell uses the current Access level, starts in the current workspace, and retains its own directory and environment across calls. It is separate from the Agent’s tool shells.

With `!command`, output stays outside model context and does not start a model Turn unless you press `S` (**Share to conversation**). `Esc` returns to chat while the Shell continues; `Ctrl+C` interrupts and returns. `I` sends more input, `C` signals the foreground command, `S` shares output to the conversation, `Q` quotes output into the composer, and `Y` copies output. Use `/terminal` to return to a detached Shell or close it. The reader yields to approvals, and the configured Access level remains in force.

Shell history and environment last for this live Agent; resuming a saved session creates a new Shell. A marked paste beginning with `!` remains ordinary message text. Type the leading `!` deliberately to execute; an unmarked single-line paste cannot always be distinguished from typing. Attachments keep a submission in message mode. This shortcut requires an interactive terminal; terminal readiness is not reported as a command exit code.

## Related

- [Commands](commands.md) — the complete slash-command reference
- [Tune the working environment](tutorials/environment.md) — themes, motion, notifications, and the status line
- [Recover and manage a long session](tutorials/long-session.md) — resume, rewind, compact, and export
