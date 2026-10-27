---
description: "Every omdsh setting: appearance, motion, notifications, Agent language, optional features, and the configurable two-line status footer, with defaults and persistence."
---

# Settings

`/settings` opens the settings overlay. `Tab` and `Shift+Tab` switch between Interface, Agent, Tools, Status line, and Integrations; Advanced appears only when the profile has unclaimed plugin fields; `↑`/`↓` move between rows and `←`/`→` change a value. Type a name or press `/` to search across categories, including field names. Search retains the selected result after editing. `Esc` clears the query, then returns to browsing, then closes Settings; `Ctrl+U` clears the query directly. Narrow terminals show the current category and its position so `Tab` navigation remains visible. The complete overlay keys are in [Keyboard and keys](keyboard.md).

## Product configuration

Built-in capabilities appear in the product category that owns the task. Advisor, Command hooks compatibility, and Subagent model selection show their current value directly; use `←`/`→` or `Space` to change it. Press `Enter` on a configuration row to open its settings; `Esc` returns to that same row, even when enabling an integration changes the available settings. Empty categories are omitted.

| Category | Configuration |
|---|---|
| Interface | Appearance, input, notifications and startup preferences. |
| Agent | Model and reasoning, Access, Agent preset, Language, Subagents and Subagent models. |
| Tools | Tool parallelism, Shell timeout/output limits and optional feature toggles. The shell executor's host-level `cwd` is intentionally not offered: every session runs in its current working directory. |
| Status line | Footer layout, visibility, context style and colors. |
| Integrations | Web providers, Web search · API, Web search · Messages, Advisor, Command hooks, Codex, and Claude Code. |
| Advanced | Unclaimed live fields and installed plugins without a product form. It is hidden when empty. |

In Integrations, Codex and Claude Code offer Enable/Disable, direct Model and Permissions editors, restoration of inherited values, and Installation status. Their overview shows Enabled, Disabled, Unavailable or Load error, read from Plugin Manager. Installation status checks package registration rather than native authentication and stays open until dismissed; model settings appear after the provider is active. Installation and uninstallation remain in `/plugins`; its **Integration settings** action opens this same form. Native environment overrides remain in the Profile patch and are not displayed in the generic form.

**Web providers** selects the search and fetch backend; the shipped default is `deepseek-search-api`/`deepseek-fetch-api`, which make one direct DeepSeek API request without an auxiliary model turn. **Web search · API** configures that provider’s API key reference, endpoint, result count, and whether the triggering question is sent; on a `deepseek-account` session the shared account token takes precedence over the API key; `/login` stores the official key under the upstream `DEEPSEEK_API_KEY` reference, so an official API login is enough. **Web search · Messages** keeps the fallback Messages provider’s limits, key reference, endpoint, model, and API version; select `deepseek-official` under Web providers to use it, or `http` for the local fetch fallback.

Advanced honors each plugin's automatic-form policy and omits fields already represented in product controls, including TUI appearance, language, and the structured status-line editor. Hidden, disabled and deprecated fields are omitted. New unclaimed fields remain available without duplicating their owner's product form.

Each field shows its effective value and whether it is inherited or overridden in this Profile. Product fields open directly in an editor with the current choice selected or value prefilled. Durations and byte limits accept readable units such as `30s`, `2m`, `512 KiB` and `2 MiB`. **Restore inherited setting…** opens a field chooser and confirmation; `Ctrl+R` on a settings row also restores inheritance. Advanced keeps its **Set value** / **Reset to inherited** actions. Edits validate against the plugin schema and save with the revision shown by the form. A concurrent change refuses the write rather than overwriting it. Strings use plain input; Subagent allowed models use a catalog selector. Other arrays, dictionaries and structured fields in Advanced use JSON. Hidden or disabled schema fields are omitted. Compound fields containing secrets remain protected; use `/login` or their owning configuration instead.

Secret inputs are masked and are never shown in notices. Setting an `apiKey` beside `apiKeyEnv` saves the key through Harness credentials and writes only its reference into the Profile. Resetting that key removes both Profile fields so inheritance applies again; it does not revoke an inherited credential or erase a key from the credential store. Credential-reference fields retain the Harness environment and credential-source inheritance.

Settings are saved to the active Profile. Appearance applies immediately; Agent language applies from the next turn, child-model selection applies to new sessions. **Advisor** is off until you choose Codex or Claude Code. The chosen model is what `consult_advisor` reaches and what `/advisor` uses by default; naming a provider on the command line overrides it for that request. A consultation is a paid request to another vendor's model, and no budget cap is applied — enabling it is the acknowledgement. Only active, schema-declared live fields appear here; ordinary deployment options still belong in the Profile patch. [Plugins](plugins.md) describes enablement and installation.

In **Agent → Subagent models → Allowed models**, search the model catalog, press `Space` to toggle models and `Enter` to save. Current routes are preselected; configured routes outside the catalog remain available. Choose at least one model before enabling model selection. New sessions sample the allowlist and expose only those exact routes to `subagent`; existing sessions retain their choice, and `subagent_fork` inherits the parent route. The default is disabled.

Product forms and save notices use task and field labels; Advanced retains technical namespaces and paths. Schema help appears beside each field. Settings continue to write the original plugin entry rather than copying configuration into TUI preferences.

### Command hooks

In **Integrations**, choose **Command hooks**. Set **Configuration file** first, then **Hook compatibility** to `codex` or `claude-code`; `off` is the default and disables execution. An empty path uses `.codex/hooks.json` or `.claude/settings.json` relative to the process working directory. Paths can point to existing compatible configurations; editing their contents requires a restart or switching the bridge off and on.

The selected published bridge runs its supported synchronous command hooks. Codex maps SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop; Claude Code follows its published event subset. Unsupported async, prompt and agent hooks are not executed. Blocking decisions and failures appear in the transcript and remain in the log. Enabling hooks does not replay SessionStart for an existing session. Only one bridge is active at a time.

## Interface

Rows are grouped under Appearance, Input, Notifications and Startup.

| Row | Values | Default | Effect |
|---|---|---|---|
| Theme | dark, light, system | dark | Color palette. omdsh ships one dark palette, one light palette, and `system`, which derives surfaces and text color from the colors the terminal reports and follows a light terminal, including a light/dark switch mid-session on terminals that report it. A tool card names its state by fill: neutral while running, green when the call succeeded, and red when it failed. |
| Color | on / off | on | SGR styling. |
| Motion | full / reduced / off | full | `full` adds smooth streaming and a working shimmer, `reduced` keeps smooth streaming without the shimmer, and `off` follows provider chunks with static activity marks. |
| Math in replies | auto / source | auto | Format supported formulas as terminal text, or retain LaTeX delimiters and commands. |
| Mermaid in replies | auto / source | auto | Draw complete diagrams that fit, or show Mermaid source. |
| Terminal title | status / session / workspace / off | status | Show the root Agent state with the session name, retain only the session name, show state with workspace and Git branch, or stop setting the title. |
| Terminal status | auto / on / off | auto | Report root Agent lifecycle to supporting terminals; Auto waits for a capability reply, On forces reporting, and Off disables it. |
| Editor | Auto / detected editors | Auto | App used by file previews and `Ctrl+X` prompt editing. |
| Keybindings | Default / custom count | Default | Open the shortcut remapping picker, save to `keybindings.json`, and apply immediately. |
| Mouse interaction | auto / tui / native | auto | Handle scrolling and selection when needed, respect tmux mouse off in Auto, or leave mouse input to the terminal. |
| Paste protection | on / off | on | Detect unmarked multiline pastes and rapid key streams so embedded Enter keys do not submit a message. |
| Copy on select | on / off | on | Copy on mouse release; when off, use `Alt+C`, `Enter`, or right-click. |
| Update checks | on / off | on | Check npm once a day and notify when a newer release is available. |
| Release notes | summary / expanded / hidden | summary | Show new release notes once after an upgrade. |
| Notifications | off / unfocused / always | off | Notify when a turn finishes or input is required. `unfocused` waits until the terminal loses focus; `always` reports regardless of focus. |

Notifications coalesce brief event bursts, prioritizing questions, approvals, and failures over successful completion. Returning to the terminal before a pending notification is sent cancels it in `unfocused` mode. A turn shorter than thirty seconds never notifies: the boundary decides whether an arriving notification is noise, so it is fixed rather than configurable.

Terminal title and Terminal status share the root Agent lifecycle with Herdr. Pending prompts take priority over running work; completion and failure remain visible until new work or a session switch. Inspecting a subagent does not replace the root state. Terminal status uses OSC 7501 and sends only the session name as optional metadata, never prompt bodies, tool arguments or errors. These controls apply immediately and clear owned metadata on exit; redirected input or output sends no terminal control sequences. The separate OSC 9 busy/idle indicator is gone: it repeated what Terminal status already reports through a weaker protocol.

Tool previews use the active theme's background colors with padding on every side. Prompt and tool-card backgrounds have paired text colors; ordinary reply text keeps the terminal's default foreground. Match `light` to a light terminal and `dark` or `system` to a dark one. A card's fill alone names its state — neutral while running, green on success, red on failure — and that distinction survives on 16-color terminals, where the pending and success fills are the only pair that must share an entry. Turns share one presentation, described in [Keyboard and keys](keyboard.md#transcript); there is no transcript density setting. Legacy `foldDensity` and `expandTools` values are accepted but no longer affect the view.

Editor choices include installed VS Code, Cursor, VSCodium, Neovim, Vim, Nano, and Vi. Auto honors an existing `$VISUAL` or `$EDITOR` value, then prefers a detected graphical code editor before terminal editors. macOS app bundles and standard Windows installation locations are checked even when their launcher is absent from PATH. A manual selection applies immediately and persists across launches. Save and close the opened file to return; a missing saved editor is shown as unavailable so you can select another app. If no editor is found, install one and reopen Settings.

Motion controls presentation only: provider output still enters the live session immediately, and a tool boundary or settled assistant message flushes the visible stream without waiting for the animation.

Math in replies applies immediately to the live reply and reasoning view. Auto formats inline Greek letters, symbols and scripts, and lays out standalone fractions, roots, limits, matrices, cases and aligned equations using terminal characters. Unsupported, incomplete or oversized formulas retain their complete LaTeX source instead of mixing source and converted fragments. This supports a bounded subset of TeX, not a browser math renderer. Copying replies and exporting sessions retain the original text; terminal history keeps the rows already shown.

Mermaid in replies uses terminal characters for supported flowcharts, sequence, state, class, ER, mindmap, timeline, pie and Git diagrams. Auto waits for the fenced block to close and draws only when parsing has no warnings and the whole diagram fits. Unsupported, incomplete, truncated or oversized diagrams retain their source; graph connections never wrap or clip to fit. Diagram colors follow the active theme. Source mode and reasoning views show Mermaid code. Copy and export retain the original Markdown; changing this preference refreshes the live view without rewriting terminal history.

## Agent

| Row | Values | Default | Effect |
|---|---|---|---|
| Language | Auto / Simplified Chinese / English | Auto | Preferred language for reasoning and replies. |

**Model and reasoning**, **Access** and **Agent preset** open the existing `/model`, `/permission` and `/agent` selectors when those commands are available. Model selection saves the default route; Access and Agent preset affect the current session.

A non-Auto choice applies from the next turn; code, identifiers, commands, tool arguments, logs, quotations, and file contents keep their accurate forms, and an explicit language request for the current task still wins. The preference is user-level, so a resumed session uses the current value rather than a historical snapshot.

## Tools

Shell offers the active platform’s timeout and output limits: Bash on POSIX and PowerShell on Windows use the same form and save to their respective owners. Optional feature rows control capabilities that cost context, runtime, or transcript noise; each row turns one composition row off.

**File recovery snapshots** is Off by default. Turn it on to save private file contents for new Turns and restore selected files with Session Tree’s `Alt+R`. Captures use disk space and add work. Changes apply to the next Turn; a capture already started continues when the switch is turned Off. Existing complete snapshots remain readable when Off. See [Restore Turn files](sessions.md#restore-turn-files). This switch edits the recovery plugin’s configuration; the feature rows below instead enable or disable composition rows.

| Row | Default | Effect when off |
|---|---|---|
| Changed-file summary | On | No per-turn changed-file record, and no Git snapshots at turn start and turn end. |
| Session history tools | On | The model loses `session_search`, `session_event_search`, `session_trace`, `session_event_trace` and `session_event_read`. |
| Ralph loop | Off | The loop tool stays absent until you turn it on here. |
| Repeat-tool reminder | On | The model gets no nudge out of identical tool-call loops. |

The running profile watches this patch and applies changes after the write settles; a host with HMR disabled applies them on the next launch. `disabled` is a Loader option rather than plugin configuration, so the settings service cannot express it; these rows are written into a managed block in `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` instead, which is the surface the Harness reads while composing the tree. The block is delimited by comments and everything you wrote by hand around it is left alone.

Rows that back a command (`session-query` backs `/resume`, `workspace` backs `@` mentions) and rows that make the agent unusable (`tool-fs`, `tool-bash`, `todo`) are deliberately not listed. `web_search` is also absent: it shares its row with `web_fetch`, so no row-level switch can express "search off, fetch on".

## Status line

| Row | Values | Default | Effect |
|---|---|---|---|
| Telemetry | on / off | on | Show session metrics on the second footer line; model and workspace metadata remain visible. |
| Density | minimal / standard / verbose | standard | How much the footer says. `minimal` keeps occupancy and cost with `Ctx` labels; `standard` shows every telemetry group with `Ctx`; `verbose` uses long labels (`Context`) and the detailed context form. |

`Space` on any footer part shows or hides it, and the choice keeps applying across densities. **Restore layout** confirms restoration of the inherited density and visibility.

Every part has a fixed place, and there is nothing to drag: a row says only whether that part appears. The first line keeps identity on the left — Model (`deepseek`), Effort (`max`), and Session — and place on the right — Path (`~/project`) and Git (`main *1`). Session is off below `verbose`, because the terminal window title carries the session title regardless. The second line lists Context (`Ctx 1.6%`), Cache (`Cache 99%`), Tokens (`5.9M in`), Latency (`TTFT 1.2s`), Time (`LLM 16m51s`), and Activity (`3 turns`), in that order at every density.

The context representation follows the density — `standard` and `minimal` print a percentage, `verbose` prints `Ctx 1.6% · 16.4K/1M` — and every form keeps warning and error colors as occupancy rises. On a narrow terminal complete groups are taken in catalog order, so a group that does not fit is skipped and a smaller later group can still appear; nothing moves to a second column or changes place as the terminal grows. Roles that need attention keep their own ink: a dirty branch stays `warning`, and a cache-hit percentage stays on the success color.

## Persistence

Saving an appearance or status-line edit writes only the fields you changed; other fields keep inheriting their defaults. Appearance and status-line changes preview immediately while saving. If saving fails, saved preferences are restored and the error remains visible until dismissed. Feature switches update only after their Profile patch is written; an unreadable existing patch is left intact.

Settings, model preferences, and logged-in credentials are live plugin config persisted into the active Profile's Cordis patch, `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` (with `$DSH_HOME`, then `~/.dsh`, standing in for the home itself); `/settings`, `/model`, and `/login` all write there. A `settings.yaml` left by an earlier release is imported once at startup — each section written into the Profile row with the same id — and the file is then renamed to `settings.yaml.imported`, while a section that no longer matches a row id is logged and stays only in the renamed file. See [Sessions and history](sessions.md) for the complete file list.

## Configuration ownership

Mounted Harness plugins keep their settings in their own Profile row config. The `llm-deepseek` route accepts only Messages-compatible endpoints and rejects a `protocol` key with `protocol is not configurable; remove it and use a Messages-compatible baseURL`. Set a compatible `baseURL` for a custom gateway; the DeepSeek endpoint is selected by base URL.

## Related

- [Keyboard and keys](keyboard.md) — settings overlay keys and keybinding overrides
- [Troubleshooting](troubleshooting.md) — color environments and update behavior
- [Commands](commands.md) — `/settings`, `/model`, `/login`
