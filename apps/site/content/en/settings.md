---
description: "Every omdsh setting: appearance, motion, notifications, Agent language, optional features, and the configurable two-line status footer, with defaults and persistence."
---

# Settings

`/settings` opens the settings overlay. `Tab` and `Shift+Tab` switch between General, Agent, Features, Status line, and Plugins; `↑`/`↓` move between rows and `←`/`→` change a value. The complete overlay keys are in [Keyboard and keys](keyboard.md).

## Plugin configuration

Open `/settings`, switch to **Plugins**, and press `Enter` on a plugin to edit its fields. `Esc` returns to the same Settings row. This section lists active plugins with editable configuration; the field list supports filtering. Fields come from the plugin's published live schema, including Shell timeout/output limits, Subagent depth/concurrency/model policies, Agent loop parallelism, and Web search endpoint/model/token/use limits.

Each field shows its effective value and whether it is inherited or overridden in this Profile. **Reset to inherited** removes only that field's override; **Set value** validates against the plugin schema and saves with the revision read by the form. A concurrent change refuses the write rather than overwriting it. Strings use plain input; arrays, dictionaries, and other structured fields use JSON. Hidden or disabled schema fields are omitted. Compound fields containing secrets remain protected; use `/auth` or their owning configuration instead.

Secret inputs are masked and are never shown in notices. Setting an `apiKey` beside `apiKeyEnv` saves the key through Harness credentials and writes only its reference into the Profile. Resetting that key removes both Profile fields so inheritance applies again; it does not revoke an inherited credential or erase a key from the credential store. Credential-reference fields retain the Harness environment and credential-source inheritance.

Edits apply live and affect every session using this Profile. Only active, schema-declared live fields appear here; ordinary deployment options still belong in the Profile patch. [Plugins](plugins.md) describes enablement and installation.

In **Plugins**, select **Subagent model selection settings** (`subagent-model-selection-settings`) to configure optional child-model selection. Set `allowedModels` to a JSON list such as `[{"provider":"deepseek-official","model":"deepseek-flash"}]` before setting `enabled` to `true`. New sessions sample the allowlist and expose only those exact routes to `subagent`; existing sessions retain their choice, and `subagent_fork` inherits the parent route. The default is disabled.

Plugin names use readable labels; the namespace remains in the description. Schema help appears beside each field.

### Command hooks

In Plugins, choose **Hook settings** (`hook-settings`). Set `configPath` first, then `bridge` to `codex` or `claude-code`; `off` is the default and disables execution. An empty path uses `.codex/hooks.json` or `.claude/settings.json` relative to the process working directory. Paths can point to existing compatible configurations; editing their contents requires a restart or switching the bridge off and on.

The selected published bridge runs its supported synchronous command hooks. Codex maps SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop; Claude Code follows its published event subset. Unsupported async, prompt and agent hooks are not executed. Blocking decisions and failures appear in the transcript and remain in the log. Enabling hooks does not replay SessionStart for an existing session. Only one bridge is active at a time.

## General

| Row | Values | Default | Effect |
|---|---|---|---|
| Theme | dark, light, midnight, solarized, catppuccin, dracula, nord, gruvbox, rose-pine, mono | dark | Color palette. |
| Color | on / off | on | SGR styling. |
| Motion | full / reduced / off | full | `full` adds smooth streaming and a working shimmer, `reduced` keeps smooth streaming without the shimmer, and `off` follows provider chunks with static activity marks. |
| Math in replies | auto / source | auto | Format supported formulas as terminal text, or retain LaTeX delimiters and commands. |
| Mermaid in replies | auto / source | auto | Draw complete diagrams that fit, or show Mermaid source. |
| Editor | Auto / detected editors | Auto | App used by file previews and `Ctrl+X` prompt editing. |
| Mouse interaction | auto / tui / native | auto | Handle scrolling and selection when needed, respect tmux mouse off in Auto, or leave mouse input to the terminal. |
| Paste protection | on / off | on | Detect unmarked multiline pastes and rapid key streams so embedded Enter keys do not submit a message. |
| Copy on select | on / off | on | Copy on mouse release; when off, use `Alt+C`, `Enter`, or right-click. |
| Terminal activity | on / off | off | Busy/idle status in supported terminal tabs and taskbars. |
| Update checks | on / off | on | Check npm once a day and notify when a newer release is available. |
| Release notes | summary / expanded / hidden | summary | Show new release notes once after an upgrade. |
| Notifications | off / long-running / always | off | Notify when a turn finishes or input is required. |
| Notify when | unfocused / always | unfocused | Suppress notifications while the terminal reports focus; terminals without focus reports use the selected notification policy. |
| Long turn | 15s / 30s / 1m / 2m | 30s | Minimum duration before a long-running notification. |

Notifications coalesce brief event bursts, prioritizing questions, approvals, and failures over successful completion. Returning to the terminal before a pending notification is sent cancels it when **Notify when** is `unfocused`.

Tool previews use the active theme's background colors with padding on every side. Prompt and tool-card backgrounds have paired text colors; ordinary reply text keeps the terminal's default foreground. Match `light` to a light terminal and the other palettes to a dark terminal. In 16-color mode, cards use neutral backgrounds and retain status labels and symbols. Turns share one presentation, described in [Keyboard and keys](keyboard.md#transcript); there is no transcript density setting. Legacy `foldDensity` and `expandTools` values are accepted but no longer affect the view.

Editor choices include installed VS Code, Cursor, VSCodium, Neovim, Vim, Nano, and Vi. Auto honors an existing `$VISUAL` or `$EDITOR` value, then prefers a detected graphical code editor before terminal editors. macOS app bundles and standard Windows installation locations are checked even when their launcher is absent from PATH. A manual selection applies immediately and persists across launches. Save and close the opened file to return; a missing saved editor is shown as unavailable so you can select another app. If no editor is found, install one and reopen Settings.

Motion controls presentation only: provider output still enters the live session immediately, and a tool boundary or settled assistant message flushes the visible stream without waiting for the animation.

Math in replies applies immediately to the live reply and reasoning view. Auto formats inline Greek letters, symbols and scripts, and lays out standalone fractions, roots, limits, matrices, cases and aligned equations using terminal characters. Unsupported, incomplete or oversized formulas retain their complete LaTeX source instead of mixing source and converted fragments. This supports a bounded subset of TeX, not a browser math renderer. Copying replies and exporting sessions retain the original text; terminal history keeps the rows already shown.

Mermaid in replies uses terminal characters for supported flowcharts, sequence, state, class, ER, mindmap, timeline, pie and Git diagrams. Auto waits for the fenced block to close and draws only when parsing has no warnings and the whole diagram fits. Unsupported, incomplete, truncated or oversized diagrams retain their source; graph connections never wrap or clip to fit. Diagram colors follow the active theme. Source mode and reasoning views show Mermaid code. Copy and export retain the original Markdown; changing this preference refreshes the live view without rewriting terminal history.

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

The running profile watches this patch and applies changes after the write settles; a host with HMR disabled applies them on the next launch. `disabled` is a Loader option rather than plugin configuration, so the settings service cannot express it; these rows are written into a managed block in `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` instead, which is the surface the Harness reads while composing the tree. The block is delimited by comments and everything you wrote by hand around it is left alone.

Rows that back a command (`session-query` backs `/sessions`, `workspace` backs `@` mentions) and rows that make the agent unusable (`tool-fs`, `tool-bash`, `todo`) are deliberately not listed. `web_search` is also absent: it shares its row with `web_fetch`, so no row-level switch can express "search off, fetch on".

## Status line

| Row | Values | Default | Effect |
|---|---|---|---|
| Telemetry | on / off | on | Show session metrics on the second footer line; model and workspace metadata remain visible. |
| Context label | compact / full | compact | Use `Ctx` or `Context` before the occupancy value. |
| Context style | percent / bar / tokens / detailed | percent | Show percentage, a ten-cell occupancy bar, used/window tokens, or percentage with tokens. |

Status items are reordered and restyled in place: `Space` shows or hides an item, `Enter` starts moving one (`↑`/`↓` reorder, `←`/`→` choose the column), and each item has its own color.

First line, in default order: Model (`deepseek`), Effort (`max`), Path (`~/project`), Git (`main *1`), and Session, which is off by default because the terminal window title carries the session title regardless.

Second line telemetry groups, all shown by default: Context (`Ctx 1.6%`), Cache (`Cache 99%`), Tokens (`5.9M in`), Latency (`TTFT 1.2s`), Time (`LLM 16m51s`), and Activity (`3 turns`). Context style changes only the representation: `tokens` shows `Ctx 16.4K/1M`, `detailed` shows `Ctx 1.6% · 16.4K/1M`, and `bar` shows occupancy without also printing a percentage. Every style retains warning and error colors as occupancy rises. When the terminal is narrow, complete groups are selected in configured order. The default order prioritizes context, cache, tokens, and latency before durations and activity counts; a group that does not fit is skipped so a smaller later group can still appear.

## Persistence

Settings, model preferences, and logged-in credentials are live plugin config persisted into the active Profile's Cordis patch, `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` (with `$DSH_HOME`, then `~/.dsh`, standing in for the home itself); `/settings`, `/model`, and `/login` all write there. A `settings.yaml` left by an earlier release is imported once at startup — each section written into the Profile row with the same id — and the file is then renamed to `settings.yaml.imported`, while a section that no longer matches a row id is logged and stays only in the renamed file. See [Sessions and history](sessions.md) for the complete file list.

## Plugin settings

Mounted Harness plugins keep their settings in their own Profile row config. The `llm-deepseek` route accepts only Messages-compatible endpoints and rejects a `protocol` key with `protocol is not configurable; remove it and use a Messages-compatible baseURL`. Set a compatible `baseURL` for a custom gateway; the DeepSeek endpoint is selected by base URL.

## Related

- [Keyboard and keys](keyboard.md) — settings overlay keys and keybinding overrides
- [Troubleshooting](troubleshooting.md) — color environments and update behavior
- [Commands](commands.md) — `/settings`, `/model`, `/login`
