# Complete your first task

[English](first-task.md) | [简体中文](first-task.zh-CN.md)

[Tutorials](../tutorials.md) · Next: [Give the agent precise context](precise-context.md)

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

[Tutorials](../tutorials.md) · Next: [Give the agent precise context](precise-context.md)
