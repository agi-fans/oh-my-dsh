---
description: Resume and organize sessions, explore branches in the session tree, restore file snapshots with Alt+R, and compact or export long conversations.
---

# Manage long sessions and recover files

Real work often spans days, dozens of turns, and a few dead ends. This guide puts together the four skills that keep long sessions safe and manageable: finding past sessions, branching, rolling back unwanted file edits, and trimming context before it fills up.

## 1. Resume and organize past sessions (`/resume`)

Whether you restarted your terminal or want to pick up yesterday’s task:

- **Direct CLI resume:** When you exit omdsh, it prints `omdsh --resume <session-id>` so you can jump straight back in.
- **Interactive search:** Inside omdsh, run `/resume` (or `/resume <query>` for full-text search across session content), pick a match, and press `Enter`.

> **Common pitfall: Why is yesterday’s session missing from `/resume`?** By default, `/resume` shows sessions tied to your **current working directory**. If you launched omdsh from a parent or sibling folder, switch back to the original project directory or resume directly by ID with `omdsh --resume <session-id>`.

Inside the `/resume` list you can keep important sessions tidy:

- **`Alt+P`:** Pin or unpin a session to the top.
- **`Alt+R`:** Rename a session (for example, `Order export refactor`) so it is easy to spot later.
- **`Alt+A` / `Alt+V`:** Archive finished sessions or toggle the archive view.
- **`/name <title>`:** Rename the active session directly from the prompt.

## 2. Explore alternate paths with the Session Tree (`Esc` twice)

Suppose turn 3 went fine, but by turn 7 you realize you want to try a different design without losing what you already learned:

1. From an empty input box, **press `Esc` twice** to open the Session Tree (wide terminals show the branch tree on the left and a live turn preview on the right).
2. Select turn 3 with `↑` / `↓` and press `Enter` to **branch from that point**. The earlier branch stays intact so you can always switch back and compare.
3. **Label milestones:** Highlight any turn and press `Alt+L` to attach a label (such as `Approach A tests green`), then press `Alt+B` to filter to labeled nodes.

> **Branches vs. files on disk:** Switching branches in the Session Tree changes **conversation history only**; it does not touch files on disk. To roll files back to how they looked before a turn, use File recovery snapshots below.

## 3. Undo unwanted file edits safely with File recovery snapshots (`Alt+R`)

If an edit goes sideways before you have made a Git commit, File recovery snapshots act as a per-turn undo button:

1. **Enable once:** Run `/settings` and turn on **`Plugins` → `Tools` → `File recovery snapshots`**. Every new turn from then on captures before/after file snapshots automatically.
2. **Preview and restore:** Press `Esc` twice to open the Session Tree, highlight the turn you want to undo, and press **`Alt+R`**:
- Select which files to restore (files you edited manually *after* that turn are flagged as conflicts and skipped so your own edits are never overwritten).
- Preview the before/after contents for each selected file.
- Confirm to restore and review the printed recovery report.

> Snapshots stay local to your profile directory and complement—not replace—regular `git commit` checkpoints.

## 4. Easily confused session commands compared

| Command | What it actually does | When to use it |
|---|---|---|
| `/continue` | Continues generation from where the previous response stopped | A network glitch, rate limit, or accidental interrupt cut off a good response. |
| `/retry` | Re-sends your last prompt and attachments as a fresh turn | You want a different attempt after switching models or raising reasoning effort. |
| `/compact` | Summarizes earlier turns into a compact block inside the same session | Context occupancy (`Ctx`) is turning yellow/red and you want to keep working without starting over. |
| `/new` | Starts a brand-new session (allowing a fresh Agent preset before the first message) | You are moving to an unrelated task and want a clean slate. |
| `/clear` | Resets the active conversation below a labeled divider while preserving native terminal scrollback | You want a fresh start in the same workspace while still scrolling up to read earlier terminal output. |

## 5. Watch context usage and compact at the right time

As a conversation grows, every turn sends more history, increasing latency and cost:

1. **Watch the footer:** Keep an eye on `Ctx` in the second footer line. It shifts to warning color above 75% and error color above 90%.
2. **Inspect details (`/context`):** Run `/context` to see the 5×8 occupancy grid and estimated breakdown across system prompt, tool schemas, and conversation messages. Select **`Details`** for full token counters, or **`Compact`** directly.
3. **Compact with focus (`/compact`):** Run `/compact` on its own or tell it what must survive:

```text
/compact Keep the final API schema, list of modified files, and the 2 remaining failing tests; summarize earlier exploration
```

Because compaction drops verbatim early details, it works best right after key decisions are captured in code or docs.

## 6. Export and share a conversation (`/export`)

Run `/export` when you want to share an investigation or archive a completed task:

| Format | What is included | Best for |
|---|---|---|
| **Markdown (`.md`)** | Clean text transcript and code blocks | Pasting into PR descriptions, wikis, or postmortems. |
| **HTML (`.html`)** | Self-contained styled web page with collapsible sections | Sharing with teammates who do not have omdsh installed. |
| **Archive (`.zip`)** | Full session log, child subagents, and original image attachments | Long-term archival (read-only backup; archives are not re-imported into omdsh). |

## Next steps

With everyday session control covered, learn how to teach omdsh your team’s conventions and connect external tools:

- [Extend projects with Skills and MCP](skills-and-mcp.md) — choosing between Skills, MCP, LSP, and plugins, plus live `/mcp` setup.
- [Sessions and recovery](../sessions.md) — local storage paths and full lifecycle details.
