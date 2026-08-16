# @agi-fans/oh-my-dsh

The `omdsh` command: a TUI coding agent over the DeepSeek Harness core runtime. Boots the shipped `config/cordis.yml` composition through the harness boot machinery (`dsh-app-boot`), provides the command line and exit request, and leaves process lifetime to the mounted runner.

## Install

```sh
npm install --global @agi-fans/oh-my-dsh
omdsh
```

Or run it without a global installation:

```sh
npx @agi-fans/oh-my-dsh
```

Follow the task-based [tutorials](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/tutorials.md) for the first login, a safe coding workflow, file and image context, queued follow-ups, session recovery, and interface customization.

Inside the TUI, run `/login` to open the DeepSeek API-key dashboard and save a validated key through the Harness credential store. The key prompt is masked and never accepts an inline `/login <key>` argument. An interactively selected key takes priority over `DEEPSEEK_API_KEY`; `/logout` removes the omdsh-managed selection and returns the provider to the external credential when one is available.

## Develop

```sh
pnpm install
pnpm omdsh "list files"

node lib/bin.js "list files"
```

Model/provider routes come from `OMDSH_MODEL`/`OMDSH_PROVIDER` or the user's `$DSH_HOME/settings.yaml` (mounted via `dsh-settings-file`); credentials resolve through `dsh-credentials-local` (inherited env, managed `.credentials.yaml`, project/user `.env`). The default permission mode is trusted-local (`danger-full-access`); `OMDSH_PERMISSION_MODE` narrows it.

Run `/settings` to customize the TUI. The overlay controls themes, colors, tool expansion, startup release notes, daily update checks, and the composer status bar, including telemetry visibility, compact/full labels, and the order of Context, Cache, Tokens, Latency, Time, and Activity groups. Use up/down to navigate and left/right to change a value; preferences are stored in the user settings document. Use `/changelog` for recent release notes or `/changelog full` for the complete packaged history. Update checks only report a newer npm version and never install it automatically.

Skills are discovered from project/user `.dsh/skills` and `.agents/skills` roots. MCP servers are loaded from user and project `.dsh/mcp.json` files; see [Skills and MCP](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/skills-and-mcp.md) for the configuration shape and TUI commands.

## Verify

```sh
pnpm --filter @agi-fans/oh-my-dsh test   # keyless pipe-mode e2e
pnpm smoke                     # keyless interactive PTY e2e
```
