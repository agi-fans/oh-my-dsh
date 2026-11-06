---
description: "omdsh access presets, sandbox and approval behavior, escalation, shell limits, and the Plan review flow."
---

# Permissions and access

Every session starts with exactly one Access preset. It decides the filesystem and shell sandbox the model runs in, and whether an action outside that sandbox needs your approval. Choose it per session with `/permission`. **Settings → General → Default access** saves the preference for future sessions; restoring inheritance uses the deployment default, which can be set with `OMDSH_PERMISSION_MODE`.

## Presets

| Preset | Sandbox mode | Approval | What the model can do |
|---|---|---|---|
| Read only | `read-only` | Ask on escalation | Inspect the workspace without writing; escalation requires approval. |
| Workspace write | `workspace-write` | Ask on escalation | Write inside the workspace; wider access requires approval. |
| Full access | `danger-full-access` | Never prompts | Full filesystem access without approval prompts. |

Workspace write is the default. The preset applies to both the filesystem seam and the shell: a mutation outside the workspace returns the shared sandbox denial instead of failing per tool, and the model may retry it once at a wider mode after approval. A retry that asks for the mode already in force runs without a prompt, while a narrower target still fails before anything executes. The composer's Access badge always reports the mode actually in force, so an approved widening is visible.

## Approval prompts

When an action needs approval, the prompt shows the tool card the session already streamed — the command, path, or diff summary for the pending call — followed by the asker's own reason. A human prompt displaces any open overlay (such as `/trajectory` or settings) and restores it when settled, so a confirmation cannot be accepted behind a stale screen.

Questions and approvals belong to the session that requested them. Replacing the active session cancels its visible and queued prompts, including approvals from its local children. Cancelled prompts cannot subsequently approve an action, send a rejection note, or save a remembered rule. Concurrent child approvals are shown one at a time with the requesting child’s label.

### Remembered decisions

For a request linked to a live tool execution, **Remember allow** and **Remember reject** open an exact invocation preview. Choose **This session** or **This workspace**, or Cancel to save nothing and withdraw the request. Session rules survive resume but do not pass to forks or children. Workspace rules apply to sessions with the same original workspace boundary, including a child using that boundary. Open `/permission` → **Approval rules** to inspect and revoke a decision. Revocation applies to future requests; it does not stop an action already approved.

Matching requires the same tool, complete JSON arguments, working directory, original workspace, standing Access mode and approval reason. Object-key order does not matter; shell strings are compared exactly, without prefix or wildcard interpretation. Different commands, parameters, reasons, directories or Access modes require a new decision. Exact invocation matching does not freeze file contents, environment variables or other external state.

Every automatic decision still passes through the Harness approval service and its session audit. A rule cannot override a `never` approval policy, tool guard or sandbox enforcement, and it does not permanently widen Access. Remembered rejection affects matching approval requests; actions that do not ask for approval remain governed by their existing tool and sandbox policies. Unlinked requests offer only one-time decisions. Records live under `OMDSH_HOME/omdsh/approval-rules`, are reread before matching, and store arguments and reasons in private files. Unreadable or invalid records reject requests rather than grant them. The store supports up to 500 rules; an invocation or reason larger than 64 KiB cannot be remembered.

## Shell limits

One confined shell stack mounts per host, Bash on POSIX and PowerShell on Windows. The shipped default timeout is 120 seconds. **Settings → Plugins → Shell** configures default and maximum timeouts, output limits, and shutdown grace for new commands. Explicit per-call timeouts are capped by the configured maximum. Background commands can be inspected through `/jobs`.

## Plan mode

`/plan` guides the model to inspect and submit a reviewable plan. Approve leaves Plan mode and continues execution; Keep planning allows feedback. Access remains the enforcement boundary. See [Plan mode](commands.md#plan-mode) for review and cancellation behavior.

## Related

- [Commands](commands.md) — `/permission` and `/plan`
- [Tools](tools.md) — what the presets gate
- [Command line](cli.md) — `OMDSH_PERMISSION_MODE`
