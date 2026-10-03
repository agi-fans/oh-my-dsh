# 会话收尾与子 Agent

状态：产品侧收尾和后台刷新修复已实现；按 omdsh `0.19.0` 核对。执行、持久事件、子 Agent 消息与取消语义由已发布的 Harness 包拥有，TUI 只维护展示投影。

## 工具预览与真实执行

流式工具参数仅表示模型正在生成调用，不证明工具已被派发。达到单次输出上限时，Harness 可以拒绝执行被截断的调用，并以 `max-tokens` 结束 turn。TUI 必须区分预览、durable call 与 durable result：

| 结束时的证据 | 投影行为 |
| --- | --- |
| 只有流式预览，没有 durable `tool/call` | 删除预览，保留已交付的安全 assistant 前缀；不能把预览当已执行调用 |
| 已有 durable `tool/call`，没有 durable result | 保留调用记录，结束 running 状态并标记错误；明确执行结果未知，不能声称工具未执行 |
| 已有 durable result | 使用真实结果，不受预览清理影响 |

[event-views](../../packages/tui/omdsh-tui/src/views/event-views.ts)在 `turn/end` 统一执行清理，而不是只在 terminal controller 中藏卡片。live、replay、resume 和 export 因此采用同一投影。`max-tokens`、`blocked`、`interrupted` 等原因有可读提示；`error` 保留失败摘要，abort 保留已交付的中断前缀。不能让 idle Agent 留下一张永久 running 的工具卡。

`max-tokens` 是截断原因，不等同于凭据或 Provider 故障。提高模型上限不能代替正确收尾；有效上限仍受精确模型、用户配置和服务端限制影响。TUI 不执行截断参数，也不自动无限发送“继续”，以免引入重复副作用和额外费用。

关联 [issue #6](https://github.com/agi-fans/oh-my-dsh/issues/6) 的[原始调查](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/long-task-interruption-analysis.md)证明了上述投影缺陷，但没有取得报告者完整会话，不能把所有“任务停住”都归因于 token 上限。

## 子 Agent 展示与流式边界

主界面子 Agent 列表只显示任务名称与 Starting、Running、Waiting、Done、Failed；Waiting 和 Done 不能合并。工具活动在 Agent Hub 和会话 inspector 中查看，后台 thinking、正文和工具参数不能驱动主界面列表重绘。

[session-controller](../../packages/tui/omdsh-tui/src/session/session-controller.ts)先校验并缓冲完整的流式增量，只向当前可见会话转发。打开 inspector 后，[live-attempt-tracker](../../packages/tui/omdsh-tui/src/session/live-attempt-tracker.ts)补回进行中前缀，再继续实时显示；关闭后停止转发后台增量。优化必须保留 attempt revision/index 连续性和最终内容，不能为减少重绘直接丢 chunk。

[subagent-roster](../../packages/tui/omdsh-tui/src/session/subagent-roster.ts)从持久事件增量维护名称、状态和有限活动记录，首次加载或恢复才回放历史。无变化时保持行与 snapshot 身份，避免重复排序和复制。TUI 比较列表可见字段；只有 Agent Hub 打开时才为活动变化刷新，并通过现有调度器合并连续状态变化。人工审批和问题继续走及时交互路径。

回归要求包括：后台 120 个不改变可见状态的 chunk 不发布 roster 或 transcript 更新；打开 inspector 后前缀完整；活动更新不绘制主列表；Starting → Running → Waiting 可以合并显示；持久工具事件、失败状态、恢复和键盘选择仍正确。这些是工作量与行为断言，不是远程模型延迟承诺。

## 性能证据与限制

2026-09-10 在 omdsh `0.15.0` 上的[调查](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/subagent-responsiveness-analysis.md)观察到同步渲染放大：第一轮 CPU profile 约 97% 样本在 TUI 渲染链路，第二轮仍有该热点但约 31% idle。证据支持间歇性主线程饥饿，不支持永久死锁或内存泄漏结论。

修复前的 fake-terminal 单次合成负载中，3 个后台 Agent 的 120 个无可见变化 chunk 仍触发 120 次 render。10,000 个简单历史 block 且前部工具 pending 时，已安装版本阻塞约 2,237ms；无 pending 时约 108ms。该实验没有真实网络、工具或 TTY，临时 profile 与脚本未入库，不能当作当前版本基准。[修复记录](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/subagent-status-plan.md)另有确定性工作量回归和当时的 PTY 验证，不替代修复后的性能采样。

进程内 spawn/fork 与 TUI 共享 JavaScript 事件循环；异步网络可以重叠，同步插件计算仍会阻塞输入和取消。fork 是会话 seed，不是操作系统 fork。Done 数量也不等于驻留 runtime 数量，不能据此推断泄漏。可选 ACP 通道提供进程隔离，但不能等价替代可继续对话的进程内子任务，配置边界见 [Harness 集成](../integrations/deepseek-harness.md)。

## 后续调查条件

- **父 Agent 未唤醒**：先取得父子 `agent/status`、settlement、parent session id、inbox inserted/claimed/discarded/spliced、interrupt 与 dispose 时间线。只有证明完成信号到达但 wake 或 admission 丢失后才调整生命周期，不能凭相似症状套用 token 修复。
- **并发准入**：有可复现的 runtime 压力后，评估覆盖 continuable 创建、冷恢复、嵌套委派和程序化调用的接口。`maxDepth` 不是并发限制，jobs 上限不自动覆盖 continuable；简单 semaphore 必须避免等待后代的父任务占满执行槽。
- **进程隔离**：采样确认剩余同步 runtime 开销影响终端后，再验证 TUI/runtime 桥。桥必须保留顺序增量、持久记录、审批与问题关联、steer、cancel、resume、inspector 和退出协议；不能通过复制上游 continuation manager 达成。
- **自动续跑**：先确认已发布接口能结构化表达截断调用与未执行结果，再设计有限恢复；UI 自动发送合成用户消息不能代替该 contract。

修改这些边界需要事件投影与 fake-TTY 回归，必要时增加负载测量和真实 PTY；验证集按 [AGENTS.md](../../AGENTS.md) 与[检查技能](../../.agents/skills/check-oh-my-dsh-change/SKILL.md)选择。
