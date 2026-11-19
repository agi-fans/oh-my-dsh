---
description: Install, update, and manage third-party plugins and bundled integrations (Codex, Claude Code, Git Worktree, Auto review, and Tmux context) with /plugins and omdsh plugin.
---

# Plugins and integrations

omdsh is built on DeepSeek Harness’s plugin architecture: shipped capabilities and installed third-party packages run side by side safely. For a guided user walkthrough see [Install plugins and built-in integrations](tutorials/install-plugin.md); to author your own plugin see [Write and publish a plugin](tutorials/write-a-plugin.md).

## 1. Managing plugins with `/plugins` and `omdsh plugin`

### Interactive management (`/plugins`)

Run `/plugins` inside omdsh for everyday management (changes apply across sessions sharing `$OMDSH_HOME`):

- **`Discover`:** Browse and search configured plugin indexes, install new packages, or update installed ones marked `Update available`.
- **`Bundles`:** Read each bundle’s README (`Details`), toggle it on or off, update it, or uninstall third-party packages.
- **`Plugin entries`:** Inspect individual plugin load states and diagnostics (terminal-required core entries are read-only so you cannot break the UI).
- **`Configure plugins`:** Jump straight to settings for Shell, subagents, web search/fetch, and installed plugins.
- **`Install bundle`:** Install directly by npm package name, version, Git URL, or local absolute path.
- **`Let the agent create a plugin`:** Same as `/agent creator`—launches the Creator preset (with the bundled `dsh-doc` authoring skill) without changing your default preset.

### Command-line management (`omdsh plugin`)

Ideal for scripts or pre-launch setup (requires `pnpm` on `PATH`):

```sh
omdsh plugin add <pkg|git-url|./local-path>
omdsh plugin update <pkg>
omdsh plugin remove <pkg>
omdsh plugin list
```

Any other arguments forward to `pnpm` inside `$OMDSH_HOME/profiles/omdsh/`. Run `omdsh --dump-config` or `omdsh doctor` afterwards to confirm the mounted plugin tree.

## 2. Bundled integrations shipped with omdsh

These integrations ship and update alongside `omdsh` (they cannot be uninstalled individually, but any of them can be disabled in `/plugins` → `Bundles`, and that choice persists across upgrades):

| Bundled integration | Default | Where to configure | What it adds |
|---|---|---|---|
| **Codex / Claude Code subagents** | Off | `/settings` → **`Plugins` → `Agents`** (or `/plugins` → `Bundles`) | Delegates self-contained text tasks to pinned Codex or Claude Code runtimes; inherits native login/model, independent conservative permissions (`never` for Codex, `dontAsk` for Claude Code). |
| **Git Worktrees** (`@deepseek-ai/dsh-experimental-worktree`) | On | `/plugins` → `Bundles`; archive option in `/settings` → `Plugins` → `Tools` | Isolates experimental work in a separate Git worktree without touching your active branch; retains worktrees on archive by default (`retainOnArchive: true`). |
| **Auto review** (`@deepseek-ai/dsh-experimental-auto-review`) | On | `/permission` (per-session) and `/plugins` → `Bundles` | Adds `Auto review` mode in `/permission` for an extra model review before sensitive actions. |
| **Tmux location context** (`@deepseek-ai/dsh-tmux-context`) | On inside tmux | `/settings` → **`Plugins` → `Tools` → `Tmux location context`** | Mounts automatically inside real POSIX tmux panes (`$TMUX_PANE`) to report session/window/pane layout; zero overhead outside tmux. |

## 3. Compatibility contract (for authors and power users)

1. **Standard npm package + `dsh.bundle.patch`:** Point `dsh.bundle.patch` in `package.json` to your patch file (such as `./cordis.patch.yml`). Packages without it install only as plain libraries and mount no plugin layer.
2. **Single shared runtime:** Declare all `@deepseek-ai/*` packages in `peerDependencies` matching the active DeepSeek Harness version; listing them in `dependencies` is rejected so the runtime tree is never duplicated.
3. **Automatic TUI support:** Plugins that register slash commands (`commands`), model tools (`tools`), model providers (`llm`), secrets (`credentials`), settings schemas (`settings` → rendered automatically under `/settings → Advanced`), or user prompts (`tui.prompt`) work inside the terminal with zero custom TUI code.
4. **No Web/HTTP host assumptions:** The TUI host intentionally does not mount a Web UI or HTTP server, and plugins must not hijack the TTY or read raw terminal bytes directly.

For boot layering, public terminal interfaces, and code examples, see [Plugin internals](plugin-internals.md) and [Architecture](architecture.md).

## Related

- [Install plugins and built-in integrations (tutorial)](tutorials/install-plugin.md) — user walkthrough
- [Write and publish a plugin](tutorials/write-a-plugin.md) — build and publish from scratch
- [Plugin internals](plugin-internals.md) — public interfaces and code examples
- [Subagents and Agent Teams](subagents.md) — detailed Codex and Claude Code behavior
