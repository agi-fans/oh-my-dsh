# Write a plugin

[English](write-a-plugin.md) | [简体中文](write-a-plugin.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Install the example plugin](install-plugin.md)

An omdsh plugin is an npm package that declares `dsh.bundle.patch`, inserts one or more Cordis rows, and mounts in the same tree as the shipped composition. It is not a Skill file, not an MCP server document, and not a TypeScript file dropped into an extensions directory. The TUI does not keep a second command registry: once the bundle is in the tree, a `dsh-commands` handler appears in `/help`, autocomplete, and the runner.

You can copy [`examples/hello`](../../examples/hello) and rename it. This walkthrough builds a small `greet-plugin` from scratch so each file's job is visible.

### Create the package

Create a directory that is not an omdsh workspace member. Do not add it to `pnpm-workspace.yaml`, and do not use `workspace:` dependencies.

```sh
mkdir greet-plugin
cd greet-plugin
```

The package needs three files: `package.json`, `cordis.patch.yml`, and `index.js`.

### Declare the bundle

`package.json` names the package, points at the plugin module, and exports the patch file. Pin `@deepseek-ai/*` peers to the same DSH release omdsh ships. Do not list those packages under `dependencies`, or `omdsh plugin` rejects the install to prevent a second Cordis or Harness copy.

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
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-commands": "^0.1.0-rc.7"
  }
}
```

A package without `dsh.bundle.patch` still installs, but only as a plain library: omdsh prints a warning and does not add a layer. Use that shape for a helper library that other bundles import.

### Insert one plugin row

`cordis.patch.yml` is a YAML array of Cordis include patches. The usual form is one `insert` list. The row `name` must be the npm package name so Node resolves the installed module; the row `id` must be unique in the composed tree.

```yaml
- insert:
    - id: greet
      name: greet-plugin
```

An id-targeted patch later replaces the whole `config` object for that id; it does not deep-merge. A patch that names a missing id is a stderr warning.

### Register a slash command

The module is an ordinary Cordis plugin: export `name`, `inject` the host services you need, and register work in `apply` so Cordis disposes it with the plugin fiber. Command names are lowercase and have no leading slash. `rawInput` is the exact text after the command name.

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

Ask a human only through `ctx.tui.prompt` after injecting `tui`, and store secrets through `ctx.credentials`. Do not take over the TTY, listen to raw terminal bytes, register a second slash-command table, or add a `/settings` row. Those surfaces stay product-owned; see [User plugins](../plugins.md).

### Install and inspect

From the directory that contains `greet-plugin`, or with a path relative to the invoking directory:

```sh
omdsh plugin add ./greet-plugin
omdsh --dump-config
```

`omdsh plugin` requires `pnpm` on `PATH`. A `./path` is relative to the invoking directory; if that path is missing, omdsh walks parent directories for the same relative path and fails if nothing exists, so it does not install a broken link.

`--dump-config` should list `greet-plugin` after `@agi-fans/oh-my-dsh` and show `id: greet`. Restart omdsh, then run `/greet`, `/greet Ada`, and `/help`. The new command appears under Agent Commands. Installing or removing a bundle does not hot-reload `node_modules`; restart after every successful `omdsh plugin` run.

### Change the plugin

Edit `index.js` or `cordis.patch.yml` in the package directory. If you installed a local path or `link:`, the Profile already points at that checkout; restart omdsh to load the new module. If you installed a registry version, run `omdsh plugin update greet-plugin` or add the new version, then restart.

A later version that gains `dsh.bundle.patch` joins the layer list on the next successful `omdsh plugin` run. Removing the package with `omdsh plugin remove greet-plugin` drops both the dependency and the layer. The shipped `@agi-fans/oh-my-dsh` layer is not a Profile dependency and is never removed.

### Publish

Publish to npm and install with `omdsh plugin add greet-plugin`. Ship a tarball from `pnpm pack` and install with `omdsh plugin add ./greet-plugin-0.1.0.tgz`. A git checkout works as `omdsh plugin add github:<owner>/greet-plugin`; git-hosted packages that build in `prepare` may need an `allowBuilds` entry in `$OMDSH_HOME/profiles/omdsh/pnpm-workspace.yaml` if pnpm blocks the script.

Import only published package exports. Do not reach into `refs/`. Do not assume Host, HTTP, or a Web UI is mounted. The first compatibility set is commands, tools with `presentCall` / `presentResult`, LLM routes on `ctx.llm`, settings and credentials, and questions through `ctx.tui.prompt`. Custom transcript blocks, overlays, theme packs, and exclusive TTY ownership are outside that set.

[Tutorials](../tutorials.md) · Previous: [Install the example plugin](install-plugin.md)
