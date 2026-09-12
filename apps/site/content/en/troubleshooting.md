---
description: "Fix common omdsh issues: interrupt and exit behavior, resuming, color environments, multiplexer scrollback, legacy sessions, and plugin boot failures."
---

# Troubleshooting

## Interrupt and exit

The first `Ctrl+C` interrupts the active turn, or clears the composer when the session is idle. A second `Ctrl+C` exits, and `Ctrl+D` exits directly. A durable session prints `omdsh --resume <session-id>` on exit so the conversation can be reopened in a new terminal.

## Find a session id again

`/session` reports the active session's details, and `/resume` opens the searchable selector. `/sessions <query>` searches durable session content when you only remember what was discussed. See [Sessions and history](sessions.md).

Sessions first created with v0.5.0 through v0.11.0 may contain a private event that an unmodified DSH persistence reader refuses; omdsh still opens them. Do not hand-edit session files, which may be compressed and carry integrity checks.

## Color

`NO_COLOR` and `FORCE_COLOR=0` stop color output when no explicit preference is set. An explicit choice — plugin configuration or a value chosen in `/settings` — still wins over the environment, and turning color on in `/settings` takes effect immediately without a restart.

## Scrollback and multiplexers

omdsh keeps the terminal's native scrollback during ordinary updates; only a real full-screen overlay borrows the alternate screen. In tmux, screen, and ConPTY, host scrollback is preserved and resize bursts are coalesced before repainting. If the display looks stale after an attach or resize, `Alt+L` resets the terminal display.

## Plugins fail at boot

A version mismatch, a bundle without a `dsh.bundle.patch` declaration, or an unresolved package name fails at startup rather than degrading silently. `omdsh --dump-config` prints the composed tree with the layer that contributed each entry, and `omdsh plugin remove <package>` reverses an install. Two copies of Cordis or the Harness packages in one tree split service tokens and are the most common cause; see [User plugins](plugins.md).

## Updates and notifications

The daily update check only reports a newer npm version; it never installs one. Post-upgrade release notes, the update check, and terminal notifications are configured in `/settings` → General. See [Settings](settings.md).

## Piped input

When input or output is not a TTY, omdsh degrades to line-based input with plain append-only output instead of claiming a screen. This is the mode CI uses.

## Related

- [Command line](cli.md) — flags and environment variables
- [Sessions and history](sessions.md) — log compatibility and local files
- [User plugins](plugins.md) — Profile installs and composition debugging
