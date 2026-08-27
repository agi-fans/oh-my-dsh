---
description: Switch omdsh models and reasoning effort, add extra providers with /login, and reshape the TUI in /settings.
---

# Tune the working environment

By the end of this walkthrough you can switch models and reasoning effort, sign in extra providers, and reshape the interface through `/settings`.

### Select model and reasoning effort

Run `/model` to open the model selector:

1. When more than one provider is live, choose the provider first.
2. Choose an available model and, when supported, its reasoning effort.

The active choice appears on the first status line and is stored in the durable session state.

### Sign in extra providers

To add another catalog provider, run `/login` and choose it from the list. A provider that registered an authorization flow offers that flow's methods instead of a generic API-key prompt; otherwise paste its API key. The route becomes live on the next model request.

Choose `custom` to add a gateway or local server that is not in the catalog: give it a permanent id, base URL, API protocol, optional key, and one or more model ids. `/logout` can drop that route without touching environment credentials.

### Customize the interface

Run `/settings` to configure the theme, color output, default tool expansion, update checks, startup release notes, and the status line.

Keys inside `/settings`:

- `Up` / `Down` move between rows, and `Left` / `Right` change the current value.
- `Tab` switches between the General and Status line sections.
- On a status item, `Space` shows or hides it.
- `Enter` starts moving a status item: `Up` / `Down` reorder it, `Left` / `Right` change its column, and `Enter` or `Esc` finishes.

The Theme row cycles `dark`, `light`, `midnight`, `solarized`, `catppuccin`, `dracula`, `nord`, `gruvbox`, `rose-pine`, and `mono`. Each status preview item — Model, Effort, Path, Git, and the telemetry groups — has its own color, left or right column, visibility, and order. The composer top border keeps 🐳 on the left and the current Access level on the right.

Run `/help` for the complete command and keyboard-shortcut catalog. The list is assembled from the active plugins, so it also includes capabilities contributed by Skills and other runtime integrations.
