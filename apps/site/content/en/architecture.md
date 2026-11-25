---
description: How oh-my-dsh composes published DeepSeek Harness plugins into a terminal coding agent — package boundaries, ownership, rendering guarantees, and verification.
---

# Architecture

oh-my-dsh builds on published **DeepSeek Harness (DSH)** packages: sessions, models, tools, commands, permissions, Skills, MCP, LSP, and metering live in Harness plugins, while omdsh owns terminal presentation and human interaction—deliberately avoiding a second agent core.

## 1. Repository and dependency boundaries

- **Runtime dependencies:** Every `@deepseek-ai/*` package is installed at exact published npm versions and consumed strictly through public exports.
- **Product packages:**
- `apps/omdsh` (`@agi-fans/oh-my-dsh`): CLI parsing, boot composition, `omdsh doctor`, `omdsh exec`, `omdsh plugin` installer, and default profile manifest.
- `packages/tui/omdsh-tui` (`@agi-fans/dsh-tui`): reusable terminal UI suite (service definition, local terminal provider, session runtime, slash commands, Markdown/tool rendering, and interactive views).
- **Read-only references:** `refs/deepseek-harness` and `refs/pi` are research-only and never participate in resolution, builds, tests, or runtime execution.

```text
apps/omdsh/                         @agi-fans/oh-my-dsh
├── src/bin.ts                      CLI entry and argument parsing
├── src/boot.ts                     Boot and compose plugin tree
├── src/doctor.ts                   Read-only diagnostics (`omdsh doctor`)
├── src/exec.ts                     Script mode (`omdsh exec --json`)
├── src/plugin.ts                   `omdsh plugin` manager
└── config/cordis.yml               Default product composition

packages/tui/omdsh-tui/             @agi-fans/dsh-tui
├── src/definition.ts               Provider-agnostic TUI Service contract
├── src/runtime/                    Local terminal provider, session runtime, runner, settings forms
├── src/commands/                   Slash-command plugins (model/session/team/plugins/mcp/etc.)
├── src/chrome/                     Themes, display width, Markdown, tool cards, status footer
├── src/input/                      Key decoding, editor, clipboard, paste protection
├── src/views/                      Transcript viewport, settings panel, diff/file/trajectory/search views
└── src/session/                    Session controller and helpers
```

## 2. Ownership and data flow

```text
Terminal input → Local TUI Provider → Runner / Command registry → Session Runtime & Harness services
              → Durable session events & metering projections → Pure view layer → Differential renderer
```

- **Local TUI Provider:** Sole owner of raw mode, key decoding, cursor state, mouse reporting, and atomic terminal writes.
- **Session Runtime:** Manages session creation/resume, model/preset selection, tool presentation mapping, and live subagent lists (routing text/image follow-ups for continuable subagents through `SubagentRuntime.prompt`).
- **Commands & tools:** Slash commands register via `dsh-commands`; tools declare presentation intent via `presentCall` / `presentResult` while the TUI handles padding, wrapping, and fallback rendering.
- **Metering & footer:** Token counts, context pressure, duration, titles, and stats come directly from Harness projections—never duplicate UI counters.
- **Pure internal modules:** ANSI cell width, Markdown formatting, frame diffing, and view transitions remain plain modules rather than speculative runtime plugins.

## 3. Runtime composition

[`apps/omdsh/config/cordis.yml`](https://github.com/agi-fans/oh-my-dsh/blob/main/apps/omdsh/config/cordis.yml) layers these capabilities over `$OMDSH_HOME/profiles/omdsh`:

- **Core & models:** Cordis loader, DeepSeek account + API-key routes with local OAuth callback host, multi-provider adapter, credentials, settings, and default model.
- **Sessions & guardrails:** Durable JSONL sessions, SQLite FTS5 search index, auto-titling and metering, remembered approval rules (`approval-rules`), turn file recovery snapshots (`file-recovery`), per-turn changed-file tracking (`workspace-changes`), tool-result pruning, image offload, and repeat-tool reminders.
- **Tools & workflows:** Platform shell (`bash` on POSIX, `pwsh` on Windows), persistent interactive terminals (`terminal`), background jobs (`jobs`), scheduled reminders (`schedule`), web search/fetch, Todo, `/goal`, `/plan`, `/btw` side queries, and command hooks (`hook-settings`).
- **Presets & multi-agent:** `Standard`, `PTC`, `Minimal`, and `Creator` presets; three subagent transports (`subagent`, `subagent_fork`, `subagent_isolated`); opt-in Agent Teams (`/team`); plus bundled Codex, Claude Code, Git Worktrees, Auto review, and Tmux location context integrations.
- **Extensions:** Filesystem Skills, live `/mcp` server manager, static `mcp.json`, and read-only `lsp.json` language servers.
- **Terminal layer:** Local TUI provider, tool presentation bridge, human interaction adapter, slash commands, and runner.

User-installed plugins (`/plugins` or `omdsh plugin add`) and `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` layer on top at boot (inspect with `omdsh --dump-config`).

## 4. Terminal rendering guarantees

### Main screen and native scrollback
- Layout is computed in **terminal display cells** (handling ANSI escapes, CJK text, emoji, combining marks, and unbroken lines), with the input box and status footer anchored at the bottom.
- **Native scrollback is never erased:** Scrolled-off rows stay immutable snapshots; `/clear`, session switches, `/resume`, and forks append below a labeled divider (`/new` adds one only when the prior transcript had substantive content).
- Alternate screen is used only for true full-screen overlays on direct terminals; tmux, screen, and ConPTY coalesce resize bursts and preserve host scrollback.

### Incremental diffing and frame sync
- Completed transcript blocks cache their formatted rows; scrolling and streaming repaint only changed visible rows inside a single DEC 2026 synchronized write.
- Streaming deltas coalesce within an 8 ms frame window while user keystrokes, tool state transitions, and control events flush immediately.

### Focus, mouse, and safe exit
- Overlays and docked panels own focus cleanly; approval prompts always take priority over routine views and restore your prior surface and draft once resolved.
- Mouse reporting (1000/1006) respects `Mouse interaction` and tmux `mouse off`, with full keyboard parity in native mode.
- `Ctrl+C` clears drafts or interrupts active work; pressing `Ctrl+C` twice at idle (or `Ctrl+D` when empty) exits with a `--resume` hint. Pipe mode shares the same command and session semantics without taking over the screen.

## 5. Verification

- **Unit & fake-TTY contract tests:** Cell width, ANSI/CJK/emoji layout, Markdown, tool cards, viewport caching, key routing, and lifecycle disposal.
- **End-to-end smoke tests:** `pnpm smoke:happy` (mock LLM happy path) and `pnpm smoke` (real PTY interaction).
- **Boundary & doc gates:** `pnpm check:boundaries` guarantees zero references into `refs/`, while `pnpm check:md` and site builds validate bilingual docs. See [`AGENTS.md`](https://github.com/agi-fans/oh-my-dsh/blob/main/AGENTS.md).
