# Remove Mouse Tracking

[English](remove-mouse-tracking-plan.md) | [简体中文](remove-mouse-tracking-plan.zh-CN.md)

## Decision

The main TUI will stop enabling terminal mouse tracking. omdsh is keyboard-first, and every required transcript, composer, selector, settings, and subagent interaction must remain fully usable without mouse input. The terminal or multiplexer will retain ownership of pointer selection and scrolling.

This change removes mouse interaction instead of adding a persistent setting. A setting would add configuration, runtime mode transitions, cleanup branches, and compatibility states for behavior that is not required by the product interaction model.

## Goals

- Stop emitting the DECSET/DECRST sequences for button-event tracking (`1000`) and SGR mouse encoding (`1006`).
- Restore ordinary terminal text selection without requiring an application-bypass modifier when the terminal or multiplexer permits it.
- Remove wheel scrolling, click-to-caret, and clickable overlay or subagent behavior from the TUI.
- Preserve complete keyboard operation for the transcript, composer, settings, prompts, overlays, and subagent views.
- Keep raw input robust when an unexpected or stale SGR mouse report reaches stdin.

## Non-goals

- Do not make terminal scrollback the transcript source in this change.
- Do not promise that the wheel will produce PageUp or PageDown input after mouse tracking is removed.
- Do not implement the native-scrollback or settled-history insertion architecture in this change (completed as a follow-up; see `MainScreenRenderer` and `Frame.liveStart`).
- Do not add a replacement mouse configuration, environment heuristic, or tmux-specific mode.

## Behavior contract

- Interactive startup must not enable terminal modes `1000` or `1006`.
- Normal disposal must continue restoring raw mode, bracketed paste, cursor visibility, and the shell cursor position, but it must not manage mouse modes that omdsh no longer owns.
- Mouse clicks, releases, motion, and wheel reports must never move the editor cursor, scroll the virtual transcript, select an overlay row, or activate a subagent control.
- PageUp and PageDown must continue paging the virtual transcript. Shift+Up and Shift+Down must continue performing the existing smaller transcript movement.
- Selectors, `/settings`, plan review, transcript inspection, and subagent views must retain keyboard navigation, selection, cancellation, and focus restoration.
- A complete SGR mouse report that reaches stdin unexpectedly must be consumed as a terminal control sequence and must not become composer text. The decoder may retain a narrow ignored-control path for this purpose; it does not need to expose a mouse interaction event.
- Pipe mode must remain unchanged.

## Implementation plan

1. Remove terminal mouse-mode ownership from the local provider. Delete the mouse enable/disable constants and remove their startup and disposal writes while preserving bracketed-paste, cursor, raw-mode, renderer, and resume-hint cleanup ordering.
2. Remove mouse actions from input dispatch. Delete wheel-to-transcript scrolling, click-to-caret, overlay clicking, settings clicking, prompt clicking, and subagent clicking. Replace rich mouse event decoding with the smallest defensive mechanism that consumes complete SGR mouse reports without dispatching an action or inserting their bytes as text.
3. Remove code that exists only for mouse hit testing. Audit every hit-test field and helper before deletion because some overlay layout state also supports keyboard document scrolling and cursor placement; retain any state with a non-mouse consumer.
4. Make keyboard alternatives discoverable. Update the existing hotkey/help surface and any stale module comments so transcript navigation is described with PageUp/PageDown and Shift+Up/Shift+Down and no visible text advertises mouse interaction.
5. Update focused tests and release notes. Replace tests for mouse actions with negative tests proving that unexpected SGR reports are swallowed, retain keyboard navigation coverage for every formerly clickable surface, and add a concise `Changed` entry under `Unreleased` in `CHANGELOG.md`.

## Expected implementation scope

The implementation is expected to touch the local provider, terminal input decoder, their focused tests, mouse-only hit-testing helpers or frame metadata, the hotkey/help surface, and `CHANGELOG.md`. Changes outside these areas require a concrete remaining mouse consumer. Nothing under `refs/` may be changed or used at runtime.

## Compatibility and risks

- Settled history now enters the terminal's native scrollback, owned by the terminal or multiplexer. The unsettled streaming tail is still rendered by the TUI, and keyboard scrolling remains available in windowed mode.
- Native selection is reliable only for terminal cells currently present and not being repainted. Streaming output, spinner updates, resize, or other frame updates may disturb an active selection in some terminals.
- tmux may continue to own mouse behavior when its `mouse` option is enabled. Removing omdsh tracking does not override tmux copy-mode or terminal bypass rules.
- A prior crashed application can leave terminal mouse reporting enabled. Defensive SGR consumption prevents those reports from becoming prompt text without reclaiming mouse ownership.

## Verification

Focused tests must cover interactive startup and disposal sequences, unexpected SGR report consumption, PageUp/PageDown transcript paging, Shift+Up/Shift+Down transcript movement, keyboard-only settings and prompt selection, keyboard-only subagent inspection, and non-TTY input. A real PTY smoke test must confirm ordinary drag selection, keyboard transcript scrolling, Ctrl-C/Ctrl-D behavior, and resume output outside tmux and under representative tmux mouse configurations.

Run the repository-required checks for a shared TUI and raw-input change:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:md
pnpm smoke:happy
pnpm smoke
git diff --check
```

## Acceptance criteria

- No production code emits `\x1b[?1000h`, `\x1b[?1006h`, `\x1b[?1000l`, or `\x1b[?1006l`.
- No mouse event changes omdsh application state.
- Unexpected complete SGR mouse reports cannot appear in the composer.
- All required interactions remain reachable and operable by keyboard.
- User-visible help and `CHANGELOG.md` describe the keyboard-first behavior accurately.
- Focused tests, the full required check set, and raw-TTY smoke tests pass.

## Follow-up

Native scrollback has been implemented as a separate rendering project. `MainScreenRenderer` inserts settled transcript history into terminal scrollback while keeping the streaming tail, composer, and fixed two-line status footer in the live viewport. On direct terminals, transient full-screen surfaces borrow the alternate screen; multiplexers and ConPTY keep them on the main screen to preserve host compatibility. This is now the basis for native wheel navigation through the complete transcript.
