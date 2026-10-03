# Herdr 集成

状态：lifecycle reporter 已实现；按 omdsh `0.19.0` 源码核对。协议与本机实测的外部基线是 2026-09-12 的 Herdr `0.9.0`，以下外部限制仅针对该版本，不推断后续 Herdr 版本。[原始调研](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/herdr-integration-research.md)保留来源与实验细节。

## 接入方式

omdsh 在自己的 Herdr pane 内通过自定义 lifecycle 上报，不需要 `herdr integration install`。Herdr `0.9.0` 的内置 agent kind 与安装 target 不含 omdsh；screen manifest 也不能自行新增一种原生进程检测。自定义上报提供状态权威，不代表 Herdr 已支持原生启动或自动恢复 omdsh。

[herdr-agent.ts](../../packages/tui/omdsh-tui/src/runtime/herdr-agent.ts)包含纯状态 controller、reporter 和 socket 传输。[本地 provider](../../packages/tui/omdsh-tui/src/runtime/provider-local.ts)接入主会话状态、人工 prompt、会话 id 和 dispose；实例没有 Herdr 环境时保持 inert。测试直接构造 LocalTui 默认使用空环境，避免误报到开发者真实 pane。

## 已实现的契约

| 项目 | 行为 |
| --- | --- |
| 环境 | 仅 `HERDR_ENV=1` 且 `HERDR_PANE_ID`、`HERDR_SOCKET_PATH` 均非空时激活；socket 或 binary 变量单独存在不能证明在 pane 内 |
| 身份 | `source: custom:omdsh`，`agent: omdsh`，不借用 `herdr:pi` 等官方 source |
| 状态 | 主 Agent running → working，否则 idle；未解决的人工 prompt 覆盖为 blocked，并携带清理后的标题 |
| 多个 prompt | 引用计数，最后一个解除后才回到 running/idle 状态 |
| 去重 | 状态与 message 相同不重复上报；启动强制播种一次 |
| Inspector | 检视子会话期间忽略其 running/idle 信号，关闭后同步 root 状态；pane 状态不跟随子 Agent 翻转 |
| 会话 | `setSession` 更新 native session id 并清除旧投影，下次状态信号携带 `agent_session_id` |
| 序号 | 以时间戳乘 1000 为起点，同一 reporter 内严格递增；Herdr 按 source 忽略不大于已接受值的 seq |
| 退出 | dispose 发送 `pane.release_agent`；release 标记阻止后续 report |
| 传输 | 每个请求使用短连接写一行 JSON；500ms 超时、socket/timer unref，失败静默；Windows 映射为命名管道 |

blocked 来自真实人工交互，不从屏幕文字猜测。Herdr 的 done 是服务端从 idle 与未查看状态推导，reporter 不发送 done。

## 传输与恢复边界

当前传输是 fire-and-forget：不等待成功、不重试，也没有串行 drain 队列。单调 seq 能帮助 Herdr 忽略乱序旧状态，但不能保证请求已交付。release 也不等待此前 socket 完成，进程强杀或传输竞争可能留下状态；不要把参考实现中的单飞行队列、重试或退出 drain 写成产品已有保障。

独立 reporter 实例使用时钟播种，没有共享的进程级序号 ledger；同毫秒重建或时钟回退下的跨实例严格递增不能仅凭播种公式保证。若出现重载后状态被忽略，先验证 accepted seq 与请求顺序，再决定是否增加共享序号和串行传输。

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

主屏渲染使用 DEC 2026 synchronized output，未做 DECRQM 探测。若将来增加探测，应重新核对 Herdr VTE 的响应与实际支持，不能把“未识别”的响应直接当作不支持。内联图像协议尚未实现，这次整理不将其视为已支持能力。

## 验证入口与一手资料

产品回归由 [herdr-agent.spec.ts](../../packages/tui/omdsh-tui/src/runtime/herdr-agent.spec.ts)和 [provider-local.spec.ts](../../packages/tui/omdsh-tui/src/runtime/provider-local.spec.ts)覆盖检测、状态投影、请求、release、inspector 隔离和无环境 no-op。网络投递、实际 attached UI、通知声音及强杀后的遗留状态仍需独立 E2E，不能由 fake transport 推断。

外部协议来源固定在当时研究的 Herdr `v0.9.0`：

- [Integrations](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/integrations.mdx)：自定义 lifecycle 路径、source 与原生恢复条件。
- [Socket API](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/socket-api.mdx)：report、release、seq 与 metadata。
- [Agent automation](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/agent-automation.mdx)：prompt、blocked 和 wait。

这些资料用于解释历史契约，不构成 Herdr 最新兼容性声明，也不是 omdsh 的运行时依赖。
