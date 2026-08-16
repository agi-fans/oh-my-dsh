# oh-my-dsh

English | [简体中文](README.zh-CN.md)

**omdsh** is a plugin-first terminal coding agent built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), with an interaction model inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi).

![oh-my-dsh terminal interface](docs/resources/screenshot.png)

## Why oh-my-dsh

DeepSeek Harness provides a capable agent runtime and a strong architectural idea: everything is a plugin. oh-my-dsh brings that runtime into a focused, keyboard-driven terminal experience without creating a second agent core or hiding the Harness behind a parallel abstraction.

The TUI is deliberately a presentation and interaction layer. Sessions, tools, permissions, models, skills, MCP servers, commands, and telemetry continue to come from Harness services and plugins; omdsh composes them into a terminal application and adds the UI behavior needed to use them comfortably.

## Design principles

- **Harness-native.** Use published DeepSeek Harness packages as the source of truth for agent behavior, state, and lifecycle.
- **Everything remains a plugin.** New capabilities belong in Cordis plugins, services, providers, consumers, or app composition instead of a growing monolithic TUI.
- **One owner for each concern.** `@agi-fans/dsh-tui` owns terminal presentation and interaction, while `@agi-fans/oh-my-dsh` owns startup and runtime composition.
- **Terminal-first interaction.** Keep the composer anchored, render incrementally, respect display-cell width, and make common workflows available from the keyboard.
- **Progressive disclosure.** Keep the default view calm and concise while making tool output, telemetry, settings, and session details discoverable on demand.
- **References stay references.** The projects under `refs/` are read-only material for API and UX research; omdsh runtime code depends only on published packages and its own workspace packages.

## What it supports

- Streaming conversations with durable sessions, resume, turn rewind, retry, compact, and Markdown export
- Plugin-owned slash commands, interactive settings, model and reasoning selection, and access modes
- Tool calls, approval and question flows, collapsible output, and live session telemetry
- Project-aware `@` file search, clipboard image paste, prompt history, and visible, editable queued follow-up messages
- Harness skills and MCP servers discovered from project and user configuration
- One-time release summaries, `/changelog`, and a cached, non-blocking npm update notice
- Responsive terminal layout, themes, transcript scrolling, and non-TTY fallback behavior

## Architecture

```text
DeepSeek Harness plugins and services
                │
                ▼
  @agi-fans/dsh-tui — terminal capability seam
                │
                ▼
  @agi-fans/oh-my-dsh — boot and plugin composition
```

The TUI package is split internally into a service definition, a local terminal provider, and an interactive runner. This keeps terminal ownership isolated from event projection and rendering, and leaves room for other providers or consumers without coupling them to the local TTY implementation. See the [architecture overview](docs/architecture.md) and [plugin architecture review](docs/plugin-architecture-review.md) for more detail.

## Performance

Performance is part of the TUI architecture: durable sessions replay in linear time, Harness projections avoid repeated history scans, settled transcript blocks retain their formatted layout, and the terminal writer emits row-level diffs. On the documented Apple M5 Pro environment, restoring 10,000 conversation turns takes a median 2.15 ms, 10,000 tool calls take 21.21 ms, and cached updates over a 5,000-turn surface average 0.24 ms per frame. See the reproducible [TUI performance report](docs/performance.md) and run `pnpm benchmark:tui` locally.

## Installation

Requirements: Node.js 22.19 or newer (Node.js 24 is also supported) and a DeepSeek API key for live model turns.

```sh
npm install --global @agi-fans/oh-my-dsh
omdsh
```

Run `/login` inside omdsh to open the DeepSeek API-key dashboard, paste a key into a masked prompt, validate it, and save it through the Harness credential store. A key chosen interactively takes priority over an inherited `DEEPSEEK_API_KEY` on the next model request and across restarts. Use `/logout` to remove that omdsh-managed choice and fall back to `DEEPSEEK_API_KEY` when one is available. CI and externally managed environments can continue using the environment variable without running `/login`.

You can also run omdsh without installing it globally:

```sh
npx @agi-fans/oh-my-dsh
```

Model settings can also come from `$DSH_HOME/settings.yaml`, while credentials follow the DeepSeek Harness credential resolution flow. Skills and MCP configuration are documented in [Skills and MCP](docs/skills-and-mcp.md).

After an upgrade, omdsh can show the release notes once at startup. Use `/changelog` for recent entries or `/changelog full` for the complete packaged history. A daily, non-blocking npm check reports newer versions without installing anything automatically; both behaviors can be customized or disabled in `/settings`.

## Development

```sh
pnpm install
pnpm omdsh "list files"  # run from source
pnpm typecheck           # check TypeScript
pnpm test                # unit and pipe-mode tests
pnpm build               # build all workspace packages
pnpm smoke               # interactive PTY smoke test
pnpm smoke:happy         # mock-LLM happy path
```

The checkouts in `refs/deepseek-harness` and `refs/oh-my-pi` are read-only references. Do not use them as runtime dependencies or modify them while developing omdsh.

## Changelog

User-visible changes and release history are tracked in [CHANGELOG.md](CHANGELOG.md).

## Acknowledgements

oh-my-dsh exists because of two projects:

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides the runtime foundation, plugin architecture, and the conviction that agent capabilities should be composable rather than embedded in one application.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) demonstrates how thoughtful terminal interaction, compact information design, and careful keyboard workflows can make an agent feel fast and approachable.

Thank you to both projects and their contributors. omdsh is an independent community project: it is built on DeepSeek Harness and learns from OMP, but is not an official distribution of either project.

## License

oh-my-dsh is available under the [MIT License](LICENSE).
