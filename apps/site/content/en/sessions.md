---
description: "Where omdsh stores durable sessions and local data, how the Session Library searches, pins and archives sessions, and how older session logs keep working."
---

# Sessions and history

## Durable sessions

Every session is a durable JSONL log under `$OMDSH_HOME/sessions`, falling back to `$DSH_HOME` and then `~/.dsh`. The logs are the source of truth for replay, projections, and search.

- `omdsh --resume <session-id>` reopens a session from the shell; the second `Ctrl+C` prints that command with the id when the session can be resumed.
- `/resume` opens a searchable selector with the latest human-message preview, age, event count, and completion state; `/resume <session-id>` skips the selector.
- `/new` starts a clean session rather than branching the current one.
- `/retry` submits the latest human prompt again as a new turn.
- `Esc` twice or `/tree` opens the Session Tree to browse this conversation’s turns and forks. Selecting nodes previews their content; Enter on a Turn creates a branch before that message and restores its prompt, while Enter on a branch or `Alt+Enter` continues that branch from its latest state.

See [Recover and manage a long session](tutorials/long-session.md) for the walkthrough.

The terminal's native scrollback stays available when you clear the transcript, resume or switch sessions, or fork through rewind. A labelled boundary marks the replacement. A fresh launch, preset or tool-catalog changes, and entering or leaving subagent inspection omit this boundary. `/new` shows it only when the previous transcript has content beyond notices and tool catalogs.

## Session Tree

The Session Tree places forks at their inherited conversation boundary, marks the active branch, and shows shared turns once. It includes related conversation branches in the same workspace; subagent sessions remain in Agent Hub.

Use `↑`/`↓` or `Tab` to select, `←`/`→` to fold or open a subtree, and type to search while retaining matching nodes’ ancestors. The selected user message and final reply appear beside the tree on wide terminals and below it on narrower ones; `Ctrl+↑`/`Ctrl+↓` scroll the preview. `Esc` clears a search first, then closes the tree; cancelling preserves the composer and active session.

The footer names the action for Enter: **edit from here** prepares a new branch and restores the original text, images, and file references without sending a model request; **continue branch**, also available through `Alt+Enter` after searching, resumes the selected branch’s latest state. The original branches and terminal scrollback remain available. These actions change conversation history, not workspace files.

Use `Alt+L` to label a Turn or branch and edit its existing label; `Alt+U` clears it. Labels are searchable and limited to 120 characters. `Alt+B` switches between the full tree and marked nodes with their ancestors, including when no nodes are marked. Labelling and filtering preserve the active session and composer; labels stay local and never enter the model context.

## Session Library

`/sessions` opens the Session Library: `p` pins or unpins a session, `r` edits its title, and `Alt+A` archives it. `Alt+V` switches to archived sessions, where `Alt+A` restores the selection. View switching works with an empty list or search; letter actions require an empty search. Archived sessions disappear from the default library and recent-session shortcuts, while their logs and attachments remain intact. You can still resume an archived session directly by id or find it with `/sessions <query>`; resuming does not automatically restore it to the default list.

Pins, archive state, and tree labels are stored in `$OMDSH_HOME/omdsh/session-library.json`. Session titles remain in the Harness session logs. These paths fall back to `$DSH_HOME` and then `~/.dsh`.

`/sessions <query>` searches durable session content instead, through the session-query index — SQLite FTS5, built in memory on the first search of a run — and resumes the chosen hit. The search covers the full session log, so matches inside compacted or collapsed history still count.

## Unsent drafts

The interactive composer saves unsent text per session after a short idle delay, and flushes it when switching sessions or exiting. Resuming a session restores its draft and cursor, including folded paste content, image bytes, and file attachment references. Parent and inspected subagent sessions keep separate drafts.

Sending or explicitly clearing the composer removes its saved draft. Browsing input history retains the original unsent draft until you edit or select recalled text. Question answers, secret inputs, and queued messages are not saved as composer drafts. Drafts stay in local files outside the Harness log and are not included in session exports; pipe mode does not save them.

## Logs on disk

Session files may be compressed and carry integrity checks, so do not edit them by hand; keep using omdsh for those sessions. A log written by an earlier release is migrated when the session is written to, and once per session format by a background pass on the first launch after an upgrade, which publishes a version-named successor (`session.v4.jsonl[.zstd]`) beside the unchanged predecessor. A single startup notice reports how many sessions that pass upgraded.

Sessions first created with v0.5.0 through v0.11.0 may contain the private `omdsh/tools-selected` event: current omdsh recognizes and resumes them, but an unmodified DSH persistence reader refuses that log. Sessions created with v0.12.0 and later do not write the event, so newly created sessions stay loadable by stock DSH persistence.

## Local files

All of these live under the same home (`$OMDSH_HOME`, else `$DSH_HOME`, else `~/.dsh`):

| Path | Contents |
|---|---|
| `sessions/` | The durable session logs. |
| `omdsh/drafts/` | Unsent composer drafts and their image bytes, grouped by hashed session id. |
| `omdsh/history.jsonl` | Prompt history behind `Ctrl+R`. |
| `omdsh/keybindings.json` | Application keybinding overrides. |
| `omdsh/model-favorites.json` | The favorite model cycle behind `Ctrl+P` and `Alt+P`. |
| `omdsh/session-library.json` | Session pins, archive state, and local tree labels. |
| `omdsh/recent-sessions.json` | Session Library labels reused across launches; delete it to re-read every stored log. |
| `omdsh/sessions-upgraded.json` | Records the session format the stored logs were upgraded to. |
| `sessions-query.sqlite` | Derived full-text index behind session content search; delete it to rebuild on the next search. |
| `profiles/omdsh/` | The user plugin Profile managed by `omdsh plugin`, including the `cordis.patch.yml` that persists settings. |

Settings changed in `/settings` persist through that Profile patch, not a separate settings file.

## Portable archive

`/export archive [path]` creates a ZIP with logical header/event JSONL, descendant subagent sessions, and verified original image/file attachments. `manifest.json` maps opaque session and attachment ids to safe archive paths. Export uses public persistence read handles, so compressed or migrated logs do not need to be copied by hand.

The archive has a 64 MiB uncompressed limit, refuses an existing destination and removes a partial output on write failure or cancellation. Logs and original attachments are not redacted. Running sessions are captured individually, not as one atomic snapshot. The ZIP supports backup and inspection; it is not an automatic session-import format. Markdown and HTML exports remain transcript formats.

## Related

- [Commands](commands.md) — `/sessions`, `/resume`, `/retry`, `/new`, and `/export`
- [Recover and manage a long session](tutorials/long-session.md) — resume, rewind, compact, and export
- [User plugins](plugins.md) — the Profile directory and `omdsh plugin`
