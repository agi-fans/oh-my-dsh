---
description: "Every omdsh setting: appearance, motion, notifications, Agent language, optional features, and the configurable two-line status footer, with defaults and persistence."
---

# Settings

`/settings` opens the settings overlay. `Tab` and `Shift+Tab` switch between General, Agent, Features, and Status line; `↑`/`↓` move between rows and `←`/`→` change a value. The complete overlay keys are in [Keyboard and keys](keyboard.md).

## General

| Row | Values | Default | Effect |
|---|---|---|---|
| Theme | dark, light, midnight, solarized, catppuccin, dracula, nord, gruvbox, rose-pine, mono | dark | Color palette. |
| Color | on / off | on | SGR styling. |
| Motion | full / reduced / off | full | `full` adds smooth streaming and a working shimmer, `reduced` keeps smooth streaming without the shimmer, and `off` follows provider chunks with static activity marks. |
| Terminal activity | on / off | off | Busy/idle status in supported terminal tabs and taskbars. |
| Update checks | on / off | on | Check npm once a day and notify when a newer release is available. |
| Release notes | summary / expanded / hidden | summary | Show new release notes once after an upgrade. |
| Notifications | off / long-running / always | off | Notify when a turn finishes or input is required. |
| Long turn | 15s / 30s / 1m / 2m | 30s | Minimum duration before a long-running notification. |

Tool previews use the active theme's background colors with padding on every side. Turns share one presentation, described in [Keyboard and keys](keyboard.md#transcript); there is no transcript density setting. Legacy `foldDensity` and `expandTools` values are accepted but no longer affect the view.

Motion controls presentation only: provider output still enters the live session immediately, and a tool boundary or settled assistant message flushes the visible stream without waiting for the animation.

## Agent

| Row | Values | Default | Effect |
|---|---|---|---|
| Language | Auto / Simplified Chinese / English | Auto | Preferred language for reasoning and replies. |

A non-Auto choice applies from the next turn; code, identifiers, commands, tool arguments, logs, quotations, and file contents keep their accurate forms, and an explicit language request for the current task still wins. The preference is user-level, so a resumed session uses the current value rather than a historical snapshot.

## Features

Optional product features that cost context, runtime, or transcript noise. Each row turns one composition row off.

| Row | Default | Effect when off |
|---|---|---|
| Changed-file summary | On | No per-turn changed-file record, and no Git snapshots at turn start and turn end. |
| Session history tools | On | The model loses `session_search`, `session_event_search`, `session_trace`, `session_event_trace` and `session_event_read`. |
| Ralph loop | Off | The loop tool stays absent until you turn it on here. |
| Repeat-tool reminder | On | The model gets no nudge out of identical tool-call loops. |

A change here applies on the next launch, and the row says so. `disabled` is a Loader option rather than plugin configuration, so the settings service cannot express it; these rows are written into a managed block in `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` instead, which is the surface the Harness reads while composing the tree. The block is delimited by comments and everything you wrote by hand around it is left alone.

Rows that back a command (`session-query` backs `/sessions`, `workspace` backs `@` mentions) and rows that make the agent unusable (`tool-fs`, `tool-bash`, `todo`) are deliberately not listed. `web_search` is also absent: it shares its row with `web_fetch`, so no row-level switch can express "search off, fetch on".

## Status line

| Row | Values | Default | Effect |
|---|---|---|---|
| Status line | on / off | on | Show the fixed two-line footer below the composer. |
| Labels | compact / full | compact | Compact or full metric labels. |

Status items are reordered and restyled in place: `Space` shows or hides an item, `Enter` starts moving one (`↑`/`↓` reorder, `←`/`→` choose the column), and each item has its own color.

First line, in default order: Model (`deepseek`), Effort (`max`), Path (`~/project`), Git (`main *1`), and Session, which is off by default because the terminal window title carries the session title regardless.

Second line telemetry groups, all shown by default: Context (`Ctx 1.6% · 16.4K/1M`), Cache (`Cache 99%`), Tokens (`5.9M in`), Latency (`TTFT 1.2s`), Time (`LLM 16m51s`), and Activity (`3 turns`). When the terminal is narrow, complete groups are selected in configured order. The default order prioritizes context, cache, tokens, and latency before durations and activity counts; a group that does not fit is skipped so a smaller later group can still appear.

## Persistence

Settings, model preferences, and logged-in credentials are live plugin config persisted into the active Profile's Cordis patch, `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` (with `$DSH_HOME`, then `~/.dsh`, standing in for the home itself); `/settings`, `/model`, and `/login` all write there. A `settings.yaml` left by an earlier release is imported once at startup — each section written into the Profile row with the same id — and the file is then renamed to `settings.yaml.imported`, while a section that no longer matches a row id is logged and stays only in the renamed file. See [Sessions and history](sessions.md) for the complete file list.

## Plugin settings

Mounted Harness plugins keep their settings in their own Profile row config. The `llm-deepseek` route accepts only Messages-compatible endpoints and rejects a `protocol` key with `protocol is not configurable; remove it and use a Messages-compatible baseURL`. Set a compatible `baseURL` for a custom gateway; the DeepSeek endpoint is selected by base URL.

## Related

- [Keyboard and keys](keyboard.md) — settings overlay keys and keybinding overrides
- [Troubleshooting](troubleshooting.md) — color environments and update behavior
- [Commands](commands.md) — `/settings`, `/model`, `/login`
