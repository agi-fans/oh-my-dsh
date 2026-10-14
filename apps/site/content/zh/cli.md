---
description: "omdsh 命令行：JSON 脚本执行、诊断、flags、插件、补全与环境变量。"
---

# 命令行

`omdsh` 二进制默认启动 TUI。子命令处理脚本执行、诊断、插件管理与补全；`--dump-config` 打印组合树。

## 用法

```text
omdsh [options] [prompt...]
omdsh plugin add <package>
omdsh plugin remove <package>
omdsh plugin <pnpm-args...>
omdsh completions bash|zsh|fish
omdsh doctor [--json]
omdsh exec --json [--resume <id>] [prompt...]
```

位置参数形式的提示会启动 omdsh 并把拼接后的内容作为第一条消息提交。默认 TUI 入口的 `--resume` 不能与提示组合，`--dump-config` 不能与两者中的任何一个组合。

## 选项

| 选项 | 作用 |
|---|---|
| `--model <route>` | 本次进程使用的模型路由；写入 `OMDSH_MODEL`。默认 `deepseek-flash`。 |
| `--provider <route>` | 本次进程使用的 provider 路由；写入 `OMDSH_PROVIDER`。默认 `deepseek-official`。 |
| `-r, --resume <session-id>` | 重新打开一个持久会话。 |
| `--dump-config` | 打印组合后的插件树并退出。 |
| `-h, --help` | 显示内置帮助。 |
| `--version` | 打印已安装版本。 |

命令行 flag 优先于所有分层环境来源。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DEEPSEEK_API_KEY` | 用于实时回合的 DeepSeek API Key；也可以改用 `/login` 保存一个校验过的 key。 |
| `OMDSH_MODEL`、`OMDSH_PROVIDER` | 默认路由覆盖；`--model` 与 `--provider` 的优先级更高。 |
| `OMDSH_HOME` | 会话、设置、凭据、MCP 与 LSP 配置、插件和 Skills 的 home；回退到 `DSH_HOME`，再到 `~/.dsh`。 |
| `OMDSH_PERMISSION_MODE` | 初始 Access preset：`read-only`、`workspace-write`（默认）或 `danger-full-access`；之后可按会话用 `/permission` 修改。 |
| `NO_COLOR`、`FORCE_COLOR=0` | 在没有显式颜色偏好时关闭彩色输出。见[故障排查](troubleshooting.md)。 |

`/model` 会把模型偏好写入 Profile 补丁 `profiles/omdsh/cordis.patch.yml`；更早版本留下的 `settings.yaml` 会在启动时导入一次，并重命名为 `settings.yaml.imported`。

## Plugin 与 completions

`omdsh plugin add <package>` 把 bundle 安装到用户 Profile，`omdsh plugin remove <package>` 删除一个，其余参数会转发给 Profile 目录中的 `pnpm`。见[用户插件](plugins.md)。

`omdsh completions bash|zsh|fish` 打印 omdsh 命令行的补全脚本，不启动 TUI，也不发起网络请求。在 shell 配置中加载：

```sh
eval "$(omdsh completions zsh)"
```

## 脚本执行

`omdsh exec --json` 使用现有 Profile、模型路由、工具和 Access 策略执行一条提示。它使用独立的机器输出消费端，不打开 TUI、不改变终端模式，也不把提示中的斜杠命令或 `!command` 当作交互命令执行。

```sh
omdsh exec --json "Explain this repository" > result.ndjson
cat task.txt | omdsh exec --json - > result.ndjson
omdsh exec --json --resume session-id "Continue the task" > result.ndjson
```

省略提示时，同样读取 stdin 直到 EOF，并将其作为一条 UTF-8 消息，大小限制为 8 MiB。位置参数不会读取 stdin，除非唯一参数为 `-`。`--model` 与 `--provider` 选择当前模型路由；`--` 结束选项解析。Exec 必须带 `--json`。恢复会话时保留历史和权限，使用当前模型选择，只输出本次新增内容，不重放旧回复。需要格式迁移的会话须先在交互模式中恢复。

Stdout 使用逐行 JSON；诊断及普通插件日志写入 stderr。每条记录包含 `schemaVersion: 1`、递增的 `sequence`、`type` 和 `data`。消费端应忽略不认识的事件类型。事件包括 `run.started`、`session.created` 或 `session.resumed`、`assistant.stream`、`assistant.message`、`turn.started`/`turn.finished`、`step.started`/`step.finished`、`tool.started`/`tool.finished`、`tool.ptc_result`、委派状态与审批审计。会话记录携带 `sessionId` 和 `root`；持久事件另带 `eventSequence` 和 `time`。流式帧保留 Harness 的尝试标识和索引。工具负载保留 Harness 调用标识和规范结果；结果消息通过 `message.toolCallId` 配对。不导出请求头或 Profile 配置。

最后一条记录为 `run.finished`。它的 data 包含 `outcome`、`exitCode`、`text`，以及可选的 `sessionId`、`sessionTotals`；出现问题时，另带含 `code` 与 `message` 的 `error`。`text` 是本次执行新增的根 Agent 最近一条已提交助手正文；失败或取消时可能保留部分输出。`sessionTotals` 来自 Harness projection，覆盖整个根会话，恢复后也包含历史回合；它不是所有子会话的总账单。正常完成会等待托管子 Agent、父会话后续回复及持久化 flush，再释放资源并写入最终结果。

| 退出码 | 含义 |
|---|---|
| `0` | 已完成。 |
| `1` | 执行、启动、清理或输出失败；达到 token 上限视为未完成。 |
| `2` | 参数或输入无效。 |
| `3` | 问题或审批需要人工输入。 |
| `130` | 被 SIGINT 中断。 |
| `143` | 被 SIGTERM 中断。 |

遇到问题或审批时，会输出 `input.required`，取消无人值守执行，并按拒绝优先的边界处理。Exec 不编造答案、不授予权限，也不扩大 Access；请在交互模式恢复会话后继续作出人工决定。第二次终止信号会强制退出。清理沿用交互式应用的五秒宽限；超时会报告 `SHUTDOWN_TIMEOUT`，写入失败结果后强制退出。中断后若输出在宽限内无法写完，会关闭通道，不声称最终记录已送达。命令语法无效时，协议尚未启动，使用说明写入 stderr；管道断开或强制终止可能使最终记录无法送达。写入遵守背压，待写协议输出限制为 32 MiB。

## 管道模式

当 stdin 或 stdout 不是 TTY——管道输入、CI——omdsh 会退化为按行输入与纯追加式输出。会话、命令与退出行为保持相同语义，只是不再占用交互式屏幕。

## 相关

- [会话与历史](sessions.md) —— `--resume` 与持久会话存储
- [权限与 Access](permissions.md) —— `OMDSH_PERMISSION_MODE` 背后的 Access preset
- [故障排查](troubleshooting.md) —— 颜色环境变量与启动失败
