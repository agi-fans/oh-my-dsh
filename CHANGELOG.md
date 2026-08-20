# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

## [Unreleased]

### Added

- Mention other sessions from the composer `@` menu. Unquoted `@` lists project files first, then session titles; `Tab` inserts a session mention, and sending the prompt captures a read-only snapshot for the model. Quoted `@"…` tokens stay file-only. File rows come from Harness `file-reference` discovery and still insert a path without uploading contents.
- Send composer images with `/goal` and `/plan`. Commands that do not accept attachments return an error and keep the original image draft in the composer.

### Changed

- Upgraded every direct DeepSeek Harness dependency to the coherent `0.1.0-rc.8` release.

### Fixed

- Route `/goal` and `/plan` after dropping TUI image placeholders that match attached drafts, leave handwritten `[Image #N]` text unchanged when nothing is attached, pass command whitespace through to Harness, and keep the original image draft when those commands fail.
- Keep `@` file rows on Harness `file-reference` results when that service is composed, including empty matches; local path search remains only when it is not.

## [0.6.1] - 2026-08-19

### Fixed

- Load user-installed DSH bundles from the omdsh Profile when running the published npm package.

## [0.6.0] - 2026-08-19

### Added

- Add [Write a plugin](docs/tutorials/write-a-plugin.md), a walkthrough for writing, installing, and publishing an omdsh plugin bundle.
- Ship [`examples/hello`](examples/hello), an installable bundle that registers `/hello` through `dsh-commands`.
- Install user DSH bundles into `$OMDSH_HOME/profiles/omdsh` with `omdsh plugin add` and `omdsh plugin remove`, and compose them after the shipped `@agi-fans/oh-my-dsh` layer at boot.
- Apply `$OMDSH_HOME/cordis.patch.yml` over the shipped composition at boot, and print the composed plugin tree with `omdsh --dump-config`.
- Show live descendant subagents above the composer, with each child's label, run state, and current tool, and present `subagent`, `send_message`, `interrupt_agent`, and `list_agents` cards by their task description instead of raw JSON.
- Open a subagent's own transcript from the Agents roster by clicking a row or pressing Alt+A, and return to the parent with Escape.
- Steer a continuable subagent from its inspect view: the composer delivers a follow-up to that child, while one-shot runs stay read-only.
- Acknowledge [Pi](https://github.com/earendil-works/pi) among the project's design influences.
- Add catalog and custom model providers through the published Harness pi-ai adapter. `/login` can store a catalog key or add a custom route (id, base URL, protocol, optional key, and model ids), `/logout` can drop that route, and `/model` lists every live provider.

### Changed

- Split the tutorials into one page per walkthrough, with [docs/tutorials.md](docs/tutorials.md) as the index.
- Highlight leading `/command` tokens in the composer, and paint slash-command names in the completion list, so those lines read as commands rather than ordinary prompt text.
- Use monochrome Unicode marks for pending, warning, todos, and settings instead of emoji-presentation glyphs.

### Fixed

- Fail loud when `omdsh plugin add` is given a missing filesystem path, instead of installing a broken link, and resolve `./examples/hello` from a subdirectory of a checkout.
- Keep ↑/↓ inside the current `/settings` tab instead of crossing into the other section.
- Hide the blinking composer cursor while a read-only subagent transcript is open.
- Paint idle subagents with a check instead of the hourglass pending glyph.

## [0.5.1] - 2026-08-18

### Fixed

- Resume sessions that recorded the omdsh tool-presentation event instead of refusing the log as an unknown harness type.

## [0.5.0] - 2026-08-18

### Added

- Added four independent, Harness-backed session controls: Agent presets (Standard, PTC, Minimal, and Cordis), Workflow (Default or Plan), tool presentation (Native, Code, or Both), and Access (Read only, Workspace write, or Full access).
- Added `/settings` Status line items that match the preview: each of Model, Effort, Path, Git, and the telemetry groups has its own color, left/right column, show/hide, and order.
- Show the session permission mode on the top-right of the composer, opposite the whale label.
- Add catppuccin, dracula, nord, gruvbox, and rose-pine palettes from the oh-my-pi coding themes.

### Changed

- Upgraded every direct DeepSeek Harness dependency to the coherent `0.1.0-rc.7` release and adopted its published Agent preset and Code runtime packages.
- Keep the lowercase Agent mode visible in the fixed footer, reveal Workflow only while Plan is active, show non-default tool presentation without category labels, keep lowercase Access on the composer boundary, and report all four separately in `/session`.
- Reset SGR attributes independently so nested color, bold, italic, and underline no longer wipe each other.
- Paint thinking traces in a quieter gray italic so they stay distinct from assistant body text, including after inline Markdown.
- Let the terminal own body ink across every palette while keeping thinking traces explicitly muted, so themes respect the user's foreground and background pairing.
- Paint thinking traces as readable comment-gray italic on dark palettes, including code, links, and headings inside those traces, so they recede from body text without collapsing into the background or being boosted to white.
- Use a quieter muted border for idle frames, quotes, rules, and tables, and complete the midnight and solarized palettes.

### Fixed

- Refresh the footer's Agent and tool-presentation labels immediately after `/agent` changes a blank session's composition.
- Restore distinct Header title, body, metadata, and frame tones across every palette, including monochrome and 16-color terminals.
- Keep the welcome card on the visible dim frame so Tips, Recent sessions, and the slogan do not sit on a near-invisible border.
- Paint fenced-code keywords with a dedicated syntax color instead of the UI accent.
- Soften inline Markdown code so codespans use a muted gray instead of accent-like orange or lavender; fenced blocks keep a separate, slightly stronger color.
- Render transcript Markdown through a GFM lexer so paragraphs reflow, nested emphasis and escapes stay intact, list items keep their continuations, and reference links resolve.
- Paint file-edit tool cards as aligned diffs: unchanged context stays dim, deletions are red, additions are green, one-line replacements mark the changed tokens, and the header shows `+N/-M`.
- Generate the CLI package README from the repository overview during packing, with npm-safe GitHub links, so npm documentation stays synchronized with the project homepage.
- Clarify that `@agi-fans/dsh-tui` is a non-executable integration library, direct end users to `@agi-fans/oh-my-dsh`, and enforce that distinction during package checks.

## [0.4.0] - 2026-08-16

### Added

- Added an oh-my-pi-inspired `/loop [count|duration] [prompt]` plugin with atomic next-prompt capture, actionable waiting guidance, explicit repeat progress, duration countdown, Ctrl-C pause and resume guidance, transient completion feedback, active-session isolation, and no routine control-message transcript noise.
- Added one-time startup release summaries, `/changelog [full]`, and cached non-blocking npm update notifications with controls in `/settings`.
- Added repository-local Skills for change validation, architecture and UX review, simplification audits, prose maintenance, bilingual documentation synchronization, and reproducible TUI demonstrations.

### Changed

- Made `/help` a compact command directory with essential shortcuts by default, added `/help full` for the complete key catalog, and limited the default `/changelog` view to the latest release.
- Adapted model selectors to use compact prompt cards for short lists and searchable full-screen pages only when the option set is large.
- Clarified that `/steer` affects the active turn's next model step, rejected idle steering, and normalized `/session` permission and token labels with the fixed footer.
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

[Unreleased]: https://github.com/agi-fans/oh-my-dsh/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/agi-fans/oh-my-dsh/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/agi-fans/oh-my-dsh/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/agi-fans/oh-my-dsh/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/agi-fans/oh-my-dsh/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/agi-fans/oh-my-dsh/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/agi-fans/oh-my-dsh/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/agi-fans/oh-my-dsh/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/agi-fans/oh-my-dsh/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/agi-fans/oh-my-dsh/releases/tag/v0.1.0
[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html
