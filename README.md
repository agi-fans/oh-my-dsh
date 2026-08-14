# oh-my-dsh

**omdsh** — a TUI coding agent in the style of
[oh-my-pi](https://github.com/can1357/oh-my-pi), running on the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) core
runtime. Everything omdsh adds is a Cordis plugin or an app over the harness
package tier; the harness itself is an unmodified git submodule under
refs/.

Status: v0 complete — TUI + runner + omdsh bin, verified keyless in pipe
and PTY modes from both source and the built artifact; honors the user's
$DSH_HOME settings (model route) and layered credentials. Design:
[docs/architecture.md](docs/architecture.md).

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