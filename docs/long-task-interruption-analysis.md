# 长任务静默停止与工具调用悬空技术报告

状态：产品侧静默收尾缺陷已修复，issue #6 的实际触发原因仍待报告者会话日志确认。

日期：2026-08-30

关联问题：[agi-fans/oh-my-dsh#6](https://github.com/agi-fans/oh-my-dsh/issues/6)

## 摘要

oh-my-dsh 存在过一个确定的 turn 收尾缺陷：当模型响应达到单次请求的输出 token 上限时，DeepSeek Harness 会出于安全原因拒绝执行可能被截断的工具调用，并以 `max-tokens` 结束当前 turn；TUI 已经根据流式 `tool-call-delta` 显示了工具卡片，却没有在 `turn/end` 时删除未派发的预览，也没有展示截断原因。最终界面会同时出现 `idle` Agent 和永久处于 `running` 的工具卡片，用户看到的效果是“工具调用已经写出来但没有执行，任务自动停了”。发送“继续”会开启新 turn，模型因此可能重新发出完整工具调用。

这一机制与 issue #6 的症状高度一致，并已通过真实 session event 形态稳定复现，但不能据此断言报告者的每次故障都由 `max-tokens` 引起。修复后的产品保留 adapter 拥有的模型目录和精确模型元数据，把官方公布的 384K max output 设为 provider fallback，替代旧的 256K fallback；同时正确收尾 TUI 状态并持久展示结束原因。频繁截断仍需要报告者的持久会话事件证明，并检查服务端实际限制和用户设置覆盖。修复不能执行已被截断的工具参数，也不会在产品层无界自动发送“继续”。

## 影响

确定受影响的场景是模型在流式输出工具调用参数时以 `finish_reason: "length"` 结束。工具可以是 `bash`、读写文件或任何原生 tool call，工具名称并不影响机制。工具参数越长，截断落在参数中的机会越大，但累计运行时长本身不是触发条件。

修复前，用户可能观察到：

- 工具卡片已经出现，参数可能只显示到一半，但没有真实执行结果。
- Agent 活动状态结束，composer 可以继续输入，工具卡片仍显示为运行中。
- transcript 没有 token 上限、截断或工具未执行的说明。
- `/trajectory` 也看不到 `max-tokens` 结束原因。
- 发送“继续”后，模型可能在新 turn 中重新生成并执行该工具调用。

该缺陷不会导致被截断的工具参数被误执行。Harness 的安全判断是正确的，问题在于产品表面没有把“预览过但未派发”和“已经派发、正在执行”区分清楚。

## 调查范围与证据

本报告使用以下证据交叉验证：

- 检查 issue #6 的问题描述与后续评论。
- 检查当前安装的 DeepSeek Harness npm 版本 `0.1.1-rc.2`，并对照只读的 `refs/deepseek-harness` 上游源码。
- 使用 `applyEvent` 和 `replayEvents` 重放真实形态的 `assistant/chunk`、`assistant/message` 和 `turn/end` 事件序列。
- 统计本机 `$DSH_HOME` 下 366 个持久会话的 turn 结束原因和工具派发配对。
- 通过 Herdr 让 OMP 独立检查相同问题，再核对双方分歧。
- 对照 Pi 对输出上限截断工具调用的处理方式。

本机样本包含 335 个已结束 turn：318 个 `completed`、13 个 `aborted`、3 个 `error` 和 1 个 `interrupted`；没有 `max-tokens`，也没有流式展示后未派发的工具调用。该样本说明本机历史中没有 issue #6 的决定性事件，不能替代报告者日志，也没有发现 Harness 普遍随机丢失已完成工具调用的证据。

## 已确认的原因链路

### 1. Provider 报告输出上限

DeepSeek API 的 `finish_reason: "length"` 被适配器映射为 Harness 的 `{ kind: 'max-tokens' }`。这是一次模型响应的结束原因，不是任务总运行时长计时器。

### 2. Harness 丢弃不安全的工具调用

`BlockAssembler` 在 `max-tokens` 结束时从最终 `assistant/message` 中过滤全部 tool-call block。流式阶段积累的 JSON 即使能够被宽松解析，也可能只是合法但不完整的参数；禁止执行是必要的安全约束。参考 [`BlockAssembler.assembled`](../refs/deepseek-harness/packages/llm/llm/src/assembler.ts)。

### 3. Agent loop 在工具派发前结束

Agent loop 先持久化已过滤的 `assistant/message`，随后检查 finish reason。遇到 `max-tokens` 时直接返回该 turn 结果，只有正常完成路径才会提取 tool calls 并进入 `executeToolCalls`。因此该预览不会产生 `tool/call` 或 `tool/result` 事件。参考 [`ReactLoopAgent.step`](../refs/deepseek-harness/packages/core/agent-loop/src/agent.ts)。

### 4. TUI 保留了流式工具预览

TUI 在收到 `tool-call-delta` 时创建 `status: 'running'`、`partial: true` 的工具 block。正常情况下，后续 `tool/call` 和 `tool/result` 会把它升级为真实调用并收尾；`max-tokens` 路径没有这些事件。

修复前的 [`turn/end` 投影](../packages/tui/omdsh-tui/src/views/event-views.ts)只为 `error` 和 `aborted` 添加可见反馈，没有处理 `max-tokens`、`blocked` 或 `interrupted`，也没有删除 preview-only tool block。投影随后把 transcript 状态设置为 `idle`，形成内部状态一致但产品语义错误的组合：Agent 已结束，工具仍显示运行中。

### 5. “继续”开启新的生成机会

截断的 tool call 已经从持久化的最终 assistant message 中移除。用户发送“继续”后，Agent 开启新 turn；模型读取此前保留的文本、工具上下文和新消息，可能重新发出同一工具调用。这个行为解释了“继续后工具才执行”，但不保证每次都生成完全相同的调用。

事件链路如下：

```text
DeepSeek SSE: tool-call-delta
          │
          ├──► TUI 创建 partial + running 工具卡片
          │
          ▼
finish_reason: length
          │
          ▼
BlockAssembler 丢弃截断的 tool-call
          │
          ▼
assistant/message 不含 tool-call
          │
          ▼
turn/end: max-tokens ──► Agent idle
          │
          └──► 修复前：TUI 未收尾 partial 工具卡、未显示原因
```

## 复现结果

使用以下事件形态重放即可稳定复现，不需要真实网络请求：

1. `turn/start`。
2. `assistant/chunk` 携带未完成的 `tool-call-delta`。
3. `assistant/message` 的 `content` 为空或只保留安全的文本／推理 block。
4. `step/end`。
5. `turn/end` 的 reason 为 `max-tokens`。

修复前的终态为：

```text
transcript.status = idle
tool.status       = running
tool.partial      = true
visible notice    = none
```

取消路径也存在过同族缺陷：`aborted` 会显示 `interrupted`，但 preview-only 工具 block 仍可能保持 `running`。因此旧的 Esc 误取消问题可以制造相似画面，不过 issue #6 描述的“长任务后出现、没有中断提示、继续后恢复”更符合 `max-tokens` 路径。

## 为什么 issue #6 仍需日志确认

OMP 的独立检查最初将频率归因于约 4K 的默认输出上限，复核当前 rc.2 安装包后否决了该推断。修复前的链路是：DeepSeek adapter 默认 `maxTokens` 为 256,000，内置 DeepSeek 模型没有 catalog override，LLM runtime 会将 adapter default 注入 prepared call，最终请求携带 `max_tokens: 256000`。

产品现在在 `apps/omdsh/config/cordis.yml` 配置 provider fallback `maxTokens: 384000`，不再提供会整体替换 adapter 目录的 `models` 数组。截至 2026-08-30，DeepSeek 官方的 [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) 和 [Pi integration](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono/) 对当前三个内置 V4 模型给出相同的 1M／384K 上限。adapter 将精确模型 `maxTokens` 放在 provider fallback 之前，因此未来上游模型可以携带不同上限，新增模型也会继续出现在 `/model`；用户设置和非内置 profile 仍可能覆盖该值。

因此，issue #6 若一晚多次触发 `max-tokens`，还需要至少一个额外条件：

- 服务端按模型能力把请求值钳制到更低的真实输出上限，并以 `length` 结束。
- 用户在 `$DSH_HOME/settings.yaml` 中配置了更低的 `llm-deepseek.maxTokens`。
- 某一步确实生成了非常长的 reasoning、文本或工具参数。
- 另一个 provider profile 使用了更低的输出上限。

这些条件目前都没有报告者侧证据。机制缺陷已经确定，issue 归因仍应表述为“最高优先级候选”，不能写成已确认事故原因。

报告者可以对发生问题的 session 文件做不包含消息正文的检查：

```sh
zstd -dc ~/.dsh/sessions/<workspace>/<session>/session.jsonl.zstd \
  | jq -c 'select(.type == "turn/end" and .data.reason.kind == "max-tokens") | {seq, time, turn: .data.turn, reason: .data.reason}'

rg -n 'maxTokens' ~/.dsh/settings.yaml
```

若第一条命中，应继续核对同一 turn 是否出现 `tool-call-delta` 且没有对应的 `tool/call`。若没有 `max-tokens`，应按 turn 的实际结束原因重新分类，而不是根据截图推断。

## 其他可能的中断路径

| 路径 | Harness 结果 | 当前可见性 | 与 issue #6 的匹配度 |
|---|---|---|---|
| 输出 token 上限 | `turn/end: max-tokens`，不执行截断工具调用 | warning 说明原因，清除未派发预览，并记录到 `/trajectory` 和终端通知 | 高，但待报告者日志确认 |
| 用户取消，包括 Esc／Ctrl-C | `turn/end: aborted` | 显示 `interrupted` 并清除未派发预览 | 与已发生的 subagent inspect 误触相关，不足以解释无人操作的 issue #6 |
| Provider 流空闲 | 300 秒 idle watchdog，默认最多重试 5 次，最终 `TIMEOUT` | 重试和最终 error 均可见 | 低；可能总计约 30 分钟，但不是静默停止 |
| Pre-step 拒绝 | `turn/end: blocked` | transcript 和 `/trajectory` 显示 warning | 次要诊断路径，通常不会先产生工具预览 |
| 异常退出后修复 | `turn/end: interrupted` | transcript 和 `/trajectory` 显示 warning，并清除未派发预览 | 只发生在崩溃或非正常退出后的恢复，不是 live 自动停止 |
| 工具自身超时 | 产生工具结果，标记 timeout 或 error | 工具输出可见，Agent 可以继续下一步 | 不符合“调用未执行且无结果” |
| 审批不可用或冲突 | fail closed，返回拒绝结果 | 应显示 prompt 或工具失败结果 | 不符合“发送继续后执行” |
| Context overflow／compaction 失败 | 重试或结构化 error | 应有 retry/error | 与长任务相关，但不是静默结束 |
| Subagent settlement 未唤醒父 Agent | 尚无当前 rc.2 的可达复现 | 取决于父子 Agent 状态 | 独立候选，不应在缺少日志时并入 issue #6 |

oh-my-dsh 没有“任务运行 30 分钟后取消”的全局计时器。接近 30 分钟的组合仅是 Provider 连续 5 分钟无流数据、初始请求加 5 次重试的极端情况；该路径会产生 `llm/retry` 和最终 `TIMEOUT`，与静默 `max-tokens` 的持久事件不同。

## 为什么没有触发 compaction

Harness 的 compaction 和 `max-tokens` 处理的是两个不同预算。compaction 在下一次 model step 之前检查已经占用的输入 context；`max-tokens` 则是当前 model step 在生成响应时触及输出上限后的结束原因。即使当前输入远低于 1M context window，一次响应仍可能独立达到 384K max output，因此不会先触发 compaction。

compaction 也不能补救已经截断的当前响应：它只能压缩下一次请求携带的历史，不能在同一个 SSE 响应结束后恢复缺失的工具参数。Pi 的恢复策略不是因此触发 compaction，而是把截断的 tool call 转成不可执行的结构化失败，再让 agent loop 获得一次重新生成完整调用的机会。当前 Harness 没有向产品插件暴露等价 contract，所以本次修复选择安全收尾和明确提示，不伪造自动续跑。

## 修复目标

- 任何 turn 结束后，TUI 都不得保留没有真实 `tool/call` 支撑的运行中工具卡片。
- `max-tokens` 必须作为独立、持久、可回放的 warning 展示，不能伪装成正常完成或普通 provider error。
- 已生成的安全文本和 reasoning prefix 必须保留；只有可能截断的工具调用预览被删除或明确标记为未执行。
- live folding、session replay、resume 和 `/trajectory` 必须从同一 durable reason 得到一致结果。
- 不执行、不修补、不猜测截断的工具参数。
- 默认修复不自动制造新的模型 turn，避免无限续写、额外费用和 durable history 语义变化。

## 修复实现

### 已完成：修正 transcript 的 turn 收尾投影

`packages/tui/omdsh-tui/src/views/event-views.ts` 已为 turn 结束建立完整的 reason projection：

- `completed`：正常收尾，不增加 notice。
- `max-tokens`：删除所有 `partial: true` 的工具预览，保留已生成的 assistant 文本／reasoning，并追加 warning notice。
- `aborted`：删除 preview-only 工具 block，保留或标记已交付的 assistant prefix，继续显示 `interrupted`。
- `interrupted`：按异常恢复处理 preview-only block，并展示与主动取消不同的说明。
- `error`：保持现有失败 attempt 清理和结构化 error notice。
- `blocked`：进入 transcript 和 `/trajectory` 的 warning 投影。

每个 `turn/end` 都会清理没有对应 durable `tool/call` 的 preview，包括畸形但标记为 `completed` 的事件序列。已经产生 `tool/call` 但没有 `tool/result` 的工具不会被删除，而是保留调用记录、结算为 error，并明确说明没有 durable result、执行结果未知；这既避免永久 running，也不把未知外部副作用误报为未执行。

当前工具截断文案为：

> Output token limit reached. A partial tool call was not executed because its arguments may be incomplete. Send “continue” to resume.

notice 使用 warning 语义而不是 error，也不写入 token 数字，因为 `turn/end` 不携带服务端实际限制。

清理 helper 同时重建 `toolByCallId` replay index，且只移除 preview-only 工具 block。实现没有复用会删除 streaming assistant 的 retry 清理逻辑，因此已经安全交付的文本会被保留。

### 已完成：增加真实事件序列回归测试

回归测试已覆盖：

- tool-only 响应在 `max-tokens` 后变为 idle、没有 running／partial 工具 block，并出现 warning。
- 文本加 tool-call 的混合响应保留文本，只删除工具预览。
- `aborted` 和 `interrupted` 不遗留 running 工具预览。
- 非末尾的已派发 running 工具结算为 error，不会从审计轨迹中消失。
- 畸形 `completed` 日志中的未派发 preview 也会被清除。
- `applyEvent` 与 `replayEvents` 得到相同 blocks，恢复会话后提示仍存在。
- warning notice 在有色和无色主题中的语义投影。

### 已完成：补齐 `/trajectory` 和终端通知的结束原因

[`TrajectoryLedger`](../packages/tui/omdsh-tui/src/views/trajectory.ts)现在记录 `max-tokens`、`blocked`、`interrupted`、`error` 和 `aborted`，并保留原始 reason payload，使用户无需读取 JSONL 即可区分：

- 模型输出被截断。
- 输入在进入 step 前被拒绝。
- 会话由持久层修复为异常中断。
- 用户主动取消。
- Provider 或运行时错误。

`max-tokens` 使用 warning 状态，不与普通 error 合并；history replay 和 live append 使用同一 ledger 逻辑。terminal notification 也从 `event.data.reason.kind` 读取真实结束原因，不再把非成功 turn 报告为 completed，并把 durable reason 映射为 `Output token limit reached`、`Turn was blocked`、`Session was interrupted` 等可读文案。

`interrupted` 不是未使用的防御枚举：session repair 会在加载崩溃时仍处于 open 状态的 turn 时写入该 reason，参考 [`interruptedTurnClosers`](../refs/deepseek-harness/packages/core/session/src/repair.ts)。

### 待推进：扩展 issue 诊断信息

- issue 模板应请求 omdsh 版本、provider/model、session id、最后一个 `turn/end.reason`、相关 `llm/retry` 记录以及 `maxTokens` 覆盖，但不要求公开消息正文、工具参数或凭据。
- 可以在 `/trajectory` detail 中显示 request 的有效 `maxTokens` 来源是用户值还是 adapter default；不要从 usage 反推服务端限制。

### 待上游 contract：安全的自动续跑

第一版不建议在产品层遇到 `max-tokens` 就无条件自动发送“继续”。该行为可能产生无限续写、额外费用、重复副作用和难以解释的 durable synthetic messages。`agent/turn-stopping` 当前也不直接携带 turn ending reason，产品插件不能仅靠该 hook 稳定识别 `max-tokens`。

若要提供无人工介入的恢复，优先向 DeepSeek Harness 上游提出显式 contract：保留截断工具调用的身份但绝不执行，为每个调用生成结构化错误结果，告诉模型参数可能不完整并要求重新发出完整调用。Pi 采用的就是这种策略，参考 [`failToolCallsFromTruncatedMessage`](../refs/pi/packages/agent/src/agent-loop.ts)。这能让模型在同一驱动循环中安全重试，同时避免把截断参数当成有效工具输入。

在上游 contract 可用前，oh-my-dsh 应保持“提示原因，由用户决定是否继续”的保守行为。上游 Web 对 `max-tokens` 的处理也只增加持久提示并指导发送“continue”，没有自动发起新 turn，参考 [DeepSeek Harness max-tokens notice fix](https://github.com/deepseek-ai/deepseek-harness/commit/e4ca03cb852bbd44119343cce83509691089ce66)。

### 单独调查：subagent 唤醒

父 Agent 未在 subagent 完成后继续的问题需要独立会话证据，不应通过 max-token 修复顺带猜测。当前 rc.2 对 parent registry lookup、settlement watcher、accepted inbox 和 wake latch 的静态检查没有得到稳定可达复现。

后续复现应同时记录：

- 父、子 Agent 的 `agent/status` 时间线。
- subagent settlement 事件及 parent session id。
- 父 Agent inbox 的 inserted、claimed、discarded 和 spliced 事件。
- 父 Agent 是否处于 running、maintenance、aborted 或 disposed。
- inspect overlay 的 Escape 输入是否转化为顶层 interrupt。
- background／continuable dispatch、in-process driver 和 closing teardown 分支。

只有在能证明 settlement 已产生但 wake 或 inbox admission 丢失后，才应修改 subagent 生命周期；否则容易把用户取消、UI inspect 状态和真正的父子 Agent 竞态混为一谈。

## 不推荐的方案

### 直接执行截断的工具调用

参数可能是合法但不完整的 JSON，执行可能导致错误路径、错误文件内容或破坏性副作用，必须禁止。

### 仅提高 `maxTokens`

provider fallback 已改用官方公布的 384,000 上限，但这只能减少因 stale fallback 造成的截断，不能修复错误状态和缺失诊断；精确模型和用户配置仍可覆盖它，服务端也可能按模型能力或剩余 context 钳制。

### 把 `max-tokens` 当成普通 error

它不是 Provider 故障，已经生成的安全输出应保留。产品需要 warning 和恢复说明，而不是让用户误以为请求失败或凭据异常。

### 只修 live UI

只在 terminal controller 中隐藏卡片会让 replay、resume、export 和 `/trajectory` 继续不一致。修复必须位于纯 session-event projection，并由 durable `turn/end.reason` 驱动。

## 验收结果

- 给定确定的 max-token 事件序列，live 和 replay 都不会显示运行中的工具调用。
- 用户能在 transcript 和 `/trajectory` 中识别输出 token 截断，并知道工具未执行。
- 已交付的文本／reasoning prefix 保留，截断工具参数不进入执行层。
- 已派发但没有 durable result 的工具保留调用记录、结算为 error，并明确标记结果未知。
- `completed`、正常工具调用、重试恢复和 error 路径无回归。
- `aborted`、`interrupted` 不遗留错误的 running 卡片。
- session resume 后提示和终态与退出前一致。
- 修复不修改 `refs/`，不引入对 reference repository 的运行时或构建依赖。

本次实现通过了 `pnpm install`、全工作区 typecheck、725 项测试、全工作区 build、`pnpm check:md`、`pnpm smoke:happy`、PTY `pnpm smoke`、`pnpm check:boundaries` 和 `git diff --check`。使用当前产品入口和受管凭据发送的最小真实 DeepSeek 请求成功返回，确认服务端接受配置的 384K output fallback。reference repositories 保持只读且工作树洁净，产品依赖和符号链接均未指向 `refs/`。

## 结论

`max-tokens` 时“工具未执行”是 Harness 的正确安全行为；“工具仍显示运行中、Agent 静默停止、诊断面看不到原因”是 oh-my-dsh 的确定缺陷。产品侧现已修复该缺陷，即使 issue #6 最终由另一条路径触发，这项修复仍然成立。

issue #6 的归因需要报告者 session 中的 `turn/end: max-tokens` 才能定案。与此同时，用户取消、blocked、异常恢复和 subagent 唤醒应分别按自己的 durable reason 和生命周期证据处理，避免用一个表面相似的“停住了”合并多个不同故障。
