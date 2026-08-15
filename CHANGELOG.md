# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

## [Unreleased]

### Added

- DeepSeek `/login` and `/logout` flows with masked input, API-key validation, persistent Harness credentials, user-selected credential priority, and environment fallback.

### Changed

- Made the model selector skip a sole provider, use compact option rows, and preserve the current model and reasoning choices.
- Made ordinary notices unframed by default while retaining explicit frames for real component and interaction boundaries.

### Fixed

- Isolated settings and credentials under `OMDSH_HOME` so tests and alternate profiles do not read the user's default Harness state.

## [0.1.0] - 2026-08-15

### Added

- Plugin-first `omdsh` terminal application built on the published DeepSeek Harness runtime.
- Durable conversations with resume, search, retry, compaction, Markdown export, prompt history, and queued follow-up messages.
- Interactive model, reasoning-effort, access-mode, settings, tools, hotkeys, Skills, and MCP surfaces.
- Project-aware `@` file search, highlighted path mentions, and clipboard image paste.
- Fixed two-line status footer with model, reasoning, workspace, Git, context, token, latency, cache, timing, turn, and step information.

### Changed

- Split the TUI into Cordis plugins for presentation, session runtime, human interaction, tool presentation, commands, and the runner.
- Redesigned the startup header, composer, status footer, command output, tools, hotkeys, settings, resume, and model-selection experiences around compact terminal interaction.

### Fixed

- Preserved terminal-cell alignment and right padding for long commands, CJK text, emoji, ANSI styling, and narrow viewports.
- Stabilized incremental rendering, transcript scrolling, cursor placement, tool-output folding, and queued input during active turns.

[Unreleased]: https://github.com/agi-fans/oh-my-dsh/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agi-fans/oh-my-dsh/releases/tag/v0.1.0
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
