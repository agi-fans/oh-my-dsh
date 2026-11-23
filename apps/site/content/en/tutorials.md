---
description: Learn omdsh step by step, from your first code edit to everyday workflows, multi-agent collaboration, long-session recovery, and extensions.
---

# Tutorials

omdsh is a coding agent that lives in your terminal. You describe a task in the input box at the bottom; it reads your codebase, edits files, runs commands, and shows its work in a clean, readable layout.

These tutorials follow the order you actually grow into the tool: finish one real code change first, then learn sharper context, mid-turn steering, multi-agent collaboration, and extensions. You do not need to read everything up front—pick up each guide when you need it.

## Stage 1: Get started

Before you begin, have Node.js 24.22.3+ (24.x) or Node.js 26.13.1+, an interactive terminal, and a DeepSeek account or API key ready.

| Tutorial | What you will accomplish |
|---|---|
| [Complete your first change](tutorials/first-task.md) | Install, sign in, pick a model, inspect a project, make a small edit, approve an action, and verify it in `/diff`. |
| [Tune your terminal and models](tutorials/environment.md) | Adjust theme, language, live status line, favorite models, and reasoning effort in the bottom-docked `/settings` panel (optional if defaults feel right). |

## Stage 2: Everyday coding workflows

These four guides cover the controls that keep you in the driver’s seat during real development work.

| Tutorial | What you will accomplish |
|---|---|
| [Give precise context and quick inputs](tutorials/precise-context.md) | Choose between `@file`, `/attach`, `@session`, and pasted screenshots; run quick shell commands with `!cmd` and side questions with `/btw`. |
| [Steer long tasks and background work](tutorials/guide-a-turn.md) | Shape plans with `/plan`, choose between queueing, steering, and interrupting mid-turn, and track work with `/goal`, `/jobs`, and `/schedule`. |
| [Subagents and Agent Teams](tutorials/multi-agent.md) | Know when to use built-in subagents, Codex/Claude Code integrations, or `/team` Agent Teams to split larger tasks in parallel. |
| [Manage long sessions and recover files](tutorials/long-session.md) | Resume sessions, branch in the session tree, restore file snapshots with `Alt+R`, and compact or export long histories. |

## Stage 3: Extend your project

Read these when you want reusable team conventions, external tools, or extra capabilities.

| Tutorial | What you will accomplish |
|---|---|
| [Extend projects with Skills and MCP](tutorials/skills-and-mcp.md) | Understand when to choose Skills, MCP, LSP, or plugins; create a project Skill and add an MCP server live in `/mcp` without restarting. |
| [Install plugins and built-in integrations](tutorials/install-plugin.md) | Browse and install plugins in `/plugins`, and configure built-in Codex, Claude Code, Git Worktree, Auto review, and Tmux context integrations. |

If you want accurate go-to-definition and symbol references, see [Language servers](language-servers.md).

## Stage 4: Build your own plugin

When you want to author custom commands, tools, or provider extensions for your team or the community:

| Tutorial | What you will accomplish |
|---|---|
| [Write and publish a plugin](tutorials/write-a-plugin.md) | Build a plugin package from scratch (or with `/agent creator`), test it locally, and prepare it for publishing. |

## Quick reference while working

| You need to | Read |
|---|---|
| Look up a slash command or shortcut | [Commands](commands.md), [Keyboard and mouse](keyboard.md) |
| Understand permission levels and approvals | [Permissions and safety](permissions.md) |
| Customize preferences or keybindings | [Settings](settings.md) |
| Inspect context usage, execution traces, or diffs | [Status and diagnostics](observability.md) |
| Find sessions, compact history, or recover files | [Sessions and recovery](sessions.md) |
| Run non-interactively in scripts or CI | [Command line](cli.md) |
| Fix startup, sign-in, key, or mouse issues | [Troubleshooting](troubleshooting.md) |
| Explore built-in tools, plugin APIs, and architecture | [Tools and presets](tools.md), [Plugin internals](plugin-internals.md), [Architecture](architecture.md) |

Inside omdsh, run `/help` to search commands, `/help full` to inspect your active shortcuts, and `/changelog` for recent release notes.
