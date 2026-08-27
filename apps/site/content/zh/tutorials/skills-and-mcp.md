---
description: 为 omdsh 工作区添加一个项目 Skill 和一个 MCP Server，并在终端中验证二者。
---

# 使用 Skills 与 MCP 扩展项目

读完本教程，项目将拥有一个可调用的 Skill 和一个已连接的 MCP Server，并知道在哪里验证它们。

### 添加项目 Skill

Skill 位于项目的 `.dsh/skills` 或 `.agents/skills` 下。每个 Skill 一个目录，目录内放一个 `SKILL.md`：

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

在 Composer 中输入 `/skill:`，即可像浏览普通命令一样查看并筛选新的 Skill，按 `Enter` 调用它。

### 添加 MCP Server

在项目中创建 `.dsh/mcp.json`，并在 `mcpServers` 下声明服务器：

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

MCP 配置在启动时加载，如果 omdsh 已在运行，请重启。项目 MCP 文件可以启动本地程序，在不熟悉的仓库中启动 omdsh 前请先检查它。

运行 `/mcp` 确认服务器已连接，再运行 `/tools`，可以在原生工具旁边看到它的工具。

### 了解更多

完整的搜索优先级、`SKILL.md` 结构、stdio 与 HTTP 示例、环境变量展开、覆盖规则和当前协议限制，请参阅 [Skills 与 MCP](../skills-and-mcp.md)。

Skills 与 MCP 不是插件 bundle。要编写并安装命令、工具、提供方或 Auth bundle，请继续 [编写插件](write-a-plugin.md) 和 [用户插件](../plugins.md)。
