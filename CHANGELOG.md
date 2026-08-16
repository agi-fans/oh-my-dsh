# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

## [Unreleased]

### Added

- Added one-time startup release summaries, `/changelog [full]`, and cached non-blocking npm update notifications with controls in `/settings`.
- Added repository-local Skills for change validation, architecture and UX review, simplification audits, prose maintenance, bilingual documentation synchronization, and reproducible TUI demonstrations.

### Changed

- Made the repository release Skill hand npm publication to the user for interactive OTP completion, then resume registry verification and GitHub finalization without repeating completed work.
- Separated tool-call input from output in a single framed card, preserving long inputs after settlement and giving terminal output its own labeled, tail-focused preview.
- Consolidated architecture guidance into one current-state reference covering plugin ownership, runtime composition, data flow, terminal guarantees, public exports, and verification boundaries.

### Fixed

- Made the startup header read the current TUI package version instead of retaining the original `0.1.0` placeholder after releases.

### Removed

- Removed completed implementation plans, a stale oh-my-pi feature-gap snapshot, and the superseded plugin-migration review after preserving their durable constraints in the architecture reference.

## [0.3.0] - 2026-08-16

### Changed

- Replaced `/mode` with an agent-scoped `/permission` selector that offers fixed Harness permission presets and requires confirmation before enabling full access.
- Refined the composer Todo HUD into a bounded tree preview with completion progress, active-work visibility, completed-item strikethrough, and overflow summaries.

### Fixed

- Restored the latest Harness Todo projection above the composer, including live updates, replay restoration, and turn-boundary clearing.
- Prevented stale transcript viewport indicators from stacking after terminal cursor drift by absolutely reanchoring changed paints and filtering content-owned cursor controls.

## [0.2.0] - 2026-08-16

### Added

- Repository-local `publish-oh-my-dsh` Skill for preparing, publishing, recovering, and verifying synchronized npm and GitHub releases.
- Double-Escape conversation rewind with an interactive human-turn selector, non-destructive session forks, and editable restoration of the selected text and images.

### Changed

- Replaced `/queue` and `/dequeue` with a composer-level view of the durable Harness inbox; repeated `↑` presses walk backward through follow-ups for editing without changing their send order.
- Merged the keyboard-shortcut catalog into `/help` so commands and controls live in one discoverable surface.
- Manual `/compact` now enters a visible `Compacting` state, locks composer actions until settlement, and remains cancellable with `Ctrl+C`.

### Fixed

- Prevented exact-width terminal paints from triggering pending-wrap phantom rows, including duplicate `Deep Driving` indicators.
- Removed long-session input and activity lag by caching transcript layout per immutable message block and recomputing only animated or changed blocks.
- Reduced large-session resume work from quadratic to linear by using a private mutable replay builder with indexed tool-call lookup while preserving immutable live updates.
- Avoided rescanning the complete event log for every streaming update when durable Harness statistics, token usage, and context projections are available.

### Removed

- Removed the redundant `/pwd` and `/dirs` commands because the fixed status footer already shows workspace, model, and Git context.
- Removed `/search` and its SQLite session index; prompt-history search remains available through `Ctrl+R`.

## [0.1.1] - 2026-08-15

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

[Unreleased]: https://github.com/agi-fans/oh-my-dsh/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/agi-fans/oh-my-dsh/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/agi-fans/oh-my-dsh/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/agi-fans/oh-my-dsh/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/agi-fans/oh-my-dsh/releases/tag/v0.1.0
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
