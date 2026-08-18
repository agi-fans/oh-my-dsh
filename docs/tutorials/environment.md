# Tune the working environment

[English](environment.md) | [简体中文](environment.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Recover and manage a long session](long-session.md) · Next: [Extend a project with Skills and MCP](skills-and-mcp.md)

### Select model and reasoning effort

Run `/model` to open the model selector. When more than one provider is live, omdsh first asks which provider to use, then lets you choose an available model and, when supported, its reasoning effort. The active choice appears on the first status line and is stored in the durable session state.

To add another catalog provider, run `/login`, choose the provider, and paste its API key. The route becomes live on the next model request. Choose `custom` to add a gateway or local server that is not in the catalog: give it a permanent id, base URL, API protocol, optional key, and one or more model ids. `/logout` can drop that route without touching environment credentials.

### Customize the interface

Run `/settings` to configure the theme, color output, default tool expansion, update checks, startup release notes, and the status line. The Theme row cycles `dark`, `light`, `midnight`, `solarized`, `catppuccin`, `dracula`, `nord`, `gruvbox`, `rose-pine`, and `mono`. Each preview item — Model, Effort, Path, Git, and the telemetry groups — has its own color, left or right column, visibility, and order. Use `Up` and `Down` to navigate, `Left` and `Right` to change a value, and `Tab` to switch between General and Status line sections. On a status item, press `Space` to show or hide it, or press `Enter` and then `Up`/`Down` to reorder or `Left`/`Right` to change column; press `Enter` or `Esc` again to finish moving. The composer top border keeps 🐳 on the left and the current Access level on the right.

Run `/help` for the complete command and keyboard-shortcut catalog. The command list is assembled from the active Harness plugins, so it also includes capabilities contributed by Skills and other runtime integrations.

[Tutorials](../tutorials.md) · Previous: [Recover and manage a long session](long-session.md) · Next: [Extend a project with Skills and MCP](skills-and-mcp.md)
