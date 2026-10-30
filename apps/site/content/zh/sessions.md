---
description: "omdsh 把持久会话与本地数据存在哪里、Session Library 如何搜索、置顶与归档会话，以及旧会话日志如何继续可用。"
---

# 会话与历史

## 持久会话

每个会话都是一份持久 JSONL 日志，存放在 `$OMDSH_HOME/sessions`，回退到 `$DSH_HOME`，再到 `~/.dsh`。日志是回放、projection 与搜索的事实来源。

- `omdsh --resume <session-id>` 可以从 shell 重新打开会话；第二次按 `Ctrl+C` 时，如果会话可恢复，omdsh 会打印带 id 的这条命令。
- `/resume` 打开会话库，显示消息预览、时间、事件数与完成状态；`/resume <session-id>` 直接跳过选择器，`/resume <查询>` 搜索持久消息正文并恢复选中的结果。在会话库内按 `Alt+S` 搜索，搜索结果支持重命名、标记与归档，`Alt+L` 返回全部会话。
- `/new` 新建干净会话，而不是从当前会话分叉。
- `/retry` 把最近一条人类提示作为新回合再次提交。
- 连按两次 `Esc` 打开 Session Tree，浏览当前对话的回合与分支。选中节点只预览内容；在 Turn 上按 Enter 会从该消息之前创建分支并恢复提示，在分支节点上按 Enter 或使用 `Alt+Enter` 则从该分支的最新状态继续。

走查见[恢复并管理长会话](tutorials/long-session.md)。

清空 transcript、恢复或切换会话，以及通过回退分叉会话时，终端原生 scrollback 会继续保留，并用带标签的分界线标记这次替换。普通启动、更换 preset、刷新工具列表，以及进入或退出子 agent 检视时，不显示这条分界线。`/new` 只有在上一份 transcript 中存在通知和工具列表以外的内容时才显示分界线。

## Session Tree

Session Tree 把分支挂在继承历史的真实分叉点，标记当前分支，共享回合只显示一次。它包含同一工作区内相关的对话分支；子代理会话不进入树，从 composer 上方的名册进入。

使用 `↑`/`↓` 或 `Tab` 选择，`←`/`→` 折叠或展开子树，输入文字进行搜索，匹配节点的祖先会保留。宽终端在树旁显示选中消息与最终回复的预览，窄终端把预览放在树下方；`Ctrl+↑`/`Ctrl+↓` 滚动预览。`Esc` 先清除搜索，再关闭树；取消后保留 composer 和当前会话。

底部显示 Enter 的具体动作：**edit from here** 创建新分支并恢复原始文本、图片与文件引用，不自动向模型发送请求；**continue branch** 恢复选中分支的最新状态，也可以在搜索后使用 `Alt+Enter`。原有分支与终端 scrollback 继续保留。这些操作改变的是对话历史，不会回滚工作区文件。

按 `Alt+L` 为 Turn 或分支添加标记、编辑已有标记；`Alt+U` 清除标记。标记可搜索，最多 120 个字符。`Alt+B` 在完整树与已标记节点之间切换，筛选时保留祖先路径，没有标记时也可以切回完整树。标记和筛选保留当前会话与 composer 草稿；标记仅保存在本地，不进入模型上下文。

### 恢复 Turn 文件

在新 Turn 开始前，通过 `/settings` → Tools 打开 **File recovery snapshots**。它默认关闭，因为会保存私有文件内容并增加捕获开销。在 Session Tree 选择 Turn 后按 `Alt+R`，选择文件，检查前后内容，再确认 **Restore selected files**；初始选中 Cancel。设置修改从下一个 Turn 生效；关闭开关时，已经开始的捕获仍会完成。较早 Turn 没有完整快照时，不能从 diff 摘要恢复文件。

恢复保留消息、当前分支、工作目录和 Git 暂存区。它恢复普通文件的原始字节与模式位，重新创建已删除文件，并移除新建文件。每个文件都会重新与保留的 Turn 结束版本比较；后续用户或其他进程的修改作为冲突保留。快照覆盖一个时间窗口，可能包含其他进程的改动，不会自动归因给模型。Turn 内切换工作目录会让该检查点不可用。离开目录后仍可恢复其保存的文件，但受当前 Access 约束；Read only 阻止恢复，即使在 Full access 下，恢复进程也保持受限。下一个模型步骤会收到重新读取相关文件的提示。

在恢复文件选择页按 `Alt+H` 可查看保存的报告；没有可恢复文件时，阅读页也会包含较早的报告。报告区分 restored、already-restored、conflict、failed、cancelled 和 uncertain。取消可能留下部分恢复。被替换的条目保存在 `.omdsh-recovery-<operation-id>.backup` 保留路径中；中断报告中 planned 操作的完成情况未经确认，不会自动重试。备份保留原 inode，持有旧文件描述符的写入方不会丢失数据。恢复逐文件执行，不承诺所有文件一起成功的事务。

Git 捕获覆盖当前目录的已跟踪和未被忽略的未跟踪文件；原有忽略路径、submodule、嵌套仓库与 Git 元数据被排除或保护。非 Git 目录不会沿链接递归。私有快照与报告保存在 `omdsh/file-recovery/`，恢复会话后仍可读取。不会自动清理；删除该目录会移除恢复数据，但不会删除消息或工作区备份。空目录、所有权、ACL 与扩展属性不属于内容恢复契约。硬链接、特殊文件或权限位、Windows reparse point、含义不明确的路径、不稳定的扫描、超过 10,000 个条目、文件超过 128 MiB 或快照超过 1 GiB，都会让捕获不可用，而不是生成不完整检查点。

## Session Library

`/resume` 打开 Session Library：`p` 置顶或取消置顶，`r` 编辑会话标题，`Alt+A` 归档选中会话。`Alt+V` 切换到归档列表，在那里按 `Alt+A` 恢复选中会话。列表为空或正在搜索时也能切换视图；单字母操作需要先清空搜索。归档会话从默认列表和最近会话快捷入口中隐藏，日志与附件仍然保留。你仍可以按 ID 直接恢复，或用 `/resume <查询>` 搜索；继续归档会话不会自动将它移回默认列表。

置顶、归档状态与树节点标记保存在 `$OMDSH_HOME/omdsh/session-library.json`；会话标题仍写入 Harness 会话日志。这些路径依次回退到 `$DSH_HOME` 和 `~/.dsh`。

`/resume <查询>` 则改为搜索持久会话内容，通过 session-query 索引——SQLite FTS5，在每次运行首次搜索时于内存中构建——并恢复选中的结果。搜索覆盖完整会话日志，因此被压缩或折叠历史中的匹配同样会被计入。

## 未发送草稿

交互式 composer 按会话保存未发送的输入：短暂停止编辑后自动保存，切换会话或退出时立即写入。恢复会话会还原草稿和光标位置，包括折叠粘贴的原文、图片字节和文件附件引用。父会话与正在查看的子 Agent 会话各自保留草稿。

发送消息或明确清空 composer 会移除已保存的草稿。浏览输入历史时仍保留原来的未发送草稿，直到你修改或选用历史文本。问答回复、秘密输入和已排队消息不作为 composer 草稿保存。草稿存放在 Harness 日志之外的本地文件中，不包含在会话导出中；管道模式不保存草稿。

## 磁盘上的日志

会话文件可能经过压缩并带有完整性校验，请不要手工修改。启动和浏览 Session Library 不会迁移历史日志。列表用 `migration required` 标记它们，有缓存时显示旧标题，否则显示会话 ID。交互式 `/resume`、从列表或搜索结果选中旧会话时，会先询问是否迁移；接受后发布一个带版本名的后继文件（`session.v4.jsonl[.zstd]`），前驱文件保持不变，取消则不打开该会话。`omdsh --resume <session-id>` 和行输入模式的 `/resume <session-id>` 明确激活并迁移指定会话，不增加交互确认。重命名等其他明确写入操作也可能迁移所选日志。

最初使用 v0.5.0 至 v0.11.0 创建的会话可能包含私有的 `omdsh/tools-selected` 事件：当前 omdsh 可以识别并恢复它们，但未经扩展的 DSH 持久化读取器会拒绝该日志。v0.12.0 及更高版本创建的会话不再写入该事件，因此新建会话可被原版 DSH 持久化读取。

## 本地文件

以下内容都位于同一个 home（`$OMDSH_HOME`，否则 `$DSH_HOME`，再否则 `~/.dsh`）：

| 路径 | 内容 |
|---|---|
| `sessions/` | 持久会话日志。 |
| `omdsh/file-recovery/` | 私有 Turn 文件快照、带校验的清单与恢复报告。 |
| `omdsh/drafts/` | 未发送的 composer 草稿及其图片字节，按会话 ID 的哈希分组。 |
| `omdsh/history.jsonl` | `Ctrl+R` 使用的输入历史。 |
| `omdsh/keybindings.json` | 应用级键位覆盖。 |
| `omdsh/model-favorites.json` | `Ctrl+P` 与 `Alt+P` 使用的收藏模型循环。 |
| `omdsh/session-library.json` | 会话置顶、归档状态与本地树节点标记。 |
| `omdsh/recent-sessions.json` | 跨启动复用的会话库标签；删除后重新读取当前格式日志，历史日志仍只按 header 展示。 |
| `sessions-query.sqlite` | 会话内容搜索使用的派生全文索引；删除后会在下次搜索时重建。 |
| `profiles/omdsh/` | 由 `omdsh plugin` 管理的用户插件 Profile，其中包括持久化设置的 `cordis.patch.yml`。 |

在 `/settings` 中修改的设置会持久化到该 Profile 补丁，而不是单独的设置文件。

## 可携带归档

`/export archive [path]` 创建 ZIP，包含逻辑 header/event JSONL、后代子 Agent 会话，以及经过校验的原始图片和文件附件。`manifest.json` 把不透明的会话与附件 ID 映射到安全的归档路径。导出使用公开 persistence read handles，无需手动复制压缩或迁移后的日志。

归档的未压缩内容上限为 64 MiB；目标已存在时拒绝写入，写入失败或取消时删除本次的残缺文件。日志与原始附件不脱敏。运行中的会话分别取样，不是跨会话的原子快照。ZIP 用于备份和检查，不提供自动会话导入；Markdown 和 HTML 仍是转录格式。

## 相关

- [命令](commands.md) —— `/resume`、`/retry`、`/new` 与 `/export`
- [恢复并管理长会话](tutorials/long-session.md) —— 恢复、回退、压缩与导出
- [用户插件](plugins.md) —— Profile 目录与 `omdsh plugin`

文件恢复快照与报告仅保存在 Profile 所在环境，不包含在可移植归档中。
