---
description: Install omdsh, sign in, choose a model, inspect a project, complete one small code edit, and review the diff.
---

# Complete your first change

This tutorial walks you through one complete coding loop in about five minutes: installing omdsh, signing in, asking the agent to inspect a repository, making a small safe edit, and verifying the result in `/diff`.

## Requirements and installation

Before you start, make sure you have:

- Node.js 22.19+ (22.x) or Node.js 24+ (check with `node -v`)
- An interactive terminal (macOS Terminal, iTerm2, Ghostty, Kitty, WezTerm, Windows Terminal, and similar)
- A DeepSeek account or a DeepSeek API key (other providers are supported too)

Install globally and start omdsh inside any repository you want to work on:

```sh
npm install --global @agi-fans/oh-my-dsh
cd /path/to/your-project
omdsh
```

To try omdsh without installing globally, run `npx @agi-fans/oh-my-dsh`.

When omdsh opens, you see three areas: the welcome header at the top, the conversation transcript in the middle, and an anchored **input box** (`🐳`) with the **status footer** at the bottom showing your model, reasoning effort, workspace path, Git branch, and live metrics.

## Sign in and select a model

Run `/login` in the input box and press `Enter`:

1. **DeepSeek account (recommended):** Choose `DeepSeek account`. Your browser opens for authorization, and omdsh saves the sign-in automatically. If you already signed in with DSH Web or Desktop, omdsh reuses that sign-in right away.
2. **API key:** Choose `DeepSeek` and paste your API key. omdsh validates it and stores it in your local credentials file. If you prefer environment variables, set `DEEPSEEK_API_KEY` before launching.

Next, run `/model` to pick a model:

- If you signed in with a **DeepSeek account**, pick a model under `deepseek-account`.
- If you signed in with an **API key**, pick a model under `deepseek`.

Your chosen model appears immediately on the left of the status footer. If you want a one-off model switch without changing your default, press `Ctrl+D` in the model picker to choose `This session only`.

## Step 1: Inspect the project first

Start with a read-only question so you can see how omdsh reads files and presents its work:

```text
Summarize this project's directory structure, entry points, and how to run tests. Do not modify any files yet.
```

Watch what happens as it works:

- **Compact progress:** Thinking and tool calls appear as compact rows while running and fold into a single duration line (`Worked for …`) once finished, keeping the final answer expanded.
- **Inspect on demand:** Press `Ctrl+O` to expand or collapse thinking and tool details for completed turns, or click the disclosure arrow next to any step.
- **Live footer metrics:** The second footer line updates with context occupancy (`Ctx`), cache hit rate (`Cache`), time to first token (`TTFT`), and throughput (`tok/s`).

## Step 2: Make a small edit and review it in `/diff`

Now ask for a small, verifiable change—for example adding a unit test or a focused helper improvement:

```text
Inspect the date formatting helper in src/utils, add a unit test for an empty-string input, and run the test suite to verify.
```

This introduces the two safety checks you will use every day:

1. **Permissions (`/permission`):**
- The default `Workspace write` level lets the agent read and edit files inside the current workspace.
- If a command reaches outside the workspace or needs explicit consent, a **warning-bordered approval card** opens at the bottom showing exactly what will run. You can allow once, reject, or remember the rule.
- Switch to `Read only` anytime when exploring unfamiliar code, or try built-in `Auto review` for an extra automated check before sensitive actions. See [Permissions and safety](../permissions.md).
2. **Diff review (`/diff`):**
- When a turn edits files, a `Changed` summary appears in the conversation. Click a filename or run `/diff` to open the interactive diff viewer.
- On wide terminals, `/diff` shows the file list on the left and the diff on the right. Press `V` to toggle between diff and full file view, or `Esc` to return.
- Need a tweak on specific lines? Select them in `/diff` and press `Alt+Y` (or press `Q`) to quote the file location straight back into your input box.

## Four habits worth remembering right away

- **Send vs. newline:** `Enter` sends your prompt; `Shift+Enter` or `Ctrl+J` inserts a newline (`Ctrl+J` works in almost every terminal).
- **Selecting text:** Because mouse scrolling and clicks are active by default, hold `Shift` (or `Option` in some macOS terminals) while dragging to select text with your terminal, or adjust `Settings → Terminal → Mouse interaction`.
- **Interrupt and exit:** Press `Esc` or `Ctrl+C` while the agent is working to stop the current turn. At idle, press `Ctrl+C` twice to exit—omdsh prints an `omdsh --resume <session-id>` command so you can pick up right where you left off.
- **Built-in help:** Type `/` for command completion, `/help` to search commands, or `/help full` to browse every active shortcut.

## Next steps

- Want to tweak the theme, language, status footer, or favorite models? Continue to [Tune your terminal and models](environment.md).
- Happy with the defaults? Jump straight to [Give precise context and quick inputs](precise-context.md) for everyday productivity habits.
