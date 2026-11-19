---
description: Browse and install third-party plugins in /plugins, and manage built-in Codex, Claude Code, Git Worktree, Auto review, and Tmux context integrations.
---

# Install plugins and built-in integrations

Beyond Skills and MCP, omdsh supports installable plugin packages (npm packages) that add new slash commands, tools, model providers, or local integrations. You can discover, install, update, enable, and remove them directly inside `/plugins`—no hand-edited config files needed.

## 1. Tour the `/plugins` hub

Run `/plugins` inside omdsh to open the plugin manager:

| Entry | What it does |
|---|---|
| `Configure plugins` | Open settings forms for Shell, subagents, web search/fetch, and installed plugins |
| `Let the agent create a plugin` | Launch the built-in Creator preset (same as `/agent creator`) to scaffold and debug a new plugin |
| `Plugin entries` | Inspect individual loaded plugins, read diagnostics, or toggle an entry |
| `Bundles` | Manage installed external plugins and bundled integrations (read README details, update, enable/disable, uninstall) |
| `Discover` | Browse and search configured plugin indexes and install in one flow |
| `Install bundle` | Install directly by npm package name, version, Git URL, or local absolute path |

> Changes in `/plugins` apply across sessions sharing your profile (`$OMDSH_HOME`). Routine toggles apply live; replacing package files may ask you to restart omdsh.

## 2. Enable built-in integrations shipped with omdsh

Several high-value integrations are already bundled with omdsh—just configure or enable them when you need them:

### Codex and Claude Code subagent integrations (off by default)

If you already use Codex or Claude Code locally, you can delegate self-contained tasks to them:

1. Open `/settings` → **`Plugins` → `Agents`** (or open them from `/plugins` → `Bundles`).
2. Select `Codex` or `Claude Code`, enable it, and check **`Installation status`** to verify the runtime.
3. Leave **Model** blank to inherit native settings. **Permissions** stay independent of your main session and start conservative (`never` for Codex, `dontAsk` for Claude Code)—widen them only when you want the child agent to edit files.

### Git Worktree and Auto review (enabled by default)

- **Git Worktree** (`@deepseek-ai/dsh-experimental-worktree`): Isolate risky experiments in a separate Git worktree without touching your active branch. Configure worktree retention on archive in `/settings` → `Plugins`, or disable it anytime under `/plugins` → `Bundles`.
- **Auto review** (`@deepseek-ai/dsh-experimental-auto-review`): Powers the `Auto review` permission mode in `/permission` for an extra automated review step before sensitive actions. Disable it anytime under `/plugins` → `Bundles`.

### Tmux location context (enabled by default inside tmux)

When running inside a `tmux` pane, the built-in **Tmux location context** plugin tracks your session, window, and pane layout automatically (zero overhead outside tmux). Adjust its refresh interval or turn it off under `/settings` → **`Plugins` → `Tools` → `Tmux location context`**.

## 3. Install, update, and remove third-party plugins

### Option A: Inside omdsh with `/plugins` (recommended)

1. **Discover and install:** Open `/plugins` → **`Discover`**, filter by keyword, review compatibility details, and confirm installation.
2. **Install by specifier:** Open `/plugins` → **`Install bundle`** and enter any of:
- npm package or version: `@scope/my-plugin` or `@scope/my-plugin@1.2.0`
- Git URL: `github:owner/repo`
- Local directory or tarball: `/abs/path/to/my-plugin` or `/abs/path/to/my-plugin.tgz`
3. **Read docs, update, or uninstall:** Open `/plugins` → **`Bundles`**, select a package to read its README (`Details`), install updates (`Update`), or remove it (`Uninstall`).

### Option B: From the command line with `omdsh plugin`

For scripts or pre-launch setup (requires `pnpm` on `PATH`):

```sh
omdsh plugin add @scope/my-plugin     # npm spec, Git URL, or ./local-path
omdsh plugin list                     # list installed bundles
omdsh plugin update @scope/my-plugin  # update to a compatible newer version
omdsh plugin remove @scope/my-plugin  # uninstall the bundle
```

Run `omdsh doctor` or `omdsh --dump-config` afterwards to verify the plugin loaded cleanly with no version conflicts.

## Common questions

- **Why can’t built-in integrations be uninstalled?** Bundled integrations (Codex, Claude Code, Git Worktree, Auto review) ship and update alongside `omdsh`. You can **Disable** any of them in `/plugins` → `Bundles`, and your disabled preference is preserved across upgrades.
- **Installed a plugin but its command didn’t appear?** Run `omdsh doctor` to check DeepSeek Harness version compatibility; if you installed via the CLI, restart `omdsh` once to load it.

## Next steps

- Full compatibility contract and plugin behavior: [Plugins and integrations](../plugins.md).
- Want to build your own command, tool, or integration plugin? Continue to [Write and publish a plugin](write-a-plugin.md).
