---
name: record-tui-demo
description: Record or capture a truthful, reproducible oh-my-dsh terminal demonstration for a README, release, PR, issue, or UX comparison. Use when asked for a TUI GIF, terminal recording, screenshots, visual proof of a user-facing flow, or before documenting a substantial composer, transcript, tool-card, queue, todo, settings, resume, or status-line change.
---

# Record an oh-my-dsh TUI Demo

Capture the real application in the user's terminal emulator, preserving its appearance and one coherent interaction story. Recording is read-only evidence unless the user separately authorizes publishing or repository edits.

## Establish provenance

1. Read [`AGENTS.md`](../../../AGENTS.md). Record `git rev-parse HEAD` and `git status --short --branch`; disclose any relevant uncommitted product changes. Separately authorized skill edits do not invalidate footage of an installed release.
2. When the user asks to record an installed release, verify `command -v omdsh` and `omdsh --version` and record that installation. For a source-tree demo, build with `pnpm build` and use its built entry. Never substitute a mocked renderer or manually composed ANSI output.
3. Use a dedicated terminal window and isolated temporary workspace and session roots. Preserve the user's normal terminal profile and TUI appearance. Reuse the normal provider configuration through the application without reading or printing credential values; preserve custom credential references as well as provider and model selection. Keep personal history, clipboard data, and unrelated panes out of the recording.
4. Record the terminal app, dimensions, font/profile, theme, color mode, model/transport, and whether a real model round ran. Never imply a fixture proves provider behavior.

## Choose the format

- Default to native screen recording of the actual terminal window, delivered as MP4 or MOV. Keep the user's font, font size, line spacing, theme, padding, and window appearance; do not replace them with recorder defaults or modify global terminal preferences for the demo.
- Do not use ANSI re-rendering such as `asciinema` → `agg`, a browser terminal, or a VHS-controlled replacement terminal for visual demos unless the user explicitly requests that format. Those paths change font metrics, glyph fallback, colors, and layout. An optional `.cast` is a replay/debug artifact, not visual evidence of the user's terminal.
- A requested GIF must be encoded from the native screen recording, preserving aspect ratio and readable resolution. Prefer the video as the fidelity reference; never redraw text or add a fake terminal frame.
- Inspect a native preview before the full take. Use window capture or a stable crop that excludes unrelated desktop content. Use screenshots when motion adds no evidence.
- Check installed native capture tools and `ffmpeg`; do not install a recorder without authorization. If native capture is unavailable, report the concrete prerequisite and do not silently fall back to re-rendering.

## Stage one story

Choose three to six observable states, such as welcome, typed prompt, Deep Driving, tool Input/Output, settled reply, and resume hint. Keep one terminal size and crop. Use benign deterministic prompts; do not include API keys, private paths beyond the intentional demo workspace, personal Git state, or unrelated notifications.

For a real provider flow, use normal application configuration without reading or printing the credential. For layout-only evidence, explicitly label a keyless smoke or fixture path as such.

Wait for concrete state before capture: a unique label, completed tool card, settled response, visible queue item, or restored prompt. A fixed delay alone is not proof. When demonstrating interruption, paste, scrolling, narrow width, CJK, or emoji behavior, include the state that proves the specific interaction rather than only the final reply.

## Capture and verify

Store temporary frames and artifacts under a gitignored scratch directory or a `mktemp -d` path. Keep lexical frame names and hold the settled final state longest. If encoding a GIF, use the installed encoder without overwriting an existing artifact unexpectedly.

Inspect the encoded artifact itself against the native preview. Confirm matching font and glyph rendering, readable text, stable dimensions, sufficient final hold, accurate colors, and absence of secrets. Run `git status --short` and confirm the recording did not modify tracked files or reference repositories beyond separately authorized edits.

## Publish only with authority

Return the artifact path and provenance by default. Do not commit media, push an assets branch, edit a PR, or update README content unless the user explicitly asks for that action. When publishing is authorized, record the demonstrated commit beside the artifact and revalidate that the branch head has not moved.
