---
description: Complete /settings guide organized in the exact UI tab order (General, Models, Agent presets, Plugins, Terminal, Advanced) with defaults and recommended setups.
---

# Settings

Run `/settings` (alias `/set`) to open the bottom-docked settings panel right above the live status footer—keeping your conversation above and your real status footer below visible the entire time.

- `Tab` / `Shift+Tab` (or `←` / `→`) switches top tabs; `↑` / `↓` moves focus; `Space` / `Enter` toggles or opens a sub-form.
- Press **`/`** (or start typing) to search across every tab; `Esc` clears search and then closes settings.
- Press **`Ctrl+R`** on any item to restore its inherited default.
- Appearance and status-line changes **apply and save immediately**, displaying a brief confirmation on the panel footer without cluttering the transcript. Multi-field forms (Shell, Subagents, Model providers, Web search/fetch) stage changes as a draft until you choose **`Apply`**.

## Five high-impact adjustments

| Goal | Where to change it |
|---|---|
| Trim or expand the status footer live | `Terminal` → `Status line` (updates and underlines items directly on the real footer below) |
| Drag-to-select freely in tmux | `Terminal` → `Mouse interaction` → `Off` (`native`) |
| Get pinged when long work finishes or needs approval | `Terminal` → `Notifications` → `unfocused` |
| Enable per-turn file undo checkpoints | `Plugins` → `Tools` → `File recovery snapshots` |
| Make `Enter` steer instead of queue while busy | `Terminal` → `Input` → `Busy send behavior` → `Steer` |

The sections below follow the exact tab order in `/settings`.

---

## 1. General

| Setting | Values | Default | Effect |
|---|---|---|---|
| **UI language** | `Auto` / `English` / `简体中文` | `Auto` | Switches menus, prompts, and settings immediately (`Auto` checks `LC_ALL`, `LC_MESSAGES`, `LANG`). Commands, model names, file contents, and footer metric labels stay in their original form. |
| **Response language** | `Follow UI` / `Auto` / `English` / `简体中文` | `Follow UI` (new profiles) | Controls the assistant’s prose language starting on the next turn (code, identifiers, and explicit prompt requests always take priority). |
| **Default access** | `Read only` / `Workspace write` / `Full access` | `Workspace write` | Default permission level for new sessions. |
| **Current access** | Same as `/permission` (includes `Auto review`) | Active session | Changes permissions for the current session. |
| **Current goal** | Edit / pause / resume / clear | None | Manages the active `/goal` objective. |
| **File change summary** | `On` / `Off` | `On` | Shows per-turn `Changed` summaries in the transcript (turning off keeps `/diff turn` available). |

---

## 2. Models

| Entry | Purpose |
|---|---|
| **Model and reasoning** | Opens `/model` to change the saved default or press `Ctrl+D` for this session only. |
| **DeepSeek account** | Sign in/out of the shared DeepSeek account, view profile, top-up/grant balances, and account notices, or pick a `deepseek-account` model. |
| **Sign in / Add API key** | Activate a built-in provider and store its API key, or add a custom API provider. |
| **Sign out / Remove key** | Sign out of the shared account or remove locally stored API keys (leaves environment variables untouched). |
| **Endpoints and model lists** | Edit base URL, API protocol (`OpenAI Chat Completions`, `OpenAI Responses`, `Anthropic Messages`), model definitions (ID, context window, max output, text/image inputs, reasoning levels), or run **`Fetch available models`**. |

> Secret inputs are masked and never echoed; leaving an API key blank preserves the existing credential. Native DeepSeek routes require a Messages-compatible endpoint (`baseURL` only—`protocol` is fixed).

---

## 3. Agent presets

- **Default Agent preset:** Sets the default preset (`Standard`, `PTC`, `Minimal`, or `Creator`) for future sessions.
- **Current session:** Switchable only before the first message on a blank session. On active sessions, use `/agent inspect` to inspect composition or `/agent creator` to open a plugin-authoring session. See [Tools and presets](tools.md).

---

## 4. Plugins

Centralizes built-in tools, subagents, integrations, and optional feature toggles:

### Tools

- **Shell:** Platform-specific default timeout (120s), max timeout, in-memory output cap, retained temp-file cap, and shutdown grace period (accepts readable units like `30s`, `2m`, `512 KiB`, `2 MiB`).
- **Tool parallelism:** Maximum safe parallel tool calls in a single step (separate from subagent concurrency).
- **File recovery snapshots:** Off by default. Captures per-turn snapshots so you can restore files via `Alt+R` in the Session Tree. See [Sessions and recovery](sessions.md#3-recovering-turn-files-file-recovery-snapshots).
- **Tmux location context:** On by default inside real POSIX `tmux` panes (`$TMUX_PANE`), injecting session/window/pane layout context on layout changes (configurable minimum refresh interval; zero overhead outside tmux).
- **Retain worktree on archive:** Shown when Git Worktrees is enabled; defaults to `true` so archiving a session in `/resume` keeps its worktree until you turn this off.

### Agents / Subagents

- **Subagents:** Configure max delegation depth (default `1`), max concurrent subagents, and an optional allowed-model allowlist.
- **Codex & Claude Code:** Enable/disable these bundled native integrations, check **`Installation status`**, and configure independent **Model** (blank inherits native settings) and **Permissions** (conservative defaults: `never` for Codex, `dontAsk` for Claude Code).

### Integrations

- **MCP servers:** Opens the live `/mcp` manager to add, toggle, probe, restart, or remove servers without restarting omdsh. See [Skills and MCP](skills-and-mcp.md).
- **Web search and fetch:** Choose search/fetch backends (defaults to hosted `deepseek-search-api` and `deepseek-fetch-api` to avoid local proxy/DNS failures; switch fetch to **`Direct fetch`** `http` when accessing localhost or internal networks), results per search (1–50), and billing source (`auto` / `account` / `api-key`).
- **Command hooks:** Enable synchronous command hooks (`off` / `codex` / `claude-code`, default `off`) and optional config path (defaults to `.codex/hooks.json` or `.claude/settings.json`; toggle or restart after editing the hook file).

### Optional features

Toggle individual optional capabilities to trim context or noise (applies live):

| Toggle | Default | When turned off |
|---|---|---|
| **Record file changes** | On | Stops per-turn changed-file tracking and Git snapshots |
| **Session history tools** | On | Removes `session_search`, `session_trace`, and related history tools from the model |
| **Ralph loop** | Off | Keeps the loop tool disabled until explicitly enabled here |
| **Repeat tool reminder** | On | Stops injecting reminders when the model repeats the same tool call |

---

## 5. Terminal

### Appearance, Input, Notifications, and Startup

| Setting | Values | Default | Effect |
|---|---|---|---|
| **Theme** | `dark` / `light` / `system` | `dark` | Catppuccin Mocha/Latte palettes, or `system` adapting to your terminal colors. |
| **Color** | `on` / `off` | `on` | Terminal SGR colors (explicit choice overrides `NO_COLOR`). |
| **Motion** | `full` / `reduced` / `off` | `full` | `full` smooth streaming + subtle shimmer; `reduced` removes shimmer; `off` static rendering (display only; never delays model output). |
| **Math in replies** | `auto` / `source` | `auto` | Typesets supported inline/block math in terminal glyphs, or preserves raw LaTeX. |
| **Mermaid in replies** | `auto` / `source` | `auto` | Draws fitting flowcharts, sequence, state, ER, class, and Git diagrams in terminal characters, or shows raw source. |
| **Thinking in turns** | Collapsed / Shown | Collapsed | Default visibility for thinking blocks (`Ctrl+T` toggles anytime). |
| **Terminal title** | `status` / `session` / `workspace` / `off` | `status` | Sets terminal window title to status, session name, or workspace + Git branch. |
| **Terminal status** | `auto` / `on` / `off` | `auto` | Reports lifecycle/progress to compatible terminals (including Herdr and OSC 9;4 progress). |
| **Editor** | `Auto` / detected editors | `Auto` | External editor for `Ctrl+X` and `E` in file previews (VS Code, Cursor, VSCodium, Neovim, Vim, Nano, Vi; respects `$VISUAL`/`$EDITOR`). |
| **Keybindings** | Default / custom count | Default | Interactive key rebinding and key tester, saved live to `keybindings.json`. |
| **Mouse interaction** | `auto` / `tui` / `native` | `auto` | `auto` respects tmux `mouse off`; `tui` forces clicks/wheel; `native` hands mouse to your terminal. |
| **Busy send behavior** | `Queue` / `Steer` | `Queue` | What `Enter` does while busy (`Cmd/Ctrl+Enter` always runs the opposite). |
| **Paste protection** | `on` / `off` | `on` | Prevents unmarked multi-line pastes from submitting early. |
| **Copy on select** | `on` / `off` | `on` | Copies when mouse drag ends; turn off to copy with `Alt+C`, `Enter`, or right-click. |
| **Update checks** | `on` / `off` | `on` | Daily cached npm version check (notifies only; never auto-installs). |
| **Release notes** | `summary` / `expanded` / `hidden` | `summary` | One-time release-note display after upgrading. |
| **Notifications** | `off` / `unfocused` / `always` | `off` | Notifies when a long turn finishes (≥30s while unfocused) or an approval prompt needs input. |

### Status line (`Terminal → Status line`)

Changes under `Status line` **update immediately on the live status footer beneath the panel, with the focused item underlined**:

- **Session metrics:** Toggle the metrics row below line 1 (turning it off reclaims that row).
- **Density:**
- `minimal` — occupancy only (`Ctx`, `Cache`).
- `standard` (default) — adds latency and throughput (`TTFT`, `tok/s`).
- `verbose` — full labels (`Context 1.6% · 16.4K/1M`) plus a **third line** for session duration and turns/steps when width allows.
- **Fixed layout and graceful degradation:**
- Line 1: identity on the left (Model, Effort, Session), workspace on the right (Path, Git).
- Metrics: occupancy and duration on the left (Context, Cache, Duration), throughput and work on the right (Tokens, TTFT, Turns).
- Narrow terminals drop items strictly from lowest priority first (`Turns` → `Duration` → `Latency/Tokens/Cache`) so items never jump sides or reappear out of order.
- **Per-item toggles and reset:** Press `Space` to hide or show any item (explicit overrides persist across density changes); choose **`Restore layout`** to reset.

---

## 6. Advanced

Shown only when an installed plugin exposes raw schema fields not already covered by a product form. Each field shows whether its value is inherited or overridden, validates against the plugin schema, and supports **`Reset to inherited`**.

---

## Where settings are saved

Preferences from `/settings`, `/model`, and `/login` persist in `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` (API keys stay in the local credentials store; shared DeepSeek sign-in uses its own account store). If another process edits the file concurrently, draft forms offer **`Load latest and keep draft`** so you can merge safely. See [Sessions and recovery](sessions.md#8-local-data-files) for the full file map.

## Related

- [Tune your terminal and models](tutorials/environment.md) — guided setup walkthrough
- [Keyboard and mouse](keyboard.md) — settings navigation keys and `keybindings.json`
- [Troubleshooting](troubleshooting.md) — color, mouse, notifications, and sign-in fixes
