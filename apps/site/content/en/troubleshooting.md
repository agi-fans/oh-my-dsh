---
description: "Fix common omdsh issues: interrupt and exit behavior, resuming, DeepSeek account sign-in, color environments, multiplexer scrollback, legacy sessions, and plugin boot failures."
---

# Troubleshooting

## Interrupt and exit

The first `Ctrl+C` interrupts the active turn, or clears the composer when the session is idle. A second `Ctrl+C` exits, and `Ctrl+D` exits directly. A durable session prints `omdsh --resume <session-id>` on exit so the conversation can be reopened in a new terminal.

## Find a session id again

`/session` reports the active session's details, and `/resume` opens the searchable selector. `/resume <query>` searches durable session content when you only remember what was discussed. See [Sessions and history](sessions.md).

Sessions first created with v0.5.0 through v0.11.0 may contain a private event that an unmodified DSH persistence reader refuses; omdsh still opens them. Do not hand-edit session files, which may be compressed and carry integrity checks.

## DeepSeek account sign-in

`/login` → **DeepSeek account** opens the platform authorization page with a loopback callback such as `http://127.0.0.1:<port>/oauth/callback`. After approval, the page should end at `.../dsh/authorized?login_source=web` and show “Authorization complete”. A page that opens DeepSeek Harness Desktop ends with `login_source=desktop` (or no `login_source`); it belongs to a Desktop-initiated attempt, not the TUI. Close that tab and start a fresh `/login` instead of reusing it.

The browser may keep the tab open because it was opened from the terminal rather than by `window.open`; close it after the completion message and press Enter in the TUI. On a remote host, forward the displayed loopback port over SSH so the callback can reach the TUI. Once signed in, the shared account appears in both `/login` and `/logout`; signing out removes the local grant and revokes it in the background.

## Logs

The interactive TUI redirects plugin `console` output to `$OMDSH_HOME/omdsh/logs/omdsh.log` instead of stdout, so a diagnostic cannot write into the composer or corrupt the frame. The file is local and may contain operational details; `omdsh exec` keeps its own stdout/stderr protocol. Remove the file to reset the log.

## Color

`NO_COLOR` and `FORCE_COLOR=0` stop color output when no explicit preference is set. An explicit choice — plugin configuration or a value chosen in `/settings` — still wins over the environment, and turning color on in `/settings` takes effect immediately without a restart.

omdsh uses 24-bit color when `COLORTERM` reports it or the terminal is not a known 16-color host. Apple Terminal receives the 256-color palette instead, because its 24-bit support is unreliable; set `COLORTERM=truecolor` to override. On a 16-color terminal, theme colors are matched against the palette the terminal reports.

## Keyboard protocol

On terminals that implement the Kitty keyboard protocol, omdsh asks for unambiguous key reporting so `Alt` and `Ctrl` shortcuts are recognized reliably. It gives the terminal its own key encoding back on exit, while suspended with `Ctrl+Z`, while an external editor runs, and if the process exits unexpectedly. If `Esc` or `Ctrl+C` misbehave in your shell after a crash, `printf '\033[<u'` restores the previous encoding.

## Scrollback and multiplexers

omdsh keeps the terminal's native scrollback during ordinary updates; only a real full-screen overlay borrows the alternate screen. It also keeps it when the transcript is replaced: `/clear`, a session switch, and `--resume` all append the new document below a labelled seam instead of erasing what is above, because that history holds the output your shell printed before omdsh started. In tmux, screen, and ConPTY, host scrollback is preserved and resize bursts are coalesced before repainting. If the display looks stale after an attach or resize, `Alt+L` resets the terminal display.

Rows that have scrolled into that history are snapshots of what was shown at the time, and nothing rewrites them. Scrolling up past a seam therefore shows calls that have since finished, or a run that has since folded, laid out as they were when the terminal received them. The seam is the only thing that marks the change, and the live view below it is the source of truth for the current transcript.

## Plugins fail at boot

A version mismatch, a bundle without a `dsh.bundle.patch` declaration, or an unresolved package name fails at startup rather than degrading silently. `omdsh --dump-config` prints the composed tree with the layer that contributed each entry, and `omdsh plugin remove <package>` reverses an install. Two copies of Cordis or the Harness packages in one tree split service tokens and are the most common cause; see [User plugins](plugins.md).

## Updates and notifications

The daily update check only reports a newer npm version; it never installs one. Post-upgrade release notes, the update check, and terminal notifications are configured in `/settings` → Interface. See [Settings](settings.md).

## Piped input

When input or output is not a TTY, omdsh degrades to line-based input with plain append-only output instead of claiming a screen. This is the mode CI uses.

## Related

- [Command line](cli.md) — flags and environment variables
- [Sessions and history](sessions.md) — log compatibility and local files
- [User plugins](plugins.md) — Profile installs and composition debugging
