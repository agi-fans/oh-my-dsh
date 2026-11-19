---
description: 配置本地语言服务器（LSP），让 omdsh 的助手可以精准跳转定义、查找引用、查看实现并读取悬浮类型文档。
---

# 语言服务器（LSP）

配置本地语言服务器后，omdsh 会向模型提供一个只读的 **`lsp`** 工具，支持四项精准代码导航操作：`goToDefinition`（跳转定义）、`findReferences`（查找全部引用）、`goToImplementation`（查看实现）和 `hover`（类型与文档悬浮信息）。

在配置至少一个服务器之前，相关能力不会挂载——没有配语言服务器的项目不会出现一个只会报错的 `lsp` 工具。

## 一、前置条件

先在本地安装目标语言的服务器，并确保可执行文件在 `PATH` 上（omdsh 不自动下载或附带语言服务器）：

| 语言 | 常用服务器 | 启动命令 |
|---|---|---|
| TypeScript / JavaScript | `typescript-language-server` | `typescript-language-server --stdio` |
| Python | `pyright` | `pyright-langserver --stdio` |
| Go | `gopls` | `gopls` |
| Rust | `rust-analyzer` | `rust-analyzer` |
| C / C++ | `clangd` | `clangd` |

## 二、编写 `lsp.json`

配置文件位置与 `mcp.json` 一致：

- **个人级（所有项目生效）**：`$OMDSH_HOME/lsp.json`（默认 `~/.dsh/lsp.json`）
- **项目级（仅当前项目生效，同名覆盖个人级）**：`<项目>/.dsh/lsp.json`

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

### 字段说明

| 字段 | 必填 | 含义 |
|---|---|---|
| `command` | 是 | `PATH` 上的可执行文件名，或绝对路径。 |
| `extensionToLanguage` | 是 | 小写、带点号的文件扩展名到 LSP 语言 ID 的映射（至少一项）。 |
| `args` | 否 | 传给服务器的启动参数数组。 |
| `env` | 否 | 额外环境变量（凭据类变量与 `DSH_*` 不会被转发）。 |
| `initializationOptions` | 否 | 传给服务器 `initialize` 请求的静态选项。 |
| `configuration` | 否 | 对 `workspace/configuration` 请求的静态应答。 |
| `enabled` | 否 | 设为 `false` 可保留配置但暂不启用该服务器。 |

支持 `${NAME}` 与 `${NAME:-fallback}` 环境变量展开，避免把本机绝对路径写死在团队配置里：

```json
{
  "servers": {
    "typescript": {
      "command": "${LSP_BIN:-typescript-language-server}",
      "args": ["--stdio"],
      "extensionToLanguage": { ".ts": "typescript" }
    }
  }
}
```

## 三、验证是否生效

修改 `lsp.json` 后重启 omdsh，用两步快速验收：

1. 在终端运行 `omdsh --dump-config`，确认配置中出现了 `lsp`、`lsp-stdio` 与 `tool-lsp`；
2. 进入 omdsh 后运行 `/tools`，搜索 `lsp`，确认 `lsp` 工具已经可用。

## 四、工作原理、边界与快速排查

- **什么时候最有价值**：面对重名符号、重载方法或需要查清全部调用点再重构时，模型用 `lsp` 比全文 `grep` 准得多；`findReferences` 总是包含声明处，避免遗漏定义。
- **按需启动与实时读盘**：每个工作区首次查询时才拉起对应的语言服务器进程，每次查询读取磁盘上的最新文件内容，不会残留脏缓冲。
- **权限提醒**：语言服务器与 omdsh 拥有相同进程权限，宿主会拒绝工作区外、非普通文件或超大文件的查询，但不额外提供进程沙箱——只配置你信任的本地二进制。
- **常见排查**：
- **启动即报错**：omdsh 启动时会检查所有已配置二进制是否存在、JSON 是否合法，缺二进制会直接给出明确报错而不会静默忽略；用 `which <command>` 检查 `PATH` 或把该服务器临时设为 `"enabled": false`。
- **模型收到 `LSP_UNAVAILABLE`**：说明目标文件扩展名没有在 `extensionToLanguage` 中映射对应服务器（例如 `.mts` / `.jsx` 漏配了），补上扩展名映射后重启即可。
