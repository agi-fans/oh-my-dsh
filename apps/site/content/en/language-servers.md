---
description: Configure local language servers so the omdsh agent can jump to definitions, find references, inspect implementations, and read hover documentation.
---

# Language servers

omdsh can hand the agent a read-only `lsp` tool backed by real language servers. The tool has four operations — `goToDefinition`, `findReferences`, `goToImplementation`, and `hover` — and omdsh does not implement the protocol itself: the DeepSeek Harness `dsh-lsp` seam, the `dsh-lsp-stdio` host, and the `dsh-tool-lsp` tool own server lifecycle, framing, and result normalization.

Nothing is mounted until you configure at least one server, so a session without language servers never shows an `lsp` tool that can only fail.

## Prerequisites

Install the server you want and make sure its executable is on `PATH`. omdsh ships no language server and installs none. Common choices:

| Language | Server | Command |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `typescript-language-server --stdio` |
| Python | `pyright` | `pyright-langserver --stdio` |
| Go | `gopls` | `gopls` |
| Rust | `rust-analyzer` | `rust-analyzer` |
| C / C++ | `clangd` | `clangd` |

## Configure servers

Write `lsp.json` in the same places omdsh reads `mcp.json`: `$OMDSH_HOME/lsp.json` (or `$DSH_HOME/lsp.json`, then `~/.dsh/lsp.json`) for every project, and `<project>/.dsh/lsp.json` for one project. A project definition overrides a user definition with the same server name.

```json
{
  "servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": {
        ".ts": "typescript",
        ".tsx": "typescriptreact"
      }
    },
    "python": {
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "extensionToLanguage": { ".py": "python" }
    }
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `command` | yes | Executable name resolved on `PATH`, or an absolute path. |
| `extensionToLanguage` | yes | Lowercase leading-dot extension to LSP language id. At least one entry. |
| `args` | no | Arguments passed to the executable. |
| `env` | no | Extra environment merged over the inherited one. Credential-shaped names and `DSH_*` are not forwarded. |
| `initializationOptions` | no | Static `initialize` options for the server. |
| `configuration` | no | Static answer to every `workspace/configuration` request. |
| `enabled` | no | Set `false` to keep a server in the file without mounting it. |

`${NAME}` and `${NAME:-fallback}` expand from the environment, so a machine-specific path or binary name can stay out of the file:

```json
{ "servers": { "typescript": {
  "command": "${LSP_BIN:-typescript-language-server}",
  "extensionToLanguage": { ".ts": "typescript" }
} } }
```

Restart omdsh after editing `lsp.json`. `omdsh --dump-config` lists the `lsp`, `lsp-stdio`, and `tool-lsp` rows, and `/tools` lists the `lsp` tool.

## What the agent gets

The agent calls `lsp` with an operation, a file path, and one-based line and character coordinates. Navigation returns `path:line:character` locations grouped by file; `findReferences` always includes the declaration, so impact analysis never misses the defining site. Hover returns normalized text. Empty results are successful no-result answers, not errors.

Use it when textual search is ambiguous — a common symbol name, an overloaded method, or a change that needs exact call sites — and keep `grep` and `read` for ordinary navigation.

## Behavior and limits

- omdsh resolves every configured executable at startup. A missing binary or a malformed `lsp.json` fails the launch with a labelled error instead of silently disabling navigation.
- Each workspace gets one pooled server process, started on the first query for that workspace. Queries to one server run one at a time; different workspaces run in parallel.
- Each query opens the current source text transiently and closes it afterwards, so the server always sees what is on disk and no document state accumulates.
- A configured server runs with the same filesystem and process authority as omdsh. The host rejects query sources that are missing, non-regular, non-UTF-8, oversized, or outside the workspace, but it adds no sandbox of its own — treat a configured server like any other executable you trust.
- A query for an extension no configured server maps fails with `LSP_UNAVAILABLE`, which the agent can read and route around.
