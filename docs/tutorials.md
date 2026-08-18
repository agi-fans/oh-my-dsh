# Tutorials

[English](tutorials.md) | [简体中文](tutorials.zh-CN.md)

These task-based walkthroughs cover the path from a fresh installation to reliable day-to-day use, then to writing an installable plugin. They assume Node.js 22.19 or later in the 22.x line, or Node.js 24 or newer, a terminal with TTY support, and a DeepSeek API key for live model turns. Writing a plugin also requires `pnpm` on `PATH`.

Each walkthrough lives on its own page so a later change can update one path without rewriting the rest.

| Walkthrough | What it covers |
|---|---|
| [Complete your first task](tutorials/first-task.md) | Install, `/login`, Agent / Workflow / Tools / Access, and a first request |
| [Give the agent precise context](tutorials/precise-context.md) | `@` mentions, image paste, and structured prompts |
| [Guide an active turn](tutorials/guide-a-turn.md) | Queue, Loop, Plan, Todo, and `/goal` |
| [Recover and manage a long session](tutorials/long-session.md) | Resume, rewind, compact, and export |
| [Tune the working environment](tutorials/environment.md) | `/model`, `/login` for extra providers, and `/settings` |
| [Extend a project with Skills and MCP](tutorials/skills-and-mcp.md) | Project Skills and `mcp.json`; full reference is [Skills and MCP](skills-and-mcp.md) |
| [Install the example plugin](tutorials/install-plugin.md) | `omdsh plugin add ./examples/hello` |
| [Write a plugin](tutorials/write-a-plugin.md) | Author, install, inspect, and publish a `dsh.bundle` package |

The plugin compatibility contract is in [User plugins](plugins.md).

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
| Install a local plugin bundle | `omdsh plugin add ./examples/hello` |
| Write a plugin | [Write a plugin](tutorials/write-a-plugin.md) |

The daily update check only reports a newer npm version; it never installs one automatically.
