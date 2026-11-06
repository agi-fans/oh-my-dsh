---
description: Add one project Skill and one MCP server to an omdsh workspace, then verify both from the terminal.
---

# Extend a project with Skills and MCP

By the end of this walkthrough, you will have a reusable project Skill and an MCP server configuration, and know how to inspect the capabilities omdsh loaded. Skills supply instructions for a task. MCP servers supply tools the agent can call.

### Add a project Skill

Skills live under `.dsh/skills` or `.agents/skills` in the project. Create one directory per Skill with a `SKILL.md` inside:

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

Type `/` and the new Skill’s name in the composer to find it alongside commands, then press `Enter` to invoke it. You can stage images or files before submitting the request.

### Add an MCP server

This example assumes you have installed a stdio MCP memory server that provides `mcp-server-memory` on `PATH`. Follow that server’s installation instructions first, or substitute the executable and arguments of a server you already use. Create `.dsh/mcp.json` in the project and declare it under `mcpServers`.

```json
{
  "mcpServers": {
    "memory": {
      "command": "mcp-server-memory",
      "args": []
    }
  }
}
```

MCP configuration loads at startup, so restart omdsh if it is already running. A project MCP file can start local programs, so review it before launching omdsh in an unfamiliar repository.

Run `/mcp` to inspect the registered MCP tools and available diagnostics, then `/tools` to find them alongside native tools. If they are missing, check the executable and configuration with `omdsh doctor`. Finally, ask the agent to invoke an appropriate tool and inspect its result. A successful call verifies that operation with the current server and credentials.

### Learn more

[Skills and MCP](../skills-and-mcp.md) covers the complete search priority, `SKILL.md` structure, stdio and HTTP examples, environment expansion, override rules, and current protocol limitations.

To add a command, tool, provider, or authorization flow through a bundle, continue with [Install the example plugin](install-plugin.md). The bundle contract is in [User plugins](../plugins.md).
