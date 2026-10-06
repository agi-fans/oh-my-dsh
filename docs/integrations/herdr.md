# Herdr 集成

状态：lifecycle reporter 已实现。历史 attached UI 实测基线为 2026-09-12 的 Herdr `0.9.0`；当前请求与响应格式另按本机 Herdr `0.9.1` 的 `herdr api schema --json` 核对。下述历史外部限制不推断后续版本。[原始调研](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/herdr-integration-research.md)保留来源与实验细节。

## 接入方式

omdsh 在自己的 Herdr pane 内通过自定义 lifecycle 上报，不需要 `herdr integration install`。Herdr `0.9.0` 的内置 agent kind 与安装 target 不含 omdsh；screen manifest 也不能自行新增一种原生进程检测。自定义上报提供状态权威，不代表 Herdr 已支持原生启动或自动恢复 omdsh。

[herdr-agent.ts](../../packages/tui/omdsh-tui/src/runtime/herdr-agent.ts)包含纯状态 controller、reporter 和 socket 传输。[本地 provider](../../packages/tui/omdsh-tui/src/runtime/provider-local.ts)接入主会话状态、人工 prompt、会话 id 和 dispose；实例没有 Herdr 环境时保持 inert。测试直接构造 LocalTui 默认使用空环境，避免误报到开发者真实 pane。

## 已实现的契约

| 项目 | 行为 |
| --- | --- |
| 环境 | 本地 provider 仅在输入、输出均为 TTY，且 `HERDR_ENV=1`、`HERDR_PANE_ID`、`HERDR_SOCKET_PATH` 均有效时激活；后台管道运行不认领 pane，smoke 子终端不继承调用者的 Herdr 环境 |
| 身份 | `source: custom:omdsh`，`agent: omdsh`，不借用 `herdr:pi` 等官方 source |
| 状态 | 主 Agent running → working，否则 idle；未解决的人工 prompt 覆盖为 blocked，并携带清理后的标题 |
| 多个 prompt | 引用计数，最后一个解除后才回到 running/idle 状态 |
| 去重 | 状态与 message 相同不重复上报；启动强制播种一次 |
| Inspector | pane 持续跟随 root 状态，子 Agent 的 running/idle 只更新检视画面；root 的变化不覆盖子会话画面 |
| 会话 | `setSession` 保留运行与 prompt 状态，立即携带新的 `agent_session_id` 上报 |
| 序号 | 进程内共享序号，以时间戳乘 1000 为下限；快速重建或时钟回退仍严格递增；Herdr 按 source 拒绝旧 seq |
| 退出 | dispose 先同步恢复终端，再等待 `pane.release_agent`；release 阻止后续 report，总等待不超过 1100ms |
| 传输 | 串行短连接请求，匹配成功响应才确认投递；单次 500ms 超时，失败静默并在 1 秒后重试最新状态；Windows 映射为命名管道 |

blocked 来自真实人工交互，不从屏幕文字猜测。Herdr 的 done 是服务端从 idle 与未查看状态推导，reporter 不发送 done。

## 传输与恢复边界

同一 reporter 最多有一个在途请求，尚未发出的状态合并为最新状态。请求须收到相同 id 的成功响应；断开、错误响应或超时都视为失败。失败后重新投递最新状态，不依赖下一次状态变化触发恢复。工作期间 socket 与重试 timer 均 unref，不延长进程寿命。退出会丢弃尚未发出的状态，等在途请求结束再发送 release，并由有界的退出 timer 留出投递时间。

同一进程、同一 socket 和 pane 的新 reporter 会停止旧实例的队列与重试，旧实例的退出不会再释放新实例的状态权威。序号仅在当前进程内共享；不同进程不共享 ledger，也不能保证系统时钟回退后的跨进程递增。已确认成功后没有周期性心跳，Herdr 服务重启后的状态由下一次状态变化或会话更新重新上报。release 失败、超时或进程强杀仍可能留下状态，不能承诺强杀后自动清理。

状态认领以 pane 为范围，不以仓库工作目录为范围。非交互运行与 smoke 子终端必须隔离，避免开发验证向调用者的 pane 写入 `custom:omdsh` 状态。另行创建的嵌套 PTY 也应去掉继承的 `HERDR_*` 变量，除非它确实对应一个独立的 Herdr pane。

Herdr `0.9.0` 的独立 headless session/socket 实测确认：自定义上报可在 agent list 显示 omdsh 与 blocked 状态，release 后记录消失；`agent_session_id` 被接受，但 pane get 不暴露对应 `agent_session`，也没有验证 omdsh 的 native restore。发送会话引用保留前向兼容，不承诺 Herdr 服务重启后自动 `omdsh --resume`。

## 仍未接入或验证的面

| 缺口 | 启动条件与验证要求 |
| --- | --- |
| Herdr 终端 profile | 当前 `detectTerminalProfile` 只识别 TMUX/STY/ZELLIJ，Herdr 单独运行被归为 direct。若调整归类，验证 resize 合并、主屏浏览与 overlay 恢复；当前已无 ED3 清历史路径，旧调研的清历史建议不再适用 |
| 原生通知 | 当前通知使用 OSC 9；旧调研发现 Herdr 0.9.0 不可靠转发该通道。若接入 `herdr notification show`，需验证环境、参数清理、标题、声音映射、命令失败与回退，不影响 lifecycle authority |
| 自动化输入 | bracketed paste 已由 TUI 解析，但尚未把自定义 reporter 与 Herdr `agent prompt/wait` 做完整 E2E。测试必须覆盖 composer 提交、blocked 拒绝、overlay 中输入落点，以及 settled 状态等待 |
| Metadata | 会话标题目前走 OSC 2，没有 `report-metadata`。只有明确 sidebar 展示需求时再接，不能通过 metadata 争抢状态权威 |
| 消息协议 | `[herdr-msg reply-to:… task:…]` 是 skill 层约定，不是当前产品入站协议；接入需明确解析、上下文与回复授权 |
| Native start/restore | 需要核对 Herdr 对自定义 kind 的启动与恢复能力，lifecycle 上报本身不足以提供 |

主屏渲染使用 DEC 2026 synchronized output，未做 DECRQM 探测。若将来增加探测，应重新核对 Herdr VTE 的响应与实际支持，不能把“未识别”的响应直接当作不支持。图片预览在直连兼容终端使用 Kitty 或 iTerm2 协议；Herdr 环境回退为图片信息与外部打开，不发送图像协议。

## 验证入口与一手资料

产品回归由 [herdr-agent.spec.ts](../../packages/tui/omdsh-tui/src/runtime/herdr-agent.spec.ts)、[provider-local.spec.ts](../../packages/tui/omdsh-tui/src/runtime/provider-local.spec.ts)、[session-controller.spec.ts](../../packages/tui/omdsh-tui/src/session/session-controller.spec.ts)与 [smoke-lib.spec.ts](../../apps/omdsh/src/smoke-lib.spec.ts)覆盖检测、状态投影、响应解析、失败重试、串行 release、inspector 隔离和测试环境隔离。真实网络投递、attached UI、通知声音及强杀后的遗留状态仍需独立 E2E，不能由 fake transport 推断。

外部协议来源固定在当时研究的 Herdr `v0.9.0`：

- [Integrations](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/integrations.mdx)：自定义 lifecycle 路径、source 与原生恢复条件。
- [Socket API](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/socket-api.mdx)：report、release、seq 与 metadata。
- [Agent automation](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/agent-automation.mdx)：prompt、blocked 和 wait。

这些资料用于解释历史契约，不构成 Herdr 最新兼容性声明，也不是 omdsh 的运行时依赖。
