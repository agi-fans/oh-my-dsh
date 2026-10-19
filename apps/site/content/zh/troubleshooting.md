---
description: "排查常见 omdsh 问题：中断与退出行为、恢复会话、DeepSeek 账户登录、颜色环境变量、复用器滚动回看、旧会话以及插件启动失败。"
---

# 故障排查

## 中断与退出

第一次 `Ctrl+C` 中断活动回合；会话空闲时则清空 composer。第二次 `Ctrl+C` 退出，`Ctrl+D` 直接退出。持久会话退出时会打印 `omdsh --resume <session-id>`，方便在新终端里重新打开这段对话。

## 找回会话 id

`/session` 报告活动会话的详细信息，`/resume` 打开可搜索的选择器。只记得聊过什么时，用 `/resume <查询>` 搜索持久会话内容。见[会话与历史](sessions.md)。

最初使用 v0.5.0 至 v0.11.0 创建的会话可能包含一个未经扩展的 DSH 持久化读取器会拒绝的私有事件；omdsh 仍能打开它们。不要手工修改会话文件——它们可能被压缩并带有完整性校验。

## DeepSeek 账户登录

`/login` → **DeepSeek account** 会用 loopback 回调地址（例如 `http://127.0.0.1:<port>/oauth/callback`）打开平台授权页。授权完成后，页面应结束在 `.../dsh/authorized?login_source=web` 并显示“授权已完成”。如果页面拉起 DeepSeek Harness Desktop，它的地址会带 `login_source=desktop`（或没有 `login_source`），属于 Desktop 发起的授权，不是 TUI；关闭那个标签页，重新从 `/login` 获取新地址，不要复用旧标签页。

由于标签页是从终端打开而不是由 `window.open` 打开，浏览器可能不会自动关闭它；看到完成提示后手动关闭，并在 TUI 中按回车。远程主机需要把 TUI 显示的 loopback 端口通过 SSH 转发到本机，回调才能到达 TUI。登录后共享账户会同时出现在 `/login` 与 `/logout`；登出会删除本地 grant，并在后台尝试撤销。

## 日志

交互式 TUI 会把插件的 `console` 输出重定向到 `$OMDSH_HOME/omdsh/logs/omdsh.log`，而不是 stdout，诊断文本不会写进 composer 或破坏画面。文件只保留在本机，可能包含运行细节；`omdsh exec` 仍使用自己的 stdout/stderr 协议。删除该文件即可重置日志。

## 颜色

在未设置显式颜色偏好时，`NO_COLOR` 与 `FORCE_COLOR=0` 会关闭彩色输出。显式选择——插件配置或在 `/settings` 中选择的值——仍然优先于环境变量；在 `/settings` 中开启颜色会立即生效，无需重启。

## 滚动回看与复用器

普通更新期间 omdsh 保留终端原生滚动回看；只有真正的全屏浮层会借用备用屏幕。替换转录时同样保留：`/clear`、切换会话与 `--resume` 都会在带标签的接缝下方追加新文档，而不是清掉上面的内容——那段历史里还有 omdsh 启动前你 shell 打印的东西。在 tmux、screen 与 ConPTY 下，宿主滚动回看会被保留，resize 突发会先合并再重绘。附加或 resize 后如果显示看起来过期，用 `Alt+L` 重置终端显示。

已经滚进那段历史的行，是当时显示内容的快照，之后不会被改写。因此向上滚过接缝时，会看到已经结束的工具调用、或已经折叠成组头的工作段，仍按终端收到它们时的样子排列。接缝是唯一标记这次更替的地方，接缝之下的实时视图才是当前转录的准。

## 插件启动失败

版本不匹配、bundle 缺少 `dsh.bundle.patch` 声明，或包名无法解析，都会在启动时直接失败，而不是静默降级。`omdsh --dump-config` 会打印组合树并标注每个条目来自哪一层，`omdsh plugin remove <package>` 可以撤销一次安装。同一棵树里出现两份 Cordis 或 Harness 包会分裂 service token，是最常见的原因；见[用户插件](plugins.md)。

## 更新与通知

每日更新检查只会提示存在新的 npm 版本，从不自动安装。升级后的版本说明、更新检查与终端通知都在 `/settings` → Interface 中配置。见[设置](settings.md)。

## 管道输入

当输入或输出不是 TTY 时，omdsh 退化为按行输入与纯追加式输出，而不是占用屏幕。CI 使用的就是这种模式。

## 相关

- [命令行](cli.md) —— flags 与环境变量
- [会话与历史](sessions.md) —— 日志兼容性与本地文件
- [用户插件](plugins.md) —— Profile 安装与组合调试
