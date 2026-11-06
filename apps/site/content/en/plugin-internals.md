---
description: Published plugin interfaces, TUI interaction ownership, response-language integration, and the conditions for adding presentation APIs.
---

# Plugin internals

Plugin authors extend the running Cordis tree through published Harness services. Start with [User plugins](plugins.md) for installation and [Write a plugin](tutorials/write-a-plugin.md) for an executable example.

## Available extension points

| Capability | Interface | Terminal behavior |
|---|---|---|
| Slash commands | `dsh-commands` metadata, handlers and completion | Commands appear in Help, completion and the runner. |
| Tools | Harness tool registration and `ToolDefinition.presentCall` / `presentResult` | The TUI renders provider-declared content with its own padding, wrapping and generic fallback. |
| Models and authorization | `ctx.llm` and registered `ctx.authorization` flows | Models appear in the picker, and `/login` presents the flow’s notices and prompts. |
| Settings and credentials | `ctx.settings` and `ctx.credentials` | Schema-declared live settings can appear in Advanced, subject to automatic-form policy. Secret values use the credential service. |
| Questions and notices | `ctx.tui.prompt`, `notice` and `commandOutput` | The local provider owns focus, cancellation, readable results and return to the composer. |
| Session behavior | Harness Agent/session services and durable events | Plugins observe lifecycle and contribute behavior within their Cordis scope. |
| Personas and skills | Agent presets and the Harness skill registry | `/agent` selects a preset before model history exists, and `/<skill-name>` invokes a skill. |

Declare required services in the plugin’s `inject` list and register effects through its Cordis context so unloading releases them. Use the installed package’s exports and types as the contract. The [TUI manifest](https://github.com/agi-fans/oh-my-dsh/blob/main/packages/tui/omdsh-tui/package.json) lists the shipped provider, service definition, runtime and command entry points.

## Terminal ownership

The local provider owns raw mode, decoded input routing, cursor state, viewport layout, mouse selection and terminal writes. The runner is the single consumer of `readInput`. Plugin questions use `prompt()` and the request’s cancellation signal. Human approvals have priority over ordinary browsing.

The product owns the composer, status footer, theme palettes, transcript layout and Settings categories. Plugins contribute tool presentation intent through `presentCall` and `presentResult`. Advanced exposes eligible live schema fields, while specialized forms use the owning command and prompt service. The fixed footer formats Harness projections and degrades lower-priority metrics as width shrinks.

Custom presentation registries remain a design possibility. `ctx.tui.contributions`, custom component factories and theme-pack registration have no published API. Introducing one requires independently owned consumers whose needs exceed the existing tool and prompt contracts. Its lifecycle, compatibility, cancellation, focus restoration and width behavior must be specified and verified before public export. Existing implementation modules remain internal unless the package export map explicitly exposes them.

Durable events must satisfy the published session schema. Readers can skip an unknown event only when it is explicitly ignorable and safe to omit. A visual extension therefore needs a durable replay contract before it can add new conversation facts. Permission decisions continue through Harness authorization and audit.

## Response language and complete personas

The product’s **Response language** setting contributes a system-prompt section. Follow UI resolves the interface language at the next turn; Auto contributes an empty fragment. A custom persona with `complete: true` must append `{{omdsh_agent_behavior}}` to honor the preference because complete personas suppress ordinary sections. The owning plugin and turn snapshot contract are documented in the [Agent behavior design](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/design/agent-behavior.md).

## Composition and lifecycle

`apps/omdsh` owns Profile loading, installation and application composition. The TUI package owns terminal presentation and interaction. User bundles share the published Harness services and must declare compatible peers to preserve service identity. CLI package operations require a restart. Runtime plugin operations report whether they applied live or require a restart, while existing Agent compositions retain their revision.

Any future presentation seam must preserve display-cell layout, ANSI handling, CJK and emoji width, composer drafts, attachment order, cancellation and terminal restoration. Verification includes exceptions, unload, resize and nested human prompts. Source lookup and existing tests are described in [Architecture](architecture.md).

## Related

- [User plugins](plugins.md) — installation and compatibility
- [Write a plugin](tutorials/write-a-plugin.md) — a runnable bundle
- [Architecture](architecture.md) — package and runtime ownership
