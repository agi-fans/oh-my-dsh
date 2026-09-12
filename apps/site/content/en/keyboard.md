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
| `Ctrl+-` | Undo the last edit. |
| `Ctrl+D` | Delete forward, or quit when the composer is empty. |
| `Ctrl+V` | Paste clipboard text or an image. |
| `Alt+C` | Copy the current prompt. |
| `Ctrl+Alt+C` | Copy the current line. |
| `Ctrl+X` | Edit the prompt in `$VISUAL` or `$EDITOR`. |

## Transcript

| Shortcut | Action |
|---|---|
| `PgUp` / `PgDn` | Scroll one page. |
| `Shift+Up` / `Shift+Down` | Scroll quickly. |
| `Ctrl+O` | Expand tool output or catalog descriptions. |
| `Ctrl+F` | Search the current transcript when the composer is empty; `n`/`N` step across matches. |
| `Alt+A` | Open the Agent Hub; continuable child agents can be steered from their transcript. |

## Session

| Shortcut | Action |
|---|---|
| `Esc` twice | Rewind to an earlier conversation turn. |
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
| Settings (`/settings`) | `↑`/`↓` move between rows, `←`/`→` change a value, `Space` show or hide a status item, `Enter` change a value or start moving a status item, `Tab`/`Shift+Tab` switch sections, `Home`/`End` jump to the edges, `Esc`/`Ctrl+C` close. |
| Copy picker (`/copy`) | `↑`/`↓` or `Tab` navigate, `PgUp`/`PgDn` page, `Home`/`End` edges, `Enter`/`Space` copy, `Esc`/`Ctrl+C` close. |
| Agent Hub (`Alt+A`, or `↓` on an empty composer) | `↑`/`↓` navigate, `Home`/`End` edges, `Enter` open the child transcript, `Tab`/`←`/`→` switch the inspector pane, `PgUp`/`PgDn` scroll, `T` toggle the tree, `Esc`/`Ctrl+C` close. |
| History search (`Ctrl+R`) | Type to filter, `↑`/`↓`/`Tab`/`PgUp`/`PgDn`/`Home`/`End` navigate, `Enter` select, `Esc`/`Ctrl+C` cancel; the query accepts the line-editing keys. |
| Transcript search (`Ctrl+F`) | Type the query, `Ctrl+N`/`Ctrl+P` step while editing, `Enter` confirm, `n`/`N` step across matches, `/` edit the query, `Esc`/`Ctrl+C` close. |
| Trajectory (`/trajectory`) | `↑`/`↓`, `Home`/`End`, `PgUp`/`PgDn` navigate, `Enter` open details, `Tab`/`←`/`→` switch sections, `/` search, `n`/`N` and `Ctrl+N`/`Ctrl+P` step matches, `t` collapse turns, `c` collapse calls, `Esc`/`Ctrl+C` close. |
| Prompts (resume, permission, model, agent, workflow, login, rewind) | Type to filter, `↑`/`↓`/`Tab` navigate, `←`/`→` choose, `PgUp`/`PgDn` and `Home`/`End` move, `Space` multi-select, `Enter` select or submit, `Ctrl+J` submit, `Esc` go back or cancel, `Ctrl+C` cancel. |

## Custom keybindings

Application bindings live in `$OMDSH_HOME/omdsh/keybindings.json` (falling back to `$DSH_HOME`, then `~/.dsh`), the same home that stores sessions, settings, and MCP files. The document maps lower-case key ids to action ids:

```json
{
  "ctrl+j": "search-transcript",
  "ctrl+r": "retry"
}
```

Key ids join modifiers with `+` (`ctrl`, `alt`, `shift`, `super`) and spell named keys in lower case (`pageup`, `pagedown`, `escape`, `left`, `right`, `up`, `down`). Values must be one of the action ids below; an unknown action or a malformed file leaves the shipped binding in place for that entry. Bindings are read once at startup, so restart omdsh after editing the file, and `/help` then shows the effective keys.

| Action id | Default key | Effect |
|---|---|---|
| `external-editor` | `Ctrl+X` | Edit the prompt in `$VISUAL` or `$EDITOR`. |
| `retry` | `Alt+R` | Run the most recent human prompt again. |
| `paste-clipboard` | `Ctrl+V` | Paste clipboard text or an image. |
| `copy-prompt` | `Alt+C` | Copy the current prompt. |
| `copy-line` | `Ctrl+Alt+C` | Copy the current line. |
| `inspect-subagent` | `Alt+A` | Open the Agent Hub. |
| `cycle-model-forward` | `Ctrl+P` | Cycle to the next favorite model. |
| `cycle-model-backward` | `Alt+P` | Cycle to the previous favorite model. |
| `cycle-reasoning` | `Ctrl+T` | Cycle the current model's reasoning effort. |
| `toggle-tools` | `Ctrl+O` | Expand tool output or catalog descriptions. |
| `scroll-page-up` | `PgUp` | Scroll one page up. |
| `scroll-page-down` | `PgDn` | Scroll one page down. |
| `scroll-fast-up` | `Shift+Up` | Scroll quickly up. |
| `scroll-fast-down` | `Shift+Down` | Scroll quickly down. |
| `search-history` | `Ctrl+R` | Search prompt history. |
| `search-transcript` | `Ctrl+F` | Search the current transcript. |

## Related

- [Commands](commands.md) — the complete slash-command reference
- [Tune the working environment](tutorials/environment.md) — themes, motion, notifications, and the status line
- [Recover and manage a long session](tutorials/long-session.md) — resume, rewind, compact, and export
