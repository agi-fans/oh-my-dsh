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

Inside the TUI, `/resume` opens a searchable session selector with the latest human-message preview, age, event count, and completion state. `/resume <session-id>` skips the selector when you already know the identifier.

### Understand legacy session compatibility

omdsh v0.12.0 and later no longer add the private `omdsh/tools-selected` event, so newly created sessions can be loaded by an unmodified DSH persistence reader. Sessions first created with v0.5.0 through v0.11.0 may still contain that event: current omdsh recognizes it and can resume those sessions, but an unmodified DSH reader will refuse the log. Session files may be compressed and include integrity checks, so do not edit them by hand; keep using omdsh for those sessions until an explicit migration tool is available.

### Rewind without destroying history

When the agent is idle and the composer is empty, press `Esc` twice to open the conversation-turn selector. Choosing a user turn creates a new session branched from the history before that message and restores the original prompt into the composer. The original session remains available through `/resume`, so rewind is recoverable rather than destructive.

Two neighboring commands cover the cases rewind does not:

- `/retry` submits the latest human prompt again as a new turn.
- `/new` starts a clean session instead of branching the current one.

### Compact and export

Run `/compact` while the agent is idle to replace a useful older history span with a summary. The compacting state remains visible until the durable checkpoint finishes; wait for completion before starting another session operation. If there is not enough history, the command reports that nothing is compactable.

Run `/export` to write the complete transcript as `omdsh-transcript-<session-id>.md` in the current directory, or supply a destination:

```text
/export docs/session-review.md
```
