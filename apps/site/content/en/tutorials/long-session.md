---
description: Resume, rewind, compact, and export long omdsh sessions, including omdsh --resume after a two-step Ctrl-C exit.
---

# Recover and manage a long session

By the end of this walkthrough you can resume a session after leaving, rewind to an earlier turn, compact old history, and export a transcript.

### Resume after leaving

The first `Ctrl+C` clears or interrupts, and a second one exits. When the active session is durable, omdsh prints a command you can paste later:

```sh
omdsh --resume <session-id>
```

Inside the TUI, `/resume` opens a searchable session selector with the latest human-message preview, age, event count, and completion state. `/resume <session-id>` skips the selector when you already know the identifier. Session logs, the Session Library, and the local data files are documented in [Sessions and history](../sessions.md).

### Understand legacy session compatibility

omdsh v0.12.0 and later no longer add the private `omdsh/tools-selected` event, so newly created sessions can be loaded by an unmodified DSH persistence reader. Sessions first created with v0.5.0 through v0.11.0 may still contain that event: current omdsh recognizes it and can resume those sessions, but an unmodified DSH reader will refuse the log. Session files may be compressed and include integrity checks, so do not edit them by hand; keep using omdsh for those sessions until an explicit migration tool is available.

### Explore branches without losing history

When the agent is idle and the composer is empty, press `Esc` twice, or run `/tree`, to open the Session Tree. Browse turns and forks with `↑`/`↓`, fold them with `←`/`→`, and type to search while previewing the selected content. Enter on a Turn prepares a new branch before that message and restores its text, images, and file references into the composer without sending it. Enter on a branch or `Alt+Enter` resumes that branch’s latest state. The original branches stay available; these operations do not roll back workspace files.

Two neighboring commands cover other session workflows:

- `/retry` submits the latest human prompt again as a new turn.
- `/new` starts a clean session instead of branching the current one.

### Compact and export

Run `/compact` while the agent is idle to replace a useful older history span with a summary. The compacting state remains visible until the durable checkpoint finishes; wait for completion before starting another session operation. If there is not enough history, the command reports that nothing is compactable.

Run `/export` to write the complete transcript as `omdsh-transcript-<session-id>.md` in the current directory, or supply a destination:

```text
/export docs/session-review.md
```
