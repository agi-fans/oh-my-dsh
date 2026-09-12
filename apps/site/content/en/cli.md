---
description: "The omdsh command line: flags, the plugin and completions subcommands, environment variables, one-shot prompts, and pipe-friendly behavior."
---

# Command line

The `omdsh` binary starts the TUI. Everything the shell needs — plugin management, completions, a composition dump — is a subcommand or a flag.

## Usage

```text
omdsh [options] [prompt...]
omdsh plugin add <package>
omdsh plugin remove <package>
omdsh plugin <pnpm-args...>
omdsh completions bash|zsh|fish
```

A positional prompt boots omdsh and submits the joined words as the first message. `--resume` cannot combine with a prompt, and `--dump-config` cannot combine with either.

## Options

| Option | Effect |
|---|---|
| `--model <route>` | Model route for this process; sets `OMDSH_MODEL`. Default `deepseek-flash`. |
| `--provider <route>` | Provider route for this process; sets `OMDSH_PROVIDER`. Default `deepseek-official`. |
| `-r, --resume <session-id>` | Reopen a durable session. |
| `--dump-config` | Print the composed plugin tree and exit. |
| `-h, --help` | Show the built-in help. |
| `--version` | Print the installed version. |

Command-line flags outrank every layered environment source.

## Environment

| Variable | Effect |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key for live turns; `/login` stores a validated key instead. |
| `OMDSH_MODEL`, `OMDSH_PROVIDER` | Default route overrides; `--model` and `--provider` win over them. |
| `OMDSH_HOME` | Home for sessions, settings, credentials, MCP and LSP configuration, plugins, and skills; falls back to `DSH_HOME`, then `~/.dsh`. |
| `OMDSH_PERMISSION_MODE` | Initial Access preset: `read-only`, `workspace-write` (default), or `danger-full-access`. `/permission` changes it per session afterwards. |
| `NO_COLOR`, `FORCE_COLOR=0` | Disable color output unless an explicit color preference exists. See [Troubleshooting](troubleshooting.md). |

Model settings can also come from `$DSH_HOME/settings.yaml`; `/model` writes the same preferences interactively.

## Plugin and completions

`omdsh plugin add <package>` installs a bundle into the user Profile, `omdsh plugin remove <package>` deletes one, and any other arguments are forwarded to `pnpm` in the Profile directory. See [User plugins](plugins.md).

`omdsh completions bash|zsh|fish` prints a completion script for the omdsh command line without booting the TUI or making network requests. Load it from your shell profile:

```sh
eval "$(omdsh completions zsh)"
```

## Pipe mode

When stdin or stdout is not a TTY — piped input, CI — omdsh degrades to line-based input with plain append-only output. Sessions, commands, and exit behavior keep the same semantics without claiming an interactive screen.

## Related

- [Sessions and history](sessions.md) — `--resume` and durable session storage
- [Permissions and access](permissions.md) — the Access presets behind `OMDSH_PERMISSION_MODE`
- [Troubleshooting](troubleshooting.md) — color environments and boot failures
