---
description: "Where omdsh stores durable sessions and local data, how the Session Library searches and pins sessions, and how older session logs keep working."
---

# Sessions and history

## Durable sessions

Every session is a durable JSONL log under `$OMDSH_HOME/sessions`, falling back to `$DSH_HOME` and then `~/.dsh`. The logs are the source of truth for replay, projections, and search.

- `omdsh --resume <session-id>` reopens a session from the shell; the second `Ctrl+C` prints that command with the id when the session can be resumed.
- `/resume` opens a searchable selector with the latest human-message preview, age, event count, and completion state; `/resume <session-id>` skips the selector.
- `/new` starts a clean session rather than branching the current one.
- `/retry` submits the latest human prompt again as a new turn.
- `Esc` twice opens the conversation-turn selector: choosing a user turn branches a new session from the history before that message and restores the original prompt into the composer. The original session stays available through `/resume`, so rewind is recoverable rather than destructive.

See [Recover and manage a long session](tutorials/long-session.md) for the walkthrough.

## Session Library

`/sessions` opens the Session Library, the resume list with pin and rename actions: `p` pins a session and `r` renames it. Pins and names are stored in `$OMDSH_HOME/omdsh/session-library.json`.

`/sessions <query>` searches durable session content instead, through the session-query index — SQLite FTS5, built in memory on the first search of a run — and resumes the chosen hit. The search covers the full session log, so matches inside compacted or collapsed history still count.

## Logs on disk

Session files may be compressed and carry integrity checks, so do not edit them by hand; keep using omdsh for those sessions until an explicit migration tool is available. Reading an older log migrates it through the released v0→v3 chain and publishes a version-named successor (`session.v3.jsonl[.zstd]`) while the predecessor file stays unchanged.

Sessions first created with v0.5.0 through v0.11.0 may contain the private `omdsh/tools-selected` event: current omdsh recognizes and resumes them, but an unmodified DSH persistence reader refuses that log. Sessions created with v0.12.0 and later do not write the event, so newly created sessions stay loadable by stock DSH persistence.

## Local files

All of these live under the same home (`$OMDSH_HOME`, else `$DSH_HOME`, else `~/.dsh`):

| Path | Contents |
|---|---|
| `sessions/` | The durable session logs. |
| `omdsh/history.jsonl` | Prompt history behind `Ctrl+R`. |
| `omdsh/keybindings.json` | Application keybinding overrides. |
| `omdsh/model-favorites.json` | The favorite model cycle behind `Ctrl+P` and `Alt+P`. |
| `omdsh/session-library.json` | Session pins and renames. |
| `profiles/omdsh/` | The user plugin Profile managed by `omdsh plugin`. |

Settings changed in `/settings` persist through the Harness settings file; model settings can also come from `$DSH_HOME/settings.yaml`.

## Related

- [Commands](commands.md) — `/sessions`, `/resume`, `/retry`, `/new`, and `/export`
- [Recover and manage a long session](tutorials/long-session.md) — resume, rewind, compact, and export
- [User plugins](plugins.md) — the Profile directory and `omdsh plugin`
