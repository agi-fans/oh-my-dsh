# Skills 与 MCP

[English](skills-and-mcp.md) | 简体中文

omdsh 将这两类能力都保留在 DeepSeek Harness 接口之后。Skills 由 Harness Skill Registry 和文件系统 Provider 发现；每个 MCP Server 会被适配为一个 `@deepseek-ai/dsh-mcp-client` 插件实例。TUI 不实现这两种协议。

## Skills

Skills 默认启用。文件系统 Provider 按以下优先级搜索：

- `<project>/.dsh/skills`
- `<project>/.agents/skills`
- `$OMDSH_HOME/skills`（若未设置，则依次使用 `$DSH_HOME/skills` 和 `~/.dsh/skills`）
- `~/.agents/skills`

Skill 可以是包含 `SKILL.md` 的目录，也可以是一个独立的 Markdown 文件。例如：

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

Skills 与普通 Slash Command 共用同一份目录，采用与 pi/OMP 相同的平铺模型。输入 `/skill:` 可以浏览和筛选 Skills，并在列表中查看简短说明；按 Enter 即可调用。旧的 `/code-review` 形式仍可兼容 Harness 的用户调用语义，但不会继续展示。模型也会通过 Harness `skill` 工具收到相同目录，并可以按需加载匹配的 Skill。

## MCP

omdsh 按以下顺序读取 MCP 配置：

1. `$OMDSH_HOME/mcp.json`、`$DSH_HOME/mcp.json` 或 `~/.dsh/mcp.json`
2. `<project>/.dsh/mcp.json`

项目级定义会覆盖同名的用户级定义。项目 MCP 文件可以启动本地程序，因此在不熟悉的仓库中运行 omdsh 前，应先检查该文件。

配置文件使用常见的 `mcpServers` 结构。以下是一个 stdio Server：

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

以下是一个 Streamable HTTP Server：

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

可选字段包括 `enabled`、`timeout`（或 `toolCallTimeoutMs`）、`failOnStartupError` 以及 Harness `reconnect` 对象。stdio 配置还接受 `cwd`，HTTP 配置则接受 `headers`。字符串值支持 `${NAME}` 和 `${NAME:-default}` 环境变量展开，因此凭据不必直接写入 JSON 文件。没有默认值且无法解析的占位符会保持原样。

发现的工具使用 `mcp__<server>__<tool>` 名称，并进入普通 Harness Tool Registry。`/mcp` 按 Server 对已连接工具进行分组，`/tools` 则将它们与原生工具一起展示。MCP 重连后的工具列表变化会自动更新这两个界面。当前 Harness MCP Client 只支持工具，因此 MCP Resources 和 Prompts 尚未接入。
