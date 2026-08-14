# oh-my-dsh

**omdsh** — a TUI coding agent in the style of [oh-my-pi](https://github.com/can1357/oh-my-pi), running on the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) core runtime. Everything omdsh adds is a Cordis plugin or an app over the harness package tier; the harness itself is an unmodified git submodule under refs/.

Status: the three oh-my-pi parity rounds are implemented: durable/resumable sessions, dynamic commands, approvals/questions, coding-tool renderers, model/context controls, attachments, transcript search/export, external editing, themes and plan/goal/subagent workflows. It is verified keyless in pipe and PTY modes and honors `$DSH_HOME` settings and layered credentials. See [architecture](docs/architecture.md) and the [implementation matrix](docs/implementation-rounds.md). Skills and MCP setup are documented in [Skills and MCP](docs/skills-and-mcp.md).

## Layout

- refs/deepseek-harness — core runtime layer (submodule)
- refs/oh-my-pi — TUI design reference (submodule)
- packages/tui/omdsh-tui — the TUI capability seam
- apps/omdsh — the omdsh command

## Development

```sh
pnpm install
pnpm omdsh "list files"   # interactive TUI (needs DEEPSEEK_API_KEY for live turns)
pnpm test               # unit + pipe-mode e2e
pnpm run build:runtime   # build the shipped runtime closure
node apps/omdsh/lib/bin.js "list files"  # the built command
pnpm smoke              # interactive PTY e2e (keyless)
pnpm smoke:happy        # happy-path e2e vs the harness mock LLM (keyless)
```
