# User plugins

[English](plugins.md) | [简体中文](plugins.zh-CN.md)

omdsh extends through DeepSeek Harness plugins that mount in the same Cordis tree as the shipped composition. A user-installed capability is an npm package that declares `dsh.bundle.patch`, joins the omdsh Profile layer list, and starts with the rest of the tree.

Boot applies the shipped [`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml) as the `@agi-fans/oh-my-dsh` product bundle, then user bundles from `$OMDSH_HOME/profiles/omdsh`, the Profile `cordis.patch.yml`, `$OMDSH_HOME/cordis.patch.yml`, and MCP insert patches. `omdsh plugin add` and `omdsh plugin remove` install those user bundles. `omdsh --dump-config` prints the composed tree.

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

## Current boot

`apps/omdsh/src/boot.ts` initializes `$OMDSH_HOME/profiles/omdsh` when that Profile is missing, heals the installation module fallback, and mounts an empty Profile root. Patches apply in product → user bundles → Profile patch → home patch → MCP → shipped agent-preset overlay order. A present patch file that is empty or not a YAML list fails loud. Boot, `omdsh plugin`, and `omdsh --dump-config` share one `loadLayeredEnv` snapshot first, so project and home `.env` files change home lookup and MCP expansion the same way on every path. `--dump-config` prints that composition without starting the TUI.

A package listed in `dsh.profile.bundles` must declare `dsh.bundle.patch` and resolve from the omdsh installation or the Profile `node_modules`. Writing a provider profile in `settings.yaml` still cannot activate an adapter that the composition never mounted.

`/login` already covers catalog providers and a hand-declared custom route through the shipped, dormant `@deepseek-ai/dsh-llm-pi-ai` adapter. OAuth, refresh-token ownership, and any provider whose adapter is not in the shipped tree still need a user-mounted plugin.

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

`ctx.tui.contributions` is not shipped. A registry with no consumer is an API with no users; omdsh also has no `/reload`, so the first public shape has to last. Freeze the TypeScript union and priority rules in types when the first real bundle needs presentational slots that existing seams cannot express.

Contribution records are an extensible discriminated union. The first shipped variants are `status` and, only when a real tool proves `presentCall` / `presentResult` is not enough, typed `card`. There is no TUI command registry and no registrable `/settings` row. Slash commands stay on `dsh-commands`. Plugin preferences stay on `ctx.settings` and are edited through that plugin's own slash command plus `ctx.tui.prompt`. `/settings` remains product-owned: `tuiSettingItems` is coupled to `TuiPrefs`, persistence, validation, tab navigation, and status reorder. If several plugins later repeat the same settings wizard, extract a form-shaped `prompt` seam rather than opening the product settings list. Later `overlay` variants must add cases without breaking existing records. Each card presenter declares a tool or presentation id, a numeric priority, and the registering plugin id. When two presenters claim the same id, the highest priority wins; equal priority keeps the earlier registrant and boot logs a warning. Treat this registry as a public rendering API from the first version, not a temporary shim. Do not add it to `@agi-fans/dsh-tui` stable exports until at least one real user bundle has used the shape.

`@agi-fans/dsh-tui` exports the contribution tokens, their TypeScript types, and a small set of presentation primitives (width-safe text, theme color names, card section shapes). Those primitives are required so a plugin card cannot blow out layout. It does not export the renderer, editor, or TTY owner. The registry is never a second input path: `readInput` stays single-consumer, and `onInterrupt` / `onQueueEdit` / `onRewind` / `onInspect*` stay host-private. Plugins ask humans only through `prompt()`.

Most of Pi's first-wave richness is already a Harness seam: commands, tools, approval, prompts, notices, session events, and Agent presets start working as soon as the bundle mounts. After a real user bundle is mounted:

1. **Status segments.** Plugins publish projection ids and labels only. Values come from Harness projections, not from counters invented in the plugin. The two-line footer still degrades cache, tokens, and TTFT first, then durations, then turns. Loop already writes process-local footer state; that is the second-owner test in [Architecture](architecture.md).
2. **Cards.** Prefer `ToolDefinition.presentCall` / `presentResult`. Register a typed card presenter on `ctx.tui.contributions` only when a real tool proves those fields cannot express the card. The TUI still owns layout, padding, the generic fallback, and the priority rule above.

Later waves, only when a second owner appears:

- more `prompt` presentation kinds as a versioned discriminated union (select, confirm, input, list, and action descriptions), so wizards stay data-in / action-out;
- a reserved `interactive-view` contribution case, then a slim `custom<T>()` that still uses the same exclusive arbitrator as `prompt()`;
- reserved composer-adjacent widget slots that must not move the composer or footer anchors;
- theme token overlays that restyle existing slots without shipping a new palette format.

omdsh does not clone Pi's host `TUI` object, `extensions/*.ts` loader, or `/reload`. It can later clone the ownership split Pi already uses: the plugin returns a Component, and the local Provider still owns raw mode, focus, cursor, viewport, composition, and atomic writes. That is not the same as shipping a second UI framework. A public contribution API stays closed until a real external bundle needs it.

A future Component contract stays narrow: `render(width)` returns width-safe lines, optional `handleInput` receives decoded key events (never raw terminal bytes), plus `invalidate()` and optional `dispose()`. The host normalizes ANSI, clips width, and places the cursor. `custom<T>()` gives the factory only a semantic theme, `requestRender`, `done(result)`, and an `AbortSignal`. It does not pass the renderer, editor, keybinding manager, or TUI instance. The call pauses `readInput`, saves the composer draft, routes focus to the Component, and restores draft, focus, and cursor on settle, cancel, or fiber dispose. The first overlay is a capturing modal with host-interpreted size and anchor options only.

Minimum bricks, if that seam ships: width-safe `Text`, `Spacer`, `Box`, `VStack`, `SelectList`, and a host-backed `Input` that reuses the composer row so CJK IME is not reimplemented. Do not export Markdown, Editor, Renderer, or a general layout engine. Plugin-drawn text fields are rejected. Card presenters may later return a Component; status stays a declarative projection segment. Message and transcript renderers wait on the durable event contract and must not bypass session schema through Component.

Never clone `setFooter` replacement, `setEditorComponent`, `onTerminalInput`, global shortcut hooks, direct TTY control, a second tool or command bus, or extension-directory hot load.

An internal prototype may exist as an unexported experimental path driven by a product-owned plugin, with fake-TTY tests for nesting, abort, dispose, exceptions, resize, ANSI, CJK, emoji, and composer restore. It must not land in `@agi-fans/dsh-tui` stable exports until a real external bundle has used it.

The local Provider still exclusively owns raw mode, key decoding, cursor placement and visibility, viewport paging, differential writes, and the Ctrl-C / Ctrl-D lifecycle. A modal must keep a host reserved-key set (double Ctrl-C, Ctrl-D, Alt shortcuts) and a forced `done()` if the plugin render throws or loops.

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

From an omdsh checkout, [`examples/hello`](../examples/hello) is a complete bundle that registers `/hello`. `./examples/hello` is relative to the invoking directory; if that path is missing, omdsh walks parent directories for the same relative path and fails if nothing exists, so `pnpm --dir apps/omdsh omdsh plugin add ./examples/hello` still installs the checkout example. After a successful add, restart omdsh and run `/hello`; `--dump-config` should list `@agi-fans/omdsh-plugin-hello` after the product layer. A published package uses the same command with its npm or git spec instead of the local path.

`omdsh plugin` initializes `$OMDSH_HOME/profiles/omdsh` on first use, runs `pnpm` in that directory, and reconciles `dsh.profile.bundles` against installed packages that declare `dsh.bundle.patch`. Template / product bundles that are not Profile dependencies stay on the list. A plain library dependency is installed but does not become a layer; a later version that gains `dsh.bundle.patch` joins the list on the next successful `omdsh plugin` run.

`--dump-config` prints the composed entry list through `renderConfigDump`, with comments that name each contributing layer. That dump is the supported way to inspect the live composition.

After a successful add, restart omdsh. New LLM routes appear in `/model`. New commands appear in `/help`. Auth that needs a browser or device-code step owns that lifecycle inside its plugin and uses `ctx.tui.prompt` for any terminal question.

## Ownership

`apps/omdsh` owns the Profile, installer, dump, and composition. `@agi-fans/dsh-tui` owns `ctx.tui`. A plugin depends on those services and the published types, not on renderer internals.

`ctx.tui.contributions` is not shipped. After a real external bundle needs presentational slots that `presentCall` / `presentResult` and `ctx.tui.prompt` cannot express, freeze `status` and, if needed, `card` in the stable package exports.

## Authoring a bundle

Walk through [Write a plugin](tutorials/write-a-plugin.md) to build and install a bundle, or copy [`examples/hello`](../examples/hello). A bundle is an npm package whose `package.json` contains:

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
- [Write a plugin](tutorials/write-a-plugin.md) — write, install, and publish a bundle
- [Issue #1](https://github.com/agi-fans/oh-my-dsh/issues/1) — user request that this model answers
