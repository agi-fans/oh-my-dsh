---
description: "Inspect what omdsh is doing: the /trajectory event ledger, /context usage and session details, and the /diff workspace summary."
---

# Observability

omdsh reads everything it shows from Harness projections and the durable session log; the views below are presentations of that data, not counters invented by the TUI.

## Session ledger: `/trajectory`

`/trajectory` opens a keyboard-driven event ledger for the active session. It is three levels deep — a turn, the steps inside it, and the records inside each step — and the ledger follows the live tail while a turn runs.

A turn rule states the step count when folded and the wall time it took, a step header marks one model request and, when calls are folded, lists the tools hidden under it, and a record row ends with what that record cost: input and output tokens for a model request, duration for everything. Records with no recorded duration leave the column empty instead of printing a dash, because they were never timed rather than timed at zero. A timing overview sits above the ledger once a run has more than one step, and hides while you search.

From there you can:

- search the full ledger with `/`, then step across matches with `n`/`N` or `Ctrl+N`/`Ctrl+P`; `Enter` locates a match and expands the collapsed turn or call that hides it;
- collapse or expand turns with `t` and the tool calls inside every step with `c`;
- open a record's details with `Enter`: a title line naming the record, its duration and, for a call, the tool; then only the sections that record can fill, each drawn for what it holds — facts as label/value rows, an answer or a message as Markdown under a `Thinking`/`Answer` label, a payload or a tool result as code with syntax highlighting. A payload is numbered only once a line is too long for the pane, and a wrapped line leaves the number column blank rather than claiming to be another line;
- switch between detail sections with `Tab` and the arrow keys. Only the sections a record actually has are offered, so a tool record with no schema never shows an empty one.

Matching scans the full ledger, so collapsed turns and hidden subtool calls still count. `/trajectory` needs an interactive TTY.

## Context and session overview

`/context` opens a live panel with projected occupancy, remaining capacity, estimated composition, and session activity. Wide terminals show a compact occupancy grid; narrow terminals show a bar. The categories use heuristic estimates, independently of the calibrated occupancy total. Missing measurements are labelled unavailable.

Use Tab and Enter or click an action to open Details, copy the session ID, or invoke the available `/compact` command. Details contains model, reasoning, workflow, access, queue counts, cumulative provider usage, and the latest token samples. The panel supports wheel scrolling, search, and text selection. Updates pause during text selection, and Esc restores the conversation position and draft. Non-interactive output includes the complete text report.

The footer's `Ctx` group shows pressure as a percentage with used and window token counts and turns to warning and error colors as pressure rises. See [Tune the working environment](tutorials/environment.md) for the configurable status items.

## Workspace diff: `/diff`

`/diff` opens a file browser for current Git changes against HEAD, including staged, unstaged and untracked files. `/diff <path>` opens one file, and `/diff turn [number]` reads a retained turn comparison. Missing historical comparisons are marked unavailable; `V` explicitly switches to current content. Plain mode retains the text summary and patch output. These commands only read Git state and never stage or commit.

## Per-turn changed files

Every completed turn ends with a record of the files that turn changed, with the turn's line totals and each path's own added and removed counts. It is attributed to the turn that produced it, so a long session shows which change belongs to which request rather than one cumulative total. The list folds past eight files and `Ctrl+O` expands it; a turn that changed nothing says so, and binary or oversized files are marked instead of given counts. Because the record is derived from the turn's own snapshots, a session opened later shows the turn without its file list.

`/diff` and this record answer different questions: `/diff` reports the working tree as it stands now, while the per-turn record reports what one turn changed.

## Tools and integrations: `/tools` and `/mcp`

`/tools` opens a searchable catalog with a description preview. Enter opens the complete description, and Esc returns to the list. `/mcp` offers server entries with tool counts and recent calls, a searchable tool catalog, and rendered diagnostic pages. These views reflect exposed tools and recorded outcomes. Live connection and authentication status are unavailable in the published Harness API. Reopen `/tools` or refresh `/mcp` after a catalog change. Tool results larger than the context budget spill to a private file with a bounded preview in the transcript; the original stays readable with `read` or `grep`.

## Herdr pane integration

Inside a Herdr pane, omdsh registers as a first-class agent: the sidebar follows its `working`, `idle`, and `blocked` state (a block names the pending approval or question), the resumable session id is reported, and the pane is released when omdsh exits. The integration stays inert outside Herdr.

## Related

- [Commands](commands.md) — `/trajectory`, `/context`, `/diff`, and the rest of the catalog
- [Keyboard and keys](keyboard.md) — ledger and overlay keys
- [Performance](performance.md) — how the transcript and ledger stay fast on long sessions
