# Agent 行为设置技术方案

状态：Language v1 已定稿并进入实现。

## 摘要

在 `/settings` 中增加独立的 `Agent` 分区，第一版只提供 `Language`。用户可以让 omdsh 默认使用简体中文或英文进行可受 prompt 影响的推理和面向用户的沟通，也可以保留 `Auto`，让模型继续根据对话与其他指令选择语言。

设置由 `apps/omdsh` 的产品插件拥有，通过 DeepSeek Harness 的 settings 和 system-prompt seam 生效。`packages/tui/omdsh-tui` 只负责展示、键盘交互和提交更新，不读取 settings 文件，也不通过隐藏用户消息、回复后处理或 TUI 私有状态改变模型行为。

## 决策

- 第一版只发布 `Language`，不为了填满分区而发布缺少可观察验收标准的行为旋钮。
- `/settings` 保留独立 `Agent` 分区；一个目标清楚的设置足以成立。
- UI 值为 `Auto`、`Simplified Chinese`、`English`，稳定存储值为 `auto`、`zh-CN`、`en`。
- Agent 行为使用独立的 `omdsh-agent` namespace，不写入终端外观所属的 `omdsh-tui`。
- 产品插件必须依赖 settings 和 system prompt；TUI 是可选绑定。没有 TUI 的 composition 仍然可以读取设置并生成 prompt。
- 设置从下一个 turn 生效。已经开始的 turn 使用开始时的设置快照，运行中的请求不会取消或重写。
- 用户自定义的 `complete: true` persona 若要支持该设置，必须显式引用 `{{omdsh_agent_behavior}}`；这是 Harness complete persona 语义带来的文档化兼容约束。

## 目标

- 在已绑定产品设置时提供 `General`、`Agent`、`Status line` 三个键盘可选分区。
- 将语言偏好持久化为用户级设置，对新会话、恢复会话和继承内置 preset 的进程内 subagent 生效。
- 通过 system prompt 影响模型生成，不污染用户消息、session events、transcript、导出内容或 prompt history。
- 保持默认行为和最终 system prompt 字节不变；用户未修改设置时不增加 token，也不破坏已有 KV cache 前缀。
- 保持 `/settings` 为产品自有界面，不开放任意插件注册设置行的公共接口。

## 非目标

- 不提供 TUI 界面本地化。第一版设置标签和说明仍使用英文。
- 不承诺模型不可见的内部推理严格使用指定语言；只能约束模型可受 prompt 影响的推理内容和面向用户的输出。
- 不翻译代码、标识符、命令、Tool 参数、日志、引用、文件内容或需要保留标准写法的技术术语。
- 不把模型、推理强度、权限、Plan mode、Agent preset、温度或 Provider 参数迁入 `Agent` 分区。
- 不允许语言设置放宽安全策略、权限要求、仓库规则或用户对当前任务的明确要求。
- 第一版不提供项目级或会话级覆盖；设置是当前用户的 omdsh 默认行为。

## 用户体验

`/settings` 顶部在产品绑定存在时显示三个分区。`Tab` 和 `Shift+Tab` 在分区之间切换，`Up`、`Down`、`Home` 和 `End` 只在当前分区内移动。`Agent` 分区采用与 General 普通循环项相同的交互：`Left`、`Right`、`Enter` 或 `Space` 切换当前值，不进入自由文本编辑器。

| Setting | Values | Default | Description |
|---|---|---|---|
| `Language` | `Auto`, `Simplified Chinese`, `English` | `Auto` | `Preferred language for reasoning and replies` |

`Auto` 不生成额外指令，因此未配置用户不会承担额外 token 成本，也不会因升级改变 Agent 的既有交流方式。

## 冻结的行为语义

`zh-CN` 生成以下完整 fragment：

> 主要使用简体中文进行推理和面向用户的沟通，包括回复、提问、计划、待办文字和子 Agent 简报。代码、标识符、命令、Tool 参数、日志、引用、文件内容和惯用技术术语在准确性需要时保留原文或标准写法。项目指令中明确规定语言时，遵循项目指令；若用户明确要求当前任务使用其他语言，以该要求为准。

`en` 生成以下完整 fragment：

> Use English as the primary language for reasoning and user-facing communication, including replies, questions, plans, todo text, and subagent summaries. Preserve code, identifiers, commands, tool arguments, logs, quotations, file contents, and conventional technical terms in their original or standard form when accuracy requires. Follow explicit language requirements in project instructions; if the user explicitly requests another language for the current task, follow that request.

`auto` 返回空字符串。语言设置是默认偏好，不是语言锁：项目指令中的明确语言规则仍然有效，用户对当前任务提出的翻译、双语或其他语言要求覆盖持久化偏好。安全、权限、Tool contract 和运行时约束始终保持其原有优先级。

Harness 不提供独立的“偏好优先级”机制；语言 fragment 是 system prompt 内容，而 `AGENTS.md` 等 workspace instructions 通常作为 user-role system reminder 注入。因此 fragment 自身明确要求遵循项目语言规则，同时允许用户当前请求覆盖持久化偏好。

## 持久化模型

产品插件注册 `omdsh-agent` namespace：

```yaml
omdsh-agent:
  language: zh-CN
```

Schema 为：

```ts
type AgentLanguage = 'auto' | 'zh-CN' | 'en'

interface AgentBehaviorSettings {
  language: AgentLanguage
}
```

Schema 默认值为 `auto`，拒绝未知枚举值。settings 文件中不存在 `omdsh-agent` 时解析为默认对象；外部编辑继续使用 Harness settings provider 的校验、热发布和 last-good-value 行为。

设置是用户级当前状态，不写入 session event，也不随 session 保存旧快照。恢复会话时使用当前用户偏好，因此历史回复与恢复后的回复可能使用不同语言。

## 模块与所有权

### 产品运行时

`apps/omdsh/src/agent-behavior.ts` 是 Cordis plugin，硬注入 `settings` 和 `systemPrompt`，并通过可选的 `ctx.inject(['tui'])` 挂载终端设置面。它负责：

- 注册并拥有 `omdsh-agent` schema。
- 将已提交设置投影为集中测试的 prompt fragment。
- 注册普通 persona 使用的全局 system-prompt section，以及 complete persona 使用的 prompt variable。
- 在 turn 开始时冻结当前 committed 值，并在 turn 结束后清除快照。
- TUI 存在时，将窄的 `get`、`update`、`watch` binding 交给 TUI。

插件由 `@agi-fans/oh-my-dsh/agent-behavior` 正式 package export 暴露。`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-system-prompt` 和 schema 包均为精确版本的直接依赖；运行时不从 `refs/` 或传递依赖路径加载实现。

### TUI

`packages/tui/omdsh-tui` 继续拥有设置 overlay、键盘导航和纯渲染。binding 类型声明在 TUI 包中，避免 TUI 反向依赖产品包；具体 schema 和 prompt fragment 仍由产品拥有。

`TuiService.bindAgentBehaviorSettings` 接受一个封闭 binding：

```ts
interface TuiAgentBehaviorSettingsBinding {
  get(): TuiAgentBehaviorSettings
  update(next: TuiAgentBehaviorSettings): Promise<void>
  watch(listener: (next: TuiAgentBehaviorSettings) => void): () => void
}
```

未绑定时不显示 Agent 分区，原有 General 与 Status line 两页行为保持不变。绑定后 TUI 可以乐观显示选择，但 prompt 始终读取 settings scope 的 committed 值；写入失败时 overlay 回滚到最后一次已提交值，并显示普通错误 notice。`General` 与 `Status line` 继续只更新 `omdsh-tui`，`Agent` 只更新 `omdsh-agent`。

## Prompt 集成

普通内置 persona 使用一个全局 section：

```text
name: omdsh:agent-behavior
order: 30
```

顺序 30 位于 persona 之后、order 50 的 Plan policy 之前。默认值产生空 section，render 时被丢弃。

Minimal preset 使用 `complete: true`，Harness 会在 assembly waterfall 后保留完整 persona 并抑制其他 section。产品因此始终注册合法变量名 `omdsh_agent_behavior`，默认严格返回 `''`，非空时返回带两个前导换行的 fragment。Minimal persona 直接追加变量且不预留空白：

```yaml
text: You are a helpful software engineer assistant.{{omdsh_agent_behavior}}
```

这样默认插值后的 persona 与升级前字节级相同；非默认设置才增加分隔和语言指令。普通 preset 不引用变量，避免与全局 section 重复。

用户自定义的 `complete: true` persona 不会被产品强行改写，也不会导致 assembly 失败；未引用变量时 Language 只是不生效。需要支持时，在 persona 文本末尾直接追加 `{{omdsh_agent_behavior}}`。

## 生效边界与数据流

在 `agent/pre-step` 第一次进入一个 turn 时，插件记录当前 settings scope 的 committed 值。同一 turn 后续 model step 复用该值，避免长任务执行中因外部编辑设置而中英混杂。`agent/status: idle` 或 agent dispose 时清除快照，因此已提交设置从下一个 turn 生效，运行中的请求不会取消或重写。

```text
$DSH_HOME/settings.yaml
          │
          ▼
Harness settings provider
          │ committed AgentBehaviorSettings
          ▼
apps/omdsh agent-behavior plugin
          ├──► optional TUI Agent tab ── update ──► settings scope
          │
          └──► turn snapshot ──► section / variable ──► model request
```

进程内 subagent 继承产品 composition，因此使用当前用户设置。其面向父 Agent 的简报也遵循 Language，因为简报会进入父 Agent 上下文。

## Cache、token 与失败处理

- 默认值不生成 prompt fragment，Minimal 默认插值也不增加空白，因此最终 system prompt 保持字节级不变。
- 非默认值在每次模型请求中增加一个固定 fragment；修改语言会改变 section 之后的 prompt prefix，可能降低该次请求的 KV cache reuse。
- prompt fragment 是 total function；所有 schema-valid 值都返回稳定字符串，变量永远返回字符串而不是 `undefined`。
- 外部文件校验失败时 settings provider 保留 last-good value。
- TUI 持久化失败时回滚并显示 notice，不会让未提交值进入 prompt。
- 产品 composition 若未挂载该插件，Minimal 的变量会在第一次严格插值时明确失败；这是 bundle 配置错误，不静默退回不一致行为。

## 测试与验证

纯逻辑测试覆盖 schema 默认值与未知值拒绝、变量名合法性、`auto` 空输出、两种冻结 fragment、turn 快照，以及 Minimal 默认字节不变。TUI 测试覆盖有无绑定的两种分区结构、三页正反向循环、分区内边界、语言循环、namespace 隔离、外部更新、失败回滚与 40/60/80 列 display-cell 布局。

Runtime 与 composition 验证需要确认普通 preset 只有一个 fragment、Minimal 通过变量获得同一 fragment、自定义 complete persona 未引用变量时不崩溃，以及新会话、恢复会话和进程内 subagent 使用当前用户设置。

最终运行仓库规定的完整验证集，并因为设置 overlay 键盘分区发生变化额外运行完整 raw-TTY smoke。依赖审计必须确认产品代码、lockfile 和 symlink 均不指向 `refs/`，三个 reference submodule 保持干净。

## 被否决的方案

### 同时发布 Reply detail 与 Progress updates

两者目前只有散文意图，没有能区分档位的冻结 prompt 和可观察验收。`Progress updates` 还可能意外改变 Tool 节奏、todo 使用和任务拆分，而不只是沟通频率。第一版不将其写入 schema、UI 或 prompt。

### 写入 `omdsh-tui` namespace

语言属于 Agent 行为而不是终端外观。复用 TUI namespace 会使无 TUI composition 无法表达行为，也会扩大跨包耦合和 whole-object 覆盖风险。

### 隐藏用户消息或回复后处理

隐藏消息会污染 history、context、compaction、export 和 resume 语义。后处理无法控制推理语言，还会破坏 Markdown、代码和引用，并使显示内容与 durable assistant event 不一致。

### 开放通用 `/settings` row registry

一个产品自有设置域不足以承诺第三方扩展接口。用户插件继续通过自身 command、`ctx.settings` 和 `ctx.tui.prompt` 编辑偏好。

## 后续候选

只有在每个档位都有冻结 prompt、可观察验收标准且不越过权限边界后，才考虑增加：

- `Reply detail`：应能在固定任务样例中区分解释密度，同时保持结果、风险、失败和验证信息完整。
- `Progress updates`：应只影响同一 assistant event 中的阶段说明，不改变 Tool 调用、todo、step 数或任务完整度。
- `Clarification style`：只能处理非关键歧义，不能替用户决定会显著改变结果的事项。
- `Verification`：只能在仓库和用户没有明确要求时设定最低倾向，不能弱化现有规则。

不计划加入权限、自主授权、代码风格、模型参数、Plan mode 或综合 personality preset。
