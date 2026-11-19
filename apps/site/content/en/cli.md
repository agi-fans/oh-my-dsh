---
description: Complete omdsh CLI reference — flags, omdsh doctor diagnostics, omdsh exec --json scripting with jq examples and error codes, plugin CLI, shell completions, and environment variables.
---

# Command line

Running `omdsh` launches the interactive TUI by default. Subcommands handle read-only health checks (`doctor`), machine-readable scripting (`exec --json`), plugin management (`plugin`), and shell completions (`completions`).

## Usage

```text
omdsh [options] [prompt...]
omdsh doctor [--json]
omdsh exec --json [--model <route>] [--provider <route>] [--resume <id>] [--] [prompt...]
omdsh plugin add|update|remove|list [args...]
omdsh completions bash|zsh|fish
```

Positional prompt arguments launch omdsh and submit the joined text as the first message. On the interactive entry point, `--resume` cannot be combined with a positional prompt, and `--dump-config` cannot be combined with either.

## Options

| Option | Effect |
|---|---|
| `--model <route>` | Model for this run (overrides `OMDSH_MODEL`; defaults to `deepseek-flash`). |
| `--provider <route>` | Provider for this run (overrides `OMDSH_PROVIDER`; defaults to `deepseek-official`). |
| `-r, --resume <session-id>` | Reopen a durable session by ID. |
| `--dump-config` | Print the resolved plugin and config tree and exit. |
| `-h, --help` | Show CLI help. |
| `--version` | Print installed version. |

**Configuration precedence** (highest to lowest): CLI flags > process environment variables > project `.env` > `$OMDSH_HOME/.env` > `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`.

## 1. Diagnostics (`omdsh doctor`)

`omdsh doctor` is a **read-only** health check—it never boots plugins, connects MCP servers, or sends model requests:

```sh
omdsh doctor         # human-readable report
omdsh doctor --json  # machine-readable JSON (schemaVersion: 1)
```

Each check reports one of four statuses: `ok`, `failed` (with actionable remediation), `not-configured`, or `not-checked`.

| Exit code | Meaning |
|---|---|
| `0` | No failed checks |
| `1` | One or more failed checks |
| `2` | Invalid arguments |

## 2. Scripting and CI (`omdsh exec --json`)

`omdsh exec --json` runs one prompt **without opening the TUI or changing terminal modes**, writing line-delimited JSON (NDJSON) events to `stdout` and diagnostics to `stderr`.

> `exec` shares stored credentials and DeepSeek account sign-in with the TUI, but does not open a browser login flow—sign in once via `/login` in interactive `omdsh` before using `deepseek-account` models in scripts.

### Practical examples (including `jq`)

```sh
# 1. Run a prompt and save the full event stream
omdsh exec --json "Summarize this repository's structure and test commands" > run.ndjson

# 2. Extract only the final assistant answer (or error code) with jq
omdsh exec --json "Check src/auth for unhandled errors" \
  | jq -r 'select(.type == "run.finished") | if .data.error then "ERROR(\(.data.error.code)): \(.data.error.message)" else .data.text end'

# 3. Read a long prompt from stdin (up to 8 MiB) or continue an existing session
cat spec.md | omdsh exec --json - > run.ndjson
omdsh exec --json --resume <session-id> "Finish the remaining unit tests" > run.ndjson
```

Slash commands and `!command` inside an `exec` prompt are treated as plain prompt text; use `--` to end option parsing. Legacy sessions needing format migration must be opened once interactively with `/resume` first.

### Sample NDJSON stream

Every line includes `schemaVersion: 1`, a monotonic `sequence`, `type`, and `data` (consumers should ignore unknown event types), ending with `run.finished`:

```json
{"schemaVersion":1,"sequence":1,"type":"run.started","data":{"model":"deepseek-flash"}}
{"schemaVersion":1,"sequence":2,"type":"session.created","data":{"sessionId":"s_abc123","root":"/path/to/repo"}}
{"schemaVersion":1,"sequence":3,"type":"assistant.message","data":{"text":"This repository contains two packages..."}}
{"schemaVersion":1,"sequence":4,"type":"run.finished","data":{"outcome":"completed","exitCode":0,"sessionId":"s_abc123","text":"This repository contains two packages..."}}
```

- `data.text` holds the latest committed root assistant reply from this run; `data.sessionTotals` reports cumulative root-session usage (including earlier turns on `--resume`, excluding child subagent bills).
- If unattended execution hits an approval or user question, `exec` emits `input.required` and exits safely with code `3` (**never fabricating answers or silently widening access**); resume interactively with `omdsh --resume <session-id>` to answer.

### `exec` exit codes and error codes

| Exit code | Meaning |
|---|---|
| `0` | Completed |
| `1` | Boot, execution, output, or shutdown failure (including hitting max tokens) |
| `2` | Invalid arguments or input (e.g. > 8 MiB stdin or missing `--json`) |
| `3` | Human approval or answer required (`REQUIRES_INPUT`) |
| `130` / `143` | Interrupted by `SIGINT` / `SIGTERM` |

Common `data.error.code` values on `run.finished`:

- `CONTENT_REFUSED` — provider refused the request under content policy.
- `REQUIRES_INPUT` — paused for human approval or question (exit code `3`).
- `MAX_TOKENS` — stopped at the output token limit before completion.
- `CANCELLED` — cancelled by signal.
- `INVALID_INPUT`, `BOOT_FAILED`, `RUN_FAILED`, `RUNTIME_FAILED` — invalid input, boot error, or runtime failure.
- `SHUTDOWN_TIMEOUT` — cleanup exceeded the 5-second grace period.

## 3. Plugin CLI, shell completions, and pipe mode

- **Plugin management:** Use `omdsh plugin add|update|remove|list`—see [Plugins and integrations](plugins.md).
- **Shell completions** (local only; never starts the TUI or accesses the network):

```sh
eval "$(omdsh completions zsh)"   # bash and fish are also supported
```

- **Plain pipe mode:** Running plain `omdsh` without a TTY falls back to line-oriented append-only output. Prefer `omdsh exec --json` for reliable automation.

## 4. Environment variables

| Variable | Effect |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key (environment values take precedence over `/login` and `/logout`). |
| `DEEPSEEK_BASE_URL` | Custom DeepSeek-compatible endpoint URL. |
| `OMDSH_MODEL`, `OMDSH_PROVIDER` | Default model and provider overrides (lower priority than `--model` / `--provider`). |
| `OMDSH_HOME` (fallback `DSH_HOME` → `~/.dsh`) | Root directory for sessions, settings, credentials, Skills, MCP/LSP configs, and plugins. |
| `OMDSH_PERMISSION_MODE` | Initial access level: `read-only`, `workspace-write` (default), or `danger-full-access`. |
| `OMDSH_IMAGE_PROTOCOL` | Override inline image protocol detection: `kitty`, `iterm2`, or `none`. |
| `VISUAL`, `EDITOR` | Default external editor candidates for `Ctrl+X` and file preview `E`. |
| `NO_COLOR`, `FORCE_COLOR=0`, `COLORTERM` | Disable colors or force 24-bit color (`COLORTERM=truecolor`). |
| `DSH_TELEMETRY_DISABLED` | Disable runtime telemetry reporting. |
| `OMDSH_ACP_COMMAND`, `OMDSH_ACP_ARGS` | Custom command/args for `subagent_isolated` child processes. |

## Related

- [Troubleshooting](troubleshooting.md) — `omdsh doctor` and common failure fixes
- [Sessions and recovery](sessions.md) — `--resume` and local storage paths
- [Permissions and safety](permissions.md) — access levels behind `OMDSH_PERMISSION_MODE`
