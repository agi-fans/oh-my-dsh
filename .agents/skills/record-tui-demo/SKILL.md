---
name: record-tui-demo
description: Record or capture a truthful, reproducible oh-my-dsh terminal demonstration for a README, release, PR, issue, or UX comparison. Use when asked for a TUI GIF, terminal recording, screenshots, visual proof of a user-facing flow, or before documenting a substantial composer, transcript, tool-card, queue, todo, settings, resume, or status-line change.
---

# Record an oh-my-dsh TUI Demo

Demonstrate the real built application and one coherent interaction story. Recording is read-only evidence unless the user separately authorizes publishing or repository edits.

## Establish provenance

1. Read [`AGENTS.md`](../../../AGENTS.md) and require a clean worktree for commit-specific evidence. Record `git rev-parse HEAD` and `git status --short --branch`.
2. Build the recorded tree with `pnpm build`. Use the built `omdsh` entry rather than a mocked renderer or manually composed ANSI output.
3. Create isolated temporary `OMDSH_HOME`, workspace, and session roots with `mktemp -d`. Never reuse or expose personal session history, credentials, clipboard data, or unrelated terminal panes.
4. Record the terminal dimensions, theme, color mode, model/transport, and whether a real model round ran. Never imply a fixture proves provider behavior.

## Choose the format

- Prefer a short GIF or terminal-native recording when an installed recorder is available.
- Use a small set of screenshots when motion adds no evidence.
- Check for `vhs`, `asciinema`, `agg`, `ffmpeg`, `tmux`, or an available computer-control capability. Do not install a recorder without user authorization.
- If the requested format cannot be produced with available tools, report the missing prerequisite instead of fabricating frames.

## Stage one story

Choose three to six observable states, such as welcome, typed prompt, Deep Driving, tool Input/Output, settled reply, and resume hint. Keep one terminal size and crop. Use benign deterministic prompts; do not include API keys, private paths beyond the intentional demo workspace, personal Git state, or unrelated notifications.

For a real provider flow, use normal application configuration without reading or printing the credential. For layout-only evidence, explicitly label a keyless smoke or fixture path as such.

Wait for concrete state before capture: a unique label, completed tool card, settled response, visible queue item, or restored prompt. A fixed delay alone is not proof. When demonstrating interruption, paste, scrolling, narrow width, CJK, or emoji behavior, include the state that proves the specific interaction rather than only the final reply.

## Capture and verify

Store temporary frames and artifacts under a gitignored scratch directory or a `mktemp -d` path. Keep lexical frame names and hold the settled final state longest. If encoding a GIF, use the installed encoder without overwriting an existing artifact unexpectedly.

Inspect the final artifact itself. Confirm frame order, readable text, stable dimensions, sufficient final hold, accurate colors, and absence of secrets. Run `git status --short` and confirm the recording did not modify tracked files or either reference repository.

## Publish only with authority

Return the artifact path and provenance by default. Do not commit media, push an assets branch, edit a PR, or update README content unless the user explicitly asks for that action. When publishing is authorized, record the demonstrated commit beside the artifact and revalidate that the branch head has not moved.
