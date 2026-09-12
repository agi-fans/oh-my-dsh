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
| `Shift+Enter` / `Alt+Enter` / `Ctrl+J` | 插入换行。 |
| `Ctrl+W` / `Alt+Backspace` | 删除前一个词。 |
| `Alt+D` | 删除后一个词。 |
| `Ctrl+U` | 删除到行首。 |
| `Ctrl+K` | 删除到行尾。 |
| `Ctrl+Y` | 粘贴回已删除的文本。 |
| `Alt+Y` | 在删除环中循环。 |
| `Ctrl+-` | 撤销上一次编辑。 |
| `Ctrl+D` | 向后删除；composer 为空时退出。 |
| `Ctrl+V` | 粘贴剪贴板文本或图片。 |
| `Alt+C` | 复制当前提示。 |
| `Ctrl+Alt+C` | 复制当前行。 |
| `Ctrl+X` | 在 `$VISUAL` 或 `$EDITOR` 中编辑提示。 |

## 转录

| 快捷键 | 作用 |
|---|---|
| `PgUp` / `PgDn` | 翻一页。 |
| `Shift+Up` / `Shift+Down` | 快速滚动。 |
| `Ctrl+O` | 展开工具输出或目录说明。 |
| `Ctrl+F` | composer 为空时搜索当前转录；`n`/`N` 在匹配间跳转。 |
| `Alt+A` | 打开 Agent Hub；可继续的子智能体可以直接在它的转录中被引导。 |

## 会话

| 快捷键 | 作用 |
|---|---|
| `Esc` 两次 | 回退到更早的对话回合。 |
| `Ctrl+C` 一次 | 中断活动回合，或清空 composer。 |
| `Ctrl+C` 两次 | 退出；持久会话会打印 `omdsh --resume <session-id>` 提示。 |
| `Ctrl+Z` | 挂起到后台。 |
| `Alt+L` | 重置终端显示。 |
| `Ctrl+R` | 搜索输入历史。 |
| `Alt+R` | 重试最近一条人类提示。 |
| `Ctrl+P` / `Alt+P` | 切换到下一个或上一个收藏模型。 |
| `Ctrl+T` | 循环切换当前模型的推理强度。 |
| `/` | 打开斜杠命令补全。 |
| `@` / `./` / `~/` | 补全文件路径。 |
| `Tab` | 接受命令或路径补全。 |

## 浮层

| 浮层 | 按键 |
|---|---|
| 设置（`/settings`） | `↑`/`↓` 移动行，`←`/`→` 修改值，`Space` 显示或隐藏状态项，`Enter` 修改值或开始移动状态项，`Tab`/`Shift+Tab` 切换分区，`Home`/`End` 跳到两端，`Esc`/`Ctrl+C` 关闭。 |
| 复制选择器（`/copy`） | `↑`/`↓` 或 `Tab` 导航，`PgUp`/`PgDn` 翻页，`Home`/`End` 到两端，`Enter`/`Space` 复制，`Esc`/`Ctrl+C` 关闭。 |
| Agent Hub（`Alt+A`，或 composer 为空时按 `↓`） | `↑`/`↓` 导航，`Home`/`End` 到两端，`Enter` 打开子转录，`Tab`/`←`/`→` 切换检查面板，`PgUp`/`PgDn` 滚动，`T` 切换树视图，`Esc`/`Ctrl+C` 关闭。 |
| 历史搜索（`Ctrl+R`） | 输入以筛选，`↑`/`↓`/`Tab`/`PgUp`/`PgDn`/`Home`/`End` 导航，`Enter` 选择，`Esc`/`Ctrl+C` 取消；查询输入支持行编辑按键。 |
| 转录搜索（`Ctrl+F`） | 输入查询，编辑中按 `Ctrl+N`/`Ctrl+P` 跳转，`Enter` 确认，`n`/`N` 在匹配间跳转，`/` 编辑查询，`Esc`/`Ctrl+C` 关闭。 |
| 轨迹（`/trajectory`） | `↑`/`↓`、`Home`/`End`、`PgUp`/`PgDn` 导航，`Enter` 打开详情，`Tab`/`←`/`→` 切换分区，`/` 搜索，`n`/`N` 与 `Ctrl+N`/`Ctrl+P` 跳转匹配，`t` 折叠回合，`c` 折叠调用，`Esc`/`Ctrl+C` 关闭。 |
| 交互选择器（resume、permission、model、agent、workflow、login、rewind） | 输入以筛选，`↑`/`↓`/`Tab` 导航，`←`/`→` 选择，`PgUp`/`PgDn` 与 `Home`/`End` 移动，`Space` 多选，`Enter` 选择或提交，`Ctrl+J` 提交，`Esc` 返回或取消，`Ctrl+C` 取消。 |

## 自定义键位

应用级绑定存放在 `$OMDSH_HOME/omdsh/keybindings.json`（回退到 `$DSH_HOME`，再到 `~/.dsh`），与会话、设置和 MCP 文件使用同一个 home。文件把小写 key id 映射到 action id：

```json
{
  "ctrl+j": "search-transcript",
  "ctrl+r": "retry"
}
```

key id 用 `+` 连接修饰键（`ctrl`、`alt`、`shift`、`super`），具名键用小写拼写（`pageup`、`pagedown`、`escape`、`left`、`right`、`up`、`down`）。值必须是下表中的 action id；无法识别的 action 或格式错误的文件只会让对应条目保留出厂绑定。绑定在启动时读取一次，编辑文件后需要重启 omdsh，之后 `/help` 会显示实际生效的按键。

| Action id | 默认键 | 作用 |
|---|---|---|
| `external-editor` | `Ctrl+X` | 在 `$VISUAL` 或 `$EDITOR` 中编辑提示。 |
| `retry` | `Alt+R` | 重试最近一条人类提示。 |
| `paste-clipboard` | `Ctrl+V` | 粘贴剪贴板文本或图片。 |
| `copy-prompt` | `Alt+C` | 复制当前提示。 |
| `copy-line` | `Ctrl+Alt+C` | 复制当前行。 |
| `inspect-subagent` | `Alt+A` | 打开 Agent Hub。 |
| `cycle-model-forward` | `Ctrl+P` | 切换到下一个收藏模型。 |
| `cycle-model-backward` | `Alt+P` | 切换到上一个收藏模型。 |
| `cycle-reasoning` | `Ctrl+T` | 循环切换当前模型的推理强度。 |
| `toggle-tools` | `Ctrl+O` | 展开工具输出或目录说明。 |
| `scroll-page-up` | `PgUp` | 向上翻一页。 |
| `scroll-page-down` | `PgDn` | 向下翻一页。 |
| `scroll-fast-up` | `Shift+Up` | 快速向上滚动。 |
| `scroll-fast-down` | `Shift+Down` | 快速向下滚动。 |
| `search-history` | `Ctrl+R` | 搜索输入历史。 |
| `search-transcript` | `Ctrl+F` | 搜索当前转录。 |

## 相关

- [命令](commands.md) —— 斜杠命令完整参考
- [调整工作环境](tutorials/environment.md) —— 主题、动效、通知与状态栏
- [恢复并管理长会话](tutorials/long-session.md) —— 恢复、回退、压缩与导出
