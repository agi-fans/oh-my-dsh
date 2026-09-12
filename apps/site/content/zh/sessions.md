---
description: "omdsh 把持久会话与本地数据存在哪里、Session Library 如何搜索与置顶会话，以及旧会话日志如何继续可用。"
---

# 会话与历史

## 持久会话

每个会话都是一份持久 JSONL 日志，存放在 `$OMDSH_HOME/sessions`，回退到 `$DSH_HOME`，再到 `~/.dsh`。日志是回放、projection 与搜索的事实来源。

- `omdsh --resume <session-id>` 可以从 shell 重新打开会话；第二次按 `Ctrl+C` 时，如果会话可恢复，omdsh 会打印带 id 的这条命令。
- `/resume` 打开可搜索的选择器，显示最近一条人类消息的预览、时间、事件数与完成状态；`/resume <session-id>` 直接跳过选择器。
- `/new` 新建干净会话，而不是从当前会话分叉。
- `/retry` 把最近一条人类提示作为新回合再次提交。
- `Esc` 两次打开对话回合选择器：选中某个用户回合会从该消息之前的历史分叉出新会话，并把原始提示恢复到 composer。原会话仍可通过 `/resume` 打开，因此回退是可恢复的，不是破坏性的。

走查见[恢复并管理长会话](tutorials/long-session.md)。

## Session Library

`/sessions` 打开 Session Library，即带置顶与重命名操作的恢复列表：按 `p` 置顶会话，按 `r` 重命名。置顶与名称保存在 `$OMDSH_HOME/omdsh/session-library.json`。

`/sessions <查询>` 则改为搜索持久会话内容，通过 session-query 索引——SQLite FTS5，在每次运行首次搜索时于内存中构建——并恢复选中的结果。搜索覆盖完整会话日志，因此被压缩或折叠历史中的匹配同样会被计入。

## 磁盘上的日志

会话文件可能经过压缩并带有完整性校验，请不要手工修改；在提供显式迁移工具前，请继续使用 omdsh 打开这些旧会话。读取旧日志时会通过已发布的 v0→v3 迁移链迁移，并发布一个带版本名的后继文件（`session.v3.jsonl[.zstd]`），前驱文件保持不变。

最初使用 v0.5.0 至 v0.11.0 创建的会话可能包含私有的 `omdsh/tools-selected` 事件：当前 omdsh 可以识别并恢复它们，但未经扩展的 DSH 持久化读取器会拒绝该日志。v0.12.0 及更高版本创建的会话不再写入该事件，因此新建会话可被原版 DSH 持久化读取。

## 本地文件

以下内容都位于同一个 home（`$OMDSH_HOME`，否则 `$DSH_HOME`，再否则 `~/.dsh`）：

| 路径 | 内容 |
|---|---|
| `sessions/` | 持久会话日志。 |
| `omdsh/history.jsonl` | `Ctrl+R` 使用的输入历史。 |
| `omdsh/keybindings.json` | 应用级键位覆盖。 |
| `omdsh/model-favorites.json` | `Ctrl+P` 与 `Alt+P` 使用的收藏模型循环。 |
| `omdsh/session-library.json` | 会话置顶与重命名。 |
| `profiles/omdsh/` | 由 `omdsh plugin` 管理的用户插件 Profile。 |

在 `/settings` 中修改的设置会持久化到 Harness 设置文件；模型设置也可以来自 `$DSH_HOME/settings.yaml`。

## 相关

- [命令](commands.md) —— `/sessions`、`/resume`、`/retry`、`/new` 与 `/export`
- [恢复并管理长会话](tutorials/long-session.md) —— 恢复、回退、压缩与导出
- [用户插件](plugins.md) —— Profile 目录与 `omdsh plugin`
