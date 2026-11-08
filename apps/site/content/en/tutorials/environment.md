---
description: Switch omdsh models and reasoning effort, add extra providers, and set UI and response languages and TUI preferences.
---

# Tune the working environment

By the end of this walkthrough you can switch models and reasoning effort, sign in extra providers, choose UI and response languages, and reshape the interface through `/settings`.

### Set languages and customize the interface

Run `/settings`. `Tab` and `Shift+Tab` switch between General, Models, Agent presets, Plugins, and Terminal. Advanced appears when plugins expose additional fields. Use arrows to select and change values, `Enter` to open a configuration form, and typing or `/` to search across categories. Forms show their scope and pending changes. Apply saves a draft; Cancel discards unapplied changes. Full options and persistence rules are in [Settings](../settings.md).

General separates **UI language** from **Response language**. UI Auto follows the environment locale. Response language offers Follow UI, Auto, Simplified Chinese, and English. New profiles default to Follow UI, resolved when the next turn starts. Existing profiles retain their saved preference, and Auto adds no language instruction. Explicit language requests in the task take precedence. Code, commands, logs, and file contents retain their original form.

In Terminal, Theme offers `dark`, `light`, and `system`. The palettes adapt Catppuccin Mocha and Latte; System follows reported terminal colors. Motion `full` smooths streamed text and animates activity, `reduced` keeps smooth text with quieter activity, and `off` follows provider chunks directly. Settled messages and tool boundaries flush the complete visible text.

**Terminal → Status line** controls density and item visibility. `minimal` shows occupancy, `standard` adds latency, and `verbose` adds token and session totals when space permits. `Space` shows or hides a selected item. Model and workspace information occupy fixed sides, and telemetry keeps a stable order as the terminal narrows. Status labels stay English across UI languages.

Run `/help` to search available commands, or `/help full` for the current keyboard shortcuts.

### Select model and reasoning effort

Run `/model` to browse models from all active providers in one searchable list. Catalogs load independently, so available models appear while other providers are still loading. Use `Alt+R` to refresh after a provider error, `Alt+F` to toggle a favorite, and `Alt+A` to switch between all models and favorites.

Press `Enter` to select a model and save it as the default, or `Ctrl+D` for **This session only**. The selected model supplies its default reasoning effort. Use `/model reasoning` or `Shift+Tab` to change effort explicitly; `Ctrl+T` shows or hides thinking. The current model and effort appear in the footer and persist with the session.

If the live switch succeeds but saving the default fails, choose **Retry saving default** or **Keep for this session**.

### Sign in extra providers

DeepSeek itself is the first entry: `/login` can start a DeepSeek account browser sign-in (through a loopback callback) or store an API key. The account route appears in `/model`; `/logout` can sign out either the account grant or the file-stored key.

To add another catalog provider, run `/login` and choose it from the list. A provider that registered an authorization flow offers that flow's methods instead of a generic API-key prompt; otherwise paste its API key. The route becomes live on the next model request.

Choose `custom` to add a gateway or local server outside the catalog. Supply a permanent ID, base URL, API protocol, optional key, and one or more model IDs. Later, open **Settings → Models → Connection settings → Endpoints and model lists** to edit or delete a custom provider. `/logout` manages stored authentication.

### Diagnose the local installation

Run diagnostics from your normal workspace:

```sh
omdsh doctor
omdsh doctor --json
```

Doctor reads the launch environment, Profile, bundle patches, plugin entry files and DSH peer requirements, Shell executable, MCP/LSP configuration and executables, and credential document metadata. It does not initialize or rewrite a Profile, execute config expressions, import configured plugins, start servers, send terminal probes or make model requests. A missing Profile reports shipped defaults; rejected layers leave explicit incomplete-coverage notices. Credential values and raw parser errors are omitted.

Each check reports `ok` for its stated local fact, `failed` for a detected problem, `not-configured` for an absent optional configuration, or `not-checked` when runtime verification is still needed. Valid configuration and an available executable do not prove authentication or connectivity. Dynamic credential locations require runtime resolution; the default store is inspected separately. Fix failed checks using their guidance, then verify the selected model in `/model` or `/login` and integrations through their normal runtime.

JSON uses `schemaVersion: 1`, `version` and a `checks` array whose entries contain `id`, `status`, `summary` and an optional `remedy`. Exit code `0` means no failed checks, including reports with unchecked capabilities; `1` means a check failed; `2` means invalid CLI arguments. Neither format includes ANSI styling.

### Next

Next, [give the agent precise context](precise-context.md) with files, screenshots, and a clear request.
