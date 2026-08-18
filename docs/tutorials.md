# Tutorials

[English](tutorials.md) | [简体中文](tutorials.zh-CN.md)

These task-based walkthroughs cover the path from a fresh installation to reliable day-to-day use. They assume Node.js 22.19 or later in the 22.x line, or Node.js 24 or newer, a terminal with TTY support, and a DeepSeek API key for live model turns.

## Tutorial 1: Complete your first task

### Install and launch

Install the command globally, change into the project you want the agent to understand, and start omdsh there:

```sh
npm install --global @agi-fans/oh-my-dsh
cd /path/to/your/project
omdsh
```

Use `npx @agi-fans/oh-my-dsh` instead when you want to try the current package without a global installation. The startup directory becomes the session workspace, while the status line resolves the surrounding Git repository when one is available.

### Sign in securely

Run `/login`. omdsh opens the DeepSeek API Key page, asks for the key in a masked prompt, validates it, and saves it through the Harness credential store. Never append a key to the command: `/login <key>` is deliberately rejected so the secret does not enter command history or the transcript.

An externally managed `DEEPSEEK_API_KEY` remains a supported fallback. A key selected through `/login` takes priority on later requests and across restarts; `/logout` removes only the omdsh-managed choice and falls back to the environment when available.

### Configure the session before the first prompt

omdsh keeps four concepts separate instead of collapsing them into one mode:

| Concept | Command | Choices |
|---|---|---|
| Agent | `/agent` | Standard is the full coding agent; PTC defaults to programmatic tool calling; Minimal keeps persistent Bash and `str_replace_editor`; Cordis adds live runtime inspection and plugin experimentation. |
| Workflow | `/workflow` | Default works directly; Plan investigates and presents a reviewable plan before implementation. |
| Tools | `/tool-mode` | Native exposes functions, Code exposes `run_code` with the generated TypeScript SDK, and Both exposes both forms. |
| Access | `/access` | Read only, Workspace write, or Full access. `/permission` remains an alias. |

Agent and Tools change the model-visible composition, so select them before the first prompt; they are locked once model history exists. PTC starts with Code tools, while the explicit Tools selector can change that blank-session choice independently. Workflow and Access are durable Harness session state and can change later.

### Choose safe Access

Run `/access` before a task that may change files. The interactive selector offers three policies:

| Mode | Use it when |
|---|---|
| Read only | You want inspection without workspace writes; an escalation still requires approval. |
| Workspace write | The task may edit the current workspace, while wider access still requires approval. |
| Full access | You trust the workspace and intentionally want unrestricted filesystem access without approval prompts. |

Full access requires a second confirmation. Access is the enforcement boundary; Plan workflow is guidance and does not replace sandbox or approval policy.

### Send a concrete request

Start with an outcome, scope, and verification target. For example:

```text
Find why the user settings are not persisted, fix the smallest responsible module, and run the focused tests. Do not change files under refs/.
```

While the agent is working, `Deep Driving` marks the active turn. Tool cards show separate Input and Output sections; press `Ctrl+O` to expand or collapse the latest tool result. The two-line status area keeps Agent, Workflow, Tools, model, reasoning effort, workspace, Git state, context pressure, token usage, latency, cache rate, and activity visible, while the composer boundary shows Access. None of this status is added to the conversation.

## Tutorial 2: Give the agent precise context

### Mention project files

Type `@` followed by part of a project path. The popup searches the workspace; use the arrow keys to move and `Tab` to insert the selected path. Mentions stay highlighted in your message and give the agent an explicit file target that it can inspect with its normal tools.

```text
Compare @packages/tui/omdsh-tui/src/chrome/renderer.ts with @packages/tui/omdsh-tui/src/chrome/renderer.spec.ts and explain the missing edge case before editing.
```

`./` and `~/` also open path completion. The completion inserts a path; it does not bypass tool permissions or silently upload file contents.

### Add screenshots and images

Copy an image and press `Ctrl+V`. When the platform clipboard reader is available, the composer inserts a compact image marker instead of a temporary path; submit it with any explanatory text as one message. Pasting an image file path also imports that image when it can be read.

On Linux, native image paste uses `wl-paste` under Wayland or `xclip` under X11. If neither command is available, text paste continues to work but direct clipboard-image capture is unavailable.

### Write structured prompts

Use `Shift+Enter`, `Alt+Enter`, or `Ctrl+J` for a newline. For a longer request, press `Ctrl+X` to edit the current draft in `$VISUAL` or `$EDITOR`, then return it to the composer.

```text
Goal: remove the duplicate loading row.

Constraints:
- keep the composer anchored
- preserve CJK display width
- add a regression test

Verification: run the focused TUI test and typecheck.
```

## Tutorial 3: Guide an active turn

### Queue follow-up messages

You do not need a special command to continue a running task. Submit another ordinary message while `Deep Driving` is active and omdsh places it in the next-turn queue. The queue appears immediately above the composer, so you can confirm what will run after the current turn.

With an empty composer, press `Up` to retrieve the newest queued message for editing. Press `Up` repeatedly to walk toward older queued messages, edit the selected text, and press `Enter` to return it to the queue. This is useful for correcting a follow-up without interrupting the current tool call.

Press `Ctrl+C` once to interrupt an active turn. A second `Ctrl+C` within the exit window leaves omdsh, so pause before pressing it again if you intend to continue the session.

### Repeat a prompt with Loop

Use `/loop` for work that should run again after every completed turn. `/loop 5 check the tests and fix the next failure` sends the prompt now and repeats it five more times. Durations accept compact expressions such as `/loop 10m inspect the latest result` or `/loop 1h30m keep improving the implementation`.

Run `/loop 5` without an inline prompt when you want the next ordinary composer message to become the repeated prompt. While Loop is active, any later ordinary message replaces that prompt after it enters the normal next-turn queue. The fixed footer shows whether Loop is waiting, running, paused, or briefly completed; count limits use explicit repeat progress, while duration limits count down without adding control messages to the transcript.

Run `/loop` again to disable it. Pressing `Ctrl+C` during an iteration interrupts the active turn and pauses Loop; sending another ordinary message resumes it with the new prompt. Loop is process-local by design, so it does not silently restart after switching, resuming, or reopening a session.

### Plan before changing files

Run `/plan` before a task that needs investigation and an implementation proposal. Plan mode asks the model to inspect without mutating and to present a reviewable plan through the Harness approval flow. Run `/plan off` to leave it directly. You can also use `/plan <message>` to enter Plan mode and send the initial planning request together.

### Follow task progress

When the agent records a Todo list, a compact tree appears above the queue and composer. Completed items, the current item, and pending work use distinct states; `/todo` prints the latest list into the transcript when you need a durable snapshot. Todo describes the current turn's work, while `/goal <objective>` controls a longer-running Harness goal; run `/goal` without arguments to inspect its current state and available actions.

## Tutorial 4: Recover and manage a long session

### Resume after leaving

The first `Ctrl+C` clears or interrupts, and a second one exits. When the active session is durable, omdsh prints a command you can paste later:

```sh
omdsh --resume <session-id>
```

Inside the TUI, `/resume` opens a searchable session selector with the latest human-message preview, age, event count, and completion state. `/resume <session-id>` skips the selector when you already know the identifier.

### Rewind without destroying history

When the agent is idle and the composer is empty, press `Esc` twice to open the conversation-turn selector. Choosing a user turn creates a new session branched from the history before that message and restores the original prompt into the composer. The original session remains available through `/resume`, so rewind is recoverable rather than destructive.

Use `/retry` when you only want to submit the latest human prompt again as a new turn. Use `/new` to start a clean session instead of branching the current one.

### Compact and export

Run `/compact` while the agent is idle to replace a useful older history span with a summary. The compacting state remains visible until the durable checkpoint finishes; wait for completion before starting another session operation. If there is not enough history, the command reports that nothing is compactable.

Run `/export` to write the complete transcript as `omdsh-transcript-<session-id>.md` in the current directory, or supply a destination:

```text
/export docs/session-review.md
```

## Tutorial 5: Tune the working environment

### Select model and reasoning effort

Run `/model` to open the model selector. omdsh first resolves the DeepSeek provider, then lets you choose an available model and, when supported, its reasoning effort. The active choice appears on the first status line and is stored in the durable session state.

### Customize the interface

Run `/settings` to configure the theme, color output, default tool expansion, update checks, startup release notes, and the status line. The Theme row cycles `dark`, `light`, `midnight`, `solarized`, `catppuccin`, `dracula`, `nord`, `gruvbox`, `rose-pine`, and `mono`. Each preview item — Model, Effort, Path, Git, and the telemetry groups — has its own color, left or right column, visibility, and order. Use `Up` and `Down` to navigate, `Left` and `Right` to change a value, and `Tab` to switch between General and Status line sections. On a status item, press `Space` to show or hide it, or press `Enter` and then `Up`/`Down` to reorder or `Left`/`Right` to change column; press `Enter` or `Esc` again to finish moving. The composer top border keeps 🐳 on the left and the current Access level on the right.

Run `/help` for the complete command and keyboard-shortcut catalog. The command list is assembled from the active Harness plugins, so it also includes capabilities contributed by Skills and other runtime integrations.

## Tutorial 6: Extend a project with Skills and MCP

Project Skills live under `.dsh/skills` or `.agents/skills`. After adding a human-invocable Skill, type `/skill:` to browse and filter it alongside other commands. MCP servers are configured in `.dsh/mcp.json`; `/mcp` shows connected servers and `/tools` shows their tools beside native Harness tools.

Follow [Skills and MCP](skills-and-mcp.md) for complete search priority, `SKILL.md` structure, stdio and HTTP examples, environment expansion, override rules, and current protocol limitations.

## Quick reference

| Goal | Action |
|---|---|
| Browse commands and shortcuts | `/help` |
| Search previous prompts | `Ctrl+R` |
| Scroll the transcript | `PgUp` / `PgDn`, `Shift+Up` / `Shift+Down`, or the mouse wheel |
| Copy the latest reply, code block, or command | `/copy` |
| Choose Agent preset | `/agent` |
| Choose Default or Plan workflow | `/workflow` |
| Choose Native, Code, or Both tools | `/tool-mode` |
| Choose session Access | `/access` |
| Inspect session statistics | `/session` |
| Inspect available tools | `/tools` |
| Repeat work after each completed turn | `/loop [count\|duration] [prompt]` |
| Read release notes | `/changelog` |
| Install the latest release | `npm install --global @agi-fans/oh-my-dsh@latest` |

The daily update check only reports a newer npm version; it never installs one automatically.
