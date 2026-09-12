---
description: "omdsh 命令行：flags、plugin 与 completions 子命令、环境变量、一次性提示，以及管道友好的行为。"
---

# 命令行

`omdsh` 二进制启动 TUI。shell 需要的其他事情——插件管理、补全、组合树导出——都是子命令或 flag。

## 用法

```text
omdsh [options] [prompt...]
omdsh plugin add <package>
omdsh plugin remove <package>
omdsh plugin <pnpm-args...>
omdsh completions bash|zsh|fish
```

位置参数形式的提示会启动 omdsh 并把拼接后的内容作为第一条消息提交。`--resume` 不能与提示组合，`--dump-config` 不能与两者中的任何一个组合。

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

模型设置也可以来自 `$DSH_HOME/settings.yaml`；`/model` 会以交互方式写入同一份偏好。

## Plugin 与 completions

`omdsh plugin add <package>` 把 bundle 安装到用户 Profile，`omdsh plugin remove <package>` 删除一个，其余参数会转发给 Profile 目录中的 `pnpm`。见[用户插件](plugins.md)。

`omdsh completions bash|zsh|fish` 打印 omdsh 命令行的补全脚本，不启动 TUI，也不发起网络请求。在 shell 配置中加载：

```sh
eval "$(omdsh completions zsh)"
```

## 管道模式

当 stdin 或 stdout 不是 TTY——管道输入、CI——omdsh 会退化为按行输入与纯追加式输出。会话、命令与退出行为保持相同语义，只是不再占用交互式屏幕。

## 相关

- [会话与历史](sessions.md) —— `--resume` 与持久会话存储
- [权限与 Access](permissions.md) —— `OMDSH_PERMISSION_MODE` 背后的 Access preset
- [故障排查](troubleshooting.md) —— 颜色环境变量与启动失败
