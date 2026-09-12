---
description: "排查常见 omdsh 问题：中断与退出行为、恢复会话、颜色环境变量、复用器滚动回看、旧会话以及插件启动失败。"
---

# 故障排查

## 中断与退出

第一次 `Ctrl+C` 中断活动回合；会话空闲时则清空 composer。第二次 `Ctrl+C` 退出，`Ctrl+D` 直接退出。持久会话退出时会打印 `omdsh --resume <session-id>`，方便在新终端里重新打开这段对话。

## 找回会话 id

`/session` 报告活动会话的详细信息，`/resume` 打开可搜索的选择器。只记得聊过什么时，用 `/sessions <查询>` 搜索持久会话内容。见[会话与历史](sessions.md)。

最初使用 v0.5.0 至 v0.11.0 创建的会话可能包含一个未经扩展的 DSH 持久化读取器会拒绝的私有事件；omdsh 仍能打开它们。不要手工修改会话文件——它们可能被压缩并带有完整性校验。

## 颜色

在未设置显式颜色偏好时，`NO_COLOR` 与 `FORCE_COLOR=0` 会关闭彩色输出。显式选择——插件配置或在 `/settings` 中选择的值——仍然优先于环境变量；在 `/settings` 中开启颜色会立即生效，无需重启。

## 滚动回看与复用器

普通更新期间 omdsh 保留终端原生滚动回看；只有真正的全屏浮层会借用备用屏幕。在 tmux、screen 与 ConPTY 下，宿主滚动回看会被保留，resize 突发会先合并再重绘。附加或 resize 后如果显示看起来过期，用 `Alt+L` 重置终端显示。

## 插件启动失败

版本不匹配、bundle 缺少 `dsh.bundle.patch` 声明，或包名无法解析，都会在启动时直接失败，而不是静默降级。`omdsh --dump-config` 会打印组合树并标注每个条目来自哪一层，`omdsh plugin remove <package>` 可以撤销一次安装。同一棵树里出现两份 Cordis 或 Harness 包会分裂 service token，是最常见的原因；见[用户插件](plugins.md)。

## 更新与通知

每日更新检查只会提示存在新的 npm 版本，从不自动安装。升级后的版本说明、更新检查与终端通知都在 `/settings` → General 中配置。见[设置](settings.md)。

## 管道输入

当输入或输出不是 TTY 时，omdsh 退化为按行输入与纯追加式输出，而不是占用屏幕。CI 使用的就是这种模式。

## 相关

- [命令行](cli.md) —— flags 与环境变量
- [会话与历史](sessions.md) —— 日志兼容性与本地文件
- [用户插件](plugins.md) —— Profile 安装与组合调试
