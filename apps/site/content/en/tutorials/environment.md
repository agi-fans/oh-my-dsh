---
description: Use the bottom-docked /settings panel to customize theme, language, live status line, favorite models, and reasoning effort.
---

# Tune your terminal and models

The defaults work well out of the box. Use this guide whenever you want to adjust colors, customize the status footer, set up fast model switching, or make mouse and notification behavior match your terminal habits.

## Open the bottom-docked `/settings` panel

Run `/settings` and press `Enter`. The panel **docks directly above the live status footer** instead of taking over the whole screen—your conversation stays visible above and your real status footer stays visible right underneath.

The panel is organized into five main tabs (a sixth `Advanced` tab appears only when an installed plugin exposes raw configuration fields):

| Tab | What it controls |
|---|---|
| `General` | UI language, update checks, and startup release notes |
| `Models` | DeepSeek account, built-in providers, and custom API endpoints |
| `Agent presets` | Default preset for new sessions (Standard, PTC code mode, and more) |
| `Plugins` | Built-in features (file recovery snapshots, Tmux context, Auto review, MCP, Codex/Claude integrations) and third-party plugins |
| `Terminal` | Theme, motion, mouse mode, keybindings, status footer, notifications, and input behavior |

Navigation inside `/settings`:

- `←` / `→` or `Tab` switches tabs; `↑` / `↓` moves focus; `Space` or `Enter` toggles or edits the selected row.
- Press `/` to search across all settings (the cursor stays visible as you type; press `Esc` to clear the search).
- Visual and status-line preferences **apply and save immediately**, showing a brief confirmation on the panel’s bottom hint line without cluttering your conversation. Multi-field forms (such as shell limits, subagents, or custom providers) let you review changes and save once with `Apply`.

## Five adjustments that make the biggest difference

### 1. Theme and language

- **Theme** (`Terminal → Theme`): Choose `Dark` (Catppuccin Mocha), `Light` (Catppuccin Latte), or `System` (adapts to your terminal palette). Pick `System` if you prefer your own terminal color scheme.
- **Language** (`General → Language`): Defaults to `Auto` (follows your locale between English and Simplified Chinese) or can be locked explicitly.

### 2. Customize the status footer live

When you move through `Terminal → Status line`, **changes take effect directly on the real status footer beneath the panel, with the focused item underlined live**:

- **Density:**
- `minimal` — context occupancy only.
- `standard` (recommended) — adds cache hit rate, first-token latency, and throughput.
- `verbose` — uses full labels and adds a third line for session totals when the terminal is wide enough.
- **Per-item toggles:** Hide or show individual items (model, effort, path, Git branch, session title, or individual metrics). Press `Ctrl+R` to restore inherited defaults.
- Metric labels (`Ctx`, `Cache`, `TTFT`) stay in English across UI languages so widths and positions never jump around.

### 3. Mouse and text selection (especially in tmux)

Under `Terminal → Mouse interaction`, pick the behavior that matches how you copy text:

| Mode | Best when |
|---|---|
| `Auto` (default) | You want scroll-wheel navigation and clickable arrows/buttons; hold `Shift` (or `Option` on some macOS terminals) to select raw text. |
| `On` | Force in-app mouse wheel and click handling. |
| `Off` | Hand the mouse completely back to your terminal for effortless drag-to-select while navigating omdsh with the keyboard. |

### 4. Desktop notifications for long turns

Enable `Terminal → Notifications` (off by default) to receive a terminal notification when a long turn finishes or when an approval prompt needs your attention while you are in another window.

### 5. External editor

Press `Ctrl+X` in the input box (or when writing plan feedback) to draft in your external editor. omdsh uses `$VISUAL` or `$EDITOR` by default, or you can set an explicit command under `Terminal → External editor` (such as `code --wait` or `nvim`).

## Fast model switching and reasoning effort

Real coding often alternates between a fast model for quick lookups and a stronger reasoning model for hard bugs:

1. **Favorite models:** Run `/model favorite` to add the current model to your quick-cycle list (`/model unfavorite` removes it). Press `Ctrl+P` / `Alt+P` anytime to cycle through favorites.
2. **Default vs. one-session switch:** Pressing `Enter` in `/model` updates the default for new sessions as well. To switch only for the active conversation, press `Ctrl+D` (`This session only`).
3. **Reasoning effort:** Press `Shift+Tab` to cycle reasoning effort (shown on the left of the status footer):
- Lower effort for quick file lookups, copy edits, and small fixes.
- Higher effort for refactors, tricky debugging, and architecture design.
4. **Thinking visibility:** Press `Ctrl+T` to show or hide thinking blocks in the conversation.

## Adding other model providers

Beyond DeepSeek, open `/login` or `Settings → Models` to configure other OpenAI- or Anthropic-compatible providers:

- Activate a provider from the built-in list with an API key, or
- Add a custom provider with your own ID, base URL, API protocol (`OpenAI Chat Completions`, `OpenAI Responses`, or `Anthropic Messages`), and model IDs.

## Quick local health check

If startup fails, models are missing, or sign-in behaves unexpectedly, run:

```sh
omdsh doctor
```

It checks your runtime environment, credentials, configuration, and plugins, and prints actionable fixes. See [Troubleshooting](../troubleshooting.md) for common symptoms and solutions.

## Next steps

- Ready for daily coding habits? Continue to [Give precise context and quick inputs](precise-context.md).
- Looking for every option and custom keybinding format? See [Settings](../settings.md).
