# @oh-my-dsh/dsh-coding-agent

The `omdsh` command: a TUI coding agent over the DeepSeek Harness core runtime. Boots the shipped `config/cordis.yml` composition through the harness boot machinery (`dsh-app-boot`), provides the command line and exit request, and leaves process lifetime to the mounted runner.

## Install

```sh
npm install --global @oh-my-dsh/dsh-coding-agent
omdsh
```

Or run it without a global installation:

```sh
npx @oh-my-dsh/dsh-coding-agent
```

## Develop

```sh
pnpm install
pnpm omdsh "list files"

node lib/bin.js "list files"
```

Model/provider routes come from `OMDSH_MODEL`/`OMDSH_PROVIDER` or the user's `$DSH_HOME/settings.yaml` (mounted via `dsh-settings-file`); credentials resolve through `dsh-credentials-local` (inherited env, managed `.credentials.yaml`, project/user `.env`). The default permission mode is trusted-local (`danger-full-access`); `OMDSH_PERMISSION_MODE` narrows it.

Run `/settings` to customize the TUI. The overlay controls themes, colors, tool expansion, and the composer status bar, including telemetry visibility, compact/full labels, and the order of Context, Cache, Tokens, Latency, Time, and Activity groups. Use up/down to navigate and left/right to change a value; preferences are stored in the user settings document.

Skills are discovered from project/user `.dsh/skills` and `.agents/skills` roots. MCP servers are loaded from user and project `.dsh/mcp.json` files; see [`docs/skills-and-mcp.md`](../../docs/skills-and-mcp.md) for the configuration shape and TUI commands.

## Verify

```sh
pnpm --filter @oh-my-dsh/dsh-coding-agent test   # keyless pipe-mode e2e
pnpm smoke                     # keyless interactive PTY e2e
```
