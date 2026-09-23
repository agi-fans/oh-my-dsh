---
description: "omdsh 的全部设置：外观、动效、通知、Agent 语言，以及可配置的两行状态栏，含默认值与持久化位置。"
---

# 设置

`/settings` 打开设置浮层。`Tab` 与 `Shift+Tab` 在 General、Agent、Status line 三个分区之间切换；`↑`/`↓` 移动行，`←`/`→` 修改值。完整浮层按键见[键盘与快捷键](keyboard.md)。

## General

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Theme | dark、light、midnight、solarized、catppuccin、dracula、nord、gruvbox、rose-pine、mono | dark | 配色方案。 |
| Color | on / off | on | SGR 着色。 |
| Motion | full / reduced / off | full | `full` 带平滑流式与工作微光；`reduced` 保留平滑流式、去掉微光；`off` 直接跟随 provider 分块并使用静态活动标记。 |
| Terminal activity | on / off | off | 支持的终端标签页与任务栏中的忙碌/空闲状态。 |
| Tool details | compact / expanded | compact | 展开工具输出与目录说明，与 `Ctrl+O` 相同。 |
| Update checks | on / off | on | 每天检查一次 npm，有新版本时通知。 |
| Release notes | summary / expanded / hidden | summary | 升级后展示一次新版本说明。 |
| Notifications | off / long-running / always | off | 回合结束或需要输入时通知。 |
| Long turn | 15s / 30s / 1m / 2m | 30s | 触发长任务通知的最短时长。 |

Motion 只影响呈现：provider 输出仍会立即进入实时会话，工具边界或已落定的助手消息会立即冲刷可见流，不等待动画。

## Agent

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Language | Auto / Simplified Chinese / English | Auto | 推理与回复的偏好语言。 |

非 Auto 的选择从下一个回合开始生效；代码、标识符、命令、工具参数、日志、引用与文件内容保持准确形式，当前任务的显式语言要求仍然优先。该偏好是用户级的，因此恢复的会话使用当前值而不是历史快照。

## Status line

| 行 | 取值 | 默认 | 作用 |
|---|---|---|---|
| Status line | on / off | on | 显示 composer 下方固定的两行页脚。 |
| Labels | compact / full | compact | 紧凑或完整的指标标签。 |

状态项可以就地重排与换色：`Space` 显示或隐藏一项，`Enter` 开始移动（`↑`/`↓` 重排，`←`/`→` 选择列），每一项都有自己的颜色。

第一行默认顺序：Model（`deepseek`）、Effort（`max`）、Path（`~/project`）、Git（`main *1`）与 Session；Session 默认关闭，因为终端窗口标题无论如何都会显示会话标题。

第二行的遥测分组默认全部显示：Context（`Ctx 1.6% · 16.4K/1M`）、Cache（`Cache 99%`）、Tokens（`5.9M in`）、Latency（`TTFT 1.2s`）、Time（`LLM 16m51s`）与 Activity（`3 turns`）。终端较窄时按优先级从低到高降级：cache、tokens、latency、时长、活动计数。

## 持久化

设置、模型偏好与登录写入的凭据都是实时插件配置，持久化到当前 Profile 的 Cordis 补丁 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`（home 本身依次回退到 `$DSH_HOME`、`~/.dsh`）；`/settings`、`/model` 与 `/login` 都写入这里。更早版本留下的 `settings.yaml` 会在启动时导入一次——每个设置段按同名 id 写入 Profile 行——随后文件被重命名为 `settings.yaml.imported`；已不再对应任何行 id 的设置段会被记录日志，并且只留在重命名后的文件里。完整文件清单见[会话与历史](sessions.md)。

## 插件设置

除浮层的三个分区之外，已挂载的 Harness 插件把设置保存在该插件自己 Profile 行上的 config 中。其中一个决定默认路由是否能工作：`llm-deepseek` 只支持 Messages，会拒绝 `protocol` 键，并回复 `protocol is not configurable; remove it and use a Messages-compatible baseURL`。因此自建 gateway 必须提供 Messages 兼容端点，DeepSeek 端点由 base URL 选择，而不是由协议开关选择。

## 相关

- [键盘与快捷键](keyboard.md) —— 设置浮层按键与键位覆盖
- [故障排查](troubleshooting.md) —— 颜色环境变量与更新行为
- [命令](commands.md) —— `/settings`、`/model`、`/login`
