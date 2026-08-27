---
description: Add one project Skill and one MCP server to an omdsh workspace, then verify both from the terminal.
---

# Extend a project with Skills and MCP

By the end of this walkthrough the project has one invocable Skill and one connected MCP server, and you know where to verify both.

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

Type `/skill:` in the composer to browse and filter the new Skill alongside other commands, then press `Enter` to invoke it.

### Add an MCP server

Create `.dsh/mcp.json` in the project and declare the server under `mcpServers`:

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

Run `/mcp` to confirm the server is connected, and `/tools` to see its tools beside the native ones.

### Learn more

[Skills and MCP](../skills-and-mcp.md) covers the complete search priority, `SKILL.md` structure, stdio and HTTP examples, environment expansion, override rules, and current protocol limitations.

Skills and MCP are not plugin bundles. To write and install a command, tool, provider, or auth bundle, continue with [Write a plugin](write-a-plugin.md) and [User plugins](../plugins.md).
