---
description: Configure local language servers (LSP) so omdsh can jump to definitions, find references, inspect implementations, and read hover docs accurately.
---

# Language servers (LSP)

Configuring a local language server exposes a read-only **`lsp`** tool to the agent with four precise operations: `goToDefinition`, `findReferences`, `goToImplementation`, and `hover`.

Nothing is mounted until at least one server is configured, so projects without language servers never see a broken `lsp` tool.

## 1. Prerequisites

Install the language server(s) you need and make sure their executables are on `PATH` (omdsh does not bundle or download servers automatically):

| Language | Common server | Command |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `typescript-language-server --stdio` |
| Python | `pyright` | `pyright-langserver --stdio` |
| Go | `gopls` | `gopls` |
| Rust | `rust-analyzer` | `rust-analyzer` |
| C / C++ | `clangd` | `clangd` |

## 2. Configure `lsp.json`

`lsp.json` lives beside `mcp.json`:

- **User-wide:** `$OMDSH_HOME/lsp.json` (defaults to `~/.dsh/lsp.json`)
- **Project-scoped (overrides user entries of the same name):** `<repo>/.dsh/lsp.json`

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

### Fields

| Field | Required | Meaning |
|---|---|---|
| `command` | Yes | Executable name on `PATH` or an absolute path. |
| `extensionToLanguage` | Yes | Lowercase dot-prefixed extensions mapped to LSP language IDs (at least one). |
| `args` | No | Command-line arguments passed to the executable. |
| `env` | No | Extra environment variables (credential-like names and `DSH_*` are never forwarded). |
| `initializationOptions` | No | Static options sent on LSP `initialize`. |
| `configuration` | No | Static response to `workspace/configuration`. |
| `enabled` | No | Set `false` to keep the entry in the file without mounting it. |

`${NAME}` and `${NAME:-fallback}` expand from the environment so machine-specific paths stay out of shared files:

```json
{
  "servers": {
    "typescript": {
      "command": "${LSP_BIN:-typescript-language-server}",
      "args": ["--stdio"],
      "extensionToLanguage": { ".ts": "typescript" }
    }
  }
}
```

## 3. Verify your setup

Restart omdsh after editing `lsp.json`, then check two things:

1. Run `omdsh --dump-config` and confirm `lsp`, `lsp-stdio`, and `tool-lsp` appear.
2. Inside omdsh, run `/tools` and search for `lsp`.

## 4. Behavior, limits, and quick troubleshooting

- **When it shines:** Common symbol names, overloaded methods, and refactors needing exact call sites (`findReferences` always includes the declaration). Plain navigation still uses `grep` and `read`.
- **On-demand & fresh:** One pooled server per workspace starts on the first query; every query reads the current file from disk so buffers never go stale.
- **Security note:** Configured servers run with the same filesystem and process permissions as omdsh. The host rejects missing, non-regular, non-UTF-8, oversized, or out-of-workspace targets, but does not sandbox the server binary itself—configure only trusted executables.
- **Quick fixes:**
- **Startup fails immediately:** omdsh validates every enabled binary and JSON schema at boot rather than failing silently. Check `which <command>` on `PATH`, or temporarily set `"enabled": false`.
- **Model sees `LSP_UNAVAILABLE`:** The queried file’s extension is missing from `extensionToLanguage` (for example `.mts` or `.jsx`). Add the mapping and restart omdsh.
