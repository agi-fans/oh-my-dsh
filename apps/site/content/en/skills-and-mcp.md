---
description: Complete reference for Skills (SKILL.md directories and frontmatter) and MCP servers (live /mcp management, ${credential:NAME} secrets, all 7 states, and static mcp.json).
---

# Skills and MCP

Capture repeatable team workflows as **Skills**, and connect external tools or data sources via **MCP (Model Context Protocol)**—neither requires writing a plugin. For a hands-on walkthrough see [Extend projects with Skills and MCP](tutorials/skills-and-mcp.md).

## 1. Skills (`SKILL.md`)

### Discovery locations

omdsh discovers `<skill-name>/SKILL.md` automatically at startup (project definitions override user definitions of the same name):

| Scope | Path | Purpose |
|---|---|---|
| **Project** | `<repo>/.dsh/skills/<skill-name>/SKILL.md` | Checked into Git and shared across the team |
| **User** | `$OMDSH_HOME/skills/<skill-name>/SKILL.md` (defaults to `~/.dsh/skills/`) | Personal workflows available in every repo |

### Format and frontmatter fields

```markdown
---
name: release-check
description: Verify changelog entries, version alignment, and build checks before cutting a release
user-invocable: true
---

When running a release check, verify each item in order:

1. Confirm the root manifest and workspace package versions match.
2. Confirm CHANGELOG.md Unreleased covers every user-visible change.
3. Run typecheck, test, and build and report any failures.
```

| Field | Required | Effect |
|---|---|---|
| `name` | Yes | Lowercase identifier (hyphens allowed); exposed as `/<name>`. |
| `description` | Yes | Shown in `/` completion and used by the model to decide when to load the Skill. |
| `user-invocable` | No | Set to `true` to mark as user-only—runs only when you explicitly type `/<name>`. |

### Invocation and precedence

- Type `/<name>` directly (supports images and file attachments).
- Unless marked user-only, the model can load matching Skills automatically when relevant.
- Built-in slash commands take precedence on name collisions; you can still reference the Skill in plain text (for example “Use the `release-check` skill”).

---

## 2. MCP servers

omdsh supports both **live management in `/mcp`** and **static `mcp.json` files**:

| Aspect | Live `/mcp` manager (recommended) | Static `mcp.json` file |
|---|---|---|
| **Restart required** | **No**—add, toggle, restart, and remove apply live | Yes, after editing the file |
| **Secrets** | Native `${credential:NAME}` references in local credentials store | Use environment variables; avoid committing raw tokens |
| **Operations** | Non-disruptive **`Probe`**, **`Restart`**, **`Disable`** | Read-only registration status and diagnostics |
| **Best for** | Personal servers, remote HTTP endpoints, private tokens | Team-standard servers committed into Git |

### Managing servers live in `/mcp`

Run `/mcp` (or open `/settings` → **`Plugins` → `Integrations` → `MCP servers`**):

- **Add server (`Add server…`):**
- `stdio`: local executable, args, and optional environment variables.
- `streamable-http`: remote HTTP endpoint URL and optional headers.
- **Safe secrets with `${credential:NAME}`:** Reference secrets as `${credential:MY_API_TOKEN}` in env vars or headers so raw secrets stay in the local credentials store rather than plain config.
- **Live controls:** Select any managed server to **`Probe`** (checks connectivity and tools without restarting), **`Restart`**, **`Enable/Disable`**, **`Remove`**, or restore inherited definitions.

### Static `mcp.json` (for Git-shared setups)

Place in `<repo>/.dsh/mcp.json` (project) or `$OMDSH_HOME/mcp.json` (user; project overrides user on name match):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "docs": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

### All seven connection states

| State | Meaning and next action |
|---|---|
| `connected` | Healthy and ready; displays exposed tool count |
| `connecting` | Establishing initial connection |
| `waiting-credentials` | A referenced `${credential:...}` secret is missing; store it and **`Restart`** |
| `reconnecting` | Attempting to recover after a drop |
| `disabled` | Manually turned off; its tools stay out of model context |
| `closed` | Connection closed; choose **`Restart`** when needed |
| `failed` | Startup or connection error; inspect diagnostics, then **`Probe`** or **`Restart`** |

### Tools, resources, and recent calls

- Connected tools appear as `mcp__<server>__<tool>` alongside `mcp-resources` in `/tools` and `/mcp` → **`Available tools`**.
- Text resources enter conversation history; binary payloads stay available to programmatic callers (such as `PTC` `run_code`).
- Open `/mcp` → **`Recent calls in this session`** to review outcomes and error details for the last 10 calls (note: an error may come from the remote tool itself rather than the connection).

## Related

- [Extend projects with Skills and MCP (tutorial)](tutorials/skills-and-mcp.md) — comparison table and step-by-step walkthrough
- [Status and diagnostics](observability.md) — checking how tool schemas affect context budget
- [Language servers](language-servers.md) — configuring read-only `lsp` code navigation
