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
| `/tree` | 浏览当前对话的回合与分支，预览内容，从历史消息创建分支，或恢复已有分支。 |
| `/session` | 显示当前会话的详细信息。 |
| `/retry` | 重新执行最近一条人类提示。 |
| `/todo` | 把当前会话的 todo 列表打印到转录中。 |
| `/clear` | 清空可见转录，并留下一条接缝。正在运行的回合、状态、todos 和排队消息保持原状。 |

## 会话配置

| 命令 | 作用 |
|---|---|
| `/agent` | 选择 Agent preset：Standard、PTC、Minimal 或 Cordis。仅在空白会话可用；不可用的 preset 会显示失败原因。`/agent inspect [preset-id]` 查看声明及当前会话保留的 composition。`code`（PTC）preset 把注册表呈现为生成 SDK，并隐藏 `workflow_run`。 |
| `/workflow` | 选择 Default 或 Plan workflow。 |
| `/permission` | 选择会话 Access 级别：Read only、Workspace write 或 Full access。 |
| `/login` | 登录 provider：目录条目、API key，或自定义 provider（自带 id、base URL、协议与模型 id）。 |
| `/logout` | 移除由 omdsh 管理的 provider 选择。 |
| `/settings` | 打开外观、Agent、功能、状态栏和插件设置。别名：`/set`。 |
| `/plugins` | 查看 Profile 插件和 bundle，启用、停用、安装或移除。安装可在应用前取消。 |

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
| `/questions` | 回答限时等待后留下的问题，也可用于恢复的会话。 |
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
| `/diff [path\|turn [number]]` | 交互模式逐文件查看当前 Git 改动；`turn` 查看保留的回合快照，不带编号时取最近一次。非交互模式保留文字汇总；不会暂存或提交。 |
| `/tools` | 列出 agent 可见的工具。 |
| `/mcp` | 显示已连接的 MCP 服务器及其工具。 |
| `/feedback <text>` | 记录一条关于当前会话的私密备注。它追加一条模型永远看不到的 log-only 事件——不离开本机——并确认会话与匿名用户 id。 |

## 文件与终端

| 命令 | 作用 |
|---|---|
| `/files [path]` | 浏览目录或预览文件。在目录选择器按 `Shift+P` 查看本会话的交付物。 |
| `/attach [path]` | 流式保存文件，并把引用暂存到 composer；不带路径时询问路径，不会直接发送消息。 |
| `/attachments` | 预览或通过外部应用打开本会话用户消息中的原始文件和图片附件。 |
| `/terminal [terminal-id]` | 打开本会话的持久终端控制台，或使用会话 sandbox 新建 shell。 |

文件文档支持方向键、PgUp/PgDn 和 Home/End 滚动。`N`/`P` 切换文件，`V` 切换 diff/预览，`O` 打开原件；`E` 使用 Settings 中选定的编辑器。Esc 返回选择器。文本预览最多 128 KiB；二进制格式交给对应应用。外部编辑器临时接管真实终端，返回后 omdsh 恢复 raw input。

代码预览使用 Prism 语法高亮，颜色跟随所选终端主题。语言根据文件名识别，包括 `Dockerfile` 和 `Makefile`；Markdown 文件按文档渲染。跨行注释和字符串会保留各自的语法颜色。未知语言保持普通文本，关闭颜色后保留源码内容。

用 Tab 或左右方向键选择文档按钮，再按 Enter 执行；`›` 标出当前选项。字母快捷键大小写均可。`/files` 预览包含同目录文件，供 Previous／Next 切换；只有一个文件时隐藏这两个按钮。`F` 返回文件列表。Open 使用系统默认应用；Editor 使用 `/settings` 的 **General → Editor** 设置，默认自动探测已安装的编辑器。在编辑器中保存并关闭文件即可返回 omdsh。操作失败和外部打开的确认会留在预览页，文件导航不会发送需要关注的通知。

`/attach` 显示文件标记与字节数回执；删除标记即可移除草稿附件。补充消息后按 Enter 一起发送，也支持只发文件。排队消息和回退会保留文件引用。带文件的草稿把斜杠开头的文字作为模型消息，而不是执行命令。Ctrl+C 取消附件操作；取消后不会暂存草稿。

终端控制台显示最新 300 行保留输出，并在打开时刷新。Up/PageUp 停止跟随，End 恢复跟随新输出。`I` 发送一行输入，`C` 中断。Esc 只离开控制台，shell 继续运行；**Close terminal** 需要确认。正在处理输入的终端保持独占输入权。这是行输入控制台，不是供全屏程序使用的原始 PTY 附着。

## 剪贴板与输出

| 命令 | 作用 |
|---|---|
| `/copy [text\|code\|cmd]` | 复制最近的助手回复、最近的围栏代码块或最近的 bash 命令；不带参数时打开复制选择器。`command` 与 `cmd` 等价。 |
| `/export [html\|markdown\|archive] [path]` | 导出 Markdown/HTML 转录，或包含逻辑日志、子会话及原始附件的 ZIP。 |
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
