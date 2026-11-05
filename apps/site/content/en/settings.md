---
description: "Every omdsh setting: appearance, motion, notifications, UI and response languages, optional features, and the configurable two-line status footer, with defaults and persistence."
---

# Settings

`/settings` opens the settings overlay. `Tab` and `Shift+Tab` switch between General, Models, Agent presets, Plugins, and Terminal; Advanced appears only when the profile has unclaimed plugin fields; `↑`/`↓` move between rows and `←`/`→` change a value. Type a name or press `/` to search across categories, including field names. Search retains the selected result after editing. `Esc` clears the query, then returns to browsing, then closes Settings; `Ctrl+U` clears the query directly. Narrow terminals show the current category and its position so `Tab` navigation remains visible. The complete overlay keys are in [Keyboard and keys](keyboard.md).

**Thinking in turns** starts collapsed by default. Shown keeps thoughts expanded while work runs; an existing explicit preference is retained. `Ctrl+T` changes the preference, and `Ctrl+O` lets you open or close individual thoughts and tool calls without changing it. See [Transcript navigation](keyboard.md).

## Product configuration

Built-in capabilities appear in the product category that owns the task. Command hooks compatibility shows its current value directly; use `←`/`→` or `Space` to change it. Press `Enter` on a configuration row to open its settings; `Esc` returns to that same row, even when enabling an integration changes the available settings. Empty categories are omitted.

| Category | Configuration |
|---|---|
| General | UI and response languages, Default access for new sessions, and explicitly labelled Current session access and Current goal actions. |
| Models | Current model and reasoning, Model providers, provider sign-in, and sign-out. Model selection also saves the default unless the session-only action is used. |
| Agent presets | Default Agent preset for new sessions and Current session preset for a blank session. |
| Plugins | Plugin management, Shell limits, tool parallelism, subagents, web providers, command hooks, native integrations and optional feature toggles. |
| Terminal | Appearance, input, notifications, startup preferences and the Status line group. |
| Advanced | Unclaimed live fields and installed plugins without a product form. It is hidden when empty. |

In Plugins, Codex and Claude Code offer Enable/Disable, direct Model and Permissions editors, restoration of inherited values, and Installation status. Their overview shows Enabled, Disabled, Unavailable or Load error, read from Plugin Manager. Installation status checks package registration rather than native authentication and stays open until dismissed; model settings appear after the provider is active. Installation and uninstallation remain in `/plugins`; its **Integration settings** action opens this same form. Native environment overrides remain in the Profile patch and are not displayed in the generic form.

**Web search and fetch** in Plugins combines provider selection, Search API result counts and legacy Messages settings in one draft. Other web plugin options remain in Advanced.

Advanced honors each plugin's automatic-form policy and omits fields already represented in product controls, including TUI appearance, language, and the structured status-line editor. Hidden, disabled and deprecated fields are omitted. New unclaimed fields remain available without duplicating their owner's product form.

Each field shows its effective value and whether it is inherited or overridden in this Profile. Product fields open directly in an editor with the current choice selected or value prefilled. Durations and byte limits accept readable units such as `30s`, `2m`, `512 KiB` and `2 MiB`. **Restore inherited setting…** opens a field chooser and confirmation; `Ctrl+R` on a settings row also restores inheritance. Advanced keeps its **Set value** / **Reset to inherited** actions. Edits validate against the plugin schema and save with the revision shown by the form. A concurrent change refuses the write rather than overwriting it. Strings use plain input; Subagent allowed models use a catalog selector. Other arrays, dictionaries and structured fields in Advanced use JSON. Hidden or disabled schema fields are omitted. Compound fields containing secrets remain protected; use `/login` or their owning configuration instead.

Secret inputs are masked and are never shown in notices. Setting an `apiKey` beside `apiKeyEnv` saves the key through Harness credentials and writes only its reference into the Profile. Resetting that key removes both Profile fields so inheritance applies again; it does not revoke an inherited credential or erase a key from the credential store. Credential-reference fields retain the Harness environment and credential-source inheritance.

Settings are saved to the active Profile. Appearance applies immediately; response language applies from the next turn, child-model selection applies to new sessions. Only active, schema-declared live fields appear here; ordinary deployment options still belong in the Profile patch. [Plugins](plugins.md) describes enablement and installation.

### Shell and tool parallelism

**Plugins → Shell** and **Plugins → Tool parallelism** each use a draft. Edits, empty-input resets and **Restore inherited setting…** remain unsaved until **Apply**. `Ctrl+R` on either settings entry opens a reset chooser that also stages the change. **Cancel** or `Esc` discards the draft. Each row distinguishes **Draft**, **Profile override** and **Inherited**; Apply writes all changed fields in that form with one revision check. Save failures retain the draft for retry. A concurrent configuration change requires cancelling and reopening instead of overwriting newer values.

Shell keeps readable units such as `30s`, `2m`, `512 KiB` and `2 MiB`. **Default timeout** is used when a command does not specify one; **Maximum timeout** caps both defaults and explicit requests. A larger default is clamped by the executor. **Output limit** bounds the in-memory tail of each stream by default, while **Retained output limit** bounds each spill file; a command may override its stdout memory limit. **Shutdown grace** is the wait before forced termination. Shell values must be positive and finite, and shutdown grace must not exceed 2147483647 ms. These settings apply to new commands. The same editor follows the mounted Bash or PowerShell executor; platform-specific fields stay in Advanced.

**Parallel tool calls** is a positive whole number limiting parallel-safe tool calls within one step. Other calls remain serial. It applies to subsequent tool batches and does not change subagent capacity.

### Subagents

**Plugins → Subagents** combines delegation depth, concurrent subagents and model selection in one draft. Field edits and **Restore inherited setting…** remain staged until **Apply**; leaving the form discards unsaved changes. The model-selection switch and allowed routes save together. Enabling requires at least one route; disabling retains the list. The default is disabled.

Depth counts the main agent as 0, its children as 1, and their children as 2; a tool’s own depth limit takes precedence. Capacity counts live subagents across all levels under one main agent, excluding that main agent. These limits govern future delegations; lowering capacity does not stop existing children. Model selection applies only to new sessions: existing sessions retain their policy, and `subagent_fork` inherits the parent route.

In **Allowed models**, search the catalog, press `Space` to toggle models and `Enter` to retain the selection in the draft. Saved routes outside the catalog stay removable and are marked **Currently unavailable**. Adapter and settings changes refresh the catalog without dropping selections; failed providers do not hide successful ones. Return to **Subagents → Refresh models** to retry. Loading does not block cancellation.

Apply checks each section's original revision. The limits and model policy are independent writes: a failed section keeps its draft for retry, while successful sections stay saved and are not written again. A conflicting draft cannot overwrite newer settings; cancel and reopen to load them.

Product forms and save notices use task and field labels; Advanced retains technical namespaces and paths. Schema help appears beside each field. Settings continue to write the original plugin entry rather than copying configuration into TUI preferences.

### Command hooks

In **Plugins**, choose **Command hooks**. Set **Configuration file** first, then **Hook compatibility** to `codex` or `claude-code`; `off` is the default and disables execution. An empty path uses `.codex/hooks.json` or `.claude/settings.json` relative to the process working directory. Paths can point to existing compatible configurations; editing their contents requires a restart or switching the bridge off and on.

The selected published bridge runs its supported synchronous command hooks. Codex maps SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop; Claude Code follows its published event subset. Unsupported async, prompt and agent hooks are not executed. Blocking decisions and failures appear in the transcript and remain in the log. Enabling hooks does not replay SessionStart for an existing session. Only one bridge is active at a time.

## DeepSeek account

Open **Models → DeepSeek account** for sign-in, profile and wallet balances. `/login` → **DeepSeek account** uses the same page and starts browser authorization when signed out. The browser completes sign-in through the local callback host; authorization can be cancelled, and successful sign-in returns to the account page automatically. Signing out requires confirmation, removes the shared local grant and revokes it in the background; API keys and the browser session are retained.

Profile and balances load independently. **Refresh** retries failed queries; a balance failure is shown as unavailable, never as zero. Recharge and bonus wallets stay separate, retain their currency, and display two decimal places; positive balances below one cent show `<0.01`. External grant changes clear old details, and live sign-in expiry produces one brief notice without replaying it on resume. Account requests use the active UI language and current time-zone offset.

**Use account route** opens the existing model picker restricted to `deepseek-account`. Enter saves the selected default, while **This session only** changes only the current session. Browsing the account page does not change the selected model.

## Model providers

Open **Models → Model providers** to browse configured providers, credential status, model counts and catalog diagnostics. Provider names remain literal in every UI language. The list refreshes on Harness configuration, credential and adapter events; **Refresh** also reloads it. DeepSeek Account appears when it has available models and opens the shared account page.

Choose a provider to edit its API key, base URL and model list. Custom APIs also expose their display name and protocol; their provider ID remains fixed. Changes stay in a draft until **Apply**. **Cancel** or Esc discards unapplied edits and returns through the provider list to the selected Settings row. Stored keys are never read into the input; a blank key keeps existing authentication. Saving, adding or removing a provider does not change the selected model: use `/model` to select an available route.

**Model list** opens individual models for editing their ID, display name, context window, maximum output tokens and text/image input types. IDs must be unique, capacities must be positive whole numbers, and input selections need at least one type. Empty optional text or capacity fields restore inheritance; input types have a separate reset action. Add models from the list, confirm deletion from a model’s details, and use Alt+Up/Down to reorder the selected model. **Keep model** and **Keep list** retain edits in the provider draft; only **Apply** saves them. Cancel or Esc discards edits made in the current model or list editor. Merely viewing an inherited catalog does not create an override, and unedited model fields are preserved.

Custom API models also expose **Reasoning levels**, with choices read from the installed Harness schema. Select levels, then edit each thinking level’s API value; an empty value uses the level name. Off disables reasoning and has no editable API value. Enabled reasoning requires at least one thinking level. Unknown stored levels survive edits, and the editor offers explicit disable and inheritance reset actions. Built-in catalog and DeepSeek models retain adapter-owned reasoning capabilities.

**Fetch available models** uses the installed catalog when the adapter supports it, or asks the configured endpoint. Its searchable selection updates only the draft, preserves existing model options, and keeps configured models absent from the response. **Restore default models** removes the catalog override for built-in providers; Apply that reset before editing the restored list. Editing an inherited pi-ai catalog carries existing per-model overrides into the replacement list. Selecting text-only input for a DeepSeek model, or restoring its text-only default, also removes its image limits.

**Add model provider** offers dormant catalog providers and custom APIs when the corresponding adapter settings are available. A custom API requires a unique ID, an HTTP(S) endpoint, a supported protocol and at least one model. **Delete provider** is available only for a provider supplied solely by the user layer and names the provider before confirmation. It removes only an omdsh-managed local key belonging to that route; shared references and external credentials remain in place.

Writes check the displayed configuration revision. A conflict retains the draft and asks you to cancel and reopen with current settings. Other save failures retain the editor for retry. If configuration succeeds but storing the key fails, Apply retries the key stage; cancelling at that point leaves the already-saved configuration in place. Credential status reports the detected source, not a successful connection test.

## Web search and fetch

Open **Plugins → Web search and fetch** to select search and fetch providers from their live registrations. Official providers appear first, followed by plugin provider IDs. A saved provider that is not registered remains visible as **Not loaded**; an unusable registered provider shows **Unavailable**. The picker refreshes on registration changes. A failed directory read retains the last list and offers **Refresh**. Provider descriptions explain authentication and execution; availability does not prove a successful network connection.

The shipped defaults remain `deepseek-search-api` and `deepseek-fetch-api`. They call DeepSeek directly without an auxiliary model turn; hosted fetch avoids local fake-IP DNS failures. This intentionally differs from Harness Web’s Direct fetch default. Choose **Direct fetch** (`http`) for retrieval from this computer, or **DeepSeek (legacy)** (`deepseek-official`) for search through an auxiliary Messages model turn. Account sessions use the conversation’s DeepSeek account where supported; other requests use the configured key reference. `/login` supplies the default `DEEPSEEK_API_KEY` reference.

**Results per search** accepts integers from 1 to 50. Legacy search exposes its key, separate Messages base URL and positive integer **Maximum searches per request**. Empty numeric or endpoint inputs restore inheritance, and selecting the deployment’s provider removes the local selection override. **Automatic** is offered only when deployment configuration leaves that provider unspecified; environment selection may still apply, and multiple usable providers without a selection are ambiguous. Unedited settings stay unchanged.

Only **Apply** writes the draft. Parameter changes save before credentials and provider selection, so a failed parameter or key write leaves the selection unsaved. Successful sections remain saved; retry writes only outstanding changes, and Cancel cannot undo successful writes. A revision conflict preserves the draft for inspection and requires cancelling and reopening. Switching away from legacy search discards its unsaved key but preserves endpoint and limit drafts. Stored keys are never displayed; a replacement writes the existing credential reference, which may be shared by other consumers. If that reference changes externally, its key draft is discarded. Externally managed credentials cannot be replaced here, and an inherited literal key that still takes precedence must be changed at its source.

## Terminal

Rows are grouped under Appearance, Input, Notifications and Startup.

| Row | Values | Default | Effect |
|---|---|---|---|
| Theme | dark, light, system | dark | Color palette. omdsh ships one dark palette, one light palette, and `system`, which derives surfaces and text color from the colors the terminal reports and follows a light terminal, including a light/dark switch mid-session on terminals that report it. Status labels and symbols remain primary; colored surfaces reinforce running, success and failure states. |
| Color | on / off | on | SGR styling. |
| Motion | full / reduced / off | full | `full` adds smooth streaming and a working shimmer, `reduced` keeps smooth streaming without the shimmer, and `off` follows provider chunks with static activity marks. |
| Math in replies | auto / source | auto | Format supported formulas as terminal text, or retain LaTeX delimiters and commands. |
| Mermaid in replies | auto / source | auto | Draw complete diagrams that fit, or show Mermaid source. |
| Terminal title | status / session / workspace / off | status | Show the root Agent state with the session name, retain only the session name, show state with workspace and Git branch, or stop setting the title. |
| Terminal status | auto / on / off | auto | Report root Agent lifecycle to supporting terminals; Auto waits for a capability reply, On forces reporting, and Off disables it. |
| Editor | Auto / detected editors | Auto | App used by file previews and `Ctrl+X` prompt editing. |
| Keybindings | Default / custom count | Default | Open the shortcut remapping picker, save to `keybindings.json`, and apply immediately. |
| Mouse interaction | auto / tui / native | auto | Handle scrolling, disclosure clicks and selection when needed, respect tmux mouse off in Auto, or leave mouse input to the terminal. |
| Enter while running | Queue / Steer | Queue | Choose whether Enter waits for the next turn or guides the next model step. Explicit Queue and Steer shortcuts stay fixed; idle sends and commands are unchanged. |
| Paste protection | on / off | on | Detect unmarked multiline pastes and rapid key streams so embedded Enter keys do not submit a message. |
| Copy on select | on / off | on | Copy on mouse release; when off, use `Alt+C`, `Enter`, or right-click. |
| Update checks | on / off | on | Check npm once a day and notify when a newer release is available. |
| Release notes | summary / expanded / hidden | summary | Show new release notes once after an upgrade. |
| Notifications | off / unfocused / always | off | Notify when a turn finishes or input is required. `unfocused` waits until the terminal loses focus; `always` reports regardless of focus. |

Notifications coalesce brief event bursts, prioritizing questions, approvals, and failures over successful completion. Returning to the terminal before a pending notification is sent cancels it in `unfocused` mode. A turn shorter than thirty seconds never notifies: the boundary decides whether an arriving notification is noise, so it is fixed rather than configurable.

Terminal title and Terminal status share the root Agent lifecycle with Herdr. Pending prompts take priority over running work; completion and failure remain visible until new work or a session switch. Inspecting a subagent does not replace the root state. Terminal status uses OSC 7501 and sends only the session name as optional metadata, never prompt bodies, tool arguments or errors. These controls apply immediately and clear owned metadata on exit; redirected input or output sends no terminal control sequences. The separate OSC 9 busy/idle indicator is gone: it repeated what Terminal status already reports through a weaker protocol.

Dark and light palettes adapt [Catppuccin Mocha and Latte](https://catppuccin.com/palette/) with blue interaction accents and stronger contrast for terminal text. Settings still offer only `dark`, `light`, and `system`. Ordinary reply text and the page background remain terminal-owned: use `light` with a light terminal, `dark` with a dark terminal, or `system` to follow reported terminal colors. Tool details use a neutral surface with padding on every side. Prompt and tool-card surfaces have paired text colors; state labels and symbols remain readable when limited terminal colors merge fills. Turns share one presentation, described in [Keyboard and keys](keyboard.md#transcript); there is no transcript density setting. Legacy `foldDensity` and `expandTools` values are accepted but no longer affect the view.

Editor choices include installed VS Code, Cursor, VSCodium, Neovim, Vim, Nano, and Vi. Auto honors an existing `$VISUAL` or `$EDITOR` value, then prefers a detected graphical code editor before terminal editors. macOS app bundles and standard Windows installation locations are checked even when their launcher is absent from PATH. A manual selection applies immediately and persists across launches. Save and close the opened file to return; a missing saved editor is shown as unavailable so you can select another app. If no editor is found, install one and reopen Settings.

Motion controls presentation only: provider output still enters the live session immediately, and a tool boundary or settled assistant message flushes the visible stream without waiting for the animation.

Math in replies applies immediately to the live reply and reasoning view. Auto formats inline Greek letters, symbols and scripts, and lays out standalone fractions, roots, limits, matrices, cases and aligned equations using terminal characters. Unsupported, incomplete or oversized formulas retain their complete LaTeX source instead of mixing source and converted fragments. This supports a bounded subset of TeX, not a browser math renderer. Copying replies and exporting sessions retain the original text; terminal history keeps the rows already shown.

Mermaid in replies uses terminal characters for supported flowcharts, sequence, state, class, ER, mindmap, timeline, pie and Git diagrams. Auto waits for the fenced block to close and draws only when parsing has no warnings and the whole diagram fits. Unsupported, incomplete, truncated or oversized diagrams retain their source; graph connections never wrap or clip to fit. Diagram colors follow the active theme. Source mode and reasoning views show Mermaid code. Copy and export retain the original Markdown; changing this preference refreshes the live view without rewriting terminal history.

## General

| Row | Values | Default | Effect |
|---|---|---|---|
| UI language | Auto / 简体中文 / English | Auto | Switches interface text immediately. |
| Response language | Follow UI / Auto / 简体中文 / English | Follow UI for new profiles | Preferred language for user-facing model communication, from the next turn. |

**Models → Model and reasoning** opens `/model`: it changes the current selection and saves the default route, unless you choose **This session only**. Model selection uses the selected model’s default effort; `/model reasoning` changes effort explicitly. **General → Default access** and **Agent presets → Default Agent preset** write Harness settings for new sessions only. Their **Current session** actions open `/permission` and `/agent`; a preset can change only before the first prompt. `Ctrl+R` restores inherited defaults. Creator is the user-facing name of the `cordis` preset; `/agent creator` or **/plugins → Let the agent create a plugin** enters it without submitting a prompt or changing the default preset.

UI language covers settings, the composer, common menus, approval controls and notifications. Auto follows `LC_ALL`, then `LC_MESSAGES`, then `LANG`: Chinese locales use Simplified Chinese; other or missing locales use English. Commands, shortcuts, model names, user text, tool output and files retain their original spelling. Untranslated extension text falls back to its source language. Switching updates the live view and leaves native terminal history intact.

Response language is independent. Follow UI resolves the interface language at the next turn; Auto adds no language instruction. Existing profiles keep their explicit language preference, or Auto when none was saved. Only newly created profiles start with Follow UI; restoring inheritance returns to Auto. The setting expresses a communication preference, not control over a model’s internal reasoning language; code, identifiers, commands, tool arguments, logs, quotations, and file contents keep their accurate forms, and an explicit language request for the current task still wins. The preference is user-level, so a resumed session uses the current value rather than a historical snapshot.

## Plugins

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

## Terminal → Status line

The footer and preview always use English labels, regardless of UI language. Settings controls and explanations follow the UI language. The preview is labelled as example data and includes a sample session title when that item is enabled.

| Row | Values | Default | Effect |
|---|---|---|---|
| Session metrics | on / off | on | Show session metrics below the first footer line; model and workspace metadata remain visible. Turning it off reclaims the rows it used. |
| Density | minimal / standard / verbose | standard | How much the footer says. `minimal` keeps occupancy — Context and Cache — with `Ctx` labels; `standard` adds Latency / speed (`TTFT`); `verbose` adds Tokens to the same line and gives Duration and Turns / steps a third, with long labels (`Context`) and the detailed context form. |

`Space` on any footer part shows or hides it: hiding is a statement about that number, so it survives a density change, while the parts the density itself decides are left alone. **Restore layout** confirms restoration of the inherited density and visibility.

Every part has a fixed place. An item’s on/off value is a preference: enabled metrics still require Session metrics to be on, enough terminal width, and data from the session. The selected row explains when the metrics switch is off. The first line keeps identity on the left — Model (`deepseek`), Effort (`max`), and Session — and place on the right — Path (`~/project`) and Git (`main *1`). Session is off below `verbose`, and can be enabled independently of the terminal window title.

The lines below the first answer two questions from opposite edges. Occupancy and elapsed time hold the left: Context (`Ctx 1.6%`), Cache (`Cache 99%`), and Duration (`LLM 16m51s`). Throughput and the amount of work hold the right: Tokens (`5.9M in`), Latency / speed (`TTFT 1.2s`), and Turns / steps (`3 turns`). The sides do not swap, so the same number is in the same place from one session to the next.

`verbose` puts the session's totals on a third line — Duration on the left, Turns / steps on the right — so the line above it never has to shed them. That line appears only once the line above is whole; below that width nothing is added back out of order.

The context representation follows the density — `standard` and `minimal` print a percentage, `verbose` prints `Context 1.6% · 16.4K/1M` — and every form keeps warning and error colors as occupancy rises. On a narrow terminal the visible set is a prefix of the catalog: fitting drops the last group, so Turns / steps goes before Duration, Duration before Latency / speed, and nothing reappears out of order as the terminal grows. Roles that need attention keep their own ink: a dirty branch stays `warning`, and a cache-hit percentage stays on the success color.

## Persistence

Saving an appearance or status-line edit writes only the fields you changed; other fields keep inheriting their defaults. Appearance and status-line changes preview immediately while saving. If saving fails, saved preferences are restored and the error remains visible until dismissed. Feature switches update only after their Profile patch is written; an unreadable existing patch is left intact.

Settings, model preferences, and logged-in credentials are live plugin config persisted into the active Profile's Cordis patch, `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` (with `$DSH_HOME`, then `~/.dsh`, standing in for the home itself); `/settings`, `/model`, and `/login` all write there. A `settings.yaml` left by an earlier release is imported once at startup — each section written into the Profile row with the same id — and the file is then renamed to `settings.yaml.imported`, while a section that no longer matches a row id is logged and stays only in the renamed file. See [Sessions and history](sessions.md) for the complete file list.

## Configuration ownership

Mounted Harness plugins keep their settings in their own Profile row config. The `llm-deepseek` route accepts only Messages-compatible endpoints and rejects a `protocol` key with `protocol is not configurable; remove it and use a Messages-compatible baseURL`. Set a compatible `baseURL` for a custom gateway; the DeepSeek endpoint is selected by base URL.

## Related

- [Keyboard and keys](keyboard.md) — settings overlay keys and keybinding overrides
- [Troubleshooting](troubleshooting.md) — color environments and update behavior
- [Commands](commands.md) — `/settings`, `/model`, `/login`
