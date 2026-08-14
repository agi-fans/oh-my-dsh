# omdsh Plugin Architecture Review

## Purpose

This document reviews whether omdsh follows the DeepSeek Harness principle that capabilities are composed as plugins. It records the original pressure points, the ownership decisions, the implemented plugin seams, and the verification contract.

The conclusion is that omdsh retains the Harness architecture at both the application and TUI layers. Session lifecycle, local commands, tool presentation, human interaction, terminal ownership, and the input runner now have explicit Cordis boundaries without mechanically turning every source file into a plugin or npm package.

## Implementation Status

Phases 1–3 were implemented as one behavior-preserving architecture round. `apps/omdsh/config/cordis.yml` now visibly composes the local provider, tool-presentation bridge, session runtime, human-interaction adapter, six command plugins, and thin runner.

- `SessionRuntime` is the deep module for active Agent/session ownership, persistence-backed replacement, model selection, projections, event replay, command routing, and disposal.
- Omdsh commands are grouped by capability and registered through `dsh-commands`; the private command catalog and switch no longer exist.
- Tool cards come from scoped `ToolDefinition.presentCall` and `presentResult` projections, with provider-neutral terminal mappings and a durable generic fallback.
- Approval and user-question binding is mounted independently of the runner.
- The package root exports only the supported provider, definition, and Cordis plugin entry points; terminal implementation modules remain internal.

Phase 4 remains deliberately deferred. Theme, status-segment, overlay, and key-action registries will be added only when independently owned contributors create a concrete need.

## What “Everything Is a Plugin” Means Here

Plugin architecture is not measured by package count or file count. A capability should become a plugin when it has an independently meaningful lifecycle, configuration, dependency set, registration contract, or replacement point.

A good omdsh plugin owns its domain behavior and contributes it through a small interface. The TUI should adapt provider-neutral declarations into terminal interaction rather than rediscovering another plugin's semantics. Pure algorithms such as terminal-width calculation, Markdown formatting, editor movement, frame diffing, and text wrapping should remain internal modules unless they gain multiple real adapters or independent lifecycle requirements.

The intended ownership rule is:

> Tool plugins own tool semantics and presentation intent; command plugins own command behavior; projection plugins own statistics; the TUI provider owns terminal interaction and rendering.

## Current Architecture That Already Fits

The application composition in [`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml) mounts Harness capabilities independently: LLM providers, sessions, persistence, projections, commands, tools, skills, approval, questions, sandboxing, subagents, the TUI provider, and the interactive runner are separate rows in one Cordis tree.

The TUI exposes supported plugin entries with distinct roles:

- `@omdsh/tui` provides the local terminal implementation of the TUI service.
- `@omdsh/tui/session-runtime` owns the active top-level Agent and session lifecycle.
- `@omdsh/tui/tool-presentation` adapts scoped tool-owned presentation intents.
- `@omdsh/tui/human-interaction` adapts approval and user-question services.
- `@omdsh/tui/command-*` groups product commands by capability and contributes them through `dsh-commands`.
- `@omdsh/tui/runner` consumes the TUI and session runtime for the interactive input loop.

The status line consumes session-stats and token-meter projections instead of maintaining an unrelated source of truth. Commands, skills, tools, approval, and questions are discovered from the active Harness scope rather than compiled into the application composition.

The internal rendering pipeline is mostly pure and testable: session events fold into transcript state, transcript state renders into terminal rows, and the line renderer applies a differential frame. Keeping these calculations as internal modules is compatible with the plugin architecture.

## Pre-Migration Architecture Pressure

The following sections describe the conditions that motivated this round. They are retained as the decision record and are no longer descriptions of the current implementation.

### Local Commands Bypass the Harness Command Registry

[`SessionController`](../packages/tui/omdsh-tui/src/session-controller.ts) owns a static `CONTROL_COMMANDS` catalog and a command-name switch for `/new`, `/resume`, `/session`, `/model`, `/retry`, `/steer`, `/queue`, `/dequeue`, `/todo`, `/mcp`, `/attach`, `/search`, and `/export`.

Harness-provided commands use `@deepseek-ai/dsh-commands`, but omdsh-owned commands require editing the controller. They therefore cannot be independently mounted, disabled, configured, replaced, or scoped through the Cordis composition. Command discovery is plugin-aware, while command ownership is only partially plugin-aware.

This is the clearest current violation of the intended model. Omdsh commands should register through `dsh-commands`; the runner should dispatch commands through that registry without a private command path.

### Tool Presentation Knowledge Is Duplicated in the TUI

[`tool-renderers.ts`](../packages/tui/omdsh-tui/src/tool-renderers.ts) classifies tools by exact name and reparses arguments for bash, file, search, and workflow tools. This means the TUI must know which argument contains a command, path, working directory, query, or file range.

The published `@deepseek-ai/dsh-tools` interface already lets each `ToolDefinition` declare provider-neutral `presentCall` and `presentResult` projections. These projections describe terminal, diff, read, search, web, and generic presentation without coupling the tool to a particular client.

Omdsh should resolve the active agent's tool definition and render its presentation intent. The generic fallback should handle tools without a presenter. Adding a new tool should not require adding its name to omdsh.

### LocalTui Owns Too Many Product Behaviors

[`LocalTui`](../packages/tui/omdsh-tui/src/provider-local.ts) is correctly the sole owner of the terminal, raw mode, cursor, viewport, and atomic screen frame. It also owns editor state, history, completion, search, settings, copy selection, clipboard access, themes, keybindings, external editing, command catalogs, tool-renderer registration, session metadata, and status projections.

The screen must remain under one provider because multiple plugins writing directly to the terminal would corrupt cursor state and frame coherence. The problem is therefore not that `LocalTui` is the sole renderer; the problem is that new capabilities currently enter it through more fields, key branches, and special cases rather than through declarative contributions.

The local provider should remain a deep module that arbitrates terminal state. Features that vary independently should contribute commands, prompts, presentation intents, or view models instead of owning terminal output.

### The TUI Service Interface Carries Several Responsibilities

[`TuiService`](../packages/tui/omdsh-tui/src/definition.ts) currently combines streamed event presentation, status and catalog synchronization, tool-renderer registration, notices, modal prompts, line input, interruption, session replacement, and disposal.

This interface is workable for one provider and one runner, but callers must coordinate several setters to produce one consistent screen state. During refactoring, prefer one coherent session/view update over adding more `setX` methods. Split the interface only when separate consumers or adapters create a real seam; do not introduce ports merely for hypothetical future providers.

### The Package Root Exposes Internal Implementation

[`src/index.ts`](../packages/tui/omdsh-tui/src/index.ts) re-exports almost every internal module, including width calculations, editor internals, clipboard helpers, overlay states, renderers, controllers, and provider implementation. No project-owned external consumer currently needs this complete surface.

Tests may continue importing internal modules by relative path. The package's public exports should be narrowed to supported service definitions and plugin entries so internal refactors do not become breaking interface changes.

## What Should Not Become a Runtime Plugin

The following areas should remain internal modules unless a real independently configurable adapter appears:

- ANSI parsing, display-cell width, CJK and emoji handling.
- Markdown parsing and terminal formatting.
- The input editor's cursor and text operations.
- Differential frame rendering and viewport slicing.
- Pure theme color projection.
- Pure prompt, settings, history-search, and copy-selector state transitions.
- Formatting helpers for status values and transcript export.

Splitting these into Cordis plugins would add shallow interfaces and ordering constraints without allowing meaningful composition. They should instead sit behind the local terminal provider's small external interface and be tested directly or through the provider seam.

## Target Plugin Shape

The first migration can keep one npm package and expose multiple Cordis plugin subpaths. Package separation is justified later only when a capability needs independent reuse, dependencies, release cadence, or ownership.

```text
@omdsh/tui/definition
└── TuiService interface and provider-neutral view vocabulary

@omdsh/tui/provider-local
├── terminal ownership, raw input, viewport, cursor, and atomic rendering
└── consumes provider-neutral view state and prompt requests

@omdsh/tui/session-runtime
├── active Agent/session lifecycle
├── create, resume, switch, send, steer, retry, and queue operations
└── publishes a small session-control interface

@omdsh/tui/runner
├── reads submitted input
├── dispatches slash commands through dsh-commands
└── sends ordinary messages through session-runtime

@omdsh/tui/human-interaction
├── approval provider adapter
└── user-question provider adapter

@omdsh/tui/tool-presentation
├── resolves ToolDefinition.presentCall/presentResult for the active scope
└── maps DSH render intents into terminal cards with a generic fallback

@omdsh/tui/command-session
├── new, resume, session, and retry
└── registers through dsh-commands

@omdsh/tui/command-queue
├── steer, queue, and dequeue
└── registers through dsh-commands

@omdsh/tui/command-model
└── model selection and reasoning effort

@omdsh/tui/command-transcript
├── search
└── export

@omdsh/tui/command-attachment
└── attach

@omdsh/tui/command-integrations
├── mcp catalog
└── other integration discovery commands
```

This shape keeps the terminal provider authoritative while making product capabilities visible in `cordis.yml`. An application profile can then include or omit transcript export, attachments, MCP discovery, or model switching without editing the TUI provider or runner.

## Proposed Interface Responsibilities

### TUI Definition

The TUI definition should contain provider-neutral types and the smallest interface needed by runners, commands, and human-interaction adapters. It should not expose ANSI helpers, `LocalTui`, concrete overlay states, or tool-name-specific renderers.

Prefer coherent inputs such as a session view snapshot or a tagged view update over a growing collection of independent setters. Prompt selection and submitted user actions remain legitimate interactions because both a local terminal and a future remote provider need them.

### Session Runtime

The session runtime should become the deep module around active agent ownership. It should hide Agent creation, model-selection refs, persistence lookup, recent-session refresh, projection snapshots, listener disposal, and active-session replacement.

Command plugins should call this runtime rather than reaching into `Agent`, persistence, projection, and TUI internals independently. This preserves locality: session-switch correctness remains in one implementation while command registration becomes composable.

### Command Plugins

Command plugins should register metadata and handlers with `dsh-commands`. Group commands by coherent capability and dependency set instead of creating one npm package per command. The command registry should remain the single path for discovery, execution lifecycle events, cancellation, scope shadowing, and result rendering.

### Tool Presentation Bridge

The bridge should use `ctx.tools.get(name, activeAgent)` to resolve the definition visible to the exact agent scope. Pending calls should use `presentCall`; completed calls should use `presentResult` with durable content, error state, and presentation metadata. The TUI should switch on provider-neutral card kinds rather than tool names.

The existing exact-name `TuiToolRenderer` registry should be removed once the Harness bridge covers built-in and third-party tools. A generic raw-argument/raw-result card remains the compatibility fallback.

## Implemented Migration

### Phase 1: Restore Ownership Without Changing UX — Complete

1. Introduce a `session-runtime` service around the active-session portion of `SessionController`.
2. Keep the current runner behavior but route ordinary messages and session state through that service.
3. Register omdsh control commands with `dsh-commands`, grouped by session, queue, model, transcript, attachment, and integration capabilities.
4. Remove the private `CONTROL_COMMANDS` dispatch path after every command is registered through Harness.
5. Mount the command plugins explicitly in `apps/omdsh/config/cordis.yml`.

This phase should preserve command names, output text, prompt interactions, resume behavior, and session logs.

### Phase 2: Adopt Tool-Owned Presentation — Complete

1. Add a bridge from active-session tool events to `ToolDefinition.presentCall` and `presentResult`.
2. Implement terminal mappings for the published generic, terminal, diff, search, read, and web card intents.
3. Preserve generic rendering for missing or failing presenters.
4. Remove hard-coded tool-name classifications and the public renderer-registration method.
5. Add replay tests proving the same durable events produce the same cards after resume.

### Phase 3: Reduce and Stabilize the Public Interface — Complete

1. Narrow package exports to the TUI definition and supported Cordis plugin subpaths.
2. Replace multiple catalog/status setters with coherent view updates where doing so simplifies caller ordering.
3. Move human approval/question binding into its own mounted adapter plugin.
4. Keep renderer, editor, overlay, theme, Markdown, and width modules internal.

### Phase 4: Add Contribution Seams Only When Needed

Theme registries, status-segment registries, overlay registries, and key-action plugins should be introduced only when at least two independently owned contributors need the seam. Until then, configuration and internal modules are simpler and deeper than speculative plugin interfaces.

## Verification Expectations

The refactor should be performed as behavior-preserving slices. Each slice should test the interface that callers use rather than private controller state.

- Command tests should mount the command registry and assert discovery, execution, cancellation, and result events.
- Session-runtime tests should exercise create, resume, switch, message queueing, projection updates, and disposal through its public interface.
- Tool-presentation tests should use tool definitions with `presentCall` and `presentResult`, including generic fallback and replay from durable metadata.
- Provider tests should continue covering terminal-cell width, CJK and emoji layout, long commands, viewport scrolling, cursor placement, prompts, Ctrl-C, and Ctrl-D.
- The application smoke tests should prove that plugin composition still boots from published npm packages with no dependency on `refs/`.

## Decision Summary

Omdsh should preserve the Harness plugin philosophy more strongly inside its TUI layer. The target is not a proliferation of packages; it is correct ownership at real seams.

The highest-priority changes are to move local commands into `dsh-commands`, introduce a deep session runtime that those plugins can consume, and replace tool-name-specific TUI renderers with Harness tool presentation intents. `LocalTui` should remain the single terminal owner, while pure rendering and input algorithms remain internal modules behind that provider.
