---
description: Install and author DeepSeek Harness plugins for omdsh with omdsh plugin, Profile layers, and the dsh.bundle.patch contract.
---

# User plugins

omdsh extends through DeepSeek Harness plugins that mount in the same Cordis tree as the shipped composition. A user-installed capability is an npm package that declares `dsh.bundle.patch`, joins the omdsh Profile layer list, and starts with the rest of the tree.

Boot applies the shipped [`apps/omdsh/config/cordis.yml`](https://github.com/agi-fans/oh-my-dsh/blob/main/apps/omdsh/config/cordis.yml) as the `@agi-fans/oh-my-dsh` product bundle, then user bundles from `$OMDSH_HOME/profiles/omdsh`, the Profile `cordis.patch.yml`, `$OMDSH_HOME/cordis.patch.yml`, and MCP insert patches. `omdsh plugin add` and `omdsh plugin remove` install those user bundles. `omdsh --dump-config` prints the composed tree.

Skills and MCP remain separate deployment surfaces; see [Skills and MCP](skills-and-mcp.md). TUI richness comes from Cordis contribution services on top of that install layer, not from a TypeScript extensions folder. Theme, overlay, and keybinding registries stay closed until a second independently owned contributor needs them; see [Architecture](architecture.md) and [Plugin internals](plugin-internals.md).

## What already works once a plugin is mounted

The TUI does not keep a second command, tool, or model registry. After a plugin is in the tree, these Harness seams already reach the terminal:

| Capability | Seam the plugin uses | What the TUI does |
|---|---|---|
| Slash command | `dsh-commands` metadata and handler | Appears in `/help`, autocomplete, and the runner |
| Tool | `ToolDefinition`, including `presentCall` / `presentResult` | Renders a card, or the generic fallback |
| Model provider | `ctx.llm` routes and settings | Appears in `/model`; `/login` can store a catalog key, run a registered authorization flow, or add a custom profile |
| Credentials and settings | `ctx.credentials` and `ctx.settings` | Shared with `$DSH_HOME` documents the rest of the tree already reads |
| Human prompt | `ctx.tui.prompt`, approval, and questions | Terminal selectors own the answer |
| Skill | Harness skill registry | Appears under `/skill:` |
| MCP server | One `dsh-mcp-client` row per server | Appears in `/mcp` and `/tools` |

A plugin that only needs those seams does not require a TUI presentation adapter.

## Current boot

`apps/omdsh/src/boot.ts` initializes `$OMDSH_HOME/profiles/omdsh` when that Profile is missing, heals the installation module fallback, and mounts an empty Profile root. Patches apply in product → user bundles → Profile patch → home patch → MCP → shipped agent-preset overlay order. A present patch file that is empty or not a YAML list fails loud. Boot, `omdsh plugin`, and `omdsh --dump-config` share one `loadLayeredEnv` snapshot first, so project and home `.env` files change home lookup and MCP expansion the same way on every path. `--dump-config` prints that composition without starting the TUI.

A package listed in `dsh.profile.bundles` must declare `dsh.bundle.patch` and resolve from the omdsh installation or the Profile `node_modules`. Writing a provider profile in `settings.yaml` still cannot activate an adapter that the composition never mounted.

`/login` already covers catalog providers and a hand-declared custom route through the shipped, dormant `@deepseek-ai/dsh-llm-pi-ai` adapter. When that adapter or another mounted plugin registers a Harness authorization flow, `/login` lists the flow and methods and the TUI renders only the generic notices and prompts. A provider whose adapter is not in the shipped tree still needs a user-mounted plugin.

## Composition

omdsh keeps a product-owned composition. It does not boot official `@deepseek-ai/dsh-base` as the first layer, and it does not become a skin on the official `web` or `headless` profiles. Those layers mount Host, HTTP, and Web UI rows that the TUI composition excludes.

The first layer is the current omdsh composition, published as the `@agi-fans/oh-my-dsh` bundle through a `dsh.bundle.patch` manifest field. User bundles append after that product layer.

```text
$OMDSH_HOME/profiles/omdsh/
  package.json          # dsh.profile.bundles plus user dependencies
  cordis.yml            # empty root []; Loader baseUrl only
  cordis.patch.yml      # optional user row patches
  node_modules/         # user bundles, managed by pnpm
```

The Profile directory uses the same home omdsh already uses for sessions, settings, credentials, and MCP: `$OMDSH_HOME`, else `$DSH_HOME`, else `~/.dsh`. The Profile name is `omdsh`, so it does not collide with official `web` or `headless` profiles that may share `$DSH_HOME`.

Boot applies patches in this order:

1. The shipped `@agi-fans/oh-my-dsh` bundle (the product `cordis.yml`, expressed as an insert over an empty root).
2. Additional names in `dsh.profile.bundles`, in list order.
3. `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`.
4. `$OMDSH_HOME/cordis.patch.yml` (machine-local overrides for every omdsh Profile).
5. Existing MCP insert patches from user and project `mcp.json` files.

A later layer wins per row id. An id-targeted patch replaces the whole `config` object; it does not deep-merge. A patch that names a missing id is skipped silently at boot (the loader logger is not wired to stderr in the TUI host), not an error.

Module resolution stays two-anchored, using the published `dsh-app-boot` helpers. `@deepseek-ai/*` and `@agi-fans/dsh-tui` resolve from the omdsh installation first through `healProfilesModuleFallback`. User bundles resolve from the Profile `node_modules`. A patch that inserts a package Node cannot resolve fails loud at boot.

omdsh implements `omdsh plugin` against those same published APIs. It does not require the official `dsh` CLI to be installed, and it does not reimplement install directories, version solving, or layer order.

omdsh does not load TypeScript files from an extensions directory. That path is a different product model and would invent a second plugin manager beside Cordis.

## Compatibility boundary

Supported without extra TUI work:

- Commands registered through `dsh-commands`.
- Tools, including provider-neutral `presentCall` / `presentResult` cards.
- LLM adapters that register routes on `ctx.llm`.
- Settings and credential plugins that use the shipped stores.
- Auth plugins that collect secrets or choices through `ctx.tui.prompt`, notices, or command output.
- Skills and MCP servers, which keep their existing discovery paths.
- Reactive plugins that observe durable session events or register Agent presets through Harness.

Not promised:

- Official `dsh-client-ui-*` Web UI plugins. omdsh has no web Profile.
- Plugins that take over the TTY, listen to raw terminal bytes, or assume a Host / HTTP surface is mounted.
- Pi's extensions-directory loader, `pi` package manifest, and `/reload` of loose TypeScript files.
- Pi or oh-my-pi branding. The product keeps the DeepSeek identity.
- Pi's "no MCP" stance. omdsh already mounts MCP servers through Harness.
- Custom durable session event types or transcript entries. Persistence rejects an event unknown to a reader unless it carries `ignorable: true` and is safe to skip; omdsh provides no downstream registration or transcript-rendering surface for private event types.
- Theme packs or overlay components. Those stay closed until a second independently owned contributor needs them.
- A second tool-call intercept bus. Permission gates stay in the Harness approval plugin so audit is not bypassed.
- Replacing the composer, keybindings, or any other TTY-owned surface.
- A second slash-command registry, or an unbounded `/settings` row list.
- Passing the host TUI instance, raw terminal bytes, or a plugin-owned assistant transcript renderer. A slim `custom()` Component seam, if it ever ships, stays experimental until a real external bundle has used it.

A version mismatch, missing `dsh.bundle` declaration on a listed bundle, or unresolved package name fails at startup through the existing `boot()` / `assertEntriesActivated` path. The largest remaining risk is a user bundle that brings a second copy of Cordis or an incompatible DSH release: service tokens then split, and a plugin can look active while it cannot inject or dispose correctly. Core `@deepseek-ai/*` and `@agi-fans/dsh-tui` packages stay peers of the shipped release; `omdsh plugin` rejects an incompatible range at install time, and boot fails loud if two copies resolve.

Installing or removing a bundle requires a restart; live HMR of `node_modules` is out of scope. Watching `cordis.patch.yml` is not shipped.

## User workflow

```sh
omdsh plugin add ./examples/hello
omdsh plugin remove @agi-fans/omdsh-plugin-hello
omdsh --dump-config
```

From an omdsh checkout, [`examples/hello`](https://github.com/agi-fans/oh-my-dsh/tree/main/examples/hello) is a complete bundle that registers `/hello`. `./examples/hello` is relative to the invoking directory; if that path is missing, omdsh walks parent directories for the same relative path and fails if nothing exists, so `pnpm --dir apps/omdsh omdsh plugin add ./examples/hello` still installs the checkout example. After a successful add, restart omdsh and run `/hello`; `--dump-config` should list `@agi-fans/omdsh-plugin-hello` after the product layer. A published package uses the same command with its npm or git spec instead of the local path.

`omdsh plugin` initializes `$OMDSH_HOME/profiles/omdsh` on first use, runs `pnpm` in that directory, and reconciles `dsh.profile.bundles` against installed packages that declare `dsh.bundle.patch`. Template / product bundles that are not Profile dependencies stay on the list. A plain library dependency is installed but does not become a layer; a later version that gains `dsh.bundle.patch` joins the list on the next successful `omdsh plugin` run.

`--dump-config` prints the composed entry list through `renderConfigDump`, with comments that name each contributing layer. That dump is the supported way to inspect the live composition.

After a successful add, restart omdsh. New LLM routes appear in `/model`. New commands appear in `/help`. Auth that needs a browser or device-code step owns that lifecycle inside its plugin and uses `ctx.tui.prompt` for any terminal question.

## Authoring a bundle

Walk through [Write a plugin](tutorials/write-a-plugin.md) to build and install a bundle, or copy [`examples/hello`](https://github.com/agi-fans/oh-my-dsh/tree/main/examples/hello). A bundle is an npm package whose `package.json` contains:

```json
{
  "name": "@scope/dsh-example",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

`cordis.patch.yml` is a YAML array of Cordis include patches. The usual form is one `insert` list of plugin rows:

```yaml
- insert:
    - id: example-provider
      name: '@scope/dsh-example'
```

Pin `@deepseek-ai/*` and `@agi-fans/dsh-tui` as peers of the same DSH release omdsh ships. Do not nest a second `cordis` or `dsh-*` copy in the bundle's own dependencies. Import only published package exports. Do not reach into `refs/`. Do not assume Host, HTTP, or a Web UI is present.

Prefer existing seams:

- register commands on `dsh-commands`;
- register tools with presentation intent on the tool definition;
- register LLM routes on `ctx.llm`;
- store secrets through `ctx.credentials`;
- ask the user through `ctx.tui.prompt`.

A plugin that needs a custom transcript block, an overlay, a theme pack, or exclusive TTY ownership is outside the first compatibility set. After `ctx.tui.contributions` ships, register a typed card presenter only when `presentCall` / `presentResult` cannot express the card, and publish status segments as projection ids rather than local counters.

## Related

- [Architecture](architecture.md) — product composition and TUI ownership
- [Plugin internals](plugin-internals.md) — the `ctx.tui` surface and the planned contribution layer
- [Skills and MCP](skills-and-mcp.md) — filesystem Skills and MCP server documents
- [Write a plugin](tutorials/write-a-plugin.md) — write, install, and publish a bundle
