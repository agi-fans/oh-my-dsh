---
description: Complete reference for built-in subagents, /team Agent Teams shared task boards, Codex and Claude Code integrations, and depth/concurrency limits.
---

# Subagents and Agent Teams

For a guided walkthrough with real examples, see [Subagents and Agent Teams tutorial](tutorials/multi-agent.md). This page documents the complete behavior and configuration reference.

## 1. Built-in subagent modes

The main agent delegates work through three channels depending on isolation and context needs:

| Tool | Execution mode | Context | Typical use |
|---|---|---|---|
| **`subagent`** | In-process, fresh context | Starts clean | Parallel module audits, independent tests, focused research |
| **`subagent_fork`** | In-process, forked from parent | Inherits committed parent history and model route | Deepening an investigation already underway in the main thread |
| **`subagent_isolated`** | Isolated child process | Separate process/profile (requires `dsh` with an `acp` profile on `PATH`) | Heavyweight self-contained work needing process isolation |

### Inspecting, following up, and steering

- **Subagent list:** Whenever a session has child subagents (including earlier unloaded children after `/resume`), a live list appears above the input box showing name, status, and elapsed time.
- **Enter & return:** Press **`↓`** from an empty input box (or click a row) and press `Enter` to open a subagent’s transcript; press `Esc` to return to the parent.
- **Follow-ups and steering:** For continuable subagents, send follow-ups directly in the subagent’s input box or press `Alt+S` to steer mid-run.
- **Attachment rule:** Subagent follow-ups accept **text and images only**; file attachments are rejected with an error.
- **Approvals:** Subagent approval prompts clearly name the requesting child and queue sequentially; switching the main session cancels pending approvals from the previous session and its local children.

## 2. Agent Teams (`/team` shared task board)

When multiple continuable subagents edit different parts of the same codebase concurrently, use `/team` to coordinate ownership and prevent collisions:

- **Toggle:** `/team on` exposes `team_task_*` tools across the current session tree (root agent + continuable subagents); `/team off` hides the tools on future steps while keeping recorded tasks.
- **Inspect:**
- `/team` opens the interactive board with filtering, refresh, toggle, and task details (`Enter` shows full description, `blockedBy` dependencies, and write-scope overlap warnings).
- `/team status` prints a Markdown board summary (also works non-interactively).
- Running `/team` while viewing a subagent automatically resolves to the root agent’s board.
- **Concurrency & safety:** Backed by Compare-and-Set updates (up to **256** tasks per session tree). Tasks declare **`writeScopes`** so overlapping file/directory scopes surface explicit warnings before agents collide.

## 3. External subagent integrations: Codex and Claude Code

omdsh bundles native **Codex** (`@deepseek-ai/dsh-subagent-codex`) and **Claude Code** (`@deepseek-ai/dsh-subagent-claude-code`) integrations (disabled by default):

- **Where to configure:** `/settings` → **`Plugins` → `Agents`** (or `/plugins` → `Bundles` → `Integration settings`).
- **Key behavior:**
- Runs each bundle’s pinned platform runtime (no executable from `PATH` is required).
- Native Codex/Claude login and settings remain authoritative—omdsh never reads or stores those credentials.
- Child `permissionMode` is independent of the parent session and starts conservative (**`never`** for Codex, **`dontAsk`** for Claude Code).
- **One-shot text-only tasks:** Returns only the final result to the parent, with no continuation or local child transcript.
- Credential-shaped ambient environment variables are scrubbed so parent API keys are not leaked implicitly.

## 4. Limits and advanced overrides

### Depth, concurrency, and allowed models

Configure under `/settings` → **`Plugins` → `Agents` → `Subagents`**:

- **Max depth (`maxDepth`):** Defaults to `1` (root is `0`, direct children are `1`; stricter tool-level limits take precedence).
- **Concurrency cap:** Caps active local and external children across the session tree (excluding the root); lowering it affects new spawns without killing running children.
- **Allowed models:** Off by default; when enabled, restricts new subagent sessions to the chosen allowlist (`subagent_fork` keeps the parent route).

### Orchestration tools and optional toggles

- **`workflow_run`:** Available under `Standard` for multi-step workflows (intentionally hidden under `PTC` so `run_code` remains the sole orchestration surface).
- **Enable `ralph` loop:** Turn on `/settings` → **`Plugins` → `Optional features` → `Ralph loop`**.
- **Enable `interrupt_agent`:** Disabled by default; to re-enable, add this entry to `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` and restart `omdsh`:

```yaml
- id: tool-interrupt-agent
  disabled: false
```

## Related

- [Subagents and Agent Teams tutorial](tutorials/multi-agent.md) — hands-on examples
- [Tools and presets](tools.md) — orchestration tools per preset
- [Plugins and integrations](plugins.md) — managing built-in integrations and external plugins
