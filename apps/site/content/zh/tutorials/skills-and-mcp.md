---
description: 看懂 Skills、MCP、LSP 与插件包该怎么选，动手写一个项目 Skill，并通过 /mcp 免重启接入外部工具与安全凭据。
---

# 用 Skills 与 MCP 扩展能力

写代码时经常会遇到两类重复需求：一是希望助手始终记住团队的固定流程（比如代码评审清单、发版检查步骤），二是希望助手能直接查数据库、看文档系统或调用外部 API。

在动手配置之前，先用下面这张表选对最轻、最合适的方式——**90% 的场景其实不需要写插件**。

## 一、怎么选：Skills vs MCP vs LSP vs 插件包

| 扩展方式 | 一句话定位 | 上手成本 | 最适合什么场景 |
|---|---|---|---|
| **Skill（`SKILL.md`）** | 给模型看的“可复用作业指导书” | **最低**（写一个 Markdown 文件） | 代码评审清单、提交规范、团队内部排查手册、固定输出模板。 |
| **MCP 服务器** | 给模型接入**外部工具和数据源**的标准接口 | **低**（在 `/mcp` 里填命令或 URL） | 查文档库、读数据库、查 Issue/工单系统、调用内部 HTTP 工具。 |
| **语言服务器（LSP）** | 给模型提供**精准代码导航**（跳转定义、查引用、看类型诊断） | **低**（装好对应语言服务器并写一份 `lsp.json`） | 大型 TypeScript / Go / Rust / Python 仓库，想减少全文 grep 误判。 |
| **插件包（Plugin）** | 给 omdsh 增加新斜杠命令、新内置工具或新模型服务商 | **中等**（安装现成插件，或写 npm 包） | 需要自定义 `/命令`、接入新模型协议、或集成复杂本地能力。 |

这篇教程带你实际跑通前两项：**写一个项目 Skill**，再**在 `/mcp` 里免重启接入一个 MCP 服务器**。安装插件见下一篇[安装插件与内置集成](install-plugin.md)，配置 LSP 见[语言服务器（LSP）](../language-servers.md)。

## 二、动手写一个项目 Skill

Skill 就是一个放在约定目录下的 `SKILL.md` 文件：

- **项目级（随仓库共享给团队）**：`.dsh/skills/<技能名>/SKILL.md`
- **个人级（所有项目都能用）**：`$OMDSH_HOME/skills/<技能名>/SKILL.md`（未设置 `$OMDSH_HOME` 时默认在 `~/.dsh/skills/`）

### 1. 创建你的第一个 Skill

在项目根目录创建 `.dsh/skills/code-review/SKILL.md`：

```markdown
---
name: code-review
description: 按团队标准检查变更的正确性、边界条件与回归测试覆盖
---

检查当前改动时按以下顺序输出结论：

1. 先列出高风险逻辑问题、并发/边界漏洞与错误处理缺失，并标注具体文件和行号。
2. 检查是否有与之匹配的单元测试或回归测试；若缺失，给出具体的测试用例建议。
3. 最后给出 3 行以内的整体评价，不重复粘贴未修改的代码。
```

### 2. 怎么触发它

保存后**重启 omdsh**（或在新建会话中）即可生效，触发方式有两种：

- **手动调用**：在输入框输入 `/` 可以看到 `/code-review` 补全，直接发送 `/code-review 检查 src/auth 的最近改动` 即可按清单执行；
- **模型自动触发**：当你说“帮我按团队标准 review 一下这次改动”时，模型看到 `description` 匹配也会自动按需加载这份 Skill。
- 如果某个 Skill 只想手动通过 `/名称` 触发、不希望模型自己主动调用，在 frontmatter 里加上 `user-invocable: true` 即可。

## 三、免重启接入 MCP 服务器（推荐用 `/mcp`）

MCP（Model Context Protocol）让助手能够安全调用外部服务提供的工具和资源。omdsh 内置了实时 MCP 管理器，**直接在 `/mcp` 里就能添加、测试、重启或停用服务器，不需要手改文件，也不用重启 omdsh**。

### 1. 交互式添加服务器

在 omdsh 中运行 `/mcp`，选择 **`添加服务器…`（`Add server…`）**，按提示填写：

1. **名称**：简短易认的名字，例如 `docs` 或 `memory`；
2. **连接方式**：
- **`stdio`（本地命令行程序）**：填可执行命令与参数，例如 `npx -y @modelcontextprotocol/server-memory`；
- **`streamable-http`（远程 HTTP 服务）**：填服务端 URL，例如 `https://mcp.example.com/mcp`。
3. **环境变量或请求头（如需要 API Token）**：
- 不要把真实密钥明文写死在配置里！在变量或请求头值中使用 **`${credential:变量名}`** 占位（例如 `Authorization: Bearer ${credential:DOCS_MCP_TOKEN}`），omdsh 会引导你把密钥加密存进本地凭据库，配置中只保存引用名。

### 2. 立刻探测并验证工具是否就绪

添加完成后，就在 `/mcp` 界面里选中刚加好的服务器：

- **看实时状态**：正常会显示 `已连接`（`connected`）以及暴露的工具数量；如果看到 `等待凭据`（`waiting for credentials`），说明引用的 `${credential:...}` 还没填密钥；如果看到 `失败`（`failed`），可以点进详情看完整报错日志。
- **点 `探测`（`Probe`）**：在不重启连接的前提下快速测试连通性与工具列表；
- **点 `重启`（`Restart`）或 `禁用`（`Disable`）**：修改了远程权限或暂时不想让模型看到这组工具时，一键生效。
- 也可以在 `/mcp` 里直接打开 **`可用工具`** 或 **`本次会话的最近调用`**，查看每次 MCP 工具调用的耗时与成功/失败结果。

### 3. 什么时候改用团队共享的 `.dsh/mcp.json`？

| 方式 | 适用场景 | 是否需重启 |
|---|---|---|
| **`/mcp` 实时管理（推荐）** | 个人日常开发、快速试接新服务、含私有密钥的远程 MCP | **免重启，立即生效** |
| **项目 `.dsh/mcp.json`** | 需要提交进 Git 仓库、让团队所有成员拉代码后自动拥有同一套标准 MCP 服务 | 改动文件后需重启 omdsh |

如果你需要随仓库共享一份标准配置，在项目根目录建 `.dsh/mcp.json`：

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

## 常见踩坑提示

- **工具太多反而拖慢模型**：每个已连接的 MCP 服务器都会把工具定义放进上下文（可在 `/context` 的 `Tool schemas` 一项看到占用）。不常用的服务器在 `/mcp` 里顺手点 `禁用` 即可，用时再开。
- **`stdio` 服务连不上**：先在输入框用 `!which npx` 或 `!命令 --help` 确认可执行文件在 `PATH` 里且能正常启动。

## 下一步

- 想一键安装现成插件或开启内置的 Codex、Claude Code、Git Worktree 集成：继续读[安装插件与内置集成](install-plugin.md)。
- 查阅完整的 `SKILL.md` 字段、MCP 7 种连接状态与高级选项：[Skills 与 MCP 参考](../skills-and-mcp.md)。
