# @agi-fans/dsh-tui

The omdsh TUI capability seam: terminal presentation for the DeepSeek Harness core runtime. One capability seam, three roles, complete:

- **Service Definition** (`src/definition.ts`) — the `tui` context service: `event`, `setStatus`, `setModel`, `readline`, `onInterrupt`, `dispose`. The vocabulary mirrors the SDK wire surface (`session.event`, `session.status`), so a remote UI can reuse the definition unchanged.
- **Service Provider** (`src/provider-local.ts`) — owns the tty: raw-mode key input (editing, history, slash/tab, Ctrl-R search, PgUp/PgDn transcript scroll, bracketed paste, Ctrl-C interrupt, Ctrl-D quit), SIGWINCH reflow, and the differential renderer. Non-tty streams degrade to line input with plain append-only printing of settled blocks.
- **Consumer** (`src/runner.ts`) — the interactive driver in the `@deepseek-ai/dsh-headless` pattern: creates one Agent through the core registry, forwards its session events, and loops on `readline`.

The rendering pipeline (`renderer`, `style`, `event-views`) is pure and exported for tests and alternative providers.

## Usage

Mount the provider and runner as ordinary cordis.yml rows (see `apps/omdsh/config/cordis.yml`); the app package owns the `omdsh` bin.
