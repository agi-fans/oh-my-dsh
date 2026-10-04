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
- 连按两次 `Esc` 或运行 `/tree` 打开 Session Tree，浏览当前对话的回合与分支。选中节点只预览内容；在 Turn 上按 Enter 会从该消息之前创建分支并恢复提示，在分支节点上按 Enter 或使用 `Alt+Enter` 则从该分支的最新状态继续。

走查见[恢复并管理长会话](tutorials/long-session.md)。

清空 transcript、恢复或切换会话，以及通过回退分叉会话时，终端原生 scrollback 会继续保留，并用带标签的分界线标记这次替换。普通启动、更换 preset、刷新工具列表，以及进入或退出子 agent 检视时，不显示这条分界线。`/new` 只有在上一份 transcript 中存在通知和工具列表以外的内容时才显示分界线。

## Session Tree

Session Tree 把分支挂在继承历史的真实分叉点，标记当前分支，共享回合只显示一次。它包含同一工作区内相关的对话分支；子代理会话仍在 Agent Hub 中管理。

使用 `↑`/`↓` 或 `Tab` 选择，`←`/`→` 折叠或展开子树，输入文字进行搜索，匹配节点的祖先会保留。宽终端在树旁显示选中消息与最终回复的预览，窄终端把预览放在树下方；`Ctrl+↑`/`Ctrl+↓` 滚动预览。`Esc` 先清除搜索，再关闭树；取消后保留 composer 和当前会话。

底部显示 Enter 的具体动作：**edit from here** 创建新分支并恢复原始文本、图片与文件引用，不自动向模型发送请求；**continue branch** 恢复选中分支的最新状态，也可以在搜索后使用 `Alt+Enter`。原有分支与终端 scrollback 继续保留。这些操作改变的是对话历史，不会回滚工作区文件。

## Session Library

`/sessions` 打开 Session Library，即带置顶与重命名操作的恢复列表：按 `p` 置顶会话，按 `r` 重命名。置顶与名称保存在 `$OMDSH_HOME/omdsh/session-library.json`。

`/sessions <查询>` 则改为搜索持久会话内容，通过 session-query 索引——SQLite FTS5，在每次运行首次搜索时于内存中构建——并恢复选中的结果。搜索覆盖完整会话日志，因此被压缩或折叠历史中的匹配同样会被计入。

## 磁盘上的日志

会话文件可能经过压缩并带有完整性校验，请不要手工修改；请继续使用 omdsh 打开这些旧会话。旧版本写入的日志会在该会话被写入时迁移，并在升级后的首次启动由后台任务按会话格式迁移一次，发布一个带版本名的后继文件（`session.v4.jsonl[.zstd]`），前驱文件保持不变。启动时会有一条提示，说明本次迁移了多少个会话。

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
| `omdsh/recent-sessions.json` | 跨启动复用的会话库标签；删除后下次启动会重新读取每个存储日志。 |
| `omdsh/sessions-upgraded.json` | 记录已存日志已迁移到的会话格式。 |
| `sessions-query.sqlite` | 会话内容搜索使用的派生全文索引；删除后会在下次搜索时重建。 |
| `profiles/omdsh/` | 由 `omdsh plugin` 管理的用户插件 Profile，其中包括持久化设置的 `cordis.patch.yml`。 |

在 `/settings` 中修改的设置会持久化到该 Profile 补丁，而不是单独的设置文件。

## 可携带归档

`/export archive [path]` 创建 ZIP，包含逻辑 header/event JSONL、后代子 Agent 会话，以及经过校验的原始图片和文件附件。`manifest.json` 把不透明的会话与附件 ID 映射到安全的归档路径。导出使用公开 persistence read handles，无需手动复制压缩或迁移后的日志。

归档的未压缩内容上限为 64 MiB；目标已存在时拒绝写入，写入失败或取消时删除本次的残缺文件。日志与原始附件不脱敏。运行中的会话分别取样，不是跨会话的原子快照。ZIP 用于备份和检查，不提供自动会话导入；Markdown 和 HTML 仍是转录格式。

## 相关

- [命令](commands.md) —— `/sessions`、`/resume`、`/retry`、`/new` 与 `/export`
- [恢复并管理长会话](tutorials/long-session.md) —— 恢复、回退、压缩与导出
- [用户插件](plugins.md) —— Profile 目录与 `omdsh plugin`
