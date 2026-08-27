---
description: Install @agi-fans/oh-my-dsh, run /login, set Agent, Workflow, Tools, and Access, then finish a first DeepSeek coding task.
---

# Complete your first task

By the end of this walkthrough you will have omdsh installed, signed in, and one finished agent task.

### Install and launch

Install the command globally, or use `npx @agi-fans/oh-my-dsh` to try the current package without a global installation:

```sh
npm install --global @agi-fans/oh-my-dsh
```

Then change into the project you want the agent to understand and start omdsh there:

```sh
cd /path/to/your/project
omdsh
```

The startup directory becomes the session workspace. If it sits inside a Git repository, the status line picks that repository up.

### Sign in securely

Run `/login`. For DeepSeek, omdsh opens the API Key page, asks for the key in a masked prompt, validates it, and saves it to the credential store.

A mounted provider that registered an authorization flow — for example a browser sign-in — appears in the `/login` list with that flow's methods, and omdsh renders only the notices and prompts the flow asks for.

Never append a key to the command: `/login <key>` is deliberately rejected so the secret does not enter command history or the transcript.

An externally managed `DEEPSEEK_API_KEY` remains a supported fallback. A key saved through `/login` takes priority on later requests and across restarts; `/logout` removes only the omdsh-managed choice and falls back to the environment when available.

### Configure the session before the first prompt

omdsh keeps four concepts separate instead of collapsing them into one mode. If you are unsure, keep the defaults for the first task.

| Concept | Command | Choices |
|---|---|---|
| Agent | `/agent` | Standard is the full coding agent; PTC defaults to programmatic tool calling; Minimal keeps persistent Bash and `str_replace_editor`; Cordis adds live runtime inspection and plugin experimentation. |
| Workflow | `/workflow` | Default works directly; Plan investigates and presents a reviewable plan before implementation. |
| Tools | `/tool-mode` | Native exposes functions, Code exposes `run_code` with the generated TypeScript SDK, and Both exposes both forms. |
| Access | `/permission` | Read only, Workspace write, or Full access. |

Agent and Tools change what the model can see, so select them before the first prompt; they are locked once model history exists. The PTC agent starts with Code tools, and the Tools selector can still change that choice while the session is blank. Workflow and Access are durable session state and can change later.

### Choose safe Access

Run `/permission` before a task that may change files. The interactive selector offers three policies:

| Mode | Use it when |
|---|---|
| Read only | You want inspection without workspace writes; an escalation still requires approval. |
| Workspace write | The task may edit the current workspace, while wider access still requires approval. |
| Full access | You trust the workspace and intentionally want unrestricted filesystem access without approval prompts. |

Full access requires a second confirmation. Access is the enforcement boundary; the Plan workflow is guidance and does not replace sandbox or approval policy.

### Send a concrete request

Start with an outcome, scope, and verification target. For example:

```text
Find why the user settings are not persisted, fix the smallest responsible module, and run the focused tests. Do not change files under refs/.
```

While the agent works, `Deep Driving` marks the active turn. Tool cards show separate Input and Output sections; press `Ctrl+O` to expand or collapse the latest tool result. The two-line status area keeps the current Agent, Workflow, Tools, model, workspace, Git state, and token telemetry visible, and the composer boundary shows Access. None of this status is added to the conversation.
