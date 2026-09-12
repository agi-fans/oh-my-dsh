---
description: "The contracts behind omdsh plugins: the ctx.tui surface, the planned contribution registry, and ownership boundaries."
---

# Plugin internals

This page covers the parts of the plugin model that are contracts for plugin authors and TUI developers rather than steps for installing or publishing a bundle. Start with [User plugins](plugins.md) for the install path and the compatibility boundary.

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
| `registerProvider` + OAuth forms | Extra model routes and login | User-mounted LLM bundles on `ctx.llm` plus `ctx.authorization` flows; the TUI supplies `AuthorizationInteraction` |
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

The product's Agent language setting is projected through the system-prompt section registry. A custom persona declared with `complete: true` suppresses ordinary sections by design, so it must append `{{omdsh_agent_behavior}}` to its own persona text if it wants to honor Language. The variable resolves to an empty string for `Auto`; omitting it is safe but leaves Language ineffective for that complete persona.

Once `ctx.tui.contributions` ships, `@agi-fans/dsh-tui` will export the contribution tokens, their TypeScript types, and a small set of presentation primitives (width-safe text, theme color names, card section shapes); those primitives are required so a plugin card cannot blow out layout. None of that is exported today — the package currently publishes only `definition.ts` and the provider entry point, and the width and theme helpers stay private implementation modules. It does not export the renderer, editor, or TTY owner. The registry is never a second input path: `readInput` stays single-consumer, and `onInterrupt` / `onQueueEdit` / `onRewind` / `onInspect*` stay host-private. Plugins ask humans only through `prompt()`.

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

## Ownership

`apps/omdsh` owns the Profile, installer, dump, and composition. `@agi-fans/dsh-tui` owns `ctx.tui`. A plugin depends on those services and the published types, not on renderer internals.

`ctx.tui.contributions` is not shipped. After a real external bundle needs presentational slots that `presentCall` / `presentResult` and `ctx.tui.prompt` cannot express, freeze `status` and, if needed, `card` in the stable package exports.

## Related

- [User plugins](plugins.md) — install, compatibility, and authoring
- [Architecture](architecture.md) — product composition and TUI ownership
