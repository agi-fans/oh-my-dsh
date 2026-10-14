---
description: "The omdsh command line: scripted JSON execution, diagnostics, flags, plugins, completions, and environment variables."
---

# Command line

The `omdsh` binary starts the TUI by default. Subcommands handle scripted runs, diagnostics, plugin management and completions; `--dump-config` prints the composition.

## Usage

```text
omdsh [options] [prompt...]
omdsh plugin add <package>
omdsh plugin remove <package>
omdsh plugin <pnpm-args...>
omdsh completions bash|zsh|fish
omdsh doctor [--json]
omdsh exec --json [--resume <id>] [prompt...]
```

A positional prompt boots omdsh and submits the joined words as the first message. For the default TUI entry, `--resume` cannot combine with a prompt, and `--dump-config` cannot combine with either.

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

`/model` writes model preferences into the Profile patch, `profiles/omdsh/cordis.patch.yml`; a `settings.yaml` left by an earlier release is imported once at startup and renamed to `settings.yaml.imported`.

## Plugin and completions

`omdsh plugin add <package>` installs a bundle into the user Profile, `omdsh plugin remove <package>` deletes one, and any other arguments are forwarded to `pnpm` in the Profile directory. See [User plugins](plugins.md).

`omdsh completions bash|zsh|fish` prints a completion script for the omdsh command line without booting the TUI or making network requests. Load it from your shell profile:

```sh
eval "$(omdsh completions zsh)"
```

## Script execution

`omdsh exec --json` runs one prompt with the existing Profile, model route, tools and Access policy. It owns an independent machine-output consumer and does not open the TUI, change terminal modes, or dispatch slash commands or `!command` from the prompt.

```sh
omdsh exec --json "Explain this repository" > result.ndjson
cat task.txt | omdsh exec --json - > result.ndjson
omdsh exec --json --resume session-id "Continue the task" > result.ndjson
```

Omitting the prompt also reads stdin through EOF as one UTF-8 message, limited to 8 MiB. Positional text does not consume stdin unless it is the single argument `-`. `--model` and `--provider` select the current route; `--` ends option parsing. Exec requires `--json`. A resumed session retains its history and permissions, uses the current model selection, and emits new work without replaying old answers. Sessions requiring a format migration must first be resumed interactively.

Stdout contains newline-delimited JSON; diagnostics and ordinary plugin logs go to stderr. Every record has `schemaVersion: 1`, an increasing `sequence`, `type` and `data`. Consumers should ignore unfamiliar event types. Records include `run.started`, `session.created` or `session.resumed`, `assistant.stream`, `assistant.message`, `turn.started`/`turn.finished`, `step.started`/`step.finished`, `tool.started`/`tool.finished`, `tool.ptc_result`, delegation updates and approval audits. Session records carry `sessionId` and `root`; durable records also carry `eventSequence` and `time`. Streaming frames retain Harness attempt identities and indexes. Tool payloads retain Harness call ids and canonical results; the result message pairs through `message.toolCallId`. Request headers and Profile configuration are not exported.

The last record is `run.finished`. Its data contains `outcome`, `exitCode`, `text`, an optional `sessionId`, optional `sessionTotals`, and an `error` with `code` and `message` when needed. `text` is the latest committed root assistant text produced by this execution; failure or cancellation can retain partial output. `sessionTotals` comes from Harness projections and covers the entire root session, including earlier turns after resume; it is not a bill for all child sessions. Normal completion waits for managed children, parent follow-ups and durable flush before releasing resources and writing the final result.

| Exit code | Meaning |
|---|---|
| `0` | Completed. |
| `1` | Execution, startup, cleanup or output failed; token-limit termination is incomplete. |
| `2` | Invalid arguments or input. |
| `3` | A question or approval requires human input. |
| `130` | Interrupted by SIGINT. |
| `143` | Interrupted by SIGTERM. |

A question or approval emits `input.required`, cancels the unattended execution and fails closed. Exec does not invent an answer, grant permission or widen Access; resume interactively to continue with a human decision. A second termination signal forces exit. Cleanup has the same five-second grace as the interactive application; a timeout reports `SHUTDOWN_TIMEOUT` and forces exit after the failed final result is written. Interrupted output that cannot drain within that grace closes the channel instead of claiming delivery. Invalid command syntax prints usage on stderr before the protocol starts; a broken pipe or forced termination can prevent delivery of the final record. Writes respect backpressure and pending protocol output is bounded to 32 MiB.

## Pipe mode

When stdin or stdout is not a TTY — piped input, CI — omdsh degrades to line-based input with plain append-only output. Sessions, commands, and exit behavior keep the same semantics without claiming an interactive screen.

## Related

- [Sessions and history](sessions.md) — `--resume` and durable session storage
- [Permissions and access](permissions.md) — the Access presets behind `OMDSH_PERMISSION_MODE`
- [Troubleshooting](troubleshooting.md) — color environments and boot failures
