<div align="center">

# oh-my-dsh

**Into the Unknown**

A focused, keyboard-first DeepSeek coding agent built on the plugin architecture of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and inspired by the interaction quality of [oh-my-pi](https://github.com/can1357/oh-my-pi) and the original [Pi](https://github.com/earendil-works/pi) agent harness.

[![CI](https://github.com/agi-fans/oh-my-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/agi-fans/oh-my-dsh/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/%40agi-fans%2Foh-my-dsh?style=flat-square&logo=npm)](https://www.npmjs.com/package/@agi-fans/oh-my-dsh) [![npm downloads](https://img.shields.io/npm/dm/%40agi-fans%2Foh-my-dsh?style=flat-square&logo=npm)](https://www.npmjs.com/package/@agi-fans/oh-my-dsh) [![Node.js ^22.19 or >=24](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat-square&logo=node.js)](https://nodejs.org/) [![MIT License](https://img.shields.io/npm/l/%40agi-fans%2Foh-my-dsh?style=flat-square)](LICENSE)

English · [简体中文](README.zh-CN.md)

</div>

![oh-my-dsh terminal interface](docs/resources/screenshot.webp)

## Quick start

Requirements: Node.js 22.19 or later in the 22.x line, or Node.js 24 or newer, plus a DeepSeek API key for live model turns.

```sh
npm install --global @agi-fans/oh-my-dsh
omdsh
```

Run `/login` once inside omdsh to validate and save your DeepSeek API key, then start a conversation. To try it without a global installation, run `npx @agi-fans/oh-my-dsh`.

## Highlights

- **Durable conversations:** resume sessions, rewind to a human turn, retry, compact, and export complete transcripts as Markdown.
- **Four real session controls:** choose a Harness Agent preset (Standard, PTC, Minimal, or Cordis), Workflow (Default or Plan), tool presentation (Native, Code, or Both), and Access (Read only, Workspace write, or Full access).
- **Rich terminal input:** search project files with `@`, paste clipboard images, reuse persistent prompt history, edit multiline prompts externally, and retrieve queued follow-ups.
- **Readable tool activity:** follow streaming calls and live subagent progress, open a child's transcript from the Agents roster, steer a continuable child from that view, inspect distinct Input and Output sections, expand long results, and keep domain-specific presentation owned by tool plugins.
- **Live operational context:** see Agent, Workflow, Tools, Access, model, reasoning effort, workspace, Git state, context pressure, tokens, TTFT, throughput, cache, timings, turns, and steps without leaving the composer.
- **Responsive by design:** retain settled transcript layout, coalesce scroll updates, emit row-level terminal diffs, and preserve correct display-cell alignment for CJK text and emoji.

## Learn

- [Tutorials](docs/tutorials.md) — complete a first task, add precise context, guide queued work, recover long sessions, customize the environment, and write an installable plugin.
- [Skills and MCP](docs/skills-and-mcp.md) — extend a project with reusable instructions and external tools.
- [User plugins](docs/plugins.md) — install DSH bundles into the omdsh Profile with `omdsh plugin`.
- [Architecture](docs/architecture.md) — understand the plugin boundaries and runtime data flow.
- [Performance](docs/performance.md) — inspect the benchmarks, methodology, and rendering optimizations.

## Why oh-my-dsh

DeepSeek Harness provides a capable agent runtime and a strong architectural idea: everything is a plugin. oh-my-dsh brings that runtime into a calm, keyboard-driven terminal experience without creating a second agent core or hiding Harness behind a parallel abstraction.

The TUI remains a presentation and interaction layer. Sessions, tools, permissions, models, Skills, MCP servers, commands, and telemetry come from Harness services and plugins; omdsh composes them into a terminal application and adds the interface behavior needed to use them comfortably.

The project follows four principles:

- **Harness-native:** use published DeepSeek Harness packages as the source of truth for agent behavior, state, and lifecycle.
- **Real plugin boundaries:** create plugins for independently owned lifecycles and contribution points, not for every source file.
- **One terminal owner:** keep raw input, cursor state, viewport management, and atomic rendering inside the local TUI Provider.
- **Progressive disclosure:** keep the default view concise while making tools, telemetry, settings, and session detail discoverable on demand.

Reference checkouts under `refs/` remain read-only research material. Runtime code depends only on published packages and oh-my-dsh workspace packages.

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

The TUI package is split into a service definition, local terminal Provider, session and interaction adapters, tool-presentation bridge, command contributions, and interactive Runner. This isolates terminal ownership from Harness domain state and exposes plugin seams only where a capability has an independent lifecycle or owner. See the [architecture overview](docs/architecture.md) for the current boundaries and data flow.

## Performance

Performance is part of the TUI architecture: durable sessions replay in linear time, Harness Projections avoid repeated history scans, settled transcript blocks retain formatted layout, and the terminal writer emits row-level diffs. On the documented Apple M5 Pro environment, restoring 10,000 conversation turns takes a median 2.15 ms, 10,000 tool calls take 21.21 ms, and cached updates over a 5,000-turn surface average 0.24 ms per frame.

See the reproducible [TUI performance report](docs/performance.md) or run `pnpm benchmark:tui` locally.

## Configuration

Run `/login` to configure a provider API key. DeepSeek still opens the official key dashboard, validates the key, and prefers the stored credential over an inherited `DEEPSEEK_API_KEY`. The same command can also activate a catalog provider such as OpenAI or Anthropic, or add a custom provider with its own id, base URL, protocol, and model ids. `/model` then lists every live route. `/logout` removes an omdsh-managed choice and, for DeepSeek, falls back to the environment when available.

Model settings can also come from `$DSH_HOME/settings.yaml`. Skills and MCP configuration are documented in [Skills and MCP](docs/skills-and-mcp.md).

After an upgrade, omdsh can show release notes once at startup. Use `/changelog` for recent entries or `/changelog full` for the complete packaged history. A cached daily npm check reports newer versions without installing anything automatically; both behaviors can be customized in `/settings`.

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

The checkouts in `refs/deepseek-harness`, `refs/oh-my-pi`, and `refs/pi` are read-only references. Do not use them as runtime dependencies or modify them while developing omdsh.

## Changelog

User-visible changes and release history are tracked in [CHANGELOG.md](CHANGELOG.md).

## Acknowledgements

oh-my-dsh exists because of these projects:

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides the runtime foundation, plugin architecture, and the conviction that agent capabilities should be composable rather than embedded in one application.
- [Pi](https://github.com/earendil-works/pi) is the original open agent harness whose terminal interaction, differential rendering, and compact coding-agent craft still set the standard this community builds on.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) continues that lineage and shows how thoughtful terminal interaction, compact information design, and careful keyboard workflows can make an agent feel fast and approachable.

Thank you to these projects and their contributors. omdsh is an independent community project: it is built on DeepSeek Harness and learns from Pi and OMP, but is not an official distribution of any of them.

## License

oh-my-dsh is available under the [MIT License](LICENSE).
