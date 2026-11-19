---
description: omdsh 快捷键与鼠标操作参考：最常用的 10 个快捷键、输入框编辑、对话浏览、各面板操作、!command 快捷 Shell 与 keybindings.json 自定义绑定。
---

# 快捷键与鼠标

随时在 omdsh 中按 **`Alt+K`**（或运行 `/help full`）都能查看当前终端实际生效的全部快捷键。在 `/settings` → **`终端` → `输入` → `快捷键`** 中可以交互式重绑或用 **`测试按键`** 确认终端发出的实际键码。

## 先记住这 10 个最高频快捷键

不需要背完整张表，日常 90% 的操作靠这 10 个键就够了：

| 快捷键 | 做什么 |
|---|---|
| `Enter` / `Shift+Enter`（或 `Ctrl+J`） | 发送消息 / 换行（`Ctrl+J` 兼容几乎所有终端） |
| `Esc` | 中断运行中的回合，或关闭当前面板/搜索/子智能体视图 |
| `Ctrl+C` | 有草稿时清空草稿；无草稿且运行中时中断；空闲时连按两次退出 |
| `Ctrl+O` | 展开或收起已完成/运行中回合的思考与工具详情 |
| `Ctrl+L` | 打开模型与推理强度选择器 |
| `Shift+Tab` | 快速循环切换当前模型的推理强度 |
| `Alt+S` / `Alt+Enter`（Win/WSL：`Ctrl+Q`） | 运行中插话纠偏（下一步）/ 排队（下一回合） |
| `Ctrl+R` | 搜索历史输入 |
| `Ctrl+Shift+F` | 搜索当前对话记录（空输入框时 `Ctrl+F` 等效） |
| 连按两次 `Esc` | 打开会话树（Session Tree），浏览分支或按 `Alt+R` 恢复回合文件 |

> **平台差异提示**：macOS 上 `Ctrl` 是 Control 键，`Alt` 对应 Option 键（需在终端里开启“Use Option as Meta key”，否则会打出 `å`/`¥` 等字符）。Windows 与本地 WSL 默认用 `Ctrl+Q` 排队、`Alt+P` 切换上一个收藏模型、`Ctrl+Alt+V` 粘贴剪贴板图片（`Alt+V` 保留给文件预览），且不支持 `Ctrl+Z` 后台挂起。

## 输入框编辑与光标导航

| 快捷键 | 作用 |
|---|---|
| 方向键 | 移动光标；输入框为空时上下翻阅历史输入 |
| `Ctrl+A` / `Home` / `Cmd+←` | 移到行首 |
| `Ctrl+E` / `End` / `Cmd+→` | 移到行尾 |
| `Alt+B` / `Alt+←`、`Alt+F` / `Alt+→` | 按词左移 / 右移 |
| `Ctrl+W` / `Alt+Backspace`、`Alt+D` | 删除前一个词 / 后一个词 |
| `Ctrl+U` / `Cmd+Backspace`、`Ctrl+K` | 删除到行首 / 删除到行尾 |
| `Ctrl+Y` / `Alt+Y` | 粘贴刚删掉的文本 / 在删除环中循环（**注意：界面有文本选区时，`Alt+Y` 优先将选区引用到输入框**） |
| `Ctrl+-` / `Cmd+Z` | 撤销编辑，或恢复刚被清空的草稿 |
| `Ctrl+D` | 向后删除字符；输入框为空时退出 omdsh |
| `Ctrl+V` / `Cmd+V`（macOS）/ `Ctrl+Alt+V`（Win/WSL） | 粘贴剪贴板文本或图片 |
| `Alt+M` | 预览草稿中的图片；无草稿图片时打开会话里最新的一张图 |
| `Alt+I` | 展开光标所在的折叠粘贴块（超过 10 行或 1000 字符的粘贴会折叠为 `[Pasted …]`） |
| `Ctrl+S` | 暂存当前草稿；再次按 `Ctrl+S`（或发完一条消息后）自动取回 |
| `Ctrl+X` / `Ctrl+G` | 在外部编辑器中编写长提示，保存关闭后自动带回 |
| `Alt+C` / `Ctrl+Alt+C` | 复制选中文本（无选区时复制整条提示）/ 复制当前行 |
| `Cmd+Enter`（macOS）/ `Ctrl+Enter` | 繁忙时使用与 `Enter` 相反的发送方式（排队 ↔ 插话）；空闲时正常发送 |
| `Alt+↑` | 输入框为空时，撤回最近一条排队消息到输入框修改 |
| `Alt+Q` / `Alt+G` | 打开消息队列面板 / 打开长期目标面板（保留当前草稿） |

> 粘贴保护（`Paste protection`）默认开启，会在终端未标记括号粘贴时防止多行粘贴被误提前发送；如影响正常打字，可在 `/settings` → **`终端` → `输入`** 中关闭。

## 对话记录浏览与鼠标操作

### 键盘导航

| 快捷键 | 作用 |
|---|---|
| `PgUp` / `PgDn`、`Shift+↑` / `Shift+↓` | 向上/向下翻页或快速滚动对话 |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | 在各条历史提问之间快速跳转 |
| `End` | 回到最新底部并退出详情浏览（在底部时移到输入行尾） |
| `Ctrl+O` | 浏览当前视口所在回合的思考与工具详情（`↑`/`↓` 选择、`Enter` 或 `←`/`→` 展开收起、`Home` 回到标题、`Esc` 退出） |
| `Alt+O` | 一次性展开/收起当前回合全部工具的完整输入和结果 |
| `Alt+A` | 打开当前工具的操作菜单（复制命令、复制结果、打开声明的文件） |
| `Alt+V` | 预览当前工具关联的文件（当前位置无工具时引导打开 `/diff`） |
| `Alt+Y` | 将当前选中的文字以 Markdown 引用形式追加到输入框 |
| `Ctrl+T` | 全局显示或折叠对话中的思考过程 |
| `Ctrl+Shift+F`（空输入框可用 `Ctrl+F`） | 搜索当前对话记录（`n`/`N` 跳转下一条/上一条命中） |

### 鼠标操作

- **滚动与展开**：滚轮可直接滚动对话记录、设置面板、历史搜索、`/diff` 与 `/trajectory`；点击思考或工具行左侧的箭头即可展开/收起；点击回合 `Changed` 文件摘要直接打开 `/diff`。
- **选中与复制**：开启内置鼠标模式（`自动` 或 `开启`）时，在当前视口内拖选文字默认松手即复制（双击选词、三击选行、`Shift` 点击扩选）；选中后输入框下方会提示 `[复制]` 与 `[引用]`。可在设置中关闭 `选中即复制`，改用 `Alt+C`、`Enter` 或右键复制。
- **右键快速预览**：无选区时，右键点击工具卡片或 `Changed` 文件行可直接预览该文件。
- **原生鼠标模式**：如果你只想用终端原生的拖选复制（例如在 tmux 中），按住 `Shift` 拖选，或在 `/settings` → **`终端` → `鼠标交互`** 中设为 `关闭`（`native`）。

## 会话与模型快捷操作

| 快捷键 | 作用 |
|---|---|
| `/`、`@` / `./` / `~/`、`Tab` | 打开命令补全 / 路径与会话补全 / 接受补全 |
| `Alt+K` | 打开快捷键目录 |
| `Ctrl+L` | 选择模型与推理强度（选择器内 `Alt+F` 收藏，`Alt+A` 切全部/收藏） |
| `Ctrl+P` / `Ctrl+Shift+P`（或 `Alt+P`） | 在收藏模型间顺向/逆向快速切换 |
| `Shift+Tab` | 循环切换当前模型的推理强度 |
| `Alt+R` | 输入框为空时，续跑可恢复的模型失败 |
| `↓`（空输入框） | 进入输入框上方的子智能体列表，`Enter` 切入查看，`Esc` 返回 |
| `Alt+L` | 重绘终端显示（调整窗口或重连 tmux 后画面错位时使用） |
| `Ctrl+Z` | 挂起到后台（仅 macOS / Linux / WSL） |

## 面板与阅读器常用按键

| 界面 | 常用操作 |
|---|---|
| **设置面板（`/settings`）** | `Tab`/`Shift+Tab` 切标签、`↑`/`↓` 选行、`←`/`→`/`Space` 改值、`Enter` 打开子表单、`/` 搜索、`Ctrl+R` 恢复默认、支持鼠标滚轮、`Esc` 退出 |
| **历史搜索（`Ctrl+R`）** | 输入多词筛选、`↑`/`↓`/`PgUp`/`PgDn`/鼠标滚轮选择、`Enter` 填入输入框、`Esc` 取消 |
| **对话搜索（`Ctrl+Shift+F`）** | 输入关键词、`Ctrl+N`/`Ctrl+P` 实时跳转、`Enter` 确认后用 `n`/`N` 跳转、`/` 修改搜索词、`Esc` 关闭 |
| **Diff 与文件阅读器（`/diff`）** | 宽屏 `Tab` 切左右栏、`V` 切对比/当前文件、`W` 切折行、`Alt+←`/`Alt+→` 横向平移、`/` 搜索、`G` 跳行号、`[`/`]` 切变更块、`Q` 或选区按 `Alt+Y` 引用回输入框、`O` 系统打开、`E` 外部编辑器打开、`?` 查帮助 |
| **执行轨迹（`/trajectory`）** | `Enter` 打开详情、`Tab` 切列表/详情、`←`/`→` 切标签页、`Space` 展开上下文/子调用、`t`/`c` 折叠回合或调用、`e` 仅看报错、`s` 按耗时排序、`f` 全屏详情、`y` 复制、`/` 搜索 |
| **会话库（`/resume`）** | `Alt+S` 全文搜索、`Alt+L` 回当前目录列表、`Alt+P` 置顶、`Alt+R` 重命名、`Alt+A` 归档/恢复、`Alt+V` 切归档视图 |
| **会话树（双按 `Esc`）** | 打字筛选、`←`/`→` 折叠分支、`Ctrl+↑`/`Ctrl+↓` 滚预览、`Enter` 从回合分叉或续跑分支、`Alt+L`/`Alt+U`/`Alt+B` 管理节点标记、`Alt+R` 恢复该回合文件 |
| **通用文档阅读器（`/help`、`/context` 详情等）** | `↑`/`↓`/`PgUp`/`PgDn`/滚轮滚动、`/` 页内查找、`Ctrl+N`/`Ctrl+P` 跳匹配、`S` 选章节、`Y` 复制当前页或字段、`Esc` 返回 |

## 快捷 Shell（`!command` 与 `!!command`）

在空输入框中以 **`!`** 开头（边框会变绿）即可在当前会话的持久 Shell 里运行命令：

- **`!command`**：输出就地展示给你看，**不进入模型上下文**；
- **`!!command`**：命令结束后自动把输出分享给模型继续分析；
- 遵循当前权限模式；运行中按 **`Ctrl+C`** 或空输入框按 **`Esc`** 可随时中断；粘贴带 `!` 的文本不会误触发执行。

## 自定义快捷键（`keybindings.json`）

可以在 `/settings` → **`终端` → `输入` → `快捷键`** 中交互式重绑（立即生效），也可以直接编辑 `$OMDSH_HOME/omdsh/keybindings.json`（格式为 `"键名": "action id"`，设为 `null` 可解除默认绑定）：

```json
{
  "ctrl+j": "search-transcript",
  "ctrl+r": "retry",
  "ctrl+s": null
}
```

修饰键用 `+` 连接（支持 `ctrl`/`control`、`alt`/`option`、`shift`、`super`/`cmd`/`command`），支持功能键 `f1`–`f12` 与小写具名键（`escape`、`pageup`、`pagedown`、`left`、`right`、`up`、`down`）。下表列出全部 **37** 个合法 `action id`：

| Action id | 默认键 | 作用 |
|---|---|---|
| `interrupt` | `escape` | 中断回合或关闭当前面板 |
| `clear-composer` | `ctrl+c` | 清空草稿或中断；空闲连按两次退出 |
| `quit` | `ctrl+d` | 输入框为空时退出 |
| `suspend` | `ctrl+z`（仅 POSIX） | 挂起到后台 |
| `reset-display` | `alt+l` | 重绘终端画面 |
| `external-editor` | `ctrl+x` / `ctrl+g` | 用外部编辑器编辑提示 |
| `stash-draft` | `ctrl+s` | 暂存或取回草稿 |
| `paste-clipboard` | `ctrl+v` / `cmd+v` / `ctrl+alt+v` | 粘贴剪贴板文本或图片 |
| `expand-paste` | `alt+i` | 展开折叠的粘贴块 |
| `preview-images` | `alt+m` | 预览草稿或会话最新图片 |
| `copy-prompt` | `alt+c` | 复制选区或当前提示 |
| `copy-line` | `ctrl+alt+c` | 复制当前行 |
| `alternate-send` | `cmd+enter` / `ctrl+enter` | 繁忙时使用相反的发送方式 |
| `follow-up` | `alt+enter` / `ctrl+q` | 排队到下一回合 |
| `dequeue` | `alt+up` | 撤回最近一条排队消息到输入框 |
| `steer-turn` | `alt+s` | 插话到当前回合下一步 |
| `manage-goal` | `alt+g` | 打开目标管理面板 |
| `manage-queue` | `alt+q` | 打开待处理消息队列 |
| `retry` | `alt+r` | 输入框为空时续跑失败生成 |
| `select-model` | `ctrl+l` | 选择模型与推理强度 |
| `cycle-model-forward` | `ctrl+p` | 切换到下一个收藏模型 |
| `cycle-model-backward` | `ctrl+shift+p` / `alt+p` | 切换到上一个收藏模型 |
| `cycle-thinking` | `shift+tab` | 循环切换推理强度 |
| `toggle-thinking` | `ctrl+t` | 全局显示或折叠思考过程 |
| `tool-actions` | `alt+a` | 打开当前工具操作菜单 |
| `quote-selection` | `alt+y` | 将选区引用到输入框 |
| `toggle-tools` | `ctrl+o` | 浏览思考与工具详情 |
| `toggle-tool-details` | `alt+o` | 切换当前回合全部工具的完整输入/输出 |
| `review-changes` | `alt+v` | 预览当前工具关联的文件 |
| `search-history` | `ctrl+r` | 搜索输入历史 |
| `search-transcript` | `ctrl+shift+f` | 搜索当前对话记录 |
| `scroll-page-up` | `pageup` | 向上翻一页 |
| `scroll-page-down` | `pagedown` | 向下翻一页 |
| `scroll-fast-up` | `shift+up` | 快速向上滚动 |
| `scroll-fast-down` | `shift+down` | 快速向下滚动 |
| `previous-turn` | `ctrl+shift+up` | 跳到上一条提问 |
| `next-turn` | `ctrl+shift+down` | 跳到下一条提问 |

## 相关

- [命令参考](commands.md) —— 全部斜杠命令与阅读器详解
- [设置](settings.md) —— 鼠标、主题、通知与状态栏设置
- [故障排查](troubleshooting.md) —— macOS Option 键、旧终端换行与 tmux 适配
