# Subagent 并发与 TUI 响应性分析

日期：2026-09-10。状态：完成源码分析、现场采样和合成负载验证；未实施性能修复或进程迁移。

后续实现：[子 Agent 状态展示修复](subagent-status-plan.md)已处理后台流式更新、持久事件重复回放和主界面活动展示。本文保留修复前的调查证据与架构取舍，不代表修复后的性能测量。

## 结论

进程内 subagent 有真实的性能和故障隔离风险：主 Agent、子 Agent、插件回调和 TUI 共用 JavaScript 事件循环。异步模型请求可以重叠等待网络，但同步计算、事件监听器和渲染仍会互相阻塞。上游提供进程内和进程外两类 provider，并未要求产品只能采用进程内架构。此次现场采样直接指向 omdsh 的同步渲染放大，不能把当天两次卡顿都认定为上游死锁，也不能认为替换子进程即可修复父进程的渲染开销。

建议先消除无效 roster 更新和历史扫描，再增加真实的并发准入控制。长期优先评估“独立 TUI 进程 + Harness runtime 进程”，保留 runtime 内现有 continuable、fork 和消息语义。逐个子 Agent 进程化需要更大的上游生命周期接口，当前 provider 接口不足以无损替换。

## 检查范围与证据强度

- 现场：全局安装的 omdsh 0.15.0，Node v24.18.0，macOS arm64，PID 79697。界面显示 3 个运行中、19 个已完成的 agent。
- 依赖：工作区和全局安装的 `@deepseek-ai/dsh-subagent` 均为 `0.1.5-rc.1`，两处对应执行 bundle 相同。
- 上游参考源码：`refs/deepseek-harness`，提交 `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。核心执行和 continuation 结论同时核对已安装 npm bundle；SDK 协议分析只针对该参考提交，未验证其安装适配。
- omdsh 源码：基于 `eab433c` 及调查时工作区已有修改。现有未提交修改由另一个会话维护，本调查未改动它们。
- 第一轮 3 秒 CPU profile 约 97% 样本位于 TUI 渲染链路；第二轮仍有相同热点，但包含约 31% idle 样本。因此证据支持严重、可间歇发生的主线程饥饿，不支持“进程永久死锁”的断言。
- 合成负载验证的是同一事件到渲染路径及其增长机制，没有重放两次事故的完整会话，也不代表真实网络总是以相同突发方式到达。

## 上游实际运行方式

### 共享事件循环是真实限制

一次性进程内 driver 经 `parent.ctx.agents.create()` 创建子 Agent。当前产品默认的 continuable 模式由 continuation manager 直接经 `ownerCtx.agents.create()` / `resume()` 创建或恢复 Agent，没有创建 worker 或操作系统子进程。相关实现见 [in-process driver](../refs/deepseek-harness/packages/subagent/subagent-in-process-driver/src/index.ts)、[continuation activation](../refs/deepseek-harness/packages/subagent/subagent/src/continuation-activation.ts)。

每个模型 chunk 经 `AssistantStreamAttempt.push()` 组装并同步发布瞬态帧；Cordis `emit()` 直接调用监听器。omdsh 的全局监听器因此在产生流式事件的调用链内执行。把函数标成 `async` 或把工作塞进 Promise 微任务，不会把同步计算搬到另一个线程，也不会自动给终端 I/O 留出执行机会。见 [assistant-stream.ts](../refs/deepseek-harness/packages/core/agent-loop/src/assistant-stream.ts)、[Cordis events.ts](../refs/deepseek-harness/vendor/cordis/src/events.ts) 和 [Node 事件循环说明](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)。

风险随活跃子 Agent 数、流式事件密度、历史长度和插件同步开销叠加。模型主要等待网络时，少量进程内 Agent 可以工作良好；没有实测依据支持一个对所有任务都安全的固定数量。

### 深度限制不是并发限制

`tool-subagent` 的 `maxDepth` 默认值为 3，限制递归层级，不能限制同层创建的数量。continuable 分支直接调用 `startContinuable()`，一次性后台分支才调用 `jobs.start()`；因此 `maxConcurrentJobsPerOwner` 不限制当前默认 continuable 子 Agent。检查的 continuation 执行路径没有总活跃 Agent 容量上限。见 [tool-subagent](../refs/deepseek-harness/packages/subagent/tool-subagent/src/index.ts) 和 [continuation manager](../refs/deepseek-harness/packages/subagent/subagent/src/continuation.ts)。

### 完成计数不等于泄漏

上游在子 Agent 空闲、没有待交付消息、没有其拥有的子 Agent 时允许 settlement，随后刷新持久状态、释放 `AgentHandle` 并从驻留表删除。以后发消息可以从持久会话冷恢复。仍有后代运行时，空闲祖先可能继续驻留。因此界面的 “19 done” 不能证明 19 个完整 runtime 仍占用内存。取消是协作式的，事件循环被占住时，处理取消和等待退出也会延迟。见 [activation settlement/disposal](../refs/deepseek-harness/packages/subagent/subagent/src/continuation-activation.ts)。

`LiveAttemptTracker` 还为各个进行中的 attempt 保存原始增量，供切换 inspector 或重建 transcript 时补回流式前缀；正常 end 会删除。大量并发长输出可能增加瞬态驻留量，但未做 heap snapshot，不能认定存在泄漏。任何压缩或保留策略都必须验证 inspector 不丢前缀、revision/index 连续性和异常销毁清理。见 [live-attempt-tracker.ts](../packages/tui/omdsh-tui/src/session/live-attempt-tracker.ts)。

### fork 不是操作系统 fork

`subagent_fork` 提取父会话截至最后一个完成 turn 的历史作为 seed。它有利于保留上下文和模型侧前缀缓存，但不提供 CPU 隔离；历史扫描、会话构建、每个子会话的 projection 和模型请求上下文都有成本。尚未测量 payload 共享和实际 heap 倍数，不能简单断言每个子 Agent 都完整复制父会话内存。独立审查任务应优先考虑 fresh spawn，只有确实需要共同历史时才 fork。见 [fork provider](../refs/deepseek-harness/packages/subagent/subagent-fork-in-process/src/index.ts) 和 [Session 构建](../refs/deepseek-harness/packages/core/session/src/index.ts)。

## omdsh 的确定性放大路径

现场 CPU profile 捕获到以下调用链：

```text
模型流式事件
  → SessionRuntime.#forwardLiveDelta
  → #pushSubagents
  → LocalTui.setSubagents
  → #render → renderView → fitFrame → visibleWidth → charWidth
```

### 无变化的增量也会完整刷新

`applySubagentDelta()` 在状态始终为 thinking 时可以返回原对象，但 `SubagentRoster.applyDelta()` 仍返回该对象；controller 只检查是否为 `undefined`，于是继续 push。每次 snapshot 都排序全部已知行，`setSubagents()` 又复制全部行和 activity，再同步 render。主会话的部分流式更新已有 8ms 合并窗口，roster 更新绕过它。见 [subagent-roster.ts](../packages/tui/omdsh-tui/src/session/subagent-roster.ts)、[session-controller.ts](../packages/tui/omdsh-tui/src/session/session-controller.ts) 和 [provider-local.ts](../packages/tui/omdsh-tui/src/runtime/provider-local.ts)。

### 每个持久事件重新回放子会话历史

`SubagentRoster.apply(session, depth, _event, ...)` 忽略传入增量，调用 `hydrate()` 遍历 `session.ownEvents()`。同一子会话持续增长时，累计扫描量可呈二次增长。合成测试中，处理 100 次事件调用产生了 100 次完整历史读取；1 万条简单历史事件约耗时 7ms。这个绝对数值不是现场主要热点，但证明了重复扫描机制；真实工具内容和更长历史可能更昂贵。

不能只把 `hydrate()` 换成一次 `applySubagentEvent()`：现在 transient activity 与 durable fold 共用视图，完整回放承担了清除临时 preview、恢复真实 tool/call 和稳定 identity 的作用。增量实现需要区分 durable fold 与瞬态覆盖，并在首次加载、恢复、日志替换或连续性中断时重建。

### 滚动提交位置被当成宽度缓存位置

`renderView()` 以最早未结束 block 计算 `liveStart`，再让 `fitFrame()` 从这里测量到结尾。一旦较早的工具长期 pending，后面已经稳定的历史行仍会反复测量。这不意味着正常情况每帧都重做全部 Markdown，而是稳定格式缓存之后仍有长后缀宽度扫描。见 [event-views.ts](../packages/tui/omdsh-tui/src/views/event-views.ts)。

`liveStart` 负责原生 scrollback 提交语义，不应直接承担“哪些行仍需验证宽度”的职责。应按 block 的内容版本、宽度、主题和展开状态缓存合规行，独立处理 mutable block。不能为了消除测量直接把 pending 内容提前提交到不可回写的 scrollback。

## 合成负载结果

测试不请求模型、不执行工具、不连接真实 TTY。使用全局已安装的 `LocalTui` 和 `SubagentRoster`，fake terminal 为 130×58，关闭颜色、输出为 no-op。3 个子 Agent 先进入 thinking，再轮流同步输入 120 个不改变显示状态的 text chunk。历史为简单中文 assistant block；pending 条件在最早处保留一个未完成工具。测试在循环前安排零延迟定时器，记录它实际获得执行的延迟。以下为单次测量，不能视为跨机器性能门槛。

| 历史 block | 前部 pending | 120 次增量重绘数 | 已安装版本阻塞时间 | 调查时工作区阻塞时间 |
| --- | --- | --- | --- | --- |
| 100 | 否 | 120 | 8ms | 9ms |
| 100 | 是 | 120 | 28ms | 32ms |
| 1,000 | 否 | 120 | 13ms | 15ms |
| 1,000 | 是 | 120 | 230ms | 241ms |
| 10,000 | 否 | 120 | 108ms | 106ms |
| 10,000 | 是 | 120 | 2,237ms | 2,565ms |

所有 120 次增量都保持原 roster 行对象不变，仍各自触发一次 render。120 次是 chunk 数，不是 token 数；没有把它换算成现场 token/s。突发循环模拟流积压或高密度回调，不能据此声称每次真实请求都会连续阻塞 2 秒。

本机调查产物保存在临时目录，未纳入 Git，系统清理临时目录后需重建：`/tmp/omdsh-subagent-load.mjs`、`/tmp/omdsh-subagent-load-installed.jsonl`、`/tmp/omdsh-subagent-load-worktree.jsonl`、`/tmp/omdsh-79697.cpuprofile`。该 profile 文件是第二轮采样，第一轮数值保留于调查工具输出。

已执行的负载命令：

```sh
node /tmp/omdsh-subagent-load.mjs
OMDSH_DIAG_BASE="$PWD/packages/tui/omdsh-tui/src/" pnpm exec tsx /tmp/omdsh-subagent-load.mjs
```

## 隔离方案的选择

| 方案 | 保留当前消息与 fork 语义 | 解决 TUI 同步渲染放大 | 执行隔离及代价 |
| --- | --- | --- | --- |
| 保留进程内，修复更新和缓存 | 是 | 直接处理 | 最小改动；其他 runtime 同步计算仍影响输入和取消 |
| 现有 `subagent_isolated` / ACP | 否 | 仍需父端优化；事件模式也可能改变 | 子任务进程隔离；不能等价替换可继续对话的任务 |
| 全部 Harness runtime 移出 TUI 进程 | 可保留 runtime 内语义，需验证交互桥 | 仍必须修复 TUI 消费端 | 隔离终端与 runtime 卡顿；后端 Agent 之间仍共享循环 |
| 每个 continuable 子 Agent 独立进程 | 当前接口不足 | 仍必须修复父端 | 隔离范围更细，需扩展生命周期接口和跨进程消息、恢复、退出协议，增加启动和内存成本 |

现有 `SubagentProvider.prepareContinuable()` 只提供 seed 数据，管理器拥有实际的 Agent 创建、恢复、控制和 disposal；冷恢复也不重新走 provider。因此新增一个 process provider 无法透明替换当前 continuable 执行。见 [provider 类型](../refs/deepseek-harness/packages/subagent/subagent/src/types.ts) 和 [activation materialization](../refs/deepseek-harness/packages/subagent/subagent/src/continuation-activation.ts)。

上游参考源码中的 SDK provider 虽然也是进程外，但不支持同等 continuable/fork 能力。其 SDK 请求表只有 initialize、session/prompt、shutdown，通知覆盖持久事件、状态和子任务开始/结束，不是完整的交互式 TUI 传输层；没有在该协议表中发现瞬态输出、交互审批/问题、取消、steer、resume 和 roster 查询的完整支持。不能把 SDK 换上后就宣称迁移完成。见 [SDK 协议](../refs/deepseek-harness/packages/sdk/protocol/src/types.ts)、[SDK server](../refs/deepseek-harness/packages/sdk/server/src/server.ts) 和 [SDK provider](../refs/deepseek-harness/packages/subagent/subagent-dsh-sdk/src/index.ts)。

## 建议实施顺序与验收

### 第一阶段：修复本次已证实的路径

1. roster 明确区分“没有此 Agent”“没有显示变化”“有变化”，只有变化才请求更新。snapshot 保持版本和稳定对象身份，避免无变化时重复排序、复制。
2. 在 TUI 内统一安排显示刷新。事件回调只更新状态和标记 dirty，低优先级 roster 活动可按约 30fps 合并；用户输入和终态需要及时刷新，但不能每个 token 强制 flush。不要用无界微任务链实现调度。
3. 在接收并验证完整流之后合并显示更新，不能直接丢弃上游 chunk，破坏 attempt revision/index 连续性、持久事件或最终输出。队列必须有边界，结束前刷新最后状态。
4. 将稳定行宽验证缓存与 `liveStart` 的 scrollback 语义分开，保留 resize、主题、工具展开、CJK/emoji、pending 卡折叠和右 padding 的正确性。
5. roster 的持久事件采用增量 fold，保留 transient 覆盖以及恢复、替换、断序后的重建路径。把重复全历史回放限制在确实需要重建的时候。

验收首先检查工作量：相同 thinking 的 120 个 chunk 不再产生 120 次画面计算；连续真实变化在可控时钟下最多每个显示 tick 重绘一次。对上述 pending 长历史负载增加 fake-TTY 按键处理和定时器心跳测试，比较原路径与修复后路径。性能门槛建议以 100ms 内获得输入处理机会为初始目标，结合 CI 基线校准，不能用一次本机测量当最终承诺。

### 第二阶段：限制活跃执行和内存压力

增加覆盖 continuable 新建、冷恢复、嵌套委派及程序化调用的准入机制。优先寻找现有 Agent 创建的可强制准入接口；若已发布接口不能覆盖全部入口，应向上游补接口，不能只限制工具描述或依赖模型遵守提示。不能靠 `maxDepth` 或 jobs 的单独配置代替。

用 1、3、8 个活跃 Agent 的负载测量选择默认上限；任务可排队或明确拒绝，状态和取消必须可见。设计容量时区分执行槽和驻留 Agent：如果父 Agent 等待后代却占住全部执行槽，简单 semaphore 会引入新的嵌套等待死锁。必须覆盖取消排队任务、父任务结束、后代继续执行及冷恢复争用。

记录 chunk/s、实际 render/s、单帧耗时、事件循环延迟、活跃 attempt 数、实际驻留 Agent 数和 heap/RSS。需要区分原始 stream 保留、历史投影和界面 roster，不能按 done 数量推断内存泄漏。独立任务优先 fresh spawn，长历史 fork 另测启动时延和内存。

### 第三阶段：把交互终端与执行 runtime 隔离

由 `apps/omdsh` 拥有宿主启动、进程和配置编排；`packages/tui/omdsh-tui` 保留终端输入、渲染和视图交互；在 omdsh 自有插件中实现有类型的状态及命令桥，继续通过公开 npm 包使用 Harness。不要复制 continuation manager，也不要把 `refs/` 源码放进运行时。

桥接至少验证：初始快照和顺序增量、可见 session/inspector 切换、瞬态更新合并和有界队列、持久事件完整性、审批/问题关联、send_message/interrupt、断开及恢复、取消确认、正常退出和必要时强制终止后端进程树。后端阻塞时 TUI 应仍能显示状态、接收按键并由宿主执行退出策略；不能承诺卡住的 runtime 还能立即完成协作取消。

这个方案隔离的是 TUI 和整组 Agent，不能让后端每个子 Agent 自动获得独立 CPU 或故障域。如果第二阶段后仍采样到子 Agent 相互阻塞，再推进上游 continuable 执行接口的进程化扩展。

## 上游设计取舍与公开性能反馈

官方文档没有宣称进程内 delegation 没有性能风险。[spawn README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-spawn-in-process/README.md) 将适用条件写为允许在同一进程运行；[ACP README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-acp/README.md) 则建议需要进程隔离时选择 ACP，需要共享父级 composition 和能力时选择进程内后端。[SDK provider README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-dsh-sdk/README.md) 也明确提到每次运行启动新进程的成本。

从这些能力差异和源码可以推断，进程内设计降低了启动、插件装配和跨进程序列化成本，也便于保留父级策略及上下文、统一作用域和生命周期。这是工程取舍的解释，不是已找到的维护者原始决策陈述。模型推理发生在远程服务，Agent 的异步网络等待可重叠；本地同步计算和事件回调才争用同一事件循环。不能根据“多个 Agent”直接推导出“需要同等数量的 CPU 执行进程”。

官方仓库已有用户的一手性能报告：2026-08-18 的 [Discussion #3067](https://github.com/deepseek-ai/deepseek-harness/discussions/3067) 描述 `0.1.0-rc.6` 上 200 多个 continuable 子 Agent 使 Web UI 冻结；2026-08-29 的 [Discussion #5014](https://github.com/deepseek-ai/deepseek-harness/discussions/5014) 描述流式事件分发和客户端快照开销，作者报告本地批处理补丁缓解了卡顿；2026-09-02 的后续评论还报告后台会话通知在较新 alpha 版本中占满客户端主线程。这些是用户测量和用户补丁，不是维护者确认，也不能证明当前 rc.1 仍具有完全相同的问题。

当前参考源码已包含浏览器端按 animation frame 合并 stream 通知的 [Notifier](../refs/deepseek-harness/packages/api/session-controller/src/client/sessions/notifier.ts)，以及长会话续跑、子会话 catalog 和内存的[后端性能基线](../refs/deepseek-harness/.agents/notes/implemented/testing/2026-09-06-backend-continuation-performance.md)、[请求历史冻结优化](../refs/deepseek-harness/.agents/notes/implemented/simplification/2026-09-06-agent-request-freeze-provenance.md)。Web 浏览器渲染与 Node runtime 分开，但客户端事件风暴仍会造成浏览器自身卡顿。SDK 协议的缺项也不能推广成整个 Harness 没有远程交互接口：Web 使用另一个 session-controller/client 体系，其是否适合 omdsh 需要独立验证。

“每个 Agent 独立进程”提供更强的执行与故障隔离，但现有证据不足以把它认定为性能、维护成本和上游兼容性三者兼顾的唯一最优架构。选择它应以明确要求每个 Agent 独立故障域为依据，不能把此次 TUI 热点直接当作必须重写上游编排的证明。

## 验证边界

尚未取得两次故障完整日志，未执行 heap 分析、并发上限实验或进程隔离原型。没有验证修复后结果，没有修改生产源码、依赖、配置或 changelog。后续任何实现需要补回归测试、用户可见 changelog 和仓库要求的 TUI/TTY 检查；本报告的 Markdown 检查不能代替功能验证。
