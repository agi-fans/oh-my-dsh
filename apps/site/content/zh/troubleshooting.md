---
description: 按真实故障现象快速排查 omdsh 启动、登录、认证、按键、鼠标、tmux、图片显示、MCP/LSP 与插件问题。
---

# 故障排查

遇到问题时，先在终端运行内置自检命令，它能一口气定位大多数环境、登录、配置和插件故障：

```sh
omdsh doctor
```

如果想把检查结果发给他人或在脚本里解析，运行 `omdsh doctor --json`。下面是按常见症状整理的排查清单。

## 一、登录、认证与模型报错

### 1. DeepSeek 账户浏览器登录跳到了桌面端或一直没返回
- 正常走 `/login` → **`DeepSeek 账户`** 时，浏览器会通过本地回调地址完成授权，最终停在带 `login_source=web` 的完成页（看到“授权已完成”后手动关闭标签页即可，omdsh 会自动切回界面）。
- 如果页面拉起了 DeepSeek Harness Desktop（地址带 `login_source=desktop` 或缺少 `login_source`），说明打开了旧的桌面端授权链接。关掉该标签页，回到 omdsh 重新跑 `/login` 打开新地址。
- **远程 SSH 服务器上登录**：把终端提示的 `127.0.0.1:<端口>` 通过 SSH 端口转发（`ssh -L <端口>:127.0.0.1:<端口> ...`）映射回本机，浏览器回调才能送达远程终端。

### 2. API Key 保存了但不生效，或提示权限错误
- 进程里已经设置了 `DEEPSEEK_API_KEY` 等环境变量时，环境变量优先且不会被 `/login` 或 `/logout` 覆盖。用 `env | grep DEEPSEEK` 检查是否被旧环境变量盖住了。
- 凭据文件（`$OMDSH_HOME/.credentials.yaml`）要求仅当前用户可读，如在 Linux/macOS 上手工改动过权限，执行 `chmod 600 ~/.dsh/.credentials.yaml`。

### 3. 模型返回内容拒绝（`CONTENT_REFUSED`）
- 当 DeepSeek 服务端因安全策略拒绝当前请求时，交互终端会明确展示内容拒绝原因，脚本模式 `omdsh exec --json` 会返回错误码 `CONTENT_REFUSED`。调整提示词表述或移除敏感片段后重试即可。

## 二、按键、换行与剪贴板问题

### 1. macOS 上 `Alt+...` 快捷键打出了 `å`、`¥`、`∑` 等字符
- macOS 终端默认把 `Option` 当作输入特殊字符，而不是发送 `Alt/Meta` 修饰键。
- **解决办法**：在终端偏好设置中开启 “Use Option as Meta key”（iTerm2 / Ghostty / WezTerm / Apple Terminal 均有此项），然后进入 `/settings` → **`终端` → `输入` → `快捷键` → `测试按键`** 确认实际收到的键名。

### 2. `Shift+Enter` 没法换行，直接把消息发出去了
- 较旧的终端不会区分 `Shift+Enter` 和普通 `Enter`。请改用 **`Ctrl+J`**（全平台通用换行键），或在支持 Kitty 键盘协议的终端（Kitty / Ghostty / WezTerm / iTerm2 新版）中使用。

### 3. 粘贴多行内容时被提前发送，或正常打字感觉有延迟
- **Paste protection**（粘贴保护）会在不支持原生括号粘贴标记的终端里用启发式方式防止误发。如果它在你的终端上造成打字停顿，可在 `/settings` → **`终端` → `输入`** 中关闭；支持括号粘贴的现代终端关闭后依然不会误提交。

### 4. 程序异常退出后，Shell 里的 `Esc` 或 `Ctrl+C` 表现怪异
- 正常退出、`Ctrl+Z` 挂起和打开外部编辑器时，omdsh 都会自动恢复终端的原始键盘协议。如果进程被强杀导致协议未还原，在 Shell 里运行一次：

```sh
printf '\033[<u'
```

## 三、鼠标、选字复制、滚动与 tmux

### 1. 鼠标直接拖选复制不了文字
- 默认 `鼠标交互` 为 `自动`，开启了界面内滚轮滚动与按钮点击。需要用终端原生拖选时，按住 **`Shift`**（macOS 部分终端为 **`Option`**）再拖动；如果你平时几乎不用鼠标点界面、只想随时自由拖选复制，在 `/settings` → **`终端` → `鼠标交互`** 中改为 **`关闭`**（`native`）。
- 如果使用内置选区复制：拖选松手默认自动复制（可在设置中关闭 `选中即复制` 改为 `Alt+C` / `Enter` 复制）。

### 2. 在 tmux / screen 里窗口缩放后画面错乱，或向上滚动看到旧内容
- **画面错位**：按 **`Alt+L`** 立刻重绘当前实时视图（不会破坏上方滚动历史）。
- **为什么向上滚动会看到已经折叠的工具旧样子？** omdsh 刻意不改写已滚出视口进入终端原生滚动历史的行——它们是当时的忠实快照，**分界线之下的实时视图才是当前最新对话记录的为准状态**。

### 3. 颜色显示不正常或没有真彩色
- 环境变量 `NO_COLOR` 或 `FORCE_COLOR=0` 会关闭彩色输出；在 `/settings` 里显式开启颜色可覆盖环境变量并立即生效。
- Apple Terminal 默认回退到 256 色以避开其 24 位色渲染缺陷；如需强制 24 位色，启动前设置 `COLORTERM=truecolor`。

## 四、内联图片、会话、MCP / LSP 与插件问题

### 1. 截图粘贴后不能在终端里直接预览（或 tmux 里看不到图）
- 内联图片预览需要终端支持 Kitty 或 iTerm2 图形协议（如 Kitty、Ghostty、WezTerm、Warp、iTerm2）；在不支持的终端或嵌套复用器中，可在预览页点 **`打开`** 调用系统看图软件。
- 如自动识别不准，可通过环境变量强制指定或关闭：`OMDSH_IMAGE_PROTOCOL=kitty|iterm2|none`。

### 2. `/resume` 里找不到昨天聊过的会话
- `/resume` 默认只列出**当前工作目录**关联的会话。切回原来的项目目录再启动，或直接运行 `omdsh --resume <会话ID>`。如果忘了 ID，先在原目录用 `/resume <聊过的关键词>` 全文检索。

### 3. MCP 服务器显示 `等待凭据` 或 `失败`
- 运行 `/mcp` 选中该服务器：
- 显示 `等待凭据`：补录 `${credential:...}` 对应的密钥后再点 **`重启`**；
- 显示 `失败`：点进服务器详情查看具体报错，并用 `!which <命令>` 确认本地命令在 `PATH` 上，确认后再点 **`探测`** 验证。

### 4. LSP 不可用或找不到语言服务器
- 确认对应语言的服务器二进制已在 `PATH` 上（例如 `typescript-language-server`、`gopls`、`rust-analyzer`），且项目或用户目录的 `lsp.json` 语法无误，详见[语言服务器（LSP）](language-servers.md)。

### 5. 插件安装后启动报错或命令未出现
- 运行 `omdsh doctor` 与 `omdsh --dump-config` 检查该插件包是否与当前 DeepSeek Harness 版本兼容、是否声明了 `dsh.bundle.patch`、是否存在重复依赖。
- 如某插件导致异常，直接执行 `omdsh plugin remove <包名>` 移除即可恢复。
- 交互模式下插件的 `console` 诊断输出全部重定向到 **`$OMDSH_HOME/omdsh/logs/omdsh.log`**，不会破坏终端画面，排查时可直接查看该日志（删除即可清空）。

### 6. 中断、退出与管道模式
- **中断 vs 退出**：模型运行时按 `Esc` 或空输入框按 `Ctrl+C` 只中断当前回合；空闲时**连按两次 `Ctrl+C`**（或空输入框按 `Ctrl+D`）退出，并打印 `omdsh --resume <会话ID>`。
- **卡在后台任务或提问**：用 `/jobs` 查看并停止失控的后台命令；如果曾错过超时提问，运行 `/questions` 检查。
- **在管道或 CI 中运行**：当 stdin/stdout 不是 TTY 时，omdsh 自动切到按行输入与纯追加输出模式；自动化集成更推荐使用 `omdsh exec --json`，详见[命令行与脚本模式](cli.md)。

## 相关

- [命令行与脚本模式](cli.md) —— `omdsh doctor`、`omdsh exec` 与全部环境变量
- [会话与恢复](sessions.md) —— 本地数据路径与旧日志兼容
- [设置](settings.md) —— 鼠标、主题、通知与快捷键配置
