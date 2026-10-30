---
description: omdsh 键盘参考：composer 编辑、转录导航、会话生命周期、各浮层按键，以及 keybindings.json 自定义绑定。
---

# 键盘与快捷键

`/help` 会在命令列表旁打印实时快捷键目录，`/help full` 补全完整版本；目录显示的是当前实际生效的绑定。应用级绑定可以通过 `keybindings.json` 覆盖，编辑器本身保留一套固定的类 Vi 按键。

## 光标导航

| 快捷键 | 作用 |
|---|---|
| 方向键 | 移动光标；composer 为空时浏览输入历史。 |
| `Ctrl+A` / `Home` | 移到行首。 |
| `Ctrl+E` / `End` | 移到行尾。 |
| `Alt+B` / `Alt+Left` | 左移一个词。 |
| `Alt+F` / `Alt+Right` | 右移一个词。 |
| `Ctrl+]` 后接一个字符 | 向前跳到该字符。 |
| `Ctrl+Alt+]` 后接一个字符 | 向后跳到该字符。 |

## 编辑

| 快捷键 | 作用 |
|---|---|
| `Enter` | 发送消息。 |
| `Shift+Enter` / `Ctrl+J` | 插入换行。 |
| `Ctrl+W` / `Alt+Backspace` | 删除前一个词。 |
| `Alt+D` | 删除后一个词。 |
| `Ctrl+U` | 删除到行首。 |
| `Ctrl+K` | 删除到行尾。 |
| `Ctrl+Y` | 粘贴回已删除的文本。 |
| `Alt+Y` | 在删除环中循环。 |
| `Ctrl+-` | 撤销上一次编辑，或恢复刚清空的草稿。 |
| `Ctrl+D` | 向后删除；composer 为空时退出。 |
| `Ctrl+V` | 粘贴剪贴板文本或图片。 |
| `Alt+M` | 预览 composer 图片，不发送消息；没有草稿图片时，打开会话中最新的一张图片。 |
| `Alt+I` | 展开折叠的粘贴内容进行编辑。 |
| `Alt+Up` | composer 为空时，将最近一条排队消息取回 composer。 |
| `Alt+Q` | 打开消息队列，保留 composer 中的草稿。 |
| `Ctrl+S` | 暂存或恢复当前 composer 草稿；发送一条消息后会自动恢复暂存的草稿。 |
| `Alt+S` | 将文本纠正消息送到当前 Turn 的下一次模型步骤。 |
| `Alt+Enter` | 把当前草稿排到活动回合之后；`Enter` 仍然发送下一回合。 |
| `Alt+C` | 复制选中文字；没有选区时复制当前提示。 |
| `Ctrl+Alt+C` | 复制当前行。 |
| `Ctrl+X` / `Ctrl+G` | 在 Settings 选定的编辑器中编辑提示。 |

超过十行或 1,000 个字符的粘贴内容显示为 `[Pasted #1: 120 lines]` 或字符数标记。方向键和删除操作将每段内容视为一个整体；`Alt+I` 展开光标所在或附近的粘贴块进行编辑，`Ctrl+-` 可撤销插入、删除或展开。复制提示、使用外部编辑器和发送消息时均使用完整文本。临时问答和队列消息编辑保留原文。以折叠粘贴块开头的草稿会作为模型消息发送，即使原文以 `/` 开头。用 `Alt+Enter` 排队的草稿会在 composer 上方标记为 `Follow-up:`，`Alt+Up` 可把它取回编辑。

**Paste protection** 还会在终端未标记粘贴输入时识别大段文本、一次读取中的多行内容和快速 ASCII 按键流，避免其中的 Enter 提前提交消息。粘贴结束后稍等，再按 Enter 发送。普通输入和单次输入法提交立即显示。这属于启发式识别；如果影响你使用的终端，可在 Settings 中关闭。关闭后，明确标记的 bracketed paste 仍然不会触发误提交。

## 转录

回合运行时，思考显示为淡色斜体正文，回复使用普通 Markdown，工具结果以带内边距的预览显示，并跟随当前主题配色。工具卡片自带状态底色：进行中、成功和失败分别使用不同的背景色。命令行保持单一加粗颜色，输出带语法高亮。活动状态写在 composer 的上边框里（spinner 加 `Deep Driving`、`Retrying in 4s` 或 `Compacting 12s`），因此等待不占用转录行，右上角留给当前 Access Level。Shell 输出保留末尾五个视觉行；成功的文件读取只显示调用信息，不显示文件正文。已完成步骤保留到整个回合结束，随后过程折叠为 `Worked for 16s` 这样的耗时摘要，下方保留完整的最终答复，失败信息也保持可见。

当表格列在窄屏上难以阅读时，会改为带列名的逐条记录。完整且能够容纳的 Mermaid 图形用终端字符绘制；不支持、不完整或尺寸过大的图形保留为代码原文。[Settings](settings.md) 中的 **Mermaid in replies** 可以切换 Auto 和 Source。回复公式遵循 [Settings](settings.md) 中的 **Math in replies** 设置。

`Ctrl+O` 恢复已完成回合的过程视图。`Alt+O` 展开当前阅读回合的完整工具 Input 与 Output，包括 PTC 子调用；再按一次恢复预览，过程视图仍保持打开。运行中的回合也支持该操作，该回合后续新增的调用会沿用详情展示。在折叠回合上按 `Alt+O`，会同时展开过程与工具详情。按 `Ctrl+O`、`End` 或向下滚过末尾会关闭检视，并重置工具详情状态。展开详情不会改写终端原生历史。

详情展示 TUI 已收到的全部文本，无法恢复工具已经截断或溢出到文件的内容。`/trajectory` 提供事件级检查，`Ctrl+Shift+F` 会搜索预览之外的内容并显示命中位置；composer 为空时 `Ctrl+F` 等效，非空时仍用于移动光标。

浏览上方消息时，composer 区域上方会出现 `Jump to latest message · End` 浮层。用户消息滚出视口后，顶部会固定显示一行摘要，并随当前阅读的回合切换。这些内容只属于视口控件，不属于对话正文。

| 快捷键 | 作用 |
|---|---|
| `PgUp` / `PgDn` | 翻一页。 |
| `Shift+Up` / `Shift+Down` | 快速滚动。 |
| 鼠标滚轮 | 从实时底部或回合检视中滚动转录，无需先展开回合。 |
| `End` / 点击跳转浮层 | 回到最新消息并关闭回合详情。在实时底部，`End` 仍移动到 composer 当前行末尾。 |
| `Ctrl+O` | 将视口所在的已完成回合恢复为运行时的展示；再按一次回到折叠的实时底部。运行中的回合保持不变；在工具目录上则切换描述详略。 |
| `Alt+O` | 切换当前阅读回合的完整工具输入和结果，运行中的回合也可使用。 |
| `Alt+V` | 预览阅读位置所在工具声明的文件。该位置没有工具时会说明并指向 `/diff`，由它审查本回合的改动。 |
| `Ctrl+Shift+F` | 搜索当前转录；`n`/`N` 在匹配间跳转。composer 为空时 `Ctrl+F` 等效，非空时移动光标。 |
| `Ctrl+T` | 显示或折叠整个转录中的思考。 |

转录可以滚动或包含可操作文件时，折叠和展开视图都支持在当前视口内拖选文字。双击选择单词或路径，三击选择整行，Shift 点击扩展选区；默认松开鼠标后复制。可在 Settings 关闭 **Copy on select**，改用 `Alt+C`、`Enter` 或右键复制；`Esc` 清除选区，`Ctrl+C` 保留清空与中断行为。滚动、调整窗口、输入文字或所选行内容变化时会清除选区。

没有文本选区时，右键带文件位置声明的工具卡片可预览其文件，右键 Changed files 的文件行可直接预览该文件。阅读器复用 Open 和已配置的 Editor。工具的相对路径保留调用发生时的目录；Changed files 保留摘要所属目录。这些预览展示宿主文件的当前内容。`Alt+V` 打开的是阅读位置所在工具的同一批文件；已完成的回合摘要不会使隐藏的工具卡片变成点击目标。审查回合改动由 `/diff` 负责。Native 鼠标模式保留键盘入口。审批或其他用户提问会取消文件操作，避免争抢输入。

**Mouse interaction** 默认 `auto`，尊重 tmux 的 mouse off 设置；`tui` 显式启用应用接管，`native` 将鼠标交给终端，键盘滚动和 `End` 仍然可用。终端原生历史继续保留，可用终端选择或 tmux copy-mode 复制。

全屏页面暂时关闭应用鼠标接管。`/trajectory` 等浏览界面关闭后恢复原来的检视位置；命令返回转录文本时，会回到实时底部显示结果。

文件和 Diff 的源码阅读器用 `/` 或 `Ctrl+F` 搜索已加载文本，`Ctrl+N`／`Ctrl+P` 循环跳转匹配行，`G` 或 `Ctrl+G` 跳到文件行号。`[`／`]` 切换 Diff 变更块；提供相应按钮时，`L` 加载更多文本，`Q` 将 `@path:line` 插入 composer，`M` 切换 Markdown 渲染。Enter 应用搜索或行号输入，Esc 先取消输入，再返回文件列表。预览上限和视图行为见[文件命令](commands.md)。

源码阅读器默认将长行折行。`W` 切换折行；`Alt+Left`／`Alt+Right` 横向移动八个显示单元格，并切换为不折行模式。行号保持固定，阅读器操作之间保留折行状态和横向位置。普通左右方向键仍用于选择操作按钮；终端控制台沿用相同的阅读快捷键。

## 会话

| 快捷键 | 作用 |
|---|---|
| `Esc` | 取消或退出当前占据屏幕的东西：提示、浮层、搜索、子智能体检视。回合进行中先把排队的跟进消息交回 composer，再中断。没有草稿时连按两次打开 Session Tree。 |
| `Ctrl+C` 一次 | 清空 composer；composer 为空时中断活动回合。 |
| `Ctrl+C` 两次 | 退出；持久会话会打印 `omdsh --resume <session-id>` 提示。 |
| `Ctrl+Z` | 挂起到后台。 |
| `Alt+L` | 重置终端显示。 |
| `Ctrl+R` | 搜索输入历史。 |
| `Alt+R` | 重试最近一条人类提示。 |
| `Ctrl+L` | 选择模型和推理强度。 |
| `Ctrl+P` / `Ctrl+Shift+P` | 切换到下一个或上一个收藏模型；`Alt+P` 也可切换到上一个。 |
| `Shift+Tab` | 循环切换当前模型的推理强度。 |
| `Ctrl+T` | 显示或折叠思考。 |
| `/` | 打开斜杠命令补全。 |
| `@` / `./` / `~/` | 补全文件路径。 |
| `Tab` | 接受命令或路径补全。 |

## 浮层

| 浮层 | 按键 |
|---|---|
| 设置（`/settings`） | `↑`/`↓` 移动行，`←`/`→` 修改值，`Space` 修改值或显示／隐藏状态项，`Enter` 打开配置、修改值或开始移动状态项，`Tab`/`Shift+Tab` 切换分区，`Home`/`End` 跳到两端，`Esc`/`Ctrl+C` 关闭；`/` 或输入文字跨分类搜索，`Backspace`／`Ctrl+U` 编辑查询，`Ctrl+R` 恢复继承（状态项只恢复颜色）。搜索中 `Esc`／`Ctrl+C` 依次清空查询、返回浏览、关闭。 |
| 历史搜索（`Ctrl+R`） | 输入以筛选，`↑`/`↓`/`Tab`/`PgUp`/`PgDn`/`Home`/`End` 导航，`Enter` 选择，`Esc`/`Ctrl+C` 取消；查询输入支持行编辑按键。 |
| 转录搜索（`Ctrl+Shift+F`） | 输入查询，编辑中按 `Ctrl+N`/`Ctrl+P` 跳转，`Enter` 确认，`n`/`N` 在匹配间跳转，`/` 编辑查询，`Esc`/`Ctrl+C` 关闭。 |
| 轨迹（`/trajectory`） | `↑`/`↓`、`Home`/`End`、`PgUp`/`PgDn` 导航，`Enter` 打开详情，`Tab`/`←`/`→` 切换分区，`/` 搜索，`n`/`N` 与 `Ctrl+N`/`Ctrl+P` 跳转匹配，`t` 折叠回合，`c` 折叠每一步里的调用，`Esc`/`Ctrl+C` 关闭。 |
| Session Library | 清空搜索后 `p` 置顶／取消置顶、`r` 重命名；`Alt+A` 归档／恢复选中会话，`Alt+V` 切换默认／归档列表，列表为空或正在搜索时也可切换。 |
| Session Tree | 输入搜索；`↑`/`↓`/`Tab` 选择，`←`/`→` 折叠，`Ctrl+↑`/`Ctrl+↓` 滚动预览，`Enter` 编辑 Turn 或恢复分支，`Alt+Enter` 恢复选中节点所在的分支，`Alt+L` 添加标记，`Alt+U` 清除标记，`Alt+B` 切换已标记节点，`Alt+R` 检查 Turn 文件恢复，`Esc` 先清除搜索再关闭，`Ctrl+C` 取消。 |
| 交互选择器（resume、permission、model、agent、workflow、login） | 输入以筛选，`↑`/`↓`/`Tab` 导航，`←`/`→` 选择，多题提问中按 `Alt+Left` 返回上一题，Plan Review 中按 `Ctrl+X` 用外部编辑器编写修改意见，`PgUp`/`PgDn` 与 `Home`/`End` 移动，`Space` 多选，`Enter` 选择或提交，`Ctrl+J` 提交，`Esc` 返回或取消，`Ctrl+C` 取消。 |

可搜索的选择列表支持多词查询，例如 `official flash`；每个词都必须匹配名称、标识符、预览或描述中的内容。`flsh` 这样的短缩写可以在单词内部匹配。名称的完整匹配和前缀匹配排在仅描述匹配之前，清空查询会恢复原始顺序。这些规则用于选择器筛选；转录搜索、提示历史和 `/resume <query>` 保留各自的搜索规则。

## 自定义键位

应用级绑定存放在 `$OMDSH_HOME/omdsh/keybindings.json`（回退到 `$DSH_HOME`，再到 `~/.dsh`），与会话、设置和 MCP 文件使用同一个 home。你可以在 `/settings` 的 **Interface → Input → Keybindings** 中交互式重绑或解绑快捷键（保存后立即生效），也可以直接编辑 JSON 文件：

```json
{
  "ctrl+j": "search-transcript",
  "ctrl+r": "retry",
  "ctrl+s": null
}
```

key id 用 `+` 连接修饰键（`ctrl`、`alt`、`shift`、`super`），具名键用小写拼写（`pageup`、`pagedown`、`escape`、`left`、`right`、`up`、`down`）。值必须是下表中的 action id，或用 `null` 解除默认按键绑定；无法识别的 action 或格式错误的文件只会让对应条目保留出厂绑定。`/help` 会显示实际生效的按键。

| Action id | 默认键 | 作用 |
|---|---|---|
| `preview-images` | `Alt+M` | 预览草稿图片，或会话中最新的图片。 |
| `expand-paste` | `Alt+I` | 展开粘贴块进行编辑。 |
| `manage-queue` | `Alt+Q` | 逐条管理待处理消息。 |
| `steer-turn` | `Alt+S` | 向当前 Turn 的下一次模型步骤发送文本纠正消息。 |
| `stash-draft` | `Ctrl+S` | 暂存或恢复当前 composer 草稿。 |
| `external-editor` | `Ctrl+X` / `Ctrl+G` | 在 Settings 选定的编辑器中编辑提示。 |
| `retry` | `Alt+R` | 重试最近一条人类提示。 |
| `paste-clipboard` | `Ctrl+V` | 粘贴剪贴板文本或图片。 |
| `copy-prompt` | `Alt+C` | 复制选中文字；没有选区时复制当前提示。 |
| `copy-line` | `Ctrl+Alt+C` | 复制当前行。 |
| `cycle-model-forward` | `Ctrl+P` | 切换到下一个收藏模型。 |
| `cycle-model-backward` | `Ctrl+Shift+P` | 切换到上一个收藏模型（`Alt+P` 等效）。 |
| `cycle-thinking` | `Shift+Tab` | 循环切换当前模型的推理强度。 |
| `toggle-thinking` | `Ctrl+T` | 显示或折叠整个转录中的思考。 |
| `toggle-tools` | `Ctrl+O` | 将视口所在的已完成回合恢复为运行时的展示；再按一次回到折叠的实时底部。运行中的回合保持不变；在工具目录上则切换描述详略。 |
| `toggle-tool-details` | `Alt+O` | 切换当前阅读回合的完整工具输入和结果。 |
| `review-changes` | `Alt+V` | 预览视口所在工具声明的文件。 |
| `scroll-page-up` | `PgUp` | 向上翻一页。 |
| `scroll-page-down` | `PgDn` | 向下翻一页。 |
| `scroll-fast-up` | `Shift+Up` | 快速向上滚动。 |
| `scroll-fast-down` | `Shift+Down` | 快速向下滚动。 |
| `search-history` | `Ctrl+R` | 搜索输入历史。 |
| `search-transcript` | `Ctrl+Shift+F` | 搜索当前转录（composer 为空时 `Ctrl+F` 等效）。 |

## Composer Shell

在输入框中键入 `!command`，即可在当前会话的持久 Shell 中执行一行命令；键入 `!!command` 则在命令结束时把输出分享到主对话流与会话上下文。草稿以 `!` 开头时 composer 边框立即变绿，所以在决定执行之前就能看到当前处于 Shell 模式。Shell 使用当前 Access 级别，从当前工作目录启动，后续调用保留它自己的目录和环境变量。它与 Agent 的工具 Shell 相互独立。

输出作为一张卡片流式出现在命令下方，命令结束时就地定型——没有阅读页需要打开或退出。`Ctrl+C` 中断正在运行的命令。`!command` 的输出不进入模型上下文；`!!command` 在命令结束时把输出分享到对话。执行仍受当前 Access 级别约束。

Shell 历史和环境仅保留在当前运行的 Agent 中；恢复已保存的会话会创建新 Shell。带粘贴标记且以 `!` 开头的文本仍作为普通消息处理。需要执行时，请主动键入开头的 `!`；无标记的单行粘贴有时无法与键入区分。携带附件的输入仍按消息处理。快捷执行需要交互式终端；Shell 返回控制权不代表命令已退出。

## 相关

- [命令](commands.md) —— 斜杠命令完整参考
- [调整工作环境](tutorials/environment.md) —— 主题、动效、通知与状态栏
- [恢复并管理长会话](tutorials/long-session.md) —— 恢复、回退、压缩与导出
