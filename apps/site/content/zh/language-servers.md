---
description: 配置本地语言服务器，让 omdsh 的 Agent 可以跳转定义、查找引用、查看实现，并读取悬浮文档。
---

# 语言服务器

omdsh 可以把一个只读的 `lsp` 工具交给 Agent，由真实的语言服务器驱动。该工具有四个操作：`goToDefinition`、`findReferences`、`goToImplementation` 和 `hover`。omdsh 本身不实现协议：DeepSeek Harness 的 `dsh-lsp` 缝、`dsh-lsp-stdio` 宿主和 `dsh-tool-lsp` 工具分别负责服务器生命周期、消息帧和结果规范化。

在配置至少一个服务器之前，这些插件都不会挂载，因此没有语言服务器的会话不会出现一个只会失败的 `lsp` 工具。

## 前置条件

安装你需要的服务器，并确保它的可执行文件在 `PATH` 上。omdsh 不附带也不安装任何语言服务器。常见选择：

| 语言 | 服务器 | 命令 |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `typescript-language-server --stdio` |
| Python | `pyright` | `pyright-langserver --stdio` |
| Go | `gopls` | `gopls` |
| Rust | `rust-analyzer` | `rust-analyzer` |
| C / C++ | `clangd` | `clangd` |

## 配置服务器

把 `lsp.json` 写到与 `mcp.json` 相同的位置：`$OMDSH_HOME/lsp.json`（或 `$DSH_HOME/lsp.json`，再退回 `~/.dsh/lsp.json`）对所有项目生效，`<项目>/.dsh/lsp.json` 只对当前项目生效。同名的项目定义会覆盖用户定义。

```json
{
  "servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": {
        ".ts": "typescript",
        ".tsx": "typescriptreact"
      }
    },
    "python": {
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "extensionToLanguage": { ".py": "python" }
    }
  }
}
```

| 字段 | 必填 | 含义 |
|---|---|---|
| `command` | 是 | 在 `PATH` 上解析的可执行文件名，或绝对路径。 |
| `extensionToLanguage` | 是 | 小写、以点开头的扩展名到 LSP 语言 id 的映射，至少一项。 |
| `args` | 否 | 传给可执行文件的参数。 |
| `env` | 否 | 叠加在继承环境之上的额外环境变量；形如凭据的名称与 `DSH_*` 不会被转发。 |
| `initializationOptions` | 否 | 传给服务器的静态 `initialize` 选项。 |
| `configuration` | 否 | 对每个 `workspace/configuration` 请求的静态应答。 |
| `enabled` | 否 | 设为 `false` 可保留配置但不挂载该服务器。 |

`${NAME}` 与 `${NAME:-fallback}` 会从环境展开，因此机器相关的路径或二进制名可以留在文件之外：

```json
{ "servers": { "typescript": {
  "command": "${LSP_BIN:-typescript-language-server}",
  "extensionToLanguage": { ".ts": "typescript" }
} } }
```

修改 `lsp.json` 后重启 omdsh。`omdsh --dump-config` 会列出 `lsp`、`lsp-stdio` 和 `tool-lsp` 三行，`/tools` 会列出 `lsp` 工具。

## Agent 能看到什么

Agent 调用 `lsp` 时给出操作、文件路径，以及从 1 开始的行号与列号。导航按文件分组返回 `path:line:character` 位置；`findReferences` 总是包含声明本身，因此影响面分析不会漏掉定义处。悬浮返回规范化文本。空结果是成功返回的"没有结果"，不是错误。

当纯文本搜索有歧义时使用它——常见符号名、重载方法，或需要精确调用点的改动——普通导航仍交给 `grep` 与 `read`。

## 行为与限制

- omdsh 在启动时解析每个已配置的可执行文件。缺少二进制或 `lsp.json` 格式错误会让启动以带标签的错误失败，而不是悄悄关闭导航。
- 每个工作区有一个池化的服务器进程，在该工作区第一次查询时启动。同一个服务器的查询串行执行，不同工作区并行。
- 每次查询都会临时打开当前源文件文本并在结束后关闭，因此服务器看到的始终是磁盘上的内容，且不会累积文档状态。
- 配置的服务器拥有与 omdsh 相同的文件系统与进程权限。宿主会拒绝缺失、非普通文件、非 UTF-8、过大或位于工作区之外的查询源，但自身不提供沙箱——请像对待任何你信任的可执行文件一样对待它。
- 查询的扩展名没有对应服务器时会返回 `LSP_UNAVAILABLE`，Agent 可以读取并据此调整。
