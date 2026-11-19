---
description: Keyboard and mouse reference for omdsh — top 10 daily shortcuts, editing, navigation, panel controls, !command shell, and all 37 keybindings.json action IDs.
---

# Keyboard and mouse

Press **`Alt+K`** (or run `/help full`) anytime inside omdsh to inspect every shortcut active in your terminal. Open `/settings` → **`Terminal` → `Input` → `Keybindings`** to rebind keys interactively or run **`Test keys`** to see the exact sequence your terminal sends.

## Start with these 10 shortcuts

You do not need to memorize everything—these ten cover 90% of daily use:

| Shortcut | What it does |
|---|---|
| `Enter` / `Shift+Enter` (or `Ctrl+J`) | Send message / insert newline (`Ctrl+J` works in almost every terminal) |
| `Esc` | Interrupt an active turn or close the current panel, search, or subagent view |
| `Ctrl+C` | Clear a non-empty draft, interrupt while busy, or press twice at idle to exit |
| `Ctrl+O` | Browse thinking and tool details for completed or active turns |
| `Ctrl+L` | Open the model and reasoning picker |
| `Shift+Tab` | Cycle reasoning effort for the active model |
| `Alt+S` / `Alt+Enter` (`Ctrl+Q` on Win/WSL) | Steer the next step / queue for the next turn while busy |
| `Ctrl+R` | Search prompt history |
| `Ctrl+Shift+F` | Search the current transcript (`Ctrl+F` also works when the input box is empty) |
| `Esc` twice | Open the Session Tree to branch conversations or press `Alt+R` to restore turn files |

> **Platform notes:** On macOS, `Ctrl` is Control and `Alt` is Option (enable “Use Option as Meta key” in your terminal so Option does not type `å`/`¥`). Windows and local WSL default to `Ctrl+Q` for queueing, `Alt+P` for previous favorite model, and `Ctrl+Alt+V` for clipboard paste (`Alt+V` stays file preview), and do not support `Ctrl+Z` suspend.

## Input box editing and cursor movement

| Shortcut | Action |
|---|---|
| Arrow keys | Move cursor; browse input history when the input box is empty |
| `Ctrl+A` / `Home` / `Cmd+←` | Start of line |
| `Ctrl+E` / `End` / `Cmd+→` | End of line |
| `Alt+B` / `Alt+←`, `Alt+F` / `Alt+→` | Previous / next word |
| `Ctrl+W` / `Alt+Backspace`, `Alt+D` | Delete previous / next word |
| `Ctrl+U` / `Cmd+Backspace`, `Ctrl+K` | Delete to start / end of line |
| `Ctrl+Y` / `Alt+Y` | Yank deleted text / cycle kill ring (**Note: when text is selected in the view, `Alt+Y` quotes the selection into the input box first**) |
| `Ctrl+-` / `Cmd+Z` | Undo edit, or restore a just-cleared draft |
| `Ctrl+D` | Delete forward; exit omdsh when the input box is empty |
| `Ctrl+V` / `Cmd+V` (macOS) / `Ctrl+Alt+V` (Win/WSL) | Paste clipboard text or an image |
| `Alt+M` | Preview draft images (or the latest session image when the draft has none) |
| `Alt+I` | Expand a collapsed paste block (`[Pasted …]`, triggered over 10 lines or 1,000 chars) |
| `Ctrl+S` | Stash current draft; press again (or send a message) to restore |
| `Ctrl+X` / `Ctrl+G` | Draft in your external editor and return on save/close |
| `Alt+C` / `Ctrl+Alt+C` | Copy selection (or whole prompt when nothing is selected) / copy current line |
| `Cmd+Enter` (macOS) / `Ctrl+Enter` | Use the alternate busy-send mode (queue ↔ steer) while busy; normal send at idle |
| `Alt+↑` | Recall the latest queued message into an empty input box for editing |
| `Alt+Q` / `Alt+G` | Open the queue manager / goal manager while keeping your draft |

> **Paste protection** (on by default) detects unmarked multi-line pastes so embedded newlines do not submit early; disable under `/settings` → **`Terminal` → `Input`** if it affects typing in your terminal.

## Transcript navigation and mouse controls

### Keyboard navigation

| Shortcut | Action |
|---|---|
| `PgUp` / `PgDn`, `Shift+↑` / `Shift+↓` | Page or fast-scroll the transcript |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Jump to previous or next user prompt |
| `End` | Return to the live bottom and close turn details (moves to line end when already at bottom) |
| `Ctrl+O` | Browse thinking and tool rows (`↑`/`↓` select, `Enter` or `←`/`→` toggle, `Home` jump to header, `Esc` leave) |
| `Alt+O` | Toggle full tool inputs and results for every tool in the current turn |
| `Alt+A` | Open actions for the current tool (copy command/output, preview declared files) |
| `Alt+V` | Preview files referenced by the current tool (or point to `/diff` if none) |
| `Alt+Y` | Append selected text as a Markdown quote into the input box |
| `Ctrl+T` | Show or hide thinking globally across the transcript |
| `Ctrl+Shift+F` (`Ctrl+F` when empty) | Search transcript (`n`/`N` step through matches) |

### Mouse controls

- **Scroll and expand:** Use the scroll wheel in the transcript, `/settings`, history search, `/diff`, and `/trajectory`. Click disclosure arrows on thinking/tool rows to toggle them, or click `Changed` file summaries to open `/diff`.
- **Select and copy:** With in-app mouse handling (`Auto` or `On`), dragging selects text and copies on release (double-click word, triple-click line, `Shift`-click extend) and surfaces `[Copy]` / `[Quote]` buttons below the input box. Disable `Copy on select` in settings to copy manually with `Alt+C`, `Enter`, or right-click.
- **Right-click preview:** Without a text selection, right-clicking a tool card or `Changed` file row previews the file directly.
- **Native terminal mouse:** Hold `Shift` while dragging for native selection, or set `/settings` → **`Terminal` → `Mouse interaction`** to **`Off`** (`native`).

## Session and model shortcuts

| Shortcut | Action |
|---|---|
| `/`, `@` / `./` / `~/`, `Tab` | Command completion / path and session completion / accept completion |
| `Alt+K` | Open keyboard shortcuts catalog |
| `Ctrl+L` | Choose model and reasoning effort (`Alt+F` favorite, `Alt+A` toggle all/favorites) |
| `Ctrl+P` / `Ctrl+Shift+P` (or `Alt+P`) | Cycle forward / backward through favorite models |
| `Shift+Tab` | Cycle reasoning effort |
| `Alt+R` | Continue a recoverable failed generation when the input box is empty |
| `↓` (empty input box) | Focus the subagent list above the input box (`Enter` inspect, `Esc` return) |
| `Alt+L` | Repaint the live display (useful after window resize or tmux reattach) |
| `Ctrl+Z` | Suspend to background (macOS / Linux / WSL only) |

## Panels and readers

| Surface | Keys |
|---|---|
| **Settings (`/settings`)** | `Tab`/`Shift+Tab` switch tabs, `↑`/`↓` move, `←`/`→`/`Space` change value, `Enter` open sub-form, `/` search, `Ctrl+R` reset, mouse wheel scrolls, `Esc` close |
| **History search (`Ctrl+R`)** | Type tokens to filter, `↑`/`↓`/`PgUp`/`PgDn`/wheel navigate, `Enter` insert, `Esc` cancel |
| **Transcript search (`Ctrl+Shift+F`)** | Type query, `Ctrl+N`/`Ctrl+P` jump while editing, `Enter` confirm then `n`/`N` jump, `/` edit query, `Esc` close |
| **Diff & file viewer (`/diff`)** | `Tab` switch panes (wide), `V` diff/current file, `W` toggle wrap, `Alt+←`/`Alt+→` pan, `/` search, `G` go to line, `[`/`]` next/prev hunk, `Q` or `Alt+Y` with selection to quote into input box, `O` system open, `E` editor, `?` help |
| **Trajectory (`/trajectory`)** | `Enter` open details, `Tab` switch panes, `←`/`→` switch tabs, `Space` expand context/subcalls, `t`/`c` fold turns/calls, `e` errors only, `s` sort slowest first, `f` zoom, `y` copy, `/` search |
| **Session Library (`/resume`)** | `Alt+S` full-text search, `Alt+L` workspace list, `Alt+P` pin, `Alt+R` rename, `Alt+A` archive/restore, `Alt+V` archived view |
| **Session Tree (`Esc` twice)** | Type to filter, `←`/`→` fold branches, `Ctrl+↑`/`Ctrl+↓` scroll preview, `Enter` branch or continue, `Alt+L`/`Alt+U`/`Alt+B` labels, `Alt+R` restore turn files |
| **Document readers (`/help`, `/context` details, etc.)** | `↑`/`↓`/`PgUp`/`PgDn`/wheel scroll, `/` find, `Ctrl+N`/`Ctrl+P` matches, `S` sections, `Y` copy page/fields, `Esc` back |

## Shortcut Shell (`!command` and `!!command`)

Start a line in an empty input box with **`!`** (the border turns green) to run commands in a persistent shell scoped to the current session:

- **`!command`:** Runs locally and displays output for you only—**excluded from model context**.
- **`!!command`:** Shares the output into the conversation once the command finishes.
- Obeys the active access level. Press **`Ctrl+C`** (or **`Esc`** from an empty input box) to interrupt a running command. Pasted text starting with `!` stays literal.

## Custom keybindings (`keybindings.json`)

Rebind interactively in `/settings` → **`Terminal` → `Input` → `Keybindings`** (applies immediately), or edit `$OMDSH_HOME/omdsh/keybindings.json` (`"key": "action-id"`, or `null` to unbind):

```json
{
  "ctrl+j": "search-transcript",
  "ctrl+r": "retry",
  "ctrl+s": null
}
```

Join modifiers with `+` (`ctrl`/`control`, `alt`/`option`, `shift`, `super`/`cmd`/`command`), plus `f1`–`f12` and lowercase named keys (`escape`, `pageup`, `pagedown`, `left`, `right`, `up`, `down`). All **37** valid action IDs:

| Action ID | Default key | Action |
|---|---|---|
| `interrupt` | `escape` | Interrupt turn or leave current surface |
| `clear-composer` | `ctrl+c` | Clear draft or interrupt; press twice at idle to exit |
| `quit` | `ctrl+d` | Exit when the input box is empty |
| `suspend` | `ctrl+z` (POSIX only) | Suspend to background |
| `reset-display` | `alt+l` | Repaint terminal display |
| `external-editor` | `ctrl+x` / `ctrl+g` | Open prompt in external editor |
| `stash-draft` | `ctrl+s` | Stash or restore draft |
| `paste-clipboard` | `ctrl+v` / `cmd+v` / `ctrl+alt+v` | Paste clipboard text or image |
| `expand-paste` | `alt+i` | Expand collapsed paste block |
| `preview-images` | `alt+m` | Preview draft or latest session image |
| `copy-prompt` | `alt+c` | Copy selection or current prompt |
| `copy-line` | `ctrl+alt+c` | Copy current line |
| `alternate-send` | `cmd+enter` / `ctrl+enter` | Send with alternate busy behavior |
| `follow-up` | `alt+enter` / `ctrl+q` | Queue draft for next turn |
| `dequeue` | `alt+up` | Recall latest queued message |
| `steer-turn` | `alt+s` | Steer the active turn’s next step |
| `manage-goal` | `alt+g` | Manage the current goal |
| `manage-queue` | `alt+q` | Manage queued messages |
| `retry` | `alt+r` | Continue failed generation when empty |
| `select-model` | `ctrl+l` | Choose model and reasoning effort |
| `cycle-model-forward` | `ctrl+p` | Next favorite model |
| `cycle-model-backward` | `ctrl+shift+p` / `alt+p` | Previous favorite model |
| `cycle-thinking` | `shift+tab` | Cycle reasoning effort |
| `toggle-thinking` | `ctrl+t` | Show or hide thinking globally |
| `tool-actions` | `alt+a` | Open actions for current tool |
| `quote-selection` | `alt+y` | Quote selected text into input box |
| `toggle-tools` | `ctrl+o` | Browse thinking and tool calls |
| `toggle-tool-details` | `alt+o` | Toggle full tool inputs and results for current turn |
| `review-changes` | `alt+v` | Preview files declared by current tool |
| `search-history` | `ctrl+r` | Search prompt history |
| `search-transcript` | `ctrl+shift+f` | Search current transcript |
| `scroll-page-up` | `pageup` | Scroll up one page |
| `scroll-page-down` | `pagedown` | Scroll down one page |
| `scroll-fast-up` | `shift+up` | Fast-scroll up |
| `scroll-fast-down` | `shift+down` | Fast-scroll down |
| `previous-turn` | `ctrl+shift+up` | Jump to previous prompt |
| `next-turn` | `ctrl+shift+down` | Jump to next prompt |

## Related

- [Commands](commands.md) — full slash-command and reader reference
- [Settings](settings.md) — mouse, theme, notifications, and status line
- [Troubleshooting](troubleshooting.md) — macOS Option keys, newlines, and tmux tips
