---
description: omdsh 命令行完整参考：启动参数、omdsh doctor 诊断、omdsh exec --json 脚本与 CI 集成（含 jq 示例与错误码）、插件 CLI、Shell 补全与全部环境变量。
---

# 命令行与脚本模式

直接运行 `omdsh` 会启动交互式终端界面；此外还提供只读自检（`doctor`）、机器可读脚本执行（`exec --json`）、插件管理（`plugin`）和 Shell 补全（`completions`）四个子命令。

## 命令总览

```text
omdsh [options] [prompt...]
omdsh doctor [--json]
omdsh exec --json [--model <route>] [--provider <route>] [--resume <id>] [--] [prompt...]
omdsh plugin add|update|remove|list [args...]
omdsh completions bash|zsh|fish
```

在默认 TUI 入口中，传入位置参数会启动 omdsh 并直接把拼接文本作为第一条消息发送；`--resume` 不能与位置提示混用，`--dump-config` 不能与其他执行参数混用。

## 启动选项

| 选项 | 作用 |
|---|---|
| `--model <route>` | 指定本次进程的模型（覆盖 `OMDSH_MODEL`，默认 `deepseek-flash`）。 |
| `--provider <route>` | 指定本次进程的服务商（覆盖 `OMDSH_PROVIDER`，默认 `deepseek-official`）。 |
| `-r, --resume <session-id>` | 恢复指定历史会话。 |
| `--dump-config` | 打印最终组装的插件与配置树并退出（用于排查配置和插件）。 |
| `-h, --help` | 显示命令行帮助。 |
| `--version` | 打印当前已安装版本号。 |

**配置优先级**（从高到低）：命令行参数 > 进程环境变量 > 项目目录 `.env` > `$OMDSH_HOME/.env` > `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`。

## 一、内置诊断（`omdsh doctor`）

`omdsh doctor` 是**完全只读**的快速体检命令——不启动插件、不连 MCP 服务器、不发模型请求，适合排查任何安装或启动异常：

```sh
omdsh doctor         # 人类可读报告
omdsh doctor --json  # 机器可读 JSON（含 schemaVersion: 1）
```

每项检查报告 4 种状态之一：`ok`（正常）、`failed`（异常，附带修复建议）、`not-configured`（未配置，例如未设置可选能力）或 `not-checked`（跳过，例如未发真实网络请求）。

| 退出码 | 含义 |
|---|---|
| `0` | 无 `failed` 检查项 |
| `1` | 存在至少一项 `failed` 检查项 |
| `2` | 命令行参数无效 |

## 二、脚本与 CI 模式（`omdsh exec --json`）

`omdsh exec --json` 在**不打开 TUI、不改变终端模式**的前提下执行单次提示，并把每一步事件以逐行 JSON（NDJSON）写到 `stdout`（诊断日志写到 `stderr`），非常适合 CI 自动化、批处理和二次封装。

> 提示：`exec` 与 TUI 共用本地凭据库和已登录的 DeepSeek 账户授权，但不会打开浏览器登录页；如需在 `exec` 中使用账户模型，先在交互式 `omdsh` 中跑一次 `/login`。

### 常用调用与 `jq` 实用示例

```sh
# 1. 直接传提示，保存完整事件流
omdsh exec --json "概括当前仓库的目录结构与测试命令" > run.ndjson

# 2. 用 jq 只提取最终回复文本（失败时查看错误码）
omdsh exec --json "检查 src/auth 是否有未处理的异常" \
  | jq -r 'select(.type == "run.finished") | if .data.error then "ERROR(\(.data.error.code)): \(.data.error.message)" else .data.text end'

# 3. 从标准输入读取长提示（上限 8 MiB），或续跑已有会话
cat spec.md | omdsh exec --json - > run.ndjson
omdsh exec --json --resume <session-id> "继续完成剩余单元测试" > run.ndjson
```

提示中的斜杠命令和 `!command` 在 `exec` 中按普通提示文本处理；使用 `--` 结束选项解析（方便传递以 `-` 开头的提示）。恢复旧版本格式需要迁移的会话时，请先在交互模式中 `/resume` 完成一次迁移。

### NDJSON 输出示例

每条 JSON 均含 `schemaVersion: 1`、递增的 `sequence`、`type` 与 `data`（消费端应忽略未识别的事件类型），最终以 `run.finished` 结尾：

```json
{"schemaVersion":1,"sequence":1,"type":"run.started","data":{"model":"deepseek-flash"}}
{"schemaVersion":1,"sequence":2,"type":"session.created","data":{"sessionId":"s_abc123","root":"/path/to/repo"}}
{"schemaVersion":1,"sequence":3,"type":"assistant.message","data":{"text":"仓库包含两个包..."}}
{"schemaVersion":1,"sequence":4,"type":"run.finished","data":{"outcome":"completed","exitCode":0,"sessionId":"s_abc123","text":"仓库包含两个包..."}}
```

- `data.text` 是本次执行根助手提交的最新一条回复；`data.sessionTotals` 汇总整个根会话的累计用量（恢复会话时含历史回合，不含子会话账单）；
- 若无人值守执行遇到需要审批或提问的步骤，会输出 `input.required` 并以退出码 `3` 安全中止（**绝不自动放行或编造回答**），你可以随后用 `omdsh --resume <session-id>` 在交互终端里继续。

### `exec` 退出码与常见错误码

| 退出码 | 含义 |
|---|---|
| `0` | 执行完成 |
| `1` | 启动、执行、输出或关闭失败（含达到 Token 上限） |
| `2` | 参数或输入无效（例如超 8 MiB 或漏写 `--json`） |
| `3` | 需要人工审批或回答问题（`REQUIRES_INPUT`） |
| `130` / `143` | 被 `SIGINT` / `SIGTERM` 中断 |

`run.finished` 中常见的 `data.error.code`：

- `CONTENT_REFUSED`：模型服务端因内容安全策略拒绝本次请求；
- `REQUIRES_INPUT`：需要人工审批或提问（对应退出码 `3`）；
- `MAX_TOKENS`：输出触及上限未完整结束；
- `CANCELLED`：执行被信号取消；
- `INVALID_INPUT` / `BOOT_FAILED` / `RUN_FAILED` / `RUNTIME_FAILED`：输入无效、启动失败或运行异常；
- `SHUTDOWN_TIMEOUT`：退出清理超过 5 秒宽限强制结束。

## 三、插件 CLI、Shell 补全与管道模式

- **插件管理**：`omdsh plugin add|update|remove|list` 管理用户插件包，详见[插件与内置集成](plugins.md)。
- **Shell 补全**（纯本地生成，不启动 TUI 也不联网）：

```sh
eval "$(omdsh completions zsh)"   # 也支持 bash 和 fish
```

- **普通管道模式**：当直接运行 `omdsh` 且 `stdin`/`stdout` 不是 TTY 时，自动退化为按行输入与纯追加文本输出；做自动化集成时推荐优先使用 `omdsh exec --json`。

## 四、环境变量一览

| 环境变量 | 作用 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（环境变量优先，不被 `/login` 或 `/logout` 覆盖）。 |
| `DEEPSEEK_BASE_URL` | 自定义 DeepSeek 兼容端点地址。 |
| `OMDSH_MODEL`、`OMDSH_PROVIDER` | 默认模型与服务商覆盖（优先级低于 `--model` / `--provider`）。 |
| `OMDSH_HOME`（回退 `DSH_HOME` → `~/.dsh`） | 会话、设置、凭据、Skills、MCP/LSP 配置与插件的根目录。 |
| `OMDSH_PERMISSION_MODE` | 初始权限模式：`read-only`、`workspace-write`（默认）或 `danger-full-access`。 |
| `OMDSH_IMAGE_PROTOCOL` | 覆盖终端内联图片协议探测：`kitty`、`iterm2` 或 `none`。 |
| `VISUAL`、`EDITOR` | 外部编辑器自动探测时的默认候选（`Ctrl+X` 与文件预览 `E`）。 |
| `NO_COLOR`、`FORCE_COLOR=0`、`COLORTERM` | 关闭终端颜色或强制开启真彩色（`COLORTERM=truecolor`）。 |
| `DSH_TELEMETRY_DISABLED` | 禁用底层遥测上报。 |
| `OMDSH_ACP_COMMAND`、`OMDSH_ACP_ARGS` | 自定义 `subagent_isolated` 使用的 `dsh` 隔离进程命令与参数。 |

## 相关

- [故障排查](troubleshooting.md) —— `omdsh doctor` 与常见报错处理
- [会话与恢复](sessions.md) —— `--resume` 与本地数据路径
- [权限与安全](permissions.md) —— `OMDSH_PERMISSION_MODE` 对应的权限模式
