# Write a plugin

By the end of this walkthrough you will have built, installed, and verified a small plugin that adds a `/greet` command, and you will know how to change and publish it. You need `pnpm` on `PATH`.

An omdsh plugin is an npm package that declares `dsh.bundle.patch` and mounts in the same plugin tree as the shipped product. It is not a Skill file, not an MCP server document, and not a TypeScript file dropped into an extensions directory. You can copy [`examples/hello`](https://github.com/agi-fans/oh-my-dsh/tree/main/examples/hello) and rename it; this walkthrough builds a small `greet-plugin` from scratch so each file's job is visible.

### Create the package

Create a directory that is not an omdsh workspace member. Do not add it to `pnpm-workspace.yaml`, and do not use `workspace:` dependencies:

```sh
mkdir greet-plugin
cd greet-plugin
```

The package needs three files: `package.json`, `cordis.patch.yml`, and `index.js`.

### Declare the bundle

`package.json` names the package, points at the plugin module, and exports the patch file:

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
    "@deepseek-ai/dsh-commands": "^0.1.1-rc.2"
  }
}
```

Two rules keep the install safe:

- Pin `@deepseek-ai/*` peers to the same DSH release omdsh ships, and keep them under `peerDependencies`. Listing them under `dependencies` makes `omdsh plugin` reject the install, because a second Cordis or Harness copy would split the shared tree.
- Keep `dsh.bundle.patch` pointing at the patch file. A package without it still installs, but only as a plain library: omdsh prints a warning and adds no layer. Use that shape for a helper library that other bundles import.

### Insert one plugin row

`cordis.patch.yml` is a YAML array of Cordis include patches, usually one `insert` list:

```yaml
- insert:
    - id: greet
      name: greet-plugin
```

The row `name` must be the npm package name so Node resolves the installed module, and the row `id` must be unique in the composed tree. A later patch that targets an id replaces the whole `config` object for that id; it does not deep-merge. A patch that names a missing id is a stderr warning.

### Register a slash command

`index.js` is an ordinary Cordis plugin: export `name`, list the host services you need in `inject`, and register work in `apply` so it is disposed automatically with the plugin:

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

Command names are lowercase and have no leading slash. `rawInput` is the exact text after the command name.

Two boundaries keep the product coherent: ask a human only through `ctx.tui.prompt` after injecting `tui`, and store secrets through `ctx.credentials`. Do not take over the TTY, listen to raw terminal bytes, register a second slash-command table, or add a `/settings` row — those surfaces stay product-owned. [User plugins](../plugins.md) lists the full compatibility contract.

### Install and inspect

From the directory that contains `greet-plugin`:

```sh
omdsh plugin add ./greet-plugin
omdsh --dump-config
```

A `./path` is relative to the invoking directory; if that path is missing, omdsh walks parent directories for the same relative path and fails if nothing exists, so it does not install a broken link.

Check the result in two steps:

1. `--dump-config` lists `greet-plugin` after `@agi-fans/oh-my-dsh` and shows `id: greet`.
2. Restart omdsh — installing or removing a bundle does not hot-reload modules — then run `/greet`, `/greet Ada`, and `/help`. The new command appears under Agent Commands.

### Change the plugin

- With a local path or `link:` install, the Profile already points at that checkout: edit `index.js` or `cordis.patch.yml` and restart omdsh to load the new module.
- With a registry install, run `omdsh plugin update greet-plugin` or add the new version, then restart.

A later version that gains `dsh.bundle.patch` joins the layer list on the next successful `omdsh plugin` run. `omdsh plugin remove greet-plugin` drops both the dependency and the layer. The shipped `@agi-fans/oh-my-dsh` layer is not a Profile dependency and is never removed.

### Publish

- npm: publish the package, then install with `omdsh plugin add greet-plugin`.
- Tarball: ship the `pnpm pack` output, then install with `omdsh plugin add ./greet-plugin-0.1.0.tgz`.
- Git: install with `omdsh plugin add github:<owner>/greet-plugin`. A git-hosted package that builds in `prepare` may need an `allowBuilds` entry in `$OMDSH_HOME/profiles/omdsh/pnpm-workspace.yaml` if pnpm blocks the script.

Import only published package exports, do not reach into `refs/`, and do not assume Host, HTTP, or a Web UI is mounted. [User plugins](../plugins.md) defines which surfaces a bundle can rely on.
