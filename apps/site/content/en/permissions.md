---
description: How to choose among the four permission levels, how approval cards and remembered rules work, shell limits, and how permissions differ from /plan.
---

# Permissions and safety

Every omdsh session runs with an explicit **access level** (configured via `/permission`). It governs both filesystem and shell sandboxing and decides when out-of-bounds actions pause for your approval.

- Run `/permission` to change the **active session’s** access level.
- Open `/settings` → **`General` → `Default access`** to set the default for new sessions (or set `OMDSH_PERMISSION_MODE` in your environment).

## Choosing an access level

| Access level | Sandbox mode | Approval prompts | Best for |
|---|---|---|---|
| **`Read only`** | `read-only` | Asks when escalating | Exploring unfamiliar repos, audits, and analysis where no files should be modified. |
| **`Workspace write`** (default) | `workspace-write` | Asks when out of bounds | **Everyday coding.** Free reads/writes and tests inside the workspace; asks before touching paths outside it. |
| **`Full access`** | `danger-full-access` | Never asks | Disposable containers, trusted sandboxes, or fully unattended local runs. |
| **`Auto review`** (session only) | Unsandboxed + pre-execution model review | Asks when review flags an action | Fewer manual clicks while keeping an automated pre-execution check on writes and external calls. |

### Key behaviors and common misconceptions

- **Unified sandbox for files and shell:** Under `Read only` and `Workspace write`, file tools and shell commands share the same boundary. Attempts to write outside the workspace (for example `~/.ssh`) are blocked consistently; the agent can request approval to retry once with wider access, and the footer badge always reflects the active level.
- **About `Auto review`:** Provided by the bundled `@deepseek-ai/dsh-experimental-auto-review` extension (enabled by default; disable anytime in `/plugins` → `Bundles`). It is opt-in per session and never stored as `Default access`. Keep two trade-offs in mind:
1. Each pre-execution review adds extra model latency and token usage.
2. Under the `code` (PTC) preset, direct Node side effects inside `run_code` bypass internal tool review.
- **Why does `/plan` still show `Workspace write`?** `/plan` is a workflow mode that instructs the agent to research and draft a plan first; actual execution permissions always belong to `/permission`.
- **Does changing directories widen access?** No—the workspace boundary stays anchored to the session’s original workspace.

## How approval prompts work

When an action requires confirmation, a **warning-bordered approval card** opens at the bottom of the screen:

- It shows the exact command, target path, or diff summary first, followed by the reason.
- Approval cards take priority over non-urgent views (such as `/trajectory` or `/settings`) and restore your previous view once answered, so you never approve something blindly behind a stale overlay.
- When several subagents request approval concurrently, prompts appear one by one and clearly name the requesting subagent.
- Switching sessions cancels pending approvals from the previous session (including its subagents) so nothing is approved in the background.

## Remembering approval decisions

On tool-backed approval cards, choose **`Remember allow`** or **`Remember reject`** and pick a scope (**`This session`** or **`This workspace`**):

- **This session:** Persists across `/resume` for this session, without propagating to forked sessions or subagents.
- **This workspace:** Applies to sessions sharing the same original workspace boundary, including child sessions.
- Inspect or revoke saved rules anytime under `/permission` → **`Approval rules`** (revoking affects future calls only).

### Exact-match safety

To prevent over-broad auto-approvals, a remembered rule matches **only** when all six fields match exactly: tool name, full JSON arguments, working directory, original workspace, active access level, and approval reason.

- **Example:** Remembering `git status` will **still prompt** for `git status -s`—shell strings are matched literally without wildcard or prefix expansion.
- **Guardrails:** Remembered rules cannot override hard sandbox constraints or permanently widen access. Rules over 64 KiB cannot be saved, up to 500 rules are stored under `$OMDSH_HOME/omdsh/approval-rules/`, and unreadable rule files fail closed.

## Shell limits

omdsh mounts a platform-appropriate shell (`bash` on macOS/Linux, `pwsh` on Windows) with a default 120-second timeout. Configure default/max timeouts, output caps, and shutdown grace periods under `/settings` → **`Plugins` → `Shell`**. Long-running background commands can be inspected or stopped in `/jobs`.

## Related

- [Commands](commands.md) — `/permission` and `/plan`
- [Tools and presets](tools.md) — what each preset exposes inside these boundaries
- [Command line](cli.md) — `OMDSH_PERMISSION_MODE`
