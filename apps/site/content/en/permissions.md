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

Workspace write is the default. The preset applies to both the filesystem seam and the shell: a mutation outside the workspace returns the shared sandbox denial instead of failing per tool, and the model may retry it once at a wider mode after approval. The composer's Access badge always reports the mode actually in force, so an approved widening is visible.

## Approval prompts

When an action needs approval, the prompt shows the tool card the session already streamed — the command, path, or diff summary for the pending call — followed by the asker's own reason. A human prompt displaces any open overlay (such as `/trajectory` or the Agent Hub) and restores it when settled, so a confirmation cannot be accepted behind a stale screen.

## Shell limits

One confined shell stack mounts per host — `bash` on POSIX, `pwsh` on Windows — and each call carries a pinned 120-second timeout. The model can raise the limit per call or run the command in the background; `/jobs` then lists it.

## Plan mode

`/plan` asks the model to inspect without mutating and to present a reviewable plan. The tool catalog stays unchanged for request-cache stability, and plan-mode rules override the mutation guidance inside it; implementation begins only after the plan is approved.

## Related

- [Commands](commands.md) — `/permission` and `/plan`
- [Tools](tools.md) — what the presets gate
- [Command line](cli.md) — `OMDSH_PERMISSION_MODE`
