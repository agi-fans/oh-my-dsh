# Recover and manage a long session

[English](long-session.md) | [简体中文](long-session.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Guide an active turn](guide-a-turn.md) · Next: [Tune the working environment](environment.md)

### Resume after leaving

The first `Ctrl+C` clears or interrupts, and a second one exits. When the active session is durable, omdsh prints a command you can paste later:

```sh
omdsh --resume <session-id>
```

Inside the TUI, `/resume` opens a searchable session selector with the latest human-message preview, age, event count, and completion state. `/resume <session-id>` skips the selector when you already know the identifier.

### Rewind without destroying history

When the agent is idle and the composer is empty, press `Esc` twice to open the conversation-turn selector. Choosing a user turn creates a new session branched from the history before that message and restores the original prompt into the composer. The original session remains available through `/resume`, so rewind is recoverable rather than destructive.

Use `/retry` when you only want to submit the latest human prompt again as a new turn. Use `/new` to start a clean session instead of branching the current one.

### Compact and export

Run `/compact` while the agent is idle to replace a useful older history span with a summary. The compacting state remains visible until the durable checkpoint finishes; wait for completion before starting another session operation. If there is not enough history, the command reports that nothing is compactable.

Run `/export` to write the complete transcript as `omdsh-transcript-<session-id>.md` in the current directory, or supply a destination:

```text
/export docs/session-review.md
```

[Tutorials](../tutorials.md) · Previous: [Guide an active turn](guide-a-turn.md) · Next: [Tune the working environment](environment.md)
