# oh-my-dsh Repository Rules

These instructions apply to the entire repository. More specific `AGENTS.md` files may add local rules, but they must not weaken the repository boundaries below.

## Product Direction

- `omdsh` is a TUI coding agent built on the published DeepSeek Harness packages and inspired by the interaction quality of oh-my-pi.
- Preserve the DeepSeek Harness “everything is a plugin” architecture. New capabilities should be Cordis plugins, services, providers, consumers, or app composition whenever that model fits.
- Keep product-owned implementation inside `apps/`, `packages/`, `scripts/`, and `docs/`. Do not place omdsh implementation in a reference project.
- `apps/omdsh` owns the `@agi-fans/oh-my-dsh` package, command startup, and runtime composition. `packages/tui/omdsh-tui` owns the `@agi-fans/dsh-tui` package, terminal presentation, input, session interaction, and reusable TUI behavior.
- Prefer deep, explicit package seams over copying upstream internals. If a second provider or consumer creates a real independent lifecycle, split the seam then rather than pre-emptively.

## Reference Repositories Are Read-Only

- Everything under `refs/` is read-only reference material. Never edit, format, patch, generate files into, or commit changes inside either reference submodule.
- `refs/deepseek-harness` is for API, architecture, and behavior research only. `refs/oh-my-pi` is for UX and TUI design research only.
- Reference projects must never participate in dependency resolution, TypeScript project references, path aliases, workspace membership, builds, tests, runtime execution, package patches, or generated symlinks.
- Do not import files from `refs/`, execute scripts from `refs/`, or add `link:refs/...`, `file:refs/...`, `paths` mappings, or package-manager overrides that point into `refs/`.
- When upstream behavior is useful, reimplement or adapt it within an omdsh-owned package. Do not solve a missing API by modifying a reference checkout.
- Documentation may link to files under `refs/` as supporting references, provided those links do not become runtime or build dependencies.
- Before handing off dependency or build changes, verify that both reference submodules are clean and that no project-owned dependency symlink resolves into `refs/`.

## Dependency Policy

- All `@deepseek-ai/dsh-*`, `@deepseek-ai/cordis*`, and other DeepSeek runtime packages must be consumed from npm through normal package exports.
- Pin one coherent published DSH release across direct dependencies. Do not mix incompatible DSH release candidates merely because an npm `latest` tag points at an older line.
- Use exact versions for DSH runtime packages so installs and the runtime composition are reproducible. Update `pnpm-lock.yaml` whenever dependency versions change.
- The only expected `workspace:` dependencies are omdsh-owned packages such as `@agi-fans/dsh-tui`. A DeepSeek package using `workspace:` is a boundary violation.
- Import only files that are actually present in the published package. Prefer public package exports; an export-map entry that targets an omitted source file is not a usable API.
- If a required upstream capability is not published, first look for a public library API or implement a local adapter. Do not silently fall back to `refs/`.
- Keep `pnpm-workspace.yaml` scoped to omdsh-owned packages and apps. Treat any addition under `refs/` as an error.

## TUI and UX Rules

- Use oh-my-pi as a design reference, not as source code or a dependency. Preserve omdsh's DeepSeek identity instead of cloning branding verbatim.
- The startup header uses the DeepSeek logo and the slogan `Into the Unknown`. Preserve the logo's source aspect ratio and distinctive top detail when converting it for terminal cells.
- The composer uses `🐳` as its only label. Keep a fixed, unframed two-line status footer directly below it: model/reasoning and workspace/Git metadata on the first line, customizable session telemetry on the second.
- Status information is English until language support exists. Design strings so they can later move behind a language layer instead of being scattered through rendering code.
- Telemetry priority is: cache, input/output tokens, and TTFT first; LLM/tool duration second; turns/steps last. Degrade from the lowest-priority group when terminal width is limited.
- Status values should be derived from Harness projections such as session stats and token metering, not duplicated counters invented by the TUI.
- Ordinary notices such as session resume confirmation should not be wrapped in an unexplained box. Use borders only when they communicate a real component boundary or interaction state.
- Assistant replies and tool output must have deliberate horizontal padding and must not touch transcript borders.
- Treat terminal layout in display cells, not JavaScript string length. ANSI sequences, CJK text, emoji, combining characters, and long unbroken commands must not collapse right padding or borders.
- Keep the composer and two-line status footer anchored at the bottom. Scrolling moves through transcript history without causing stale lines, mismatched borders, or full-screen jitter.
- Prefer incremental rendering, cached formatted rows, and coalesced wheel updates. Avoid reformatting the entire transcript for every scroll event or streaming token.
- Preserve the established exit behavior: the first Ctrl-C clears or interrupts, a second Ctrl-C exits, and exit output includes an `omdsh --resume <session-id>` hint when a session can be resumed.
- Interactive lists must support keyboard selection when they require a choice. Do not render a numbered menu and then leave the normal composer active as the only interaction path.

## Markdown and Documentation

- Do not hard-wrap prose at an arbitrary column. A paragraph should remain one continuous source line and should wrap only in the Markdown renderer.
- Start a new source line only for a semantic boundary such as a new paragraph, heading, list item, table row, block quote, or code block.
- Keep one blank line around headings, lists, fenced code blocks, and other block elements as required by CommonMark.
- Use fenced code blocks for commands and multi-line examples. Do not simulate visual wrapping by inserting manual line breaks into prose.
- Run `pnpm check:md` after changing Markdown. Use `pnpm format:md` when the repository formatter reports a fixable issue.
- Keep architecture and feature documents consistent with the actual dependency boundary: published npm packages are runtime dependencies; `refs/` supplies reference links only.

## Implementation Practices

- Preserve user changes in a dirty worktree and keep unrelated edits out of the current task.
- Search with `rg` or `rg --files` first. Keep changes focused and avoid broad mechanical rewrites unless the migration itself requires them.
- Add or update regression tests for rendering, layout, interaction, or session behavior changes. Prefer pure rendering tests plus fake-TTY contract tests for terminal behavior.
- Keep terminal rendering and event-to-view mapping pure where possible; isolate TTY ownership, raw-mode input, process signals, and filesystem access behind providers or controllers.
- Do not add a special-case UI implementation when the behavior belongs in a reusable renderer, controller, projection, or plugin seam.
- Use Conventional Commit messages when committing. Do not commit generated build output unless the repository explicitly tracks it.

## Required Verification

- Run focused tests while developing, then run the checks appropriate to the final change. Dependency, workspace, build, or shared TUI changes require the full set below.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:md
pnpm smoke:happy
git diff --check
```

- Run `pnpm smoke` when changing raw TTY input, viewport behavior, scrolling, cursor placement, Ctrl-C/Ctrl-D handling, or built-command startup.
- A change is not complete if configuration, lockfiles, source files, scripts, or dependency symlinks still point into `refs/`.
- Before finishing dependency-boundary work, audit with commands equivalent to:

```sh
rg -n 'refs/deepseek-harness|link:refs' package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json apps packages scripts --glob '!**/*.md'
find node_modules apps packages -type l -lname '*refs/deepseek-harness*' -print
git -C refs/deepseek-harness status --short
git -C refs/oh-my-pi status --short
```

- The first two audit commands must produce no matches. Both reference submodule status commands must be clean.
