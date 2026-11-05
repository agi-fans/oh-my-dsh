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
| `Shift+Enter` / `Ctrl+J` | Insert a new line. |
| `Ctrl+W` / `Alt+Backspace` | Delete the previous word. |
| `Alt+D` | Delete the next word. |
| `Ctrl+U` | Delete to the start of the line. |
| `Ctrl+K` | Delete to the end of the line. |
| `Ctrl+Y` | Yank deleted text. |
| `Alt+Y` | Cycle the yank ring. |
| `Ctrl+-` | Undo the last edit or restore a cleared draft. |
| `Ctrl+D` | Delete forward, or exit when the composer is empty. |
| `Ctrl+V` | Paste clipboard text or an image. |
| `Alt+M` | Preview composer images without sending them; with no draft image, open the newest image in the conversation. |
| `Alt+I` | Expand a folded pasted block for editing. |
| `Alt+Up` | Withdraw the latest queued message into the empty composer for editing; Enter submits it again. |
| `Alt+G` | Manage the current goal without submitting the draft. |
| `Alt+Q` | Open Message Queue without submitting the composer draft. |
| `Ctrl+S` | Stash or restore the current composer draft; a stashed draft returns automatically after you send a message. |
| `Alt+S` | Send the draft, including images and files, to the active Turn’s next model step. |
| `Alt+Enter` | Queue the draft for after the active turn, regardless of the Enter while running setting. |
| `Alt+C` | Copy the selected text, or the current prompt when nothing is selected. |
| `Ctrl+Alt+C` | Copy the current line. |
| `Ctrl+X` / `Ctrl+G` | Edit the prompt in the editor selected in Settings. |

Pastes longer than ten lines or 1,000 characters appear as `[Pasted #1: 120 lines]` or a character-count marker. Arrow keys and deletion treat each block as one unit; `Alt+I` expands the block at or nearest the caret for editing, and `Ctrl+-` undoes insertion, deletion, or expansion. Copying the prompt, using the external editor, and sending a message use the full text. Temporary questions and queued-message editing retain the source. A draft beginning with a folded paste sends its source as a message even if it begins with `/`. A draft queued with `Alt+Enter` is shown as `Queue · next turn` once Harness accepts it and `Alt+Up` recalls it for editing.

**Paste protection** also recognizes long text chunks, multiline reads, and rapid ASCII key streams when a terminal does not mark pasted input, keeping embedded Enter keys from submitting a message. Wait briefly after the paste finishes, then press Enter to send. Normal typing and individual IME commits appear immediately. This detection is heuristic; turn it off in Settings if it interferes with your terminal. Explicit bracketed paste remains safe with this setting off.

## Transcript

While a turn runs, thinking and tool calls start as compact disclosure rows. Replies use ordinary Markdown; failed calls retain their reason. Opening a thought shows quiet italic text; opening a tool shows readable content with horizontal and vertical padding on a neutral surface. Terminal output stays plain; recognized source files retain syntax colors, with Read line numbers aligned separately from wrapped code. Alt+O exposes complete Input and Output sections. The composer carries activity such as `Deep Driving`, retries and compaction in its top border, and temporary confirmations in its bottom border. When the turn finishes, the process folds to a summary such as `Worked for 16s`; all assistant replies and failure facts remain visible. Items being inspected stay open through completion until the reader returns to the live tail.

Narrow tables show labelled records when their columns would become unreadable. Complete supported Mermaid diagrams draw with terminal characters when they fit; unsupported, incomplete or oversized diagrams stay visible as code. **Mermaid in replies** in [Settings](settings.md) switches between Auto and Source. Reply formulas follow the **Math in replies** preference in [Settings](settings.md). **Thinking in turns** in [Settings](settings.md) defaults to collapsed, with a one-line `Thinking · …` preview of the latest paragraph. During streaming, a paragraph enters the preview only when its first line is complete; subsequent words in that paragraph do not change the preview. Existing explicit Shown preferences remain effective; `Ctrl+T` switches this preference and individual items can still be opened or closed.

`Ctrl+O` enters process browsing for the running or completed turn under the viewport. Use `↑`/`↓` to select an item, `Enter` to toggle its readable content, and `←`/`→` to close/open it. `Home` returns to the title of the tool being read, or the selected item when no tool detail is under the viewport. Closing and reopening a tool restores its reading position during the same inspection; a changed terminal width or detail format returns to the title. Commands show the command and output; files show their content, edits show diffs, and searches show locations and matches. `Esc`, `Ctrl+O`, or `End` returns to the live tail and resets disclosures; typing or pasting returns focus to the composer while leaving the process open. The draft is retained. `Alt+O` opens complete parameters and results for all tools in the current turn, including PTC sub-calls and new calls that arrive while running; pressing it again restores compact rows. Scrolling past the end also closes inspection. Opening details never rewrites native terminal history. When a compaction notice is under the viewport, `Ctrl+O` opens its saved summary instead.

Details show all text received by the TUI; they cannot recover content already truncated or spilled to a file by a tool. `/trajectory` provides event-level inspection, and `Ctrl+Shift+F` searches content outside the previews and reveals matches; `Ctrl+F` still does when the composer is empty, and keeps moving the caret when it is not.

When earlier messages are in view, a `↓ Latest · End` label appears above the composer area. Once a user prompt scrolls out of view, a one-line summary stays at the top while its reply is visible. The pinned prompt follows the turn being read. Inside an expanded tool result, the same top row shows the tool title until its details leave the viewport; it then returns to the prompt summary. These labels are viewport controls, not conversation content.

| Shortcut | Action |
|---|---|
| `PgUp` / `PgDn` | Scroll one page. |
| `Shift+Up` / `Shift+Down` | Scroll quickly. |
| Mouse wheel | Scroll the transcript from the live tail or while inspecting a turn; expanding a turn is not required. |
| `End` / click jump label | Return to the latest message and close turn inspection. At the live tail, `End` moves to the end of the composer line. |
| `Ctrl+O` | Browse the running or completed turn: ↑/↓ select, Enter toggles, ←/→ close/open, Home returns to the title, Esc returns. Press again to return to the live tail. On the tool catalog, toggle descriptions. |
| `Alt+O` | Toggle complete tool inputs and results for the turn being read, including a running turn. |
| `Alt+A` | Open the current tool’s actions: copy its command or result, or view its declared files. |
| `Alt+Y` | Append selected text to the draft as a Markdown quote, without sending it. |
| `Alt+V` | Preview the files the tool under the reading position declared. With no tool there it says so and points at `/diff`, which reviews this turn’s changes. |
| `Ctrl+Shift+F` | Search the current transcript; `n`/`N` step across matches. `Ctrl+F` does the same when the composer is empty, and moves the caret otherwise. |
| `Ctrl+T` | Show or hide thinking across the transcript. |

When the transcript can scroll or contains disclosure arrows or actionable files, omdsh supports mouse dragging within the current viewport in both folded and expanded views. Double-click selects a word or path; triple-click selects a line, and Shift-click extends a selection. Releasing the mouse copies by default. Turn off **Copy on select** in Settings to copy explicitly with `Alt+C`, `Enter`, or right-click; `Esc` clears the selection, and `Ctrl+C` retains its clear/interrupt behavior. With a writable composer, `Alt+Y` appends the selection as a Markdown blockquote, preserving the draft and attachments without sending. The quote is one undoable edit; long quotes fold like pasted text. Scrolling, resizing, typing, or changed selected rows clears the selection.

Click a process row’s left-hand arrow to open or close its content; click a completed turn’s arrow to browse its process. The left gutter, including the arrow and surrounding blank cells before the title, is clickable. Small movements within that gutter and preview updates do not cancel a click. Titles and paths remain selectable; dragging out of the gutter selects text without toggling, even if the pointer returns. Shift-click keeps extending the selection. Keyboard navigation continues from the clicked item.

The selected tool row also has a `[···]` button for the same actions; the menu identifies the command or file. With text selected, `[Copy]` and `[Quote]` appear beneath the composer when space permits. Clicking them keeps the draft and reading position; dragging outside a button cancels the click. Copy and quote confirmations temporarily replace navigation hints.

For Read results with a retained contiguous range, **Copy source** copies that range without display line numbers or wrapping. **Quote source** appends the file and line range plus a fenced code block to the draft. Both use the content retained by the original call, preserving indentation and long lines; they do not reopen a possibly changed file or recover text the tool did not return. Read-only views offer copying only.

Without a text selection, right-click a tool card with declared file locations to preview its files, or a Changed files row to preview that file. The reader reuses Open and the configured Editor. Relative tool paths retain the invocation’s directory; Changed files retain the summary’s directory. These previews show current host-file contents. `Alt+V` opens the same files for the tool under the reading position, and a completed Turn summary does not make hidden tool cards clickable. Search tools list each declared match by file and line, with its matching text; choosing a match opens that line, including multiple matches in the same file. The reader loads enough text to reach the line within its 4 MiB preview limit; files may have changed since the search. `Alt+A` also offers these files alongside copy actions for the current tool. Closing the menu or reader retains the draft and transcript reading position. Reviewing a turn’s changes is `/diff`. Native mouse mode keeps keyboard access. An approval or another human prompt cancels a file action rather than competing for input.

**Mouse interaction** defaults to `auto`, which respects tmux mouse off; `tui` explicitly enables application handling and `native` leaves mouse input to the terminal while keyboard scrolling and `End` remain available. Native terminal history is retained and uses terminal selection or tmux copy-mode.

Full-screen pages temporarily suspend application mouse handling. Reading views such as `/trajectory` restore the inspected position on close; commands that return transcript text move to the live tail to show their result.

File and Diff source readers use `/` or `Ctrl+F` to search loaded text, `Ctrl+N`/`Ctrl+P` to cycle matching lines, and `G` or `Ctrl+G` to jump to a file line. `[`/`]` navigate diff hunks. `L` loads more text, `Q` quotes `@path:line` into the composer, and `M` toggles Markdown rendering when available. Enter applies a search or line entry; Esc cancels the entry before returning to the file list. See [File commands](commands.md) for preview limits and view behavior.

Source readers wrap long lines by default. `W` toggles wrapping; `Alt+Left`/`Alt+Right` pans eight display cells and switches to unwrapped mode. Line numbers stay fixed, and wrapping and horizontal position are retained across reader actions. Ordinary Left/Right still select the action buttons. Background-job output uses the same reading keys.

## Session

| Shortcut | Action |
|---|---|
| `Esc` | Cancel or leave whatever has the screen: a prompt, an overlay, a search, a subagent inspection. During a turn it interrupts while preserving accepted Queue and Steer messages. With nothing typed it opens the Session Tree when pressed twice. |
| `Ctrl+C` once | Clear the composer, or interrupt the active turn while the composer is empty. |
| `Ctrl+C` twice | Exit; a durable session prints an `omdsh --resume <session-id>` hint. |
| `Ctrl+Z` | Suspend to the background. |
| `Alt+L` | Reset the terminal display. |
| `Ctrl+R` | Search prompt history. |
| `↓` (empty composer) | Enter the subagent roster; `↑`/`↓` select a child, `Enter` opens its transcript, `Esc` returns to the composer. |
| `Alt+R` | Continue an eligible failed generation with an empty composer. |
| `Ctrl+L` | Choose model and reasoning effort. |
| `Ctrl+P` / `Ctrl+Shift+P` | Cycle to the next or previous favorite model. `Alt+P` also cycles backward. |
| `Shift+Tab` | Cycle the current model's reasoning effort. |
| `Ctrl+T` | Show or hide thinking. |
| `/` | Open slash-command completion. |
| `@` / `./` / `~/` | Complete file paths. |
| `Tab` | Accept command or path completion. |

## Overlays

| Overlay | Keys |
|---|---|
| Settings (`/settings`) | `↑`/`↓` move between rows, `←`/`→` change a value, `Space` change a value or show/hide a status item, `Enter` open configuration, change a value, or start moving a status item, `Tab`/`Shift+Tab` switch sections, `Home`/`End` jump to the edges, `/` or typing searches all categories, `Backspace`/`Ctrl+U` edit the query, `Ctrl+R` restores inheritance (status items restore color), `Esc`/`Ctrl+C` clear search, return to browsing, or close. |
| History search (`Ctrl+R`) | Type to filter, `↑`/`↓`/`Tab`/`PgUp`/`PgDn`/`Home`/`End` navigate, `Enter` select, `Esc`/`Ctrl+C` cancel; the query accepts the line-editing keys. |
| Transcript search (`Ctrl+Shift+F`) | Type the query, `Ctrl+N`/`Ctrl+P` step while editing, `Enter` confirm, `n`/`N` step across matches, `/` edit the query, `Esc`/`Ctrl+C` close. |
| Trajectory (`/trajectory`) | `↑`/`↓`, `Home`/`End`, `PgUp`/`PgDn` navigate, `Enter` open details, `Tab`/`←`/`→` switch sections, `/` search, `n`/`N` and `Ctrl+N`/`Ctrl+P` step matches, `t` collapse turns, `c` collapse the calls inside every step, `Esc`/`Ctrl+C` close. |
| Session Library | `p` pins/unpins and `r` renames with an empty search; `Alt+A` archives/restores the selection, `Alt+V` switches active/archived lists even when empty or searching. |
| Session Tree | Type to search; `↑`/`↓`/`Tab` select, `←`/`→` fold, `Ctrl+↑`/`Ctrl+↓` scroll the preview, `Enter` edits a Turn or continues a branch, `Alt+Enter` continues the selected node’s branch, `Alt+L` labels a node, `Alt+U` clears its label, `Alt+B` toggles marked nodes, `Alt+R` reviews Turn file recovery, `Esc` clears search then closes, `Ctrl+C` cancels. |
| Prompts (resume, permission, model, agent, workflow, login) | Type to filter, `↑`/`↓`/`Tab` navigate, `←`/`→` choose, `Alt+Left` return to the previous question in multi-question prompts, `Ctrl+X` edit Plan Review feedback in the external editor, `PgUp`/`PgDn` and `Home`/`End` move, `Space` multi-select, `Enter` select or submit, `Ctrl+J` submit, `Esc` go back or cancel, `Ctrl+C` cancel. |

Searchable choice lists accept multiple words, such as `official flash`; every word must match a name, identifier, preview, or description. Short abbreviations such as `flsh` match within a word. Exact names and name prefixes rank ahead of description-only matches, and clearing the query restores the original order. This applies to filtering a picker; transcript search, prompt history, and `/resume <query>` retain their own search rules.

## Custom keybindings

Application bindings live in `$OMDSH_HOME/omdsh/keybindings.json` (falling back to `$DSH_HOME`, then `~/.dsh`), the same home that stores sessions, settings, and MCP files. You can remap or unbind shortcuts interactively in `/settings` under **Terminal → Input → Keybindings** (which saves and applies changes immediately), or edit the JSON file directly:

```json
{
  "ctrl+j": "search-transcript",
  "ctrl+r": "retry",
  "ctrl+s": null
}
```

Key ids join modifiers with `+` (`ctrl`, `alt`, `shift`, `super`) and spell named keys in lower case (`pageup`, `pagedown`, `escape`, `left`, `right`, `up`, `down`). Values must be one of the action ids below, or `null` to unbind a default key; an unknown action or a malformed file leaves the shipped binding in place for that entry. `/help` shows the effective keys.

**Test keys** in Keybindings shows the text or key sequence the terminal actually sends and any assigned application action. Testing does not run shortcuts, edit the draft, or save bindings; `Esc` or `Ctrl+C` returns. Standard terminal encodings for `F1`–`F12`, including modifiers, are supported (for example, `"f6": "tool-actions"`). A terminal or OS shortcut may intercept a key before omdsh sees it. On macOS, Option may produce characters such as `å` or `¥`; these remain ordinary text. Use a different binding or configure Option/Alt in the terminal, then test again.

| Action id | Default key | Effect |
|---|---|---|
| `preview-images` | `Alt+M` | Preview draft images, or the newest conversation image. |
| `expand-paste` | `Alt+I` | Expand a pasted block for editing. |
| `manage-goal` | `Alt+G` | Edit, pause, resume or clear the current goal. |
| `manage-queue` | `Alt+Q` | Manage individual pending messages. |
| `steer-turn` | `Alt+S` | Send the draft, including images and files, to the active Turn’s next model step. |
| `stash-draft` | `Ctrl+S` | Stash or restore the current composer draft. |
| `external-editor` | `Ctrl+X` / `Ctrl+G` | Edit the prompt in the editor selected in Settings. |
| `retry` | `Alt+R` | Continue an eligible failed generation with an empty composer. |
| `paste-clipboard` | `Ctrl+V` | Paste clipboard text or an image. |
| `copy-prompt` | `Alt+C` | Copy the selected text, or the current prompt when nothing is selected. |
| `copy-line` | `Ctrl+Alt+C` | Copy the current line. |
| `cycle-model-forward` | `Ctrl+P` | Cycle to the next favorite model. |
| `cycle-model-backward` | `Ctrl+Shift+P` | Cycle to the previous favorite model (`Alt+P` is equivalent). |
| `cycle-thinking` | `Shift+Tab` | Cycle the current model's reasoning effort. |
| `toggle-thinking` | `Ctrl+T` | Show or hide thinking across the transcript. |
| `toggle-tools` | `Ctrl+O` | Browse the running or completed turn: ↑/↓ select, Enter toggles, ←/→ close/open, Home returns to the title, Esc returns. Press again to return to the live tail. On the tool catalog, toggle descriptions. |
| `toggle-tool-details` | `Alt+O` | Toggle complete tool inputs and results for the turn being read. |
| `tool-actions` | `Alt+A` | Copy or open the current tool’s content. |
| `quote-selection` | `Alt+Y` | Quote selected text in the composer. |
| `review-changes` | `Alt+V` | Preview the files the tool under the viewport declared. |
| `scroll-page-up` | `PgUp` | Scroll one page up. |
| `scroll-page-down` | `PgDn` | Scroll one page down. |
| `scroll-fast-up` | `Shift+Up` | Scroll quickly up. |
| `scroll-fast-down` | `Shift+Down` | Scroll quickly down. |
| `search-history` | `Ctrl+R` | Search prompt history. |
| `search-transcript` | `Ctrl+Shift+F` | Search the current transcript (`Ctrl+F` is equivalent when the composer is empty). |

## Composer Shell

Type `!command` in the composer to run a line in this session’s persistent Shell, or `!!command` to run it and share the output to the conversation. The composer border turns green as soon as the draft starts with `!`, so the mode is visible before you commit to running anything. The Shell uses the current Access level, starts in the current workspace, and retains its own directory and environment across calls. It is separate from the Agent’s tool shells.

The output streams into the transcript as a card under your command and settles in place when the command finishes — there is no reader to open or leave. `Ctrl+C` interrupts the running command. With `!command` the output stays outside model context; `!!command` shares it to the conversation when the command finishes. The configured Access level remains in force.

Shell history and environment last for this live Agent; resuming a saved session creates a new Shell. A marked paste beginning with `!` remains ordinary message text. Type the leading `!` deliberately to execute; an unmarked single-line paste cannot always be distinguished from typing. Attachments keep a submission in message mode. This shortcut requires an interactive terminal; terminal readiness is not reported as a command exit code.

## Related

- [Commands](commands.md) — the complete slash-command reference
- [Tune the working environment](tutorials/environment.md) — themes, motion, notifications, and the status line
- [Recover and manage a long session](tutorials/long-session.md) — resume, rewind, compact, and export
