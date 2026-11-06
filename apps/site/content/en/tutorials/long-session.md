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

### Explore branches without losing history

When the agent is idle and the composer is empty, press `Esc` twice to open the Session Tree. Browse turns and forks with `↑`/`↓`, fold them with `←`/`→`, and type to search while previewing the selected content. Enter on a Turn prepares a new branch before that message and restores its text, images, and file references into the composer without sending it. Enter on a branch or `Alt+Enter` resumes that branch’s latest state. The original branches stay available; these operations do not roll back workspace files.

Two neighboring commands cover other session workflows:

- `/continue` continues an eligible failed model generation without duplicating the prompt. `/retry` resends the latest human prompt with its images and files as a new turn.
- `/new` starts a clean session instead of branching the current one.

### Compact and export

Run `/context` to inspect occupancy and the session overview. If the conversation is growing too large, review the category breakdown before deciding to compact. The display distinguishes measured usage from estimates. See [Observability](../observability.md) for details.

Run `/compact` while the agent is idle to replace a useful older history span with a summary. The compacting state remains visible until the durable checkpoint finishes. You can keep typing and queue the next message with Enter while compaction runs; it is admitted after compaction ends. Ctrl+C interrupts compaction. If summary generation fails or is cancelled before the checkpoint is written, the original model history remains available. If there is not enough history, the command reports that nothing is compactable.

The completion notice folds the saved summary behind `Ctrl+O`. Press it again to return to the live tail. Saved summaries remain readable after resuming the session; opening them never rewrites terminal scrollback.

Run `/export` to choose Markdown, HTML, or a session archive, then choose a destination. The result page offers applicable copy, preview, and open actions. To export Markdown directly, supply the format and path.

```text
/export markdown docs/session-review.md
```

### Understand legacy session compatibility

omdsh v0.12.0 and later no longer add the private `omdsh/tools-selected` event, so newly created sessions can be loaded by an unmodified DSH persistence reader. Sessions first created with v0.5.0 through v0.11.0 may still contain that event: current omdsh recognizes it and can resume those sessions, but an unmodified DSH reader will refuse the log. Session files may be compressed and include integrity checks, so do not edit them by hand; open these sessions through omdsh. When a log also requires a Harness format migration, interactive resume asks for confirmation and creates a versioned successor alongside the original. See [Session compatibility](../sessions.md) for activation and migration behavior.

### Next

You now have the core everyday workflow. If your project needs reusable instructions or external tools, continue with [Skills and MCP](skills-and-mcp.md).
