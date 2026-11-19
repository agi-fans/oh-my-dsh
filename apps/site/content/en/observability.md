---
description: Use the live status footer, /context, /trajectory, /diff, and /mcp to diagnose context pressure, slow tool calls, code edits, and server health.
---

# Status and diagnostics

Every metric in omdsh—context occupancy, cache hit rate, latency, changed files, and tool traces—comes straight from the runtime’s durable logs and metering rather than ad-hoc UI counters.

## Pick the right view for the question

| What you want to know | Tool to use |
|---|---|
| Is context nearly full, and what is taking space? | Glance at `Ctx` in the footer, or run **`/context`** |
| Why was that turn slow, or which tool failed? | Run **`/trajectory`**, press **`s`** (slowest first) or **`e`** (errors only) |
| Which exact lines did the agent just edit? | Click the turn’s **`Changed`** summary, or run **`/diff`** / **`/diff turn`** |
| Are my MCP servers connected and succeeding? | Run **`/mcp`** for live status and the last 10 calls |

---

## 1. Live status footer

Anchored right below the input box with **fixed left/right semantics** so numbers never jump sides:

- **Line 1:** Identity on the left (model, reasoning effort, optional session title) and workspace on the right (path and Git branch/dirty count).
- **Line 2 (session metrics):** Occupancy and duration on the left (`Ctx`, `Cache`), throughput and work on the right (`TTFT`, `tok/s` / tokens).
- **Line 3 (`verbose` density on wide terminals only):** Cumulative session duration on the left and total turns/steps on the right.
- **Narrow-screen degradation:** Drops lowest-priority items in strict order (**Turns → Duration → Latency/Tokens/Cache**) so nothing reappears out of order as the window grows.
- Customize in `/settings` → **`Terminal` → `Status line`**—changes apply **live on the real footer beneath the panel with the focused item underlined**.

## 2. `/context`: occupancy and breakdown

Running `/context` opens a compact live overview:

- A **5×8 occupancy dot grid** aligned row-for-row with the five occupancy and session summary lines (used/window tokens, remaining budget, turns/steps, cumulative input/output, active preset and access level).
- Occupancy turns warning color above **75%** and error color above **90%**.
- An **Estimated composition** section splits usage across **System prompt**, **Tool schemas** (watch this when many MCP servers are enabled), and **Conversation messages**.
- Actions at the bottom open full **`Details`**, **`Copy session ID`**, or trigger **`Compact`** immediately.

## 3. `/trajectory`: execution traces and latency

When a turn runs dozens of tool calls or spawns subagents, `/trajectory` gives you an event-level ledger:

- Shows turns, steps, tool calls, and named subagents with status, duration, and token counts (context entries and nested subcalls start folded; press `Space` to expand).
- Press `Enter` on any entry to inspect **`Overview`**, decoded **`Input`**, **`Result`**, raw event **`Raw`**, and **`Schema`** (`←`/`→` switches tabs).
- **Three highest-leverage shortcuts:**
- **`s`:** Sort calls slowest-first to pinpoint bottlenecks.
- **`e`:** Filter to failures and errors only.
- **`/`:** Search across every record (including folded ones); `y` copies the active section; `f` zooms details.
- Bars marked `Σ` show summed recorded durations (not wall-clock time); parent calls already include `PTC` child calls without double counting.

## 4. `/diff` and turn change summaries

- Turns that modify files display a clickable **`Changed`** summary in the transcript—click the header for the full turn diff or any file row to jump straight to it (hideable via `/settings` → `General` → `File change summary` while keeping `/diff turn` available).
- Run `/diff` for current Git changes or `/diff turn [number]` for a saved turn snapshot.
- Wide terminals (≥100 columns) split file navigation and diff side by side, with `V` (diff/current file), `[`/`]` (hunks), `/` (find), `G` (line jump), and **`Alt+Y` / `Q` to quote selected lines directly back into your input box**.

## 5. `/mcp` and native terminal status

- **`/mcp`:** Shows live states (`connected`, `connecting`, `waiting-credentials`, `reconnecting`, `disabled`, `closed`, `failed`), exposed tool counts, and the last 10 MCP calls.
- **Native terminal and Herdr integration:** In compatible terminals (such as Herdr or terminals supporting OSC 9;4 progress), tabs and sidebars automatically reflect whether omdsh is working, blocked waiting for approval/input, done, or errored, and sync the working directory for new splits. Configure under `/settings` → **`Terminal` → `Terminal title` / `Terminal status`**.

## Related

- [Manage long sessions and recover files](tutorials/long-session.md) — when to run `/compact`
- [Commands](commands.md) — full `/context`, `/trajectory`, and `/diff` controls
- [Settings](settings.md) — customizing the status footer and notifications
