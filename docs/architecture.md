# oh-my-dsh Architecture

oh-my-dsh is a terminal coding agent built by composing published DeepSeek Harness packages. The TUI owns terminal presentation and human interaction; Harness plugins continue to own sessions, models, tools, commands, permissions, skills, MCP integrations, and projections.

## Boundaries

- **Runtime:** `@deepseek-ai/*` packages are installed from npm at pinned versions and consumed through their published exports.
- **Product:** `apps/omdsh` owns the CLI and runtime composition; `packages/tui/omdsh-tui` owns the reusable terminal plugin suite.
- **References:** `refs/deepseek-harness` and `refs/oh-my-pi` are read-only sources of architecture and interaction ideas. They never enter dependency resolution, builds, tests, or runtime execution.

The product deliberately avoids a second agent core. It adapts Harness capabilities to a local terminal without reimplementing their domain state.

## Package layout

```text
apps/omdsh/                         @agi-fans/oh-my-dsh
├── src/bin.ts                      CLI entry and argument handling
├── src/boot.ts                     Harness tree boot
└── config/cordis.yml               application composition

packages/tui/omdsh-tui/            @agi-fans/dsh-tui
├── src/definition.ts               provider-neutral TUI service
├── src/provider-local.ts           terminal provider and TTY owner
├── src/session-runtime.ts          active agent and session lifecycle
├── src/human-interaction.ts        approval and question adapter
├── src/tool-presentation.ts        Harness presentation-intent bridge
├── src/command-*.ts                command contribution plugins
├── src/startup-notices.ts          release and update notices
├── src/runner.ts                   interactive input loop
└── src/index.ts                    local provider plugin entry
```

The TUI package exposes several Cordis entry points from one npm package because they share dependencies and a release cadence. A new npm package is justified only when a capability gains independent reuse, ownership, dependencies, or versioning.

## Plugin ownership

“Everything is a plugin” describes ownership rather than file count. A capability becomes a plugin when it has an independent lifecycle, configuration, dependency set, registration contract, scope, or replacement point.

- The local provider alone owns raw mode, key decoding, cursor placement, viewport state, and atomic terminal writes.
- `session-runtime` owns Agent creation, durable session creation and recovery, active-session replacement, model selection, projections, and cleanup.
- Command plugins register metadata and handlers through `dsh-commands`; the runner does not maintain a second command registry.
- Tool plugins own semantics and provider-neutral presentation intent. The TUI maps `ToolDefinition.presentCall` and `presentResult` into terminal cards and retains a generic fallback.
- Harness projection plugins own token, context, timing, title, and session statistics. The status line only formats their output.
- The human-interaction adapter connects approval and question services to terminal selectors without moving those domains into the provider.

Pure algorithms remain internal modules: ANSI parsing, display-cell width, Markdown formatting, editor movement, path matching, theme projection, frame diffing, viewport slicing, and overlay state transitions. They should not become runtime plugins until a second independently owned adapter creates a real seam.

## Runtime composition

[`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml) is the authoritative application profile. It composes:

- Cordis loader and timer infrastructure;
- the DeepSeek LLM adapter, settings, credentials, default model, and Agent runtime;
- durable JSONL sessions, checkpointing, query, title, statistics, and token projections;
- local attachment, filesystem, subprocess, bash, sandbox, and permission providers;
- Harness commands, compaction, todo, goal, plan, approval, questions, and subagents;
- filesystem skill discovery and project/user MCP server adapters;
- the local TUI provider, tool-presentation bridge, session runtime, human-interaction adapter, command contributions, startup notices, and runner.

Skills and MCP deployment details live in [`skills-and-mcp.md`](skills-and-mcp.md).

## Data and interaction flow

```text
terminal input
  → local TUI provider
  → runner or command registry
  → session runtime / Harness capability
  → durable session events and projections
  → provider-neutral transcript and status views
  → differential terminal renderer
```

Ordinary messages enter the active Agent through `session-runtime`. Slash commands execute through the scoped Harness registry. Session events are the durable source for transcript replay; projection services provide derived status rather than TUI-owned counters. Tool calls and results settle into one card with distinct Input and Output sections.

## Terminal guarantees

- Layout uses terminal display cells, including ANSI sequences, CJK text, emoji, combining characters, and long unbroken content.
- The composer and two-line status footer stay anchored at the bottom while the transcript viewport scrolls independently.
- Settled transcript layouts are cached, wheel updates are coalesced, and the renderer emits row-level differences instead of repainting the complete screen.
- Modal selectors own input and cursor visibility until they settle, then restore the composer.
- The first Ctrl-C clears or interrupts; a second Ctrl-C exits. Ctrl-D exits directly, and a durable session produces an `omdsh --resume <session-id>` hint.
- Pipe mode uses the same command and session semantics without claiming ownership of an interactive screen.

## Public surface

The supported package exports are the provider, service definition, session runtime, human-interaction adapter, tool-presentation bridge, command groups, startup notices, and runner. Renderer, editor, Markdown, width, overlay, clipboard, and selector modules remain implementation details even when tests import them by relative path.

New contribution registries for themes, status segments, overlays, or key actions should be introduced only when at least two independently owned contributors require them. Configuration and internal state machines are preferable to speculative public seams.

## Verification

- Pure rendering tests cover width, ANSI, CJK, emoji, borders, Markdown, tool cards, viewport behavior, and cursor targets.
- Runtime tests cover command registration, session creation and recovery, queueing, projections, model and permission selection, human interaction, and disposal.
- `pnpm smoke:happy` boots the complete composition against the published Harness mock LLM path.
- `pnpm smoke` exercises the built command through a real PTY for raw input, rendering, interruption, and exit behavior.
- Dependency-boundary checks require published npm packages, clean reference submodules, and no links or aliases into `refs/`.

The exact commands required for a change are defined in [`AGENTS.md`](../AGENTS.md).
