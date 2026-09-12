---
description: "Inspect what omdsh is doing: the /trajectory event ledger, projection-backed /context usage, /session details, and the /diff workspace summary."
---

# Observability

omdsh reads everything it shows from Harness projections and the durable session log; the views below are presentations of that data, not counters invented by the TUI.

## Session ledger: `/trajectory`

`/trajectory` opens a keyboard-driven event ledger for the active session. Events group by Turn and Step, and the ledger follows the live tail while a turn runs. From there you can:

- search the full ledger with `/`, then step across matches with `n`/`N` or `Ctrl+N`/`Ctrl+P`; `Enter` locates a match and expands the collapsed turn or call that hides it;
- collapse or expand turns with `t` and tool calls with `c`;
- open a record's details with `Enter`, including tool payloads, results, schemas, timing, and token usage;
- switch between detail sections with `Tab` and the arrow keys.

Matching scans the full ledger, so collapsed turns and hidden subtool calls still count. `/trajectory` needs an interactive TTY.

## Context: `/context` and the status line

`/context` prints an inline, projection-backed context breakdown that stays in the transcript. It reads the same client-visible Harness projections as the status footer and separates provider-anchored occupancy from the heuristic prompt composition. The footer's `Ctx` group shows pressure as a percentage with used and window token counts and turns to warning and error colors as pressure rises. See [Tune the working environment](tutorials/environment.md) for the configurable status items.

## Session details: `/session`

`/session` reports the active session's details in the transcript, including its identity and current configuration. Use it when you need the exact session id for `omdsh --resume`.

## Workspace diff: `/diff`

`/diff` summarizes the workspace changes as a per-file table with added and removed line counts and lists untracked files; `/diff <path>` prints one file's patch. It only reads git state and never stages or commits.

## Tools and integrations: `/tools` and `/mcp`

`/tools` lists the tools visible to the agent, grouped the way the registry exposes them. `/mcp` groups connected tools by their MCP server; both views update automatically when a tool list changes after an MCP reconnect. Tool results larger than the context budget spill to a private file with a bounded preview in the transcript; the original stays readable with `read` or `grep`.

## Herdr pane integration

Inside a Herdr pane, omdsh registers as a first-class agent: the sidebar follows its `working`, `idle`, and `blocked` state (a block names the pending approval or question), the resumable session id is reported, and the pane is released when omdsh exits. The integration stays inert outside Herdr.

## Related

- [Commands](commands.md) — `/trajectory`, `/context`, `/session`, `/diff`, and the rest of the catalog
- [Keyboard and keys](keyboard.md) — ledger and overlay keys
- [Performance](performance.md) — how the transcript and ledger stay fast on long sessions
