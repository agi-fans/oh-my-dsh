---
description: "Every omdsh setting: appearance, motion, notifications, Agent language, and the configurable two-line status footer, with defaults and persistence."
---

# Settings

`/settings` opens the settings overlay. `Tab` and `Shift+Tab` switch between the General, Agent, and Status line sections; `↑`/`↓` move between rows and `←`/`→` change a value. The complete overlay keys are in [Keyboard and keys](keyboard.md).

## General

| Row | Values | Default | Effect |
|---|---|---|---|
| Theme | dark, light, midnight, solarized, catppuccin, dracula, nord, gruvbox, rose-pine, mono | dark | Color palette. |
| Color | on / off | on | SGR styling. |
| Motion | full / reduced / off | full | `full` adds smooth streaming and a working shimmer, `reduced` keeps smooth streaming without the shimmer, and `off` follows provider chunks with static activity marks. |
| Terminal activity | on / off | off | Busy/idle status in supported terminal tabs and taskbars. |
| Tool details | compact / expanded | compact | Expand tool output and catalog details, the same as `Ctrl+O`. |
| Update checks | on / off | on | Check npm once a day and notify when a newer release is available. |
| Release notes | summary / expanded / hidden | summary | Show new release notes once after an upgrade. |
| Notifications | off / long-running / always | off | Notify when a turn finishes or input is required. |
| Long turn | 15s / 30s / 1m / 2m | 30s | Minimum duration before a long-running notification. |

Motion controls presentation only: provider output still enters the live session immediately, and a tool boundary or settled assistant message flushes the visible stream without waiting for the animation.

## Agent

| Row | Values | Default | Effect |
|---|---|---|---|
| Language | Auto / Simplified Chinese / English | Auto | Preferred language for reasoning and replies. |

A non-Auto choice applies from the next turn; code, identifiers, commands, tool arguments, logs, quotations, and file contents keep their accurate forms, and an explicit language request for the current task still wins. The preference is user-level, so a resumed session uses the current value rather than a historical snapshot.

## Status line

| Row | Values | Default | Effect |
|---|---|---|---|
| Status line | on / off | on | Show the fixed two-line footer below the composer. |
| Labels | compact / full | compact | Compact or full metric labels. |

Status items are reordered and restyled in place: `Space` shows or hides an item, `Enter` starts moving one (`↑`/`↓` reorder, `←`/`→` choose the column), and each item has its own color.

First line, in default order: Model (`deepseek`), Effort (`max`), Path (`~/project`), Git (`main *1`), and Session, which is off by default because the terminal window title carries the session title regardless.

Second line telemetry groups, all shown by default: Context (`Ctx 1.6% · 16.4K/1M`), Cache (`Cache 99%`), Tokens (`5.9M in`), Latency (`TTFT 1.2s`), Time (`LLM 16m51s`), and Activity (`3 turns`). When the terminal is narrow, groups degrade from the lowest priority: cache, then tokens, then latency, then durations, then activity counts.

## Persistence

Settings persist through the Harness settings document in the same home that stores sessions (`$OMDSH_HOME`, else `$DSH_HOME`, else `~/.dsh`). Model settings can also come from `$DSH_HOME/settings.yaml`. See [Sessions and history](sessions.md) for the complete file list.

## Related

- [Keyboard and keys](keyboard.md) — settings overlay keys and keybinding overrides
- [Troubleshooting](troubleshooting.md) — color environments and update behavior
- [Commands](commands.md) — `/settings`, `/model`, `/login`
