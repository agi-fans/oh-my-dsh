---
description: Learn omdsh step by step, from your first project inspection to everyday coding, long sessions, and optional extensions.
---

# Tutorials

oh-my-dsh aims to be the best TUI companion for DeepSeek Harness. A TUI is an interactive terminal interface. In omdsh, you write requests, read replies, and inspect the agent's work through keyboard and mouse controls. Thinking and tools unfold as you need them, while the input area and status footer stay within reach.

These tutorials follow the way you use the application. Start with one successful task, then learn how to give better context and guide longer work. Each page states its outcome and points to the next step. Reference pages hold the detailed command, setting, and behavior descriptions.

## Start here

You need Node.js 22.19 or later in the 22.x line, or Node.js 24 or newer, an interactive terminal, and a DeepSeek account or API key for model requests.

| Tutorial | What you will accomplish |
|---|---|
| [Complete your first task](tutorials/first-task.md) | Install, sign in, select a model, inspect a project, and learn to read the interface. |
| [Tune the working environment](tutorials/environment.md) | Choose appearance, language, and model preferences. This step is optional if the defaults suit you. |

## Build an everyday workflow

Continue with the same project and conversation. These tutorials introduce the controls when you have a reason to use them.

| Tutorial | What you will accomplish |
|---|---|
| [Give the agent precise context](tutorials/precise-context.md) | Refer to files and earlier sessions, attach a screenshot, and write a clear request. |
| [Guide an active turn](tutorials/guide-a-turn.md) | Send a follow-up, correct work in progress, review a plan, and follow task progress. |
| [Recover and manage a long session](tutorials/long-session.md) | Resume work, explore a branch, inspect context usage, compact, and export. |

## Add capabilities when you need them

Skills provide reusable instructions. MCP servers connect external tools. Plugin bundles can add commands, tools, and providers through Harness. Choose the extension that fits your task.

| Tutorial | What you will accomplish |
|---|---|
| [Extend a project with Skills and MCP](tutorials/skills-and-mcp.md) | Add a project Skill and configure an MCP server, then inspect the available capabilities. |
| [Install the example plugin](tutorials/install-plugin.md) | Install and try a local bundle using `omdsh plugin`. This developer exercise requires a repository checkout and `pnpm`. |
| [Write a plugin](tutorials/write-a-plugin.md) | Build your own command bundle, install it, and prepare it for distribution. |

For an existing published bundle, go directly to [User plugins](plugins.md). For code intelligence, see [Language servers](language-servers.md).

## Find an answer while working

| You need to | Read |
|---|---|
| Find a command or input gesture | [Commands](commands.md) and [Keyboard and keys](keyboard.md) |
| Understand a setting or permission | [Settings](settings.md) and [Permissions and access](permissions.md) |
| Inspect tools, context, or file changes | [Observability](observability.md) and [Tools](tools.md) |
| Understand session recovery or delegated work | [Sessions and history](sessions.md) and [Subagents and delegation](subagents.md) |
| Resolve a startup, sign-in, or terminal problem | [Troubleshooting](troubleshooting.md) |
| Understand the implementation | [Architecture](architecture.md), [Plugin internals](plugin-internals.md), and [Performance](performance.md) |

Inside omdsh, `/help` searches commands and `/help full` shows current shortcuts. `/changelog` shows recent release notes.
