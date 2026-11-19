---
description: Know when to use built-in subagents, Codex or Claude Code integrations, or /team Agent Teams to parallelize larger coding tasks safely.
---

# Subagents and Agent Teams

On larger tasks, cramming every investigation, edit, and test run into one thread is slow and fills your context window fast. omdsh gives you three ways to delegate work in parallel while staying visible and in control.

## Choose the right collaboration mode

| Mode | What it is | Context & follow-up | Best for |
|---|---|---|---|
| **Built-in subagents** (delegated automatically by the main agent) | Lightweight child agents launched fresh, forked from current context, or isolated in a separate process | Continuable (inspect live, send follow-ups); results return to the parent | Parallel codebase research, independent test suites, or heavy isolated checks. |
| **Agent Teams (`/team`)** | Session-wide **shared task board** where the main agent and continuable subagents claim tasks and declare file write scopes | Shared task list, `blockedBy` dependencies, and write-scope overlap warnings | Multi-module refactors where several agents edit code concurrently and must not collide. |
| **External subagents (Codex / Claude Code)** | Built-in integrations that delegate a self-contained task to Codex or Claude Code | One-shot text-only task (no continuation); uses each tool’s native login and default model | Offloading an independent review or fix to a Codex or Claude Code setup you already use. |

> **Rule of thumb:** Ask the main agent to parallelize work first—it automatically picks the right built-in subagent. Turn on `/team on` when multiple agents will edit code in parallel and need shared task dependencies and write-scope guardrails.

## Scenario 1: Delegate subagents, inspect live, and steer them

You do not need special syntax—just state the independent tasks clearly:

```text
Launch two subagents in parallel:
1. Audit error codes across all handlers in @src/auth for consistency.
2. Check webhook signature verification in @src/billing for edge-case bugs.
Summarize both findings into one prioritized fix list.
```

### Watching and steering active subagents

When subagents are active, a **subagent list appears above the input box** showing each agent’s name, status (running, waiting, completed), and elapsed time:

1. **Inspect a subagent:** Select it with arrow keys and press `Enter` (or click it) to view its live conversation transcript.
2. **Follow up or steer:** For continuable subagents, send follow-up instructions in its input box or press `Alt+S` to steer mid-run.
- Note: Subagent follow-ups accept **text and images only**; file attachments are rejected.
3. **Return to the main thread:** Press `Esc` to return to the parent conversation while results flow back.

## Scenario 2: Coordinate concurrent edits with `/team` Agent Teams

When several agents need to modify different parts of a codebase at the same time, enable Agent Teams to track ownership and catch file collisions early:

### 1. Enable Team mode

```text
/team on
```

This exposes the shared task-board tools (`team_task_*`) to the root agent and its continuable subagents for the current session tree.

### 2. Give a clear multi-task objective

```text
Use the shared task board to split "Export history page" into 3 tasks:
- Task 1: Backend API and types (write scope: src/server/export/)
- Task 2: Frontend list component (blocked by Task 1; write scope: src/web/export/)
- Task 3: End-to-end tests (blocked by Tasks 1 and 2; write scope: tests/export/)
Create the tasks with write scopes first, then delegate them to subagents.
```

### 3. Monitor the board with `/team`

Run `/team` anytime to open the interactive board (or `/team status` to print a Markdown summary):

- **Status and ownership:** Every task shows `pending (ready)`, `pending (blocked)`, `in progress`, or `completed`, along with its owner.
- **Write-scope warnings:** If two tasks declare overlapping write scopes, the board and task detail view flag the overlap immediately.
- **Task details:** Select any task and press `Enter` to read its full description, dependencies, and warnings.
- **Turn off anytime:** Run `/team off` to hide the task-board tools on subsequent steps while keeping recorded tasks intact.

## Scenario 3: Delegate to Codex or Claude Code

omdsh ships with built-in Codex and Claude Code integrations (disabled by default):

1. Run `/settings`, open **`Plugins` → `Agents`** (or open them from `/plugins`), and enable `Codex` or `Claude Code`.
2. In the same menu, check **Installation status** and configure **Model** (leave blank to inherit native settings) and **Permissions** (independent of the parent session—defaults are conservative: `never` for Codex and `dontAsk` for Claude Code).
3. Once enabled, ask naturally—for example, “Have Codex review this migration” or “Delegate this test cleanup to Claude Code”—and the final answer returns straight to your main thread.

## Practical tips and limits

- **Don’t over-split tiny tasks:** Spawning a subagent adds overhead; a two-file fix is usually faster in the main thread.
- **Nesting and concurrency limits:** Nesting defaults to depth 1 to prevent runaway spawning. Adjust max concurrency, nesting depth, or allowed subagent models under `Settings → Plugins → Subagents`.
- **Full reference:** See [Subagents and Agent Teams](../subagents.md) for runtime modes, permission inheritance, and advanced configuration.

## Next steps

Next, learn how to pick up yesterday’s session, explore alternate branches, recover edited files, and keep long histories healthy:

- [Manage long sessions and recover files](long-session.md).
