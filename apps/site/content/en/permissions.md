---
description: "omdsh access presets, sandbox and approval behavior, escalation, shell limits, and how Plan mode keeps edits behind review."
---

# Permissions and access

Every session starts with exactly one Access preset. It decides the filesystem and shell sandbox the model runs in, and whether an action outside that sandbox needs your approval. Choose it per session with `/permission`; the deployment default comes from `OMDSH_PERMISSION_MODE`.

## Presets

| Preset | Sandbox mode | Approval | What the model can do |
|---|---|---|---|
| Read only | `read-only` | Ask on escalation | Inspect the workspace without writing; escalation requires approval. |
| Workspace write | `workspace-write` | Ask on escalation | Write inside the workspace; wider access requires approval. |
| Full access | `danger-full-access` | Never prompts | Full filesystem access without approval prompts. |

Workspace write is the default. The preset applies to both the filesystem seam and the shell: a mutation outside the workspace returns the shared sandbox denial instead of failing per tool, and the model may retry it once at a wider mode after approval. A retry that asks for the mode already in force runs without a prompt, while a narrower target still fails before anything executes. The composer's Access badge always reports the mode actually in force, so an approved widening is visible.

## Approval prompts

When an action needs approval, the prompt shows the tool card the session already streamed — the command, path, or diff summary for the pending call — followed by the asker's own reason. A human prompt displaces any open overlay (such as `/trajectory` or the Agent Hub) and restores it when settled, so a confirmation cannot be accepted behind a stale screen.

### Remembered decisions

For a request linked to a live tool execution, **Remember allow** and **Remember reject** open an exact invocation preview. Choose **This session** or **This workspace**, or Cancel to save nothing and withdraw the request. Session rules survive resume but do not pass to forks or children. Workspace rules apply to sessions with the same original workspace boundary, including a child using that boundary. Open `/permission` → **Approval rules** to inspect and revoke a decision. Revocation applies to future requests; it does not stop an action already approved.

Matching requires the same tool, complete JSON arguments, working directory, original workspace, standing Access mode and approval reason. Object-key order does not matter; shell strings are compared exactly, without prefix or wildcard interpretation. Different commands, parameters, reasons, directories or Access modes require a new decision. Exact invocation matching does not freeze file contents, environment variables or other external state.

Every automatic decision still passes through the Harness approval service and its session audit. A rule cannot override a `never` approval policy, tool guard or sandbox enforcement, and it does not permanently widen Access. Remembered rejection affects matching approval requests; actions that do not ask for approval remain governed by their existing tool and sandbox policies. Unlinked requests offer only one-time decisions. Records live under `OMDSH_HOME/omdsh/approval-rules`, are reread before matching, and store arguments and reasons in private files. Unreadable or invalid records reject requests rather than grant them. The store supports up to 500 rules; an invocation or reason larger than 64 KiB cannot be remembered.

## Shell limits

One confined shell stack mounts per host — `bash` on POSIX, `pwsh` on Windows — and each call carries a pinned 120-second timeout. The model can raise the limit per call or run the command in the background; `/jobs` then lists it.

## Plan mode

`/plan` asks the model to inspect without mutating and to present a reviewable plan. The tool catalog stays unchanged for request-cache stability, and plan-mode rules override the mutation guidance inside it; implementation begins only after the plan is approved.

## Related

- [Commands](commands.md) — `/permission` and `/plan`
- [Tools](tools.md) — what the presets gate
- [Command line](cli.md) — `OMDSH_PERMISSION_MODE`
