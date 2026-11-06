---
description: 为 omdsh 工作区添加一个项目 Skill 和一个 MCP Server，并在终端中验证二者。
---

# 使用 Skills 与 MCP 扩展项目

完成本教程后，你会拥有一个可复用的项目 Skill 和一份 MCP Server 配置，并知道如何检查 omdsh 加载的能力。Skill 为任务提供指令，MCP Server 为 Agent 提供可调用工具。

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

在 Composer 中输入 `/` 和新 Skill 的名称，即可在命令列表中找到它，按 `Enter` 调用。提交请求前也可以暂存图片或文件。

### 添加 MCP Server

下面的示例要求先安装一个通过 stdio 通信的 MCP Memory Server，并确保 `mcp-server-memory` 在 `PATH` 中可用。先按照该服务器的说明安装，或将命令与参数替换为已经使用的服务器。在项目中创建 `.dsh/mcp.json`，通过 `mcpServers` 声明配置。

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

运行 `/mcp` 查看已注册的 MCP 工具与可用诊断，再用 `/tools` 在工具列表中找到它们。如果缺失，可以用 `omdsh doctor` 检查可执行程序与配置。最后请 Agent 调用一个合适的工具，并查看结果；调用成功可以验证当前服务器与凭据下的这项操作。

### 了解更多

完整的搜索优先级、`SKILL.md` 结构、stdio 与 HTTP 示例、环境变量展开、覆盖规则和当前协议限制，请参阅 [Skills 与 MCP](../skills-and-mcp.md)。

希望通过 bundle 添加命令、工具、提供方或授权流程，可以继续[安装示例插件](install-plugin.md)。Bundle 约定见[用户插件](../plugins.md)。
