---
description: Configure omdsh Skills and MCP servers through DeepSeek Harness discovery paths, SKILL.md files, and per-server MCP clients.
---

# Skills and MCP

omdsh keeps both capabilities behind DeepSeek Harness interfaces. Skills are discovered by the Harness skill registry and filesystem provider; MCP servers are adapted into one `@deepseek-ai/dsh-mcp-client` plugin instance per server. The TUI does not implement either protocol.

## Skills

Skills are enabled by default. The filesystem provider searches these roots in priority order:

- `<project>/.dsh/skills`
- `<project>/.agents/skills`
- `$OMDSH_HOME/skills` (or `$DSH_HOME/skills`, then `~/.dsh/skills`)
- `~/.agents/skills`

A skill may be a directory containing `SKILL.md` or a flat Markdown file. For example:

```text
.dsh/skills/code-review/SKILL.md
```

```markdown
---
name: code-review
description: Review a change for correctness and maintainability.
---

Review the current diff, run focused tests, and report findings by severity.
```

Type `/` and a skill name, such as `/code-review`, to find it alongside commands. The list shows its description and marks skills that require an explicit user request as **User only**. Invoking a skill sends the request and any staged images or files together; Harness loads its instructions before the model responds. Skills that allow model invocation also remain available through the `skill` tool. When a skill shares a name with a command, the command takes precedence in the list. Invoke that skill within a sentence instead, such as “Please use `/review` to check these changes.”

## MCP

omdsh reads MCP configuration from:

1. `$OMDSH_HOME/mcp.json`, `$DSH_HOME/mcp.json`, or `~/.dsh/mcp.json`
2. `<project>/.dsh/mcp.json`

Project definitions override same-named user definitions. A project MCP file can start local programs, so review it before launching omdsh in an unfamiliar repository.

The document uses the common `mcpServers` shape. A stdio server:

```json
{
  "mcpServers": {
    "memory": {
      "command": "mcp-server-memory",
      "args": [],
      "env": {
        "MEMORY_FILE_PATH": "/absolute/path/to/memory.jsonl"
      }
    }
  }
}
```

A Streamable HTTP server:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

Supported optional fields are `enabled`, `timeout` (or `toolCallTimeoutMs`), `failOnStartupError`, and the Harness `reconnect` object. Stdio entries additionally accept `cwd`; HTTP entries accept `headers`. String values support `${NAME}` and `${NAME:-default}` environment expansion, so credentials do not need to be stored directly in the JSON file. An unresolved placeholder without a default remains literal.

Discovered tools use `mcp__<server>__<tool>` names and enter the normal Harness tool registry. `/mcp` opens a keyboard-selectable diagnostic page with plugin registration and startup errors, available tools grouped by server, and the latest ten MCP tool calls in the current session, including programmatic sub-calls. Historical errors remain readable after resume and do not establish a current connection failure. Refresh reloads the snapshot without restarting servers; a failed refresh retains the last loaded state and marks it stale. The published Harness version does not expose live connection or authentication status. `/tools` shows MCP tools alongside native tools, and tool-list changes after a reconnect update the catalog automatically.

With at least one server configured, the model can also list and read that server's resources through the shared `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` tools, each named for the server it queries. Resource text enters the conversation history; binary payloads stay available to programmatic callers. MCP prompt templates remain unsupported.
