---
description: Switch omdsh models and reasoning effort, add extra providers, and set the Agent language and TUI preferences.
---

# Tune the working environment

By the end of this walkthrough you can switch models and reasoning effort, sign in extra providers, choose the Agent's default language, and reshape the interface through `/settings`.

### Select model and reasoning effort

Run `/model` to open the model selector:

1. When more than one provider is live, choose the provider first.
2. Choose an available model and, when supported, its reasoning effort.

The active choice appears on the first status line and is stored in the durable session state.

### Sign in extra providers

DeepSeek itself is the first entry: `/login` can start a DeepSeek account browser sign-in (through a loopback callback) or store an API key. The account route appears in `/model`; `/logout` can sign out either the account grant or the file-stored key.

To add another catalog provider, run `/login` and choose it from the list. A provider that registered an authorization flow offers that flow's methods instead of a generic API-key prompt; otherwise paste its API key. The route becomes live on the next model request.

Choose `custom` to add a gateway or local server that is not in the catalog: give it a permanent id, base URL, API protocol, optional key, and one or more model ids. `/logout` can drop that route without touching environment credentials.

### Set Agent language and customize the interface

Run `/settings` to configure the Agent's default language, theme, color output, motion, native terminal activity, optional features, update checks, startup release notes, and the status line. Every row, its allowed values, and its default are listed in [Settings](../settings.md).

Keys inside `/settings`:

- `Up` / `Down` move between rows, and `Left` / `Right` change the current value.
- `Tab` and `Shift+Tab` switch between Interface, Agent, Tools, Status line, Integrations, and Advanced.
- On a status item, `Space` shows or hides it.
- `Enter` starts moving a status item: `Up` / `Down` reorder it, `Left` / `Right` change its column, and `Enter` or `Esc` finishes.

The Agent section's Language row cycles `Auto`, `Simplified Chinese`, and `English`. A non-Auto choice becomes the default for reasoning and user-facing communication from the next turn; code, identifiers, commands, tool arguments, logs, quotations, and file contents keep their accurate forms, and an explicit language request for the current task still wins. The preference is user-level, so a resumed session uses the current value rather than a historical snapshot.

The Interface section's Motion row controls presentation only. `full` smoothly reveals streamed assistant text and animates the `Deep Driving` shimmer; `reduced` keeps smooth streaming without the shimmer; `off` follows provider chunks directly and keeps activity marks static. Complete provider output still enters the live session immediately, and a tool boundary or settled assistant message flushes the visible stream without waiting for the animation. Terminal activity is a separate opt-in busy/idle indicator for supported terminal tabs and taskbars. It does not report a completion percentage, and omdsh clears it when work stops or exits.

The Theme row cycles `dark`, `light`, and `system`. Each status preview item — Model, Effort, Path, Git, and the telemetry groups — has its own color, left or right column, visibility, and order. Context defaults to a percentage; Context style also offers an occupancy bar, used/window tokens, and a detailed combination. Every style changes to warning and error colors as pressure rises. Telemetry hides only second-line metrics, preserving the model and workspace row. The composer top border keeps 🐳 on the left and the current Access level on the right; while a turn runs the label yields to that turn's activity, and the bottom border carries the confirmation of the last action.

Run `/help` for the complete command and keyboard-shortcut catalog. The list is assembled from the active plugins, so it also includes capabilities contributed by Skills and other runtime integrations.

### Diagnose the local installation

Run diagnostics from your normal workspace:

```sh
omdsh doctor
omdsh doctor --json
```

Doctor reads the launch environment, Profile, bundle patches, plugin entry files and DSH peer requirements, Shell executable, MCP/LSP configuration and executables, and credential document metadata. It does not initialize or rewrite a Profile, execute config expressions, import configured plugins, start servers, send terminal probes or make model requests. A missing Profile reports shipped defaults; rejected layers leave explicit incomplete-coverage notices. Credential values and raw parser errors are omitted.

Each check reports `ok` for its stated local fact, `failed` for a detected problem, `not-configured` for an absent optional configuration, or `not-checked` when runtime verification is still needed. Valid configuration and an available executable do not prove authentication or connectivity. Dynamic credential locations require runtime resolution; the default store is inspected separately. Fix failed checks using their guidance, then verify the selected model in `/model` or `/auth` and integrations through their normal runtime.

JSON uses `schemaVersion: 1`, `version` and a `checks` array whose entries contain `id`, `status`, `summary` and an optional `remedy`. Exit code `0` means no failed checks, including reports with unchecked capabilities; `1` means a check failed; `2` means invalid CLI arguments. Neither format includes ANSI styling.
