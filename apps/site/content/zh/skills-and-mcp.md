---
description: 全面掌握 Skills（SKILL.md 目录与 frontmatter 字段）和 MCP 服务器（/mcp 免重启管理、${credential:NAME} 凭据模板、7 种连接状态与静态 mcp.json）。
---

# Skills 与 MCP

通过 **Skills** 把团队规范沉淀成可复用指令，通过 **MCP（Model Context Protocol）** 把外部工具与数据源接入模型——两者都不需要写插件代码。如果你是第一次配，可以先跟着[用 Skills 与 MCP 扩展能力](tutorials/skills-and-mcp.md)动手跑通一遍。

## 一、Skills（`SKILL.md`）

### 发现位置

omdsh 启动时自动扫描以下目录中的 `<技能名>/SKILL.md`（同名时项目级覆盖个人级）：

| 作用域 | 目录路径 | 用途 |
|---|---|---|
| **项目级** | `<项目>/.dsh/skills/<技能名>/SKILL.md` | 随 Git 仓库共享给团队成员 |
| **个人级** | `$OMDSH_HOME/skills/<技能名>/SKILL.md`（默认 `~/.dsh/skills/`） | 跨所有项目复用的个人工作流 |

### `SKILL.md` 格式与常用字段

```markdown
---
name: release-check
description: 发版前检查 CHANGELOG、版本号同步和构建验证清单
user-invocable: true
---

执行发版检查时，依次核对以下项目并输出逐项结果：

1. 检查根 manifest 与各子包版本号是否一致。
2. 核对 CHANGELOG.md 的 Unreleased 小节是否已完整记录用户可见变更。
3. 运行完整 typecheck、test 与 build，汇报任何失败项。
```

| Frontmatter 字段 | 必填 | 作用 |
|---|---|---|
| `name` | 是 | 技能名（全小写、可用连字符），对应手动斜杠命令 `/<name>`。 |
| `description` | 是 | 简明说明技能用途，显示在 `/` 补全列表并供模型判断是否自动加载。 |
| `user-invocable` | 否 | 设为 `true` 时标记为“仅用户调用”：只在你显式输入 `/<name>` 时触发，模型不会自动调用。 |

### 调用方式与优先级

- 输入 `/` 加技能名可直接触发（支持附带图片和文件）；
- 未标记“仅用户调用”的技能，当你的问题与 `description` 高度匹配时，模型也会按需加载；
- 若技能名与内置斜杠命令重名，内置命令优先；可以在普通提问中直接提及它（例如“请按 `release-check` 技能检查”）。

---

## 二、MCP 服务器

omdsh 同时支持**实时托管管理（`/mcp`）**和**静态配置文件（`mcp.json`）**两种方式，按需选择：

| 维度 | `/mcp` 实时管理（推荐） | 静态 `mcp.json` 文件 |
|---|---|---|
| **是否需要重启** | **免重启**，添加、启停、重启、移除立即生效 | 修改文件后需重启 omdsh |
| **安全密钥** | 原生支持 `${credential:NAME}` 加密凭据引用 | 建议通过环境变量传递，避免明文提交 |
| **交互操作** | 支持不中断连接的 **`探测`（`Probe`）**、一键 **`重启`**、随时 **`禁用`** | 仅查看注册状态与诊断 |
| **适用场景** | 个人高频工具、远程 HTTP 服务、含私有 Token 的服务 | 需要随 Git 仓库共享给整个团队的标准配置 |

### 1. 在 `/mcp` 中实时管理服务器

运行 `/mcp`（或 `/settings` → **`插件` → `集成` → `MCP 服务器`**）：

- **添加服务器（`添加服务器…`）**：
- `stdio`：本地命令行服务器（填写可执行命令、参数和可选环境变量）；
- `streamable-http`：远程 HTTP 服务器（填写 URL 和可选请求头）。
- **用 `${credential:NAME}` 安全托管密钥**：在环境变量或请求头中写入 `${credential:MY_API_TOKEN}`，omdsh 会引导你将真实密钥存入本地加密凭据库，配置文件中绝不出现明文密钥。
- **日常操作**：在列表选中任意托管服务器后可执行 **`探测`**（不重启即可检测连通性与最新工具）、**`重启`**、**`启用/禁用`**、**`移除`** 或恢复继承定义。

### 2. 静态 `mcp.json` 配置（团队共享）

放在 `<项目>/.dsh/mcp.json`（项目级）或 `$OMDSH_HOME/mcp.json`（个人级，同名项目级覆盖个人级）：

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

### 3. 七种实时连接状态与排查指南

在 `/mcp` 中可以直观看到每个服务器的当前连接状态：

| 状态（英文 / 中文） | 含义与处理方式 |
|---|---|
| `connected` / 已连接 | 正常就绪，同时显示已发现的工具数 |
| `connecting` / 连接中 | 正在建立初始化连接 |
| `waiting-credentials` / 等待凭据 | 缺少引用的 `${credential:...}` 密钥，补录后点 **`重启`** |
| `reconnecting` / 重连中 | 连接中断后正在尝试重连 |
| `disabled` / 已禁用 | 已手动停用，其工具不进入模型上下文 |
| `closed` / 已关闭 | 连接已关闭，需要时点 **`重启`** 恢复 |
| `failed` / 失败 | 启动或连接报错，选中查看详细诊断，排查后点 **`探测`** 或 **`重启`** |

### 4. 模型如何看到 MCP 工具与资源

- 已连接服务器暴露的工具统一以 `mcp__<服务器名>__<工具名>` 注册，并连同 `mcp-resources` 资源读取能力一并出现在 `/tools` 和 `/mcp` → **`可用工具`** 中；
- 文本类型的资源内容可直接进入对话历史（二进制载荷仅供 `PTC` 代码模式等程序化调用方处理）；
- 在 `/mcp` → **`本次会话的最近调用`** 可以回看最近 10 次 MCP 调用的结果与报错详情（注意：报错可能来自外部工具逻辑本身，而非连接故障）。

## 相关

- [用 Skills 与 MCP 扩展能力（教程）](tutorials/skills-and-mcp.md) —— 选型对比与一步步实战
- [状态与诊断](observability.md) —— 检查工具 schema 对上下文容量的占用
- [语言服务器（LSP）](language-servers.md) —— 配置只读代码跳转工具
