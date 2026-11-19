---
description: Complete reference for session storage, /resume library, Session Tree branching, file recovery snapshots, queueing/steering, drafts, and portable archives.
---

# Sessions and recovery

Every omdsh conversation is stored as a durable local log so you can resume work, branch from earlier turns, roll back file edits, compact long context, and export records. For a guided walkthrough see [Manage long sessions and recover files](tutorials/long-session.md); this page is the complete reference.

## Quick comparison of session commands

| Action | What it does | When to use it |
|---|---|---|
| `/resume` / `omdsh --resume <id>` | Reopens a saved session (with full-text search) | Pick up earlier work |
| `/continue` / `Alt+R` (empty input) | Resumes a transiently failed generation without re-sending your prompt | Network drop, rate limit, or transient provider error |
| `/retry` | Re-sends your last human prompt with original text, images, and files | Try a fresh answer after changing models or reasoning effort |
| `/compact [focus]` | Summarizes earlier turns inside the same session | Context occupancy (`Ctx`) is getting high |
| `/new` | Starts a fresh, empty session | Switch to an unrelated task (lets you pick a new Agent preset first) |
| `/clear` | Resets conversation context below a labeled divider | Start fresh while keeping earlier terminal scrollback visible |

> **Native scrollback is never wiped:** `/clear`, switching sessions, `/resume`, and branching all append the new view below a labeled divider while keeping your earlier terminal history intact. Normal startup, preset switches, tool-catalog refreshes, and inspecting subagents add no divider; `/new` adds one only when the previous conversation had real content.

## 1. Session Library (`/resume`)

Running `/resume` opens the library scoped to your current working directory:

- **Directory scoping:** The list, recent shortcuts, completions, and content search include only sessions recorded for the current directory. To open a session from another directory, run `/resume <session-id>` or `omdsh --resume <session-id>`.
- **Full-text search:** Run `/resume <query>` or press `Alt+S` inside the library to search full session logs (powered by a SQLite FTS5 index built on first search, including compacted or folded turns). Press `Alt+L` to return to the full list.
- **Organization shortcuts:**
- `Alt+P` — pin or unpin a session.
- `Alt+R` — rename a session (manual titles are never overwritten by auto-titling).
- `Alt+A` — archive or restore a session (synced with the workspace registry for scheduled reminders and Git worktree lifecycle; worktrees are retained on archive by default).
- `Alt+V` — switch between active and archived sessions.

## 2. Session Tree (`Esc` twice)

Press **`Esc` twice** from an empty input box to browse turns and branches in the current workspace (subagents live in the subagent list above the input box rather than the tree):

- **Navigate & filter:** `↑`/`↓`/`Tab` moves focus, `←`/`→` collapses or expands subtrees, typing filters nodes while keeping ancestor paths, and `Ctrl+↑`/`Ctrl+↓` scrolls the preview pane.
- **Branch or continue:**
- Press `Enter` on a **turn** (`edit from here`) to create a branch right before that message and restore its original text, images, and file references into the input box without auto-sending.
- Press `Enter` on a **branch node** (or `Alt+Enter` on any node, `continue branch`) to resume from the latest state of that branch.
- **Node labels:** `Alt+L` adds or edits a local label (up to 120 chars; never sent to the model), `Alt+U` clears it, and `Alt+B` toggles filtering to labeled nodes.

## 3. Recovering turn files (File recovery snapshots)

Switching branches changes conversation history only. To also roll back files edited during a turn:

1. **Enable once:** Turn on **`Settings → Plugins → Tools → File recovery snapshots`** (off by default; takes effect on the next turn).
2. **Restore in three steps:** Press `Esc` twice → highlight the turn → press **`Alt+R`** → pick files, review before/after previews, and confirm. Press `Alt+H` to read saved recovery reports.
3. **Safety guarantees and limits:**
- Every file is checked against its turn-end state—**files modified later by you or another process are flagged as conflicts and left untouched**; displaced files are kept as `.omdsh-recovery-<id>.backup` backups.
- Restoration preserves messages, the current branch, and the Git index, and reminds the model on the next step to re-read restored files.
- Blocked under `Read only` access. Changing directories mid-turn, files over 128 MiB, snapshots over 1 GiB, or workspaces over 10,000 entries skip checkpointing rather than creating partial snapshots.
- Stored locally in `omdsh/file-recovery/` (excluded from `/export archive`) and never pruned automatically; delete the folder anytime to reclaim space.

## 4. Resuming after model failures (`/continue` and `/retry`)

- After built-in retries exhaust on transient errors (rate limits, server errors, timeouts, dropped streams, empty responses), `/continue` (or `Alt+R` with an empty input box) continues generation without duplicating your prompt.
- Normal completion, manual interrupts, auth/config errors, and tool errors are not transient failures—use `/retry` when you want a fresh attempt.
- Both require an idle main session with no pending queue items or open approval prompts.

## 5. Pending messages while busy (queueing, steering, and recovery)

| Mode | Shortcut | When it delivers | Best for |
|---|---|---|---|
| **Queue (next turn)** | `Alt+Enter` (`Ctrl+Q` on Windows/WSL), or `Enter` by default | Starts as the next turn after the active turn finishes | Lining up follow-up work while the current turn is on track |
| **Steer (next step)** | `Alt+S` | Injected before the next model step **without aborting active tools** | Course-correcting or adding a constraint mid-turn |

Change what `Enter` does while busy under `Settings → Terminal → Input → Busy send behavior`; `Cmd+Enter` / `Ctrl+Enter` always runs the opposite action. Both modes preserve text, images, and file attachments.

### Managing the queue (`Alt+↑` and `/queue`)

- **`Alt+↑`** (empty input box) recalls the latest queued item for editing (preserving any displaced draft if you cancel).
- **`/queue`** (or **`Alt+Q`**) opens the live queue list grouped by `Steer · next step`, `Queue · next turn`, and `Sending · not yet accepted`:
- `Enter` edits text while keeping attachments; `Alt+S` promotes an accepted queued item to steering while a turn runs; `Alt+D` removes an item; `Alt+↑`/`Alt+↓` reorders within the group; `Esc` closes without losing drafts.
- **Interrupts & restarts:** Interrupting a turn (`Esc` or `Ctrl+C`) keeps accepted queued items in `/queue`. After a normal exit or session switch, pending items do **not** auto-send on restart—local unaccepted entries appear in `/queue` as **`Recovered · confirm to send`**; press `Alt+R` to send or pull them back into the input box to edit first.

## 6. Unsent drafts and legacy session logs

- **Automatic drafts:** Unsent input, cursor position, collapsed paste originals, and attachments save automatically per session (including per subagent) on pause, session switch, or exit, and clear when sent or explicitly cleared. Drafts are excluded from exports.
- **Legacy migrations:** Older logs show `migration required` in `/resume`; confirming writes a versioned successor file while leaving the original untouched. Sessions created in v0.5.0–v0.11.0 may contain an early private event that omdsh still opens; v0.12.0+ sessions are fully readable by standard DSH persistence readers.

## 7. Portable archives (`/export archive`)

- `/export` supports **Markdown**, **HTML**, and **Archive (`.zip`)**.
- `/export archive [path]` packages logical session JSONL, child subagent logs, verified original image/file attachments, and `manifest.json` (64 MiB uncompressed cap; refuses to overwrite existing files).
- Archives are **not redacted** and are intended for backup/inspection rather than automated re-import. File recovery snapshots are not included.

## 8. Local data files

All local data lives under `$OMDSH_HOME` (falling back to `$DSH_HOME`, then `~/.dsh`):

| Path | Contents |
|---|---|
| `sessions/` | Durable session logs (JSONL, possibly compressed with checksums—do not hand-edit). |
| `sessions-query.sqlite` | Derived full-text search index (rebuilt automatically if deleted). |
| `storages/` | Persistent key-value data, workspace registry, and scheduled reminders. |
| `profiles/omdsh/` | User plugin profile and persisted settings patch (`cordis.patch.yml`). |
| `omdsh/drafts/` | Unsent drafts and draft image bytes per session. |
| `omdsh/history.jsonl` | Prompt history used by `Ctrl+R`. |
| `omdsh/keybindings.json` | Custom application keybinding overrides. |
| `omdsh/model-favorites.json` | Favorite model cycle list (`/model favorite`). |
| `omdsh/session-library.json` | Pinned/archived flags and local Session Tree labels. |
| `omdsh/recent-sessions.json` | Cached session-library labels (rebuilt if deleted). |
| `omdsh/file-recovery/` | Per-turn file recovery snapshots, manifests, and recovery reports. |
| `omdsh/approval-rules/` | Remembered approval allow/reject rules (up to 500). |
| `omdsh/btw/` | `/btw` side-query records. |
| `omdsh/logs/omdsh.log` | Redirected plugin diagnostic logs during interactive runs (delete to reset). |

## Related

- [Manage long sessions and recover files](tutorials/long-session.md) — step-by-step walkthrough
- [Commands](commands.md) — `/resume`, `/retry`, `/compact`, `/export`
- [Plugins and integrations](plugins.md) — profile directory and `omdsh plugin`
