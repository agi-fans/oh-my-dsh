---
description: Shape changes with /plan before editing, choose between queueing, steering, and interrupting mid-turn, and track long work with /goal, /jobs, and /schedule.
---

# Steer long tasks and background work

On larger features or cross-file refactors, the real risk is not speed—it is letting the agent edit fifteen files in the wrong direction. This guide shows how to align on a plan first, steer mid-turn, and keep long-running work under control.

## 1. Align before editing with `/plan`

Before touching multiple modules, schemas, or tricky architecture choices, start in Plan mode:

```text
/plan Add an async export queue with retries for orders; inspect the codebase first and propose a plan
```

You can also run `/plan` with no arguments to enter Plan mode before sending your prompt. In Plan mode:

1. **Investigate first:** The agent reads files and drafts a structured implementation plan instead of jumping straight into code edits. (Plan mode is a workflow mode; actual file and shell permissions are still governed by `/permission`.)
2. **Review and iterate in the reader:** When the plan is ready, a scrollable review view opens (`↑`/`↓`, `PgUp`/`PgDn`, `/` to find). At the bottom, pick:
- **`Approve`:** Accept the plan, leave Plan mode, and start implementing.
- **`Keep planning`:** Send revision feedback so the agent refines the plan. Press `Ctrl+X` to write longer feedback in your external editor.
3. **Pause or leave:** Press `Esc` to dismiss the review card, or run `/plan off` to exit Plan mode.

## 2. Mid-turn controls: queue, steer, or interrupt?

When the agent is already working through a multi-step turn, you do not have to wait passively. Pick the control that matches what just happened:

| Your goal | How to do it | When to use it |
|---|---|---|
| **Queue for next turn** | `Alt+Enter` (`Ctrl+Q` on Windows/WSL), or `Enter` with the default setting | The current work is on track and you want to line up the **next** request (for example, “After fixing it, run the integration suite and update the docs”). |
| **Steer the next step** | `Alt+S` | The agent is **starting to drift**, but the context it already gathered is valuable—nudge it before its next model step (for example, “Don’t add moment; use dayjs like the rest of the repo”). |
| **Interrupt immediately** | `Esc` or `Ctrl+C` (if your draft is non-empty, the first `Ctrl+C` clears the draft) | The direction is fundamentally wrong or a slow command needs to stop right now. |

> **Tip:** If you prefer `Enter` while busy to steer instead of queueing, change `Settings → Terminal → Input → Busy send behavior`. `Cmd+Enter` / `Ctrl+Enter` always triggers the opposite action.

### Managing queued messages

Pending messages appear above the input box labeled as follow-up (`next turn`) or steering (`next step`):

- Press **`Alt+↑`** to pull the most recent queued message back into the input box for editing (any existing draft is preserved and restored if you cancel).
- Run **`/queue`** to inspect, edit, reorder, or delete pending messages.

## 3. Track multi-turn work with Todos and `/goal`

### Todo list

For multi-step tasks, the agent maintains a Todo checklist near the bottom of the screen so you can track completed and remaining steps at a glance. On short terminals, unfocused checklists collapse to a single summary line to preserve transcript space.

### Long-horizon goals with `/goal`

When a task spans many turns (for example, migrating dozens of endpoints and making the whole test suite pass), set a persistent goal:

```text
/goal Migrate all endpoints under src/api/v1 to zod validation and make pnpm test pass
```

- A goal bar appears above the input box. Press **`Alt+G`** or run `/goal` anytime to edit the objective, pause/resume, or clear it.
- **Resume safety (`Goal waiting`):** If you exit and later `/resume` a session with an active goal, omdsh **does not** automatically start spending tokens on startup—the goal waits in `Goal waiting` until you explicitly authorize it to continue.

## 4. Monitor background jobs and scheduled reminders

### Inspect background jobs with `/jobs`

When a build, server, or long test keeps running in the background, open `/jobs`:

- View every running or finished job and its elapsed time.
- Select a job to tail its stdout/stderr live—**reading output in `/jobs` does not interfere with the agent’s own output reading**.
- Stop a stuck or unwanted job cleanly with confirmation.

### Manage reminders with `/schedule`

When a session uses scheduled reminders (for example, periodic build checks), run `/schedule` to inspect them:

- Pause, resume, trigger now, rename, edit instructions, or delete reminders tied to the session.
- Open **Delivery history** to browse paginated delivery receipts (receipts confirm inbox delivery rather than model completion).

## Next steps

When one agent working sequentially is too slow and you want to split work across parallel specialists, continue to:

- [Subagents and Agent Teams](multi-agent.md) — built-in subagents, Codex/Claude Code integrations, and `/team` shared task boards.
