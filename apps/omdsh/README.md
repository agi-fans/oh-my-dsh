<!-- Generated from the repository README by scripts/sync-package-readme.mjs. -->

<div align="center">

# oh-my-dsh

**Into the Unknown**

oh-my-dsh is a terminal coding agent built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Launched as `omdsh`, it focuses on clear visual hierarchy, smooth keyboard-and-mouse controls, and reliable long-session workflows.

[![CI](https://github.com/agi-fans/oh-my-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/agi-fans/oh-my-dsh/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/%40agi-fans%2Foh-my-dsh?style=flat-square&logo=npm)](https://www.npmjs.com/package/@agi-fans/oh-my-dsh) [![npm downloads](https://img.shields.io/npm/dm/%40agi-fans%2Foh-my-dsh?style=flat-square&logo=npm)](https://www.npmjs.com/package/@agi-fans/oh-my-dsh) [![Node.js ^22.19 or >=24](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat-square&logo=node.js)](https://nodejs.org/) [![MIT License](https://img.shields.io/npm/l/%40agi-fans%2Foh-my-dsh?style=flat-square)](https://github.com/agi-fans/oh-my-dsh/blob/main/LICENSE)

[Documentation](https://omdsh.agi.fans/) · English · [简体中文](https://github.com/agi-fans/oh-my-dsh/blob/main/README.zh-CN.md)

</div>

https://github.com/user-attachments/assets/bedf83db-df50-43e4-a786-61ad42cf5a7d

A 72-second walkthrough (captured with v0.29.2) showcases omdsh across DeepSeek Harness agent presets (`Standard`, `PTC`, `Minimal`, `Creator`), live `/model`, `/settings` (all six sections with instant Catppuccin Dark and Light switching), `/plugins` bundles, `/mcp` servers, daily terminal craft (`!shell`, `@` mentions, `/btw`, `/diff`, clickable `#L` file previews), and autonomy workflows (`/permission` Auto review, `/team`, `/trajectory`, session branches, and `Alt+R` file recovery).

## Quick start

Requirements: Node.js 22.19+ (22.x) or Node.js 24+, plus a DeepSeek account or API key.

```sh
npm install --global @agi-fans/oh-my-dsh
omdsh
```

Inside omdsh, run `/login` to sign in with a DeepSeek account or save an API key, then run `/model` to pick your model (account users choose a model under `deepseek-account`). You can also try `npx @agi-fans/oh-my-dsh` without a global install. Follow the [quick-start tutorial](https://omdsh.agi.fans/docs/tutorials/first-task/) to complete your first code edit and diff review in a few minutes.

## Highlights

- **Clear process, easy diff review.** Thinking and tool calls start compact and fold into a duration summary when finished, keeping answers and errors visible. Review edits side by side in `/diff`, quote lines straight back into your prompt, or press `Ctrl+O` anytime to inspect full tool details.
- **Careful terminal typography.** Markdown, code blocks, tables, and diffs have deliberate spacing and Catppuccin Dark, Light, or System palettes. Borders stay aligned with CJK text and emoji while preserving native terminal scrollback.
- **Fast context and side queries.** Reference files or past sessions with `@`, paste screenshots, run persistent shell commands directly from the input box with `!command`, or ask quick side questions with `/btw` without cluttering the main thread.
- **Stay in control of complex and multi-agent work.** Review plans with `/plan` before editing, queue, steer, or interrupt active turns, track long tasks with `/goal`, `/jobs`, and `/schedule`, and coordinate subagents, Codex/Claude Code integrations, or `/team` Agent Teams.
- **Branchable sessions and safe file recovery.** Search and resume earlier sessions, press `Esc` twice to explore conversation branches, restore file snapshots with `Alt+R` when an edit goes wrong, and check `/context`, `/trajectory`, and the live status footer anytime.
- **Extend without friction.** Capture team workflows in project `SKILL.md` files, add and probe MCP servers live in `/mcp` without restarting, connect local language servers (LSP) for accurate code navigation, and manage plugins or built-in integrations in `/plugins`.

## Find your way through the docs

New to omdsh? Start with the [tutorial guide](https://omdsh.agi.fans/docs/tutorials/) in order, or jump straight to what you need:

| You want to | Start here |
|---|---|
| Install, sign in, and complete your first code change | [Complete your first change](https://omdsh.agi.fans/docs/tutorials/first-task/), [Tune your terminal and models](https://omdsh.agi.fans/docs/tutorials/environment/) |
| Level up your everyday coding workflow | [Give precise context](https://omdsh.agi.fans/docs/tutorials/precise-context/), [Steer long tasks](https://omdsh.agi.fans/docs/tutorials/guide-a-turn/), [Subagents and Agent Teams](https://omdsh.agi.fans/docs/tutorials/multi-agent/), [Manage long sessions](https://omdsh.agi.fans/docs/tutorials/long-session/) |
| Add Skills, MCP, LSP, or plugins | [Skills and MCP tutorial](https://omdsh.agi.fans/docs/tutorials/skills-and-mcp/), [Install plugins and integrations](https://omdsh.agi.fans/docs/tutorials/install-plugin/), [Language servers](https://omdsh.agi.fans/docs/language-servers/) |
| Look up a command, shortcut, setting, or fix an issue | [Commands](https://omdsh.agi.fans/docs/commands/), [Keyboard and mouse](https://omdsh.agi.fans/docs/keyboard/), [Settings](https://omdsh.agi.fans/docs/settings/), [Status and diagnostics](https://omdsh.agi.fans/docs/observability/), [Troubleshooting](https://omdsh.agi.fans/docs/troubleshooting/) |
| Build a plugin or understand internals | [Write and publish a plugin](https://omdsh.agi.fans/docs/tutorials/write-a-plugin/), [Plugin internals](https://omdsh.agi.fans/docs/plugin-internals/), [Architecture](https://omdsh.agi.fans/docs/architecture/) |

The bilingual Markdown under `apps/site/content/` is the documentation source of truth. To report a bug or suggest an improvement, use the [issue forms](https://github.com/agi-fans/oh-my-dsh/issues/new/choose).

## Everyday configuration

Most configuration happens right inside the terminal—no manual config editing required:

- **Accounts and models:** Run `/login` to sign in with a DeepSeek account, store an API key, or add a custom provider. Use `/model` to switch models, `/model favorite` to maintain a fast cycle list (`Ctrl+P` / `Alt+P`), and `Shift+Tab` to change reasoning effort.
- **Interface and preferences:** Run `/settings` to open the bottom-docked settings panel for themes, language, live status-line customization, permissions, and built-in integrations. See [Settings](https://omdsh.agi.fans/docs/settings/) for every option.
- **Extensions and diagnostics:** Manage MCP servers live in `/mcp`, install or toggle extensions in `/plugins`, and run `omdsh doctor` to check your local setup.
- **Shell completions** (runs locally without starting the TUI or touching the network):

```sh
omdsh completions bash
omdsh completions zsh
omdsh completions fish
```

## Relationship to DeepSeek Harness and performance

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides the underlying agent runtime, plugin system, sessions, models, tools, and permissions. omdsh composes those published packages into a community terminal application focused on terminal readability, keyboard-and-mouse interaction, and progressive disclosure. See [Architecture](https://omdsh.agi.fans/docs/architecture/) for package boundaries and design details.

Targeted optimizations for long session replay, streaming Markdown, and large file readers keep the terminal responsive on big repositories (November 6, 2026 Apple M5 Pro local CPU medians: 2.567 ms to replay 10,000 turns, 0.383 ms to scroll a 109,500-character Markdown preview, 0.212 ms to pan a 10,000-line source preview). See [Performance](https://omdsh.agi.fans/docs/performance/) for methodology and practical limits, or run `pnpm benchmark:tui` locally.

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

User-visible changes and release history are tracked in [CHANGELOG.md](https://github.com/agi-fans/oh-my-dsh/blob/main/CHANGELOG.md).

## Acknowledgements

oh-my-dsh exists because of these projects:

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides the runtime foundation, plugin architecture, and the conviction that agent capabilities should be composable rather than embedded in one application.
- [Pi](https://github.com/earendil-works/pi) is the original open agent harness whose terminal interaction, differential rendering, and compact coding-agent craft still set the standard this community builds on.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) continues that lineage and shows how thoughtful terminal interaction, compact information design, and careful keyboard workflows can make an agent feel fast and approachable.

Thank you to these projects and their contributors. omdsh is an independent community project: it is built on DeepSeek Harness and learns from Pi and OMP, but is not an official distribution of any of them.

## License

oh-my-dsh is available under the [MIT License](https://github.com/agi-fans/oh-my-dsh/blob/main/LICENSE).
