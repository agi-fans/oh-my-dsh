# User plugins

[English](plugins.md) | [简体中文](plugins.zh-CN.md)

omdsh extends through DeepSeek Harness plugins that mount in the same Cordis tree as the shipped composition. A user-installed capability is an npm package that declares `dsh.bundle.patch`, joins the omdsh Profile layer list, and starts with the rest of the tree.

This document is the intended support model. The boot path today still reads only the shipped [`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml) plus MCP insert patches. The Profile directory, `omdsh plugin` command, `--dump-config` flag, and `@agi-fans/oh-my-dsh` bundle declaration named below are not shipped until that boot path lands.

Skills and MCP remain separate deployment surfaces; see [Skills and MCP](skills-and-mcp.md). TUI richness comes from Cordis contribution services on top of that install layer, not from a TypeScript extensions folder. Theme, overlay, and keybinding registries stay closed until a second independently owned contributor needs them; see [Architecture](architecture.md) and [TUI contribution layer](#tui-contribution-layer).

## What already works once a plugin is mounted

The TUI does not keep a second command, tool, or model registry. After a plugin is in the tree, these Harness seams already reach the terminal:

| Capability | Seam the plugin uses | What the TUI does |
|---|---|---|
| Slash command | `dsh-commands` metadata and handler | Appears in `/help`, autocomplete, and the runner |
| Tool | `ToolDefinition`, including `presentCall` / `presentResult` | Renders a card, or the generic fallback |
| Model provider | `ctx.llm` routes and settings | Appears in `/model`; `/login` can store a catalog key or a custom profile |
| Credentials and settings | `ctx.credentials` and `ctx.settings` | Shared with `$DSH_HOME` documents the rest of the tree already reads |
| Human prompt | `ctx.tui.prompt`, approval, and questions | Terminal selectors own the answer |
| Skill | Harness skill registry | Appears under `/skill:` |
| MCP server | One `dsh-mcp-client` row per server | Appears in `/mcp` and `/tools` |

A plugin that only needs those seams does not require a TUI presentation adapter.

## Current boot gap

`apps/omdsh/src/boot.ts` calls `boot()` with the shipped composition and [`loadMcpPatches()`](../apps/omdsh/src/mcp-config.ts). User-level `cordis.patch.yml` files, Profile `dsh.profile.bundles` lists, and an `omdsh plugin` installer are not read. The missing piece is that the startup tree never loads those layers, not that the installer lacks a TUI.

Installing a standard DSH bundle with npm therefore has no effect: the package is never resolved into the Loader tree. Writing a provider profile in `settings.yaml` also cannot activate an adapter that the composition never mounted.

`/login` already covers catalog providers and a hand-declared custom route through the shipped, dormant `@deepseek-ai/dsh-llm-pi-ai` adapter. OAuth, refresh-token ownership, and any provider whose adapter is not in the shipped tree still need a user-mounted plugin.

## Target composition

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

1. The shipped `@agi-fans/oh-my-dsh` bundle (today's `cordis.yml`, expressed as an insert over an empty root).
2. Additional names in `dsh.profile.bundles`, in list order.
3. `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`.
4. `$OMDSH_HOME/cordis.patch.yml` (machine-local overrides for every omdsh Profile).
5. Existing MCP insert patches from user and project `mcp.json` files.

A later layer wins per row id. An id-targeted patch replaces the whole `config` object; it does not deep-merge. A patch that names a missing id is a stderr warning, not a silent no-op.

Module resolution stays two-anchored, using the published `dsh-app-boot` helpers. `@deepseek-ai/*` and `@agi-fans/dsh-tui` resolve from the omdsh installation first through `healProfilesModuleFallback`. User bundles resolve from the Profile `node_modules`. A patch that inserts a package Node cannot resolve fails loud at boot.

omdsh implements `omdsh plugin` against those same published APIs. It does not require the official `dsh` CLI to be installed, and it does not reimplement install directories, version solving, or layer order.

omdsh does not load TypeScript files from an extensions directory. That path is a different product model and would invent a second plugin manager beside Cordis.

## TUI contribution layer

Pi's ecosystem is rich because one extension can register tools, commands, providers, renderers, shortcuts, and modal UI from a single TypeScript file. omdsh wants that diversity of *capability*, not that loader. Every equivalent lands as a Cordis plugin that injects a Harness or TUI service.

| Pi extension point | What it is for | omdsh home |
|---|---|---|
| `registerCommand` + argument completions | Zero-UI `/name` catalog | `dsh-commands` metadata and handlers (already live once mounted) |
| `registerTool` + `tool_call` block/modify | Extra LLM tools and permission gates | Harness tools plus the shipped approval / permission plugins. Do not add a second intercept bus |
| `presentCall` / `presentResult` and typed card presenters | Tool cards with a distinct look | Prefer the ToolDefinition fields; register a presenter on `ctx.tui.contributions` only when those fields are not enough |
| `ctx.ui.select` / `confirm` / `input` / `notify` | Wizards and toasts | `ctx.tui.prompt`, `notice`, `commandOutput` |
| `setStatus(key, text)` | One durable footer cell per plugin | Append-only status segments that read Harness projections |
| `registerMessageRenderer` / entry renderers / Markdown transformers | Non-tool transcript chrome | Later. Unknown session events stay out of the transcript |
| `setWidget` above or below the editor | Persistent light panels | Later. Needs a reserved layout slot the composer does not yet expose |
| `ctx.ui.custom` / overlay | Modal or full-screen plugin UI | Later. Pure view/action descriptions through `ctx.tui.prompt` only |
| Theme JSON + `setTheme` | Lowest-cost visual packs | Later token overlay. Built-in palettes stay product-owned; no Pi/oh-my-pi branding |
| `registerProvider` + OAuth forms | Extra model routes and login | User-mounted LLM / auth bundles on `ctx.llm` and `ctx.tui.prompt` |
| `setEditorComponent` / `addAutocompleteProvider` | Vim mode, custom completions | Closed. Composer ownership stays in the local Provider |
| `onTerminalInput` / full-screen TTY takeover | Games and raw terminal listeners | Never. The local Provider is the only TTY owner |
| `~/.pi/agent/extensions/*.ts` and the `pi` package manifest | Auto-loaded source and a second installer | Never. Install is `omdsh plugin add` of a `dsh.bundle` package |
| Pi packages + `/reload` + project trust | What actually makes an ecosystem large | `omdsh plugin` plus restart. Hot reload of `node_modules` is out of scope. Project trust stays on the existing MCP review path |
| Session and message lifecycle hooks | Reactive plugins that rewrite input, watch turns, or act on tool results | Cordis plugins that inject Harness session and agent services and observe durable `SessionEvent`s. The TUI does not grow a second hook bus |
| Custom agents and roles | Alternate prompts, tools, and personas | Harness Agent presets and Skills. The TUI only lists and switches them through `/agent` and `/skill:` |

Most Pi plugins are reactive, not presentational. They belong on the Harness event and service tree: observe `turn/start`, `turn/end`, and tool results, or contribute an Agent preset. The TUI does not grow parallel lifecycle hooks or a role registry.

`ctx.tui` today is an input and notice channel (`event`, `prompt`, `notice`, `readInput`). Presentational plugins also need a narrow, stable `ctx.tui.contributions` service. Plugins register handles on that service; Cordis disposes those handles with the plugin fiber, so a removed bundle cannot leave a stale renderer. The service is a read-only registry, not a new input path, and it must not touch the TTY.

Contribution records are an extensible discriminated union. The first shipped variants are `card` and `status`. Later `overlay` and `slash` variants must add cases without breaking existing records. Each card presenter declares a presentation kind, a numeric priority, and the registering plugin id. When two presenters claim the same kind, the highest priority wins; equal priority keeps the earlier registrant and boot logs a warning. Treat this registry as a public rendering API from the first version, not a temporary shim: real tools outgrow `presentCall` / `presentResult` often enough that plugins will depend on the presenter contract.

`@agi-fans/dsh-tui` exports the contribution tokens, their TypeScript types, and a small set of presentation primitives (width-safe text, theme color names, card section shapes). It does not export the renderer, editor, or TTY owner.

Most of Pi's first-wave richness is already a Harness seam: commands, tools, approval, prompts, notices, session events, and Agent presets start working as soon as the bundle mounts. The remaining first TUI wave, after user bundles can mount:

1. **Cards.** Prefer `ToolDefinition.presentCall` / `presentResult`. Register a typed card presenter on `ctx.tui.contributions` when those fields cannot express the card. The TUI still owns layout, padding, the generic fallback, and the priority rule above.
2. **Status segments.** Plugins publish projection ids and labels only. Values come from Harness projections, not from counters invented in the plugin. The two-line footer still degrades cache, tokens, and TTFT first, then durations, then turns. Loop already writes process-local footer state; that is the second-owner test in [Architecture](architecture.md).

Later waves, only when a second owner appears:

- overlay slots that accept a pure view and action description, then render through `ctx.tui.prompt` presentation kinds;
- slash chrome that binds `dsh-commands` metadata and handlers, including argument completions, and does not start a second command registry;
- reserved composer-adjacent widget slots;
- theme token overlays that restyle existing slots without shipping a new palette format;
- transcript entry renderers and Markdown transformers for durable, non-LLM chrome.

The local Provider still exclusively owns raw mode, key decoding, cursor placement and visibility, viewport paging, differential writes, and the Ctrl-C / Ctrl-D lifecycle.

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
- Custom session event types. Unknown events stay out of the transcript rather than crashing replay.
- Theme packs or overlay components. Those stay closed until a second independently owned contributor needs them.
- A second tool-call intercept bus. Permission gates stay in the Harness approval plugin so audit is not bypassed.
- Custom session event types in the transcript. That boundary does not loosen.
- Replacing the composer, keybindings, or any other TTY-owned surface.

A version mismatch, missing `dsh.bundle` declaration on a listed bundle, or unresolved package name fails at startup through the existing `boot()` / `assertEntriesActivated` path. The largest remaining risk is a user bundle that brings a second copy of Cordis or an incompatible DSH release: service tokens then split, and a plugin can look active while it cannot inject or dispose correctly. Core `@deepseek-ai/*` and `@agi-fans/dsh-tui` packages stay peers of the shipped release; `omdsh plugin` rejects an incompatible range at install time, and boot fails loud if two copies resolve.

Installing or removing a bundle requires a restart; live HMR of `node_modules` is out of scope. Watching `cordis.patch.yml` can follow later, matching official long-lived DSH surfaces, and is not required for the first land.

## Planned user workflow

```sh
omdsh plugin add @scope/dsh-llm-example
omdsh plugin remove @scope/dsh-llm-example
omdsh --dump-config
```

`omdsh plugin` initializes `$OMDSH_HOME/profiles/omdsh` on first use, runs `pnpm` in that directory, and reconciles `dsh.profile.bundles` against installed packages that declare `dsh.bundle.patch`. Template / product bundles that are not Profile dependencies stay on the list. A plain library dependency is installed but does not become a layer; a later version that gains `dsh.bundle.patch` joins the list on the next successful `omdsh plugin` run.

`--dump-config` prints the composed entry list through `renderConfigDump`, with comments that name each contributing layer. That dump is the supported way to inspect the live composition.

After a successful add, restart omdsh. New LLM routes appear in `/model`. New commands appear in `/help`. Auth that needs a browser or device-code step owns that lifecycle inside its plugin and uses `ctx.tui.prompt` for any terminal question.

## Implementation sequence

1. Assemble the patch list in memory first: apply `$OMDSH_HOME/cordis.patch.yml`, add `omdsh --dump-config`, and keep fail-loud parse errors. This unblocks hand-written patches for packages that are already resolvable and shows the composed tree before Profile directories exist.
2. Express the shipped `cordis.yml` as the `@agi-fans/oh-my-dsh` bundle and boot an empty Profile root in product → user bundles → Profile patch → home patch → MCP order.
3. Run `healProfilesModuleFallback` against the app package and keep `assertEntriesActivated`, so in-box plugins resolve and a broken user layer cannot start a half-mounted tree.
4. Initialize `$OMDSH_HOME/profiles/omdsh` and add `omdsh plugin add` / `remove`, including the peer-range check against the shipped DSH release.
5. Open `ctx.tui.contributions` as a versioned discriminated union with card and status variants, including presenter priority and conflict warnings. Overlay and slash cases bind later through existing `prompt` / `dsh-commands` seams and must not change the shipped record shape.

`apps/omdsh` owns the Profile, installer, dump, and composition. `@agi-fans/dsh-tui` owns `ctx.tui` and `ctx.tui.contributions`. A plugin depends on those services and the published types, not on renderer internals.

## Authoring a bundle

A bundle is an npm package whose `package.json` contains:

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
- [Skills and MCP](skills-and-mcp.md) — filesystem Skills and MCP server documents
- [Issue #1](https://github.com/agi-fans/oh-my-dsh/issues/1) — user request that this model answers
