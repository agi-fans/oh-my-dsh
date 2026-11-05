---
description: 通过 DeepSeek Harness 的发现路径、SKILL.md 和按服务器拆分的 MCP 客户端，配置 omdsh 的 Skills 与 MCP。
---

# Skills 与 MCP

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

输入 `/` 和技能名，例如 `/code-review`，即可在命令列表中查找技能。列表展示技能说明，并将需要用户主动请求的技能标为“仅用户调用”。调用时，请求会与暂存的图片、文件一起提交，由 Harness 在模型回复前加载技能指令。允许模型调用的技能仍可通过 `skill` 工具按需加载。技能与命令同名时，列表保留命令；仍可在正文中引用该技能，例如“请用 `/review` 检查这些改动”。

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

发现的工具使用 `mcp__<server>__<tool>` 名称，进入普通 Harness 工具注册表。`/mcp` 打开支持键盘选择的诊断页，展示插件注册和启动错误、按服务器分组的可用工具，以及当前会话最近十次 MCP 工具调用，包括程序化子调用。恢复会话后仍可阅读历史错误，但不能据此判定当前连接故障。刷新会重新读取快照，不会重启服务器；刷新失败时保留上次加载的状态，并标明它可能已过时。当前发布版 Harness 无法提供实时连接和认证状态。`/tools` 将 MCP 工具与原生工具一起展示，重连后的工具列表变化会自动更新目录。

只要配置了至少一个 Server，模型还可以通过共享的 `list_mcp_resources`、`list_mcp_resource_templates` 与 `read_mcp_resource` 工具列出并读取该 Server 的资源，每次调用都要点名它查询的 Server。资源文本会进入对话历史；二进制载荷仍只对程序化调用方可用。MCP Prompt 模板仍不受支持。
