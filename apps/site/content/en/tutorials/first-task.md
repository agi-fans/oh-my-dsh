---
description: Install omdsh, sign in, select a model, and inspect a project while learning the terminal interface.
---

# Complete your first task

By the end of this walkthrough, you will have a project overview from the agent and know how to read its work. You need Node.js 22.19 or later in the 22.x line, or Node.js 24 or newer, a terminal, and a DeepSeek account or API key.

## Install and open a project

Install omdsh, then start it in the project you want to explore. Replace the example path with your own project directory.

```sh
npm install --global @agi-fans/oh-my-dsh
cd /path/to/your/project
omdsh
```

You can also run `npx @agi-fans/oh-my-dsh` from the project directory to try it without a global installation. The startup directory becomes the session workspace, and the footer shows its path and Git state when available.

## Sign in and choose a model

Run `/login` in the input area marked `🐳`. Choose **DeepSeek account** and complete sign-in in your browser, or choose the DeepSeek API-key entry and paste your key into its prompt. An existing account grant shared with DSH can be reused.

Next, run `/model`. If you signed in with an account, choose a model under `deepseek-account`. For an API key, choose the corresponding DeepSeek provider. Press `Enter` to select it and save it as your default. Check that the footer shows the selected model before sending your first request.

Paste keys only into the credential prompt. `/login <key>` is rejected to keep secrets out of command history. Remote-host browser callbacks and other authentication issues are covered in [Troubleshooting](../troubleshooting.md).

## Ask the agent to inspect the project

Keep the Standard Agent preset for this walkthrough. Run `/permission` and choose **Read only**, then send this request.

```text
Inspect this project's structure and explain its purpose, main entry points, and how to run and test it. Cite the files you used. Do not change any files or install dependencies.
```

The agent should read project files and return an overview with supporting paths. Check its run and test instructions against the files it cites. If something is missing, ask a follow-up about that part of the project.

Access controls tool permissions, and any escalation still goes through approval. Later, choose Workspace write when you want the agent to edit the project. The available policies are explained in [Permissions and access](../permissions.md).

## Read the interface

<video src="/omdsh-demo.mp4" poster="/omdsh-demo-poster.png" controls muted autoplay loop playsinline width="100%"></video>

This recording shows a real DeepSeek account turn on v0.22.0, captured before the startup header was simplified. Watch the reply arrive and the finished process fold into a `Worked for …` summary.

| Part of the interface | What to do |
|---|---|
| Thinking and tool rows | Press `Ctrl+O` to browse the process, select a row with arrows, and press `Enter` to expand. You can also click its left-hand disclosure arrow. |
| Finished turn | Read the reply and any failure facts. Expand the duration summary when you want to revisit the work. |
| Transcript | Scroll with the mouse wheel or `PgUp`. Press `End` or click `Latest · End` to return to the live tail. |
| Text you want to keep | Drag to select and copy text when TUI mouse handling is active, or use `/copy` for the latest reply. |
| Input and footer | Write the next prompt while model, workspace, and session telemetry stay visible at the bottom. |

Mouse handling depends on **Settings → Terminal → Mouse interaction**. Auto respects tmux's mouse setting, and Native uses terminal selection. Selection, quoting, full tool results, and navigation are covered in [Keyboard and keys](../keyboard.md#transcript).

## Continue from your first result

You now have a conversation you can build on. Use `/help` to find a command, or `/context` to see context usage and session details. These three controls become useful as you take on larger tasks.

| Control | When to use it |
|---|---|
| `/plan` | Investigate a task and review an implementation proposal before proceeding. `/plan off` leaves Plan mode. Access separately controls tool permissions. |
| `/permission` | Choose the level of access for the work you want to authorize. |
| `/agent` | Choose a different Harness preset for a new session before its first prompt. The preset is locked once model history exists. |

Next, [tune the working environment](environment.md) to choose appearance, language, and model preferences. If the defaults suit you, go straight to [giving the agent precise context](precise-context.md).
