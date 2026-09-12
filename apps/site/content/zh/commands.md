---
description: omdsh 斜杠命令完整参考：会话、会话配置、回合控制、可观测性、剪贴板与输出，以及 Skill 命令与参数说明。
---

# 命令

在 composer 中输入 `/` 即可浏览实时命令目录并查看参数提示；输入 `/help` 可以查看命令列表与常用快捷键（`/help full` 会补全完整键盘目录）。命令目录由当前挂载的插件组成，因此 Skills 与用户插件包贡献的命令会和内置命令一起出现。`/help` 会把 TUI 自身处理的命令列为 terminal commands，把 Harness 组合提供的命令列为 agent commands。

`[方括号]` 表示可选参数，`|` 表示多选一。带选择器的命令不需要参数。

## 会话

| 命令 | 作用 |
|---|---|
| `/new` | 新建会话。 |
| `/sessions [query]` | 不带参数时打开 Session Library；带查询时通过全文索引搜索持久会话内容并恢复选中的结果。在库中按 `p` 置顶、按 `r` 重命名。 |
| `/resume [session-id]` | 恢复一个持久会话；不带 id 时从最近会话列表中选择。 |
| `/session` | 显示当前会话的详细信息。 |
| `/retry` | 重新执行最近一条人类提示。 |
| `/todo` | 把当前会话的 todo 列表打印到转录中。 |
| `/clear` | 清空可见转录。正在运行的回合、状态、todos 和排队消息保持原状。 |

## 会话配置

| 命令 | 作用 |
|---|---|
| `/agent` | 选择 Agent preset：Standard、PTC、Minimal 或 Cordis。仅在空白会话可用；工具暴露由 preset 决定。 |
| `/workflow` | 选择 Default 或 Plan workflow。 |
| `/permission` | 选择会话 Access 级别：Read only、Workspace write 或 Full access。 |
| `/login` | 登录 provider：目录条目、API key，或自定义 provider（自带 id、base URL、协议与模型 id）。 |
| `/logout` | 移除由 omdsh 管理的 provider 选择。 |
| `/settings` | 打开设置浮层。别名：`/set`。 |

### `/model`

| 形式 | 效果 |
|---|---|
| `/model` | 打开 provider、模型与推理强度选择器。 |
| `/model <query>` | 解析 `provider/model` 或模糊模型名；精确匹配立即切换，歧义时打开选择器。 |
| `/model --session <query>` | 只切换当前会话，不写入保存的默认值；不能与子命令组合。 |
| `/model next` / `/model previous` | 切换到下一个或上一个收藏模型。 |
| `/model reasoning` | 循环切换当前模型的推理强度。 |
| `/model favorite` / `/model unfavorite` | 把当前模型加入或移出本地收藏列表，保存在 `$OMDSH_HOME/omdsh/model-favorites.json`。 |
| `/model favorites` | 列出收藏的模型。 |

## 回合控制

| 命令 | 作用 |
|---|---|
| `/steer <message>` | 在活动回合的下一个模型步骤前引导它。 |
| `/loop [count\|duration] [prompt]` | 在每个完成的回合后重复一条提示：count 或 duration 决定重复次数或持续时长；只给 count 时，下一条 composer 消息会成为被重复的提示。再次运行 `/loop` 关闭。见[引导运行中的任务](tutorials/guide-a-turn.md)。 |
| `/plan [off\|<message>]` | 进入 Plan 模式并可同时发送首个规划请求，`off` 直接退出。composer 中的图片会随规划请求一起发送。 |
| `/goal [<objective>\|clear\|edit <objective>\|pause\|resume]` | 为会话设置或查看长期目标。 |
| `/compact` | 压缩较早的对话历史。 |
| `/jobs [kill <id>]` | 列出后台任务，或按 id 停止一个。 |

## 可观测性

| 命令 | 作用 |
|---|---|
| `/context` | 在转录中打印基于 projection 的上下文用量分解，内容会保留在转录里。 |
| `/trajectory` | 打开事件账本：Turn 与 Step 分组、实时跟随、搜索、折叠、耗时、Token 用量与工具载荷。需要交互式终端。 |
| `/diff [path]` | 以按文件表格汇总工作区改动，或打印单个文件的 patch。只读 git 状态，不会暂存或提交。 |
| `/tools` | 列出 agent 可见的工具。 |
| `/mcp` | 显示已连接的 MCP 服务器及其工具。 |

## 剪贴板与输出

| 命令 | 作用 |
|---|---|
| `/copy [text\|code\|cmd]` | 复制最近的助手回复、最近的围栏代码块或最近的 bash 命令；不带参数时打开复制选择器。`command` 与 `cmd` 等价。 |
| `/export [html\|markdown] [path]` | 把完整转录导出为 Markdown 或独立 HTML。 |
| `/changelog [full]` | 显示最近的版本说明；`full` 显示打包的完整历史。 |

## Skills

每个可被用户调用的 Skill 都会以 `/skill:<name>` 出现，说明文字来自它的 `SKILL.md`。输入 `/skill:` 可以筛选列表，按 Enter 调用。较旧的 `/code-review` 形式仍被兼容接受，但不再展示。见 [Skills 与 MCP](skills-and-mcp.md)。

## 应用

| 命令 | 作用 |
|---|---|
| `/help [full]` | 显示命令与常用快捷键；`full` 补全完整键盘目录。别名：`/h`、`/?`。 |
| `/quit` | 退出应用。别名：`/q`、`/exit`。 |

## 相关

- [键盘与快捷键](keyboard.md) —— 编辑按键、浮层按键与 `keybindings.json`
- [设置](settings.md) —— `/settings` 背后的每一行
- [权限与 Access](permissions.md) —— `/permission` 背后的 preset
- [命令行](cli.md) —— `omdsh` 二进制、flags 与环境变量
- [教程](tutorials.md) —— 按任务组织的命令走查
- [Skills 与 MCP](skills-and-mcp.md) —— Skills 发现与 MCP 配置
