---
description: "For developers: build a plugin package with slash commands, tools, or settings using /agent creator or from scratch, test locally, and publish."
---

# Write and publish a plugin

When a task goes beyond what `SKILL.md` or an MCP server can do—such as adding an interactive slash command, registering a new built-in tool, or integrating a custom runtime service—author an omdsh plugin package (an npm package declaring `dsh.bundle.patch` on DeepSeek Harness’s Cordis plugin architecture).

Make sure `pnpm` is available on `PATH` before starting.

## Shortcut: Use built-in `/agent creator`

omdsh ships a dedicated **Creator** preset equipped with the authoritative `dsh-doc` authoring guide and read-only runtime inspection tools:

1. Start `omdsh` in a fresh folder and run **`/agent creator`** (or choose **`Let the agent create a plugin`** inside `/plugins`). This does not change your default preset.
2. Describe what your plugin should do; Creator inspects live host interfaces and helps generate the package, patch file, and tests.

To understand every file by hand, follow the five-minute `greet-plugin` walkthrough below (or inspect the minimal fixture in [`examples/hello`](https://github.com/agi-fans/oh-my-dsh/tree/main/examples/hello)).

## Step 1: Check your installed runtime version

Plugins must declare `@deepseek-ai/*` under `peerDependencies` matching the DeepSeek Harness (DSH) release shipped by your `omdsh` installation. Listing them under `dependencies` causes `omdsh plugin` to reject the install so the shared runtime tree is never duplicated.

Check the active version and composition with:

```sh
omdsh --dump-config | head -n 20
```

You can also inspect `@deepseek-ai/cordis` and `@deepseek-ai/dsh-commands` in your installed `@agi-fans/oh-my-dsh/package.json` and mirror those versions in `peerDependencies`.

## Step 2: Create the package and its three core files

Create a standalone directory outside the omdsh workspace (never add it to `pnpm-workspace.yaml` or use `workspace:` dependencies):

```sh
mkdir greet-plugin
cd greet-plugin
```

A minimal plugin needs three files: `package.json`, `cordis.patch.yml`, and `index.js`.

### 1. `package.json`

```json
{
  "name": "greet-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.1.0",
    "@deepseek-ai/dsh-commands": "<DSH version matching your omdsh>"
  }
}
```

Two rules keep installation safe:

- Keep all `@deepseek-ai/*` packages in `peerDependencies`, never `dependencies`.
- Keep `dsh.bundle.patch` pointing to your patch file. Without it, the package installs only as a plain library and mounts no layer (useful only for helper libraries imported by other plugins).

### 2. `cordis.patch.yml`

```yaml
- insert:
    - id: greet
      name: greet-plugin
```

- `name` must match the npm package name so Node resolves the module.
- `id` must be unique in the plugin tree. A later patch targeting the same `id` replaces its `config` object wholesale rather than deep-merging; a patch targeting a missing `id` is skipped silently at boot.

### 3. `index.js`

```js
export const name = 'greet-plugin'
export const inject = ['commands']

export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'greet',
      description: 'Print a greeting from this plugin',
      input: { hint: '[name]' },
      handler(invocation) {
        const who = invocation.rawInput.trim() || 'omdsh'
        return { kind: 'success', text: `Hello, ${who}.` }
      },
    })
  }, 'greet-plugin')
}
```

Four boundaries keep your plugin well-behaved inside the terminal:

- **Command names:** Lowercase with no leading `/`. `invocation.rawInput` contains the raw text after the command name.
- **Prompting the user:** Inject `'tui'` and call `ctx.tui.prompt(...)` for choices, text input, or document readers. Never take over the TTY or read raw terminal bytes directly.
- **Secrets:** Store sensitive credentials through `ctx.credentials`, never in plain config files.
- **Plugin settings:** Declare a schema via `ctx.settings`—omdsh automatically renders and validates your fields under `/settings → Advanced`. Do not try to patch the `/settings` UI directly.

## Step 3: Install locally, verify, and iterate

From the parent directory containing `greet-plugin`:

```sh
omdsh plugin add ./greet-plugin
omdsh --dump-config
```

Verify in two steps:

1. Confirm `greet-plugin` appears after `@agi-fans/oh-my-dsh` in `omdsh --dump-config` with `id: greet`.
2. Restart `omdsh`, then test `/greet`, `/greet Ada`, and `/help`:
- In interactive `/help`, `/greet` appears directly in the searchable command picker.
- In non-interactive text help, plugin commands are grouped under **`Extensions`**.

### Iterating on changes

- With a local path install (`./greet-plugin`), your profile links directly to that folder: edit `index.js` or `cordis.patch.yml` and **restart `omdsh`** to load changes.
- To clean up afterwards, run `omdsh plugin remove greet-plugin`.

## Step 4: Publish and distribute

- **npm:** Publish to npm so users can install via `/plugins` or `omdsh plugin add greet-plugin`.
- **Tarball:** Run `pnpm pack` and share the `.tgz`; users install with `omdsh plugin add ./greet-plugin-0.1.0.tgz`.
- **Git:** Users install with `omdsh plugin add github:<owner>/greet-plugin` (if the repo builds during `prepare`, users may need an `allowBuilds` entry in `$OMDSH_HOME/profiles/omdsh/pnpm-workspace.yaml`).

Before publishing, verify that your plugin imports only published package exports and does not assume HTTP or Web UI services (the TUI host does not mount them).

## Next steps

- Code examples for custom tools, presentation, prompts, and settings schemas: [Plugin internals](../plugin-internals.md).
- Full compatibility contract and host boundaries: [Plugins and integrations](../plugins.md) and [Architecture](../architecture.md).
