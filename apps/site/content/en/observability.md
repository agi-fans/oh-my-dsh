---
description: "Inspect what omdsh is doing: the /trajectory event ledger, /context usage and session details, and the /diff workspace summary."
---

# Observability

omdsh reads everything it shows from Harness projections and the durable session log; the views below are presentations of that data, not counters invented by the TUI.

## Session ledger: `/trajectory`

`/trajectory` opens an interactive ledger grouped by turns and model steps. Tool rows show readable command or file summaries and recorded status. Context records and nested calls start folded. A timing overview helps locate expensive steps, and the list follows new records until you move away from the live tail.

- Click a row or press `Enter` to inspect it. Available sections include Overview, decoded Input, Result, Raw, and Schema. Tool results use plain text; structured inputs and raw JSON retain code formatting. Long lines wrap with a separate line-number gutter.
- `Tab` switches focus between the list and details. Arrow keys and page keys operate on the focused pane, and the mouse wheel scrolls the pane under the pointer. `f` enlarges details, `y` copies the current section, and `Esc` returns through details to the conversation.
- `Space` expands context or nested calls, `t` folds turns, and `c` folds calls. `e` filters problems; `s` visits calls by descending duration.
- `/` searches all records, including folded content. `n`/`N` steps between matches, or `Ctrl+N`/`Ctrl+P` while typing. Enter locates a match and opens the content that contains it.

Durations and token counts come from recorded events. Missing durations stay blank. The ledger requires an interactive TTY; the full key reference is in [Keyboard and keys](keyboard.md).

## Context and session overview

`/context` opens a live panel with projected occupancy, remaining capacity, estimated composition, and session activity. Wide terminals show a compact occupancy grid; narrow terminals show a bar. The categories use heuristic estimates, independently of the calibrated occupancy total. Missing measurements are labelled unavailable.

Use Tab and Enter or click an action to open Details, copy the session ID, or invoke the available `/compact` command. Details contains model, reasoning, workflow, access, queue counts, cumulative provider usage, and the latest token samples. The panel supports wheel scrolling, search, and text selection. Updates pause during text selection, and Esc restores the conversation position and draft. Non-interactive output includes the complete text report.

The footer shows context pressure as a percentage in minimal and standard density. Verbose adds used/window token counts. Warning and error colors mark rising occupancy. See [Tune the working environment](tutorials/environment.md) for status controls.

## Workspace diff: `/diff`

`/diff` opens a file browser for current Git changes against HEAD, including staged, unstaged and untracked files. `/diff <path>` opens one file, and `/diff turn [number]` reads a retained turn comparison. Missing historical comparisons are marked unavailable; `V` explicitly switches to current content. Plain mode retains the text summary and patch output. These commands only read Git state and never stage or commit.

## Per-turn changed files

Every completed turn ends with a record of the files that turn changed, with the turn's line totals and each path's own added and removed counts. It is attributed to the turn that produced it, so a long session shows which change belongs to which request rather than one cumulative total. The list folds past eight files and `Ctrl+O` expands it; a turn that changed nothing says so, and binary or oversized files are marked instead of given counts. Because the record is derived from the turn's own snapshots, a session opened later shows the turn without its file list.

`/diff` and this record answer different questions: `/diff` reports the working tree as it stands now, while the per-turn record reports what one turn changed.

## Tools and integrations: `/tools` and `/mcp`

`/tools` opens a searchable catalog with a description preview. Enter opens the complete description, and Esc returns to the list. `/mcp` offers server entries with tool counts and recent calls, a searchable tool catalog, and rendered diagnostic pages. These views reflect exposed tools and recorded outcomes. Live connection and authentication status are unavailable in the published Harness API. Reopen `/tools` or refresh `/mcp` after a catalog change. Tool results larger than the context budget spill to a private file with a bounded preview in the transcript; the original stays readable with `read` or `grep`.

## Herdr pane integration

Inside a Herdr pane, omdsh registers as a first-class agent over the local socket (`working` during turns and compaction, `idle`, and `blocked` with the pending approval or question), reports the resumable session id, and releases the pane on exit; nested omdsh child processes stay inert so they do not overwrite the parent pane. In terminals driven by `herdr-core` (including Herdr App), omdsh reports live `idle`, `working`, `blocked`, `done`, and `error` lifecycle states and session titles over OSC 7501 and clears them on suspend, external editors, or exit.

## Related

- [Commands](commands.md) — `/trajectory`, `/context`, `/diff`, and the rest of the catalog
- [Keyboard and keys](keyboard.md) — ledger and overlay keys
- [Performance](performance.md) — how the transcript and ledger stay fast on long sessions
