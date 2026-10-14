---
description: "Where omdsh stores durable sessions and local data, how the Session Library searches, pins and archives sessions, and how older session logs keep working."
---

# Sessions and history

## Durable sessions

Every session is a durable JSONL log under `$OMDSH_HOME/sessions`, falling back to `$DSH_HOME` and then `~/.dsh`. The logs are the source of truth for replay, projections, and search.

- `omdsh --resume <session-id>` reopens a session from the shell; the second `Ctrl+C` prints that command with the id when the session can be resumed.
- `/sessions` opens the Session Library with message previews, age, event counts and completion state; bare `/resume` opens the same library for compatibility. `/resume <session-id>` skips the selector. `Alt+S` searches durable message content, and search results keep rename, pin and archive actions; `Alt+L` returns to all sessions.
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

### Restore Turn files

Enable **File recovery snapshots** in `/settings` → Tools before starting a Turn. It is Off by default because it saves private file contents and adds capture work. In Session Tree, select a Turn and press `Alt+R`, choose files, review their before/after contents and confirm **Restore selected files**; Cancel is selected initially. Changes apply to the next Turn; a capture already started continues when the switch is turned Off. Earlier Turns without complete snapshots cannot be recovered from their diff summaries.

Recovery keeps messages, the active branch, working directory and Git index unchanged. It restores ordinary file bytes and mode bits, recreates deleted files and removes created files. It rechecks each file against its retained post-Turn version, preserving later user or process changes as conflicts. Snapshot changes cover a time window and may include other processes’ edits; they are not automatically attributed to the model. A working-directory change within a Turn makes that checkpoint unavailable. Restore can target a saved directory after navigation, subject to current Access; Read only blocks restoration, and the worker remains confined even under Full access. The next model step receives a notice to reread affected files.

Open saved reports with `Alt+H` in the recovery file picker; when no files are restorable, that reading page includes the earlier reports. The report distinguishes restored, already-restored, conflict, failed, cancelled and uncertain results. Cancellation can leave a partial restoration. Displaced entries remain under reserved `.omdsh-recovery-<operation-id>.backup` paths; an interrupted receipt’s planned operations have unconfirmed completion and are never automatically retried. Backups retain the original inode so a writer holding its old descriptor does not lose data. Recovery is per file, not an all-files transaction.

Git capture covers tracked and nonignored untracked files in the active directory; ignored existing paths, submodules, embedded repositories and Git metadata are excluded or protected. Non-Git capture walks that directory without following links. Private snapshots and receipts stay under `omdsh/file-recovery/` and survive resume. No automatic pruning occurs; deleting this directory removes recovery data, without deleting messages or workspace backups. Empty directories, ownership, ACLs and extended attributes are outside the content contract. Hard links, special files or permission bits, Windows reparse points, ambiguous paths, unstable scans, more than 10,000 entries, files above 128 MiB or snapshots above 1 GiB make capture unavailable rather than produce an incomplete checkpoint.

## Session Library

`/sessions` opens the Session Library: `p` pins or unpins a session, `r` edits its title, and `Alt+A` archives it. `Alt+V` switches to archived sessions, where `Alt+A` restores the selection. View switching works with an empty list or search; letter actions require an empty search. Archived sessions disappear from the default library and recent-session shortcuts, while their logs and attachments remain intact. You can still resume an archived session directly by id or find it with `/sessions <query>`; resuming does not automatically restore it to the default list.

Pins, archive state, and tree labels are stored in `$OMDSH_HOME/omdsh/session-library.json`. Session titles remain in the Harness session logs. These paths fall back to `$DSH_HOME` and then `~/.dsh`.

`/sessions <query>` searches durable session content instead, through the session-query index — SQLite FTS5, built in memory on the first search of a run — and resumes the chosen hit. The search covers the full session log, so matches inside compacted or collapsed history still count.

## Unsent drafts

The interactive composer saves unsent text per session after a short idle delay, and flushes it when switching sessions or exiting. Resuming a session restores its draft and cursor, including folded paste content, image bytes, and file attachment references. Parent and inspected subagent sessions keep separate drafts.

Sending or explicitly clearing the composer removes its saved draft. Browsing input history retains the original unsent draft until you edit or select recalled text. Question answers, secret inputs, and queued messages are not saved as composer drafts. Drafts stay in local files outside the Harness log and are not included in session exports; pipe mode does not save them.

## Logs on disk

Session files may be compressed and carry integrity checks, so do not edit them by hand. Startup and Session Library browsing do not migrate historical logs. The library marks them `migration required`, using a previous cached title when available or the session id otherwise. Interactive `/resume` and selected library or search results ask before opening a migration-required session. Accepting writes a version-named successor (`session.v4.jsonl[.zstd]`) beside the unchanged predecessor; cancelling leaves the session unopened. `omdsh --resume <session-id>` and line-input `/resume <session-id>` explicitly activate and migrate that session without an extra interactive prompt. Other explicit writes, such as renaming, can also migrate the selected log.

Sessions first created with v0.5.0 through v0.11.0 may contain the private `omdsh/tools-selected` event: current omdsh recognizes and resumes them, but an unmodified DSH persistence reader refuses that log. Sessions created with v0.12.0 and later do not write the event, so newly created sessions stay loadable by stock DSH persistence.

## Local files

All of these live under the same home (`$OMDSH_HOME`, else `$DSH_HOME`, else `~/.dsh`):

| Path | Contents |
|---|---|
| `sessions/` | The durable session logs. |
| `omdsh/file-recovery/` | Private Turn file snapshots, checksummed manifests and recovery receipts. |
| `omdsh/drafts/` | Unsent composer drafts and their image bytes, grouped by hashed session id. |
| `omdsh/history.jsonl` | Prompt history behind `Ctrl+R`. |
| `omdsh/keybindings.json` | Application keybinding overrides. |
| `omdsh/model-favorites.json` | The favorite model cycle behind `Ctrl+P` and `Alt+P`. |
| `omdsh/session-library.json` | Session pins, archive state, and local tree labels. |
| `omdsh/recent-sessions.json` | Session Library labels reused across launches; deleting it re-reads current-format logs and leaves historical logs as header-only rows. |
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

File recovery snapshots and receipts are profile-local and are not included in portable archives.
