# omdsh 与 oh-my-pi 功能差距盘点

> 状态快照：2026-08-14  
> 对比范围：omdsh 的交互式 TUI、Coding Agent 工作流及其与 DeepSeek Harness 插件能力的连接情况。

## 结论

omdsh 的终端交互外壳已经比较完整：TTY/pipe 双模式、差分渲染、流式消息、多行编辑、历史搜索、补全、鼠标操作、设置和基础工具展示均已可用。

与 oh-my-pi 相比，主要差距已经不在视觉样式，而在以下三个层面：

1. **产品工作流不足**：缺少 session 恢复、模型切换、审批与提问、compaction、goal、todo、subagent 等 Coding Agent 常用流程。
2. **插件能力没有接入 TUI**：DeepSeek Harness 已经提供 command、session persistence、approval、questions、model selection、goal、jobs、subagent 等插件，但当前 composition 和 TUI service 尚未消费这些能力。
3. **TUI 内部仍有硬编码边界**：slash commands、transcript block、工具 renderer 和设置项主要由 omdsh 自己静态定义，尚未形成真正的 UI contribution/plugin registry。

因此，不建议逐个复刻 oh-my-pi 的命令和内部 domain model。更合适的方向是先把 omdsh 建设为 DeepSeek Harness 各插件面的通用终端 adapter。插件挂载后，命令、状态、交互和展示应能自动进入 TUI，这才符合“一切皆插件”的设计目标。

## 当前能力矩阵

| 领域 | 当前状态 | omdsh 当前能力 | 相比 oh-my-pi 的主要差距 |
| --- | --- | --- | --- |
| 启动与运行 | 已具备 | Cordis composition、TTY/pipe 模式、DeepSeek 模型与凭据、本地 sandbox/bash | CLI 模式和运行形态较少 |
| 终端渲染 | 较完整 | 差分刷新、同步输出、SIGWINCH 重排、ANSI/宽字符处理、虚拟滚动、鼠标滚轮 | 没有 oh-my-pi 的 native scrollback settled-row 体系 |
| 欢迎页 | 部分具备 | DeepSeek Logo、Tips、模型信息、响应式布局 | Recent sessions 为静态占位；没有真实 session 和 LSP 状态 |
| 用户消息 | 已具备 | 用户气泡、背景色、自动换行 | 缺图片和附件消息 |
| Agent 回复 | 基础完整 | 流式正文、reasoning、Markdown、左右边距、错误 notice | 缺图片、provider error banner、流式速率和更精细的 reveal 状态 |
| Markdown | 部分具备 | 标题、强调、删除线、链接、代码、列表、任务列表、引用、表格、分隔线 | 缺语法高亮、LaTeX、Mermaid、HTML 规范化和终端图片协议 |
| 工具调用 | 基础可用 | 通用工具框、running/ok/error 状态、JSON 参数、输出折叠、Ctrl+O | 缺按工具类型定制的 call/result renderer、diff、文件链接和流式参数 |
| 输入编辑器 | 较完整 | 多行输入、历史、撤销、kill ring、yank、单词移动、括号粘贴、点击定位 | 缺外部编辑器、图片粘贴、raw paste 和可配置快捷键 |
| 补全 | 基础完整 | slash、slash 参数、`@`、相对/绝对路径、Tab 和鼠标选择 | 命令源为静态列表；没有 skill/file/plugin 动态命令 |
| 历史搜索 | 部分具备 | Ctrl+R 搜索当前进程输入历史 | 无跨进程持久化、session transcript 搜索和全局 session 搜索 |
| 设置 | 部分具备 | dark/light、颜色开关、默认展开工具输出，并写入 Harness settings | 设置项和主题数量很少；不支持自定义主题和 keybindings |
| Slash commands | 较少 | 8 个本地命令：help、settings、hotkeys、copy、tools、pwd、clear、quit | oh-my-pi 当前定义约 70 个顶级内置命令，且还有动态命令来源 |
| Session | 基本缺失 | 每个进程创建一个随机 session | 无 persistence、resume、new、fork、branch、tree、rename、compact |
| 模型选择 | 启动时可用 | CLI/env/settings 决定初始 provider/model | 无会话内 model/provider/effort 选择 |
| 审批与提问 | 缺失 | 默认 trusted-local sandbox | 无 approval、ask-user、选项表单和 plan-review UI |
| 状态与用量 | 基础完整 | `🐳` 输入框标题、模型、idle/running、cwd、git branch；下边框状态标签显示轮次/步骤、LLM/工具耗时、TTFT、token rate、缓存命中和输入/输出 token | 尚无 cost、jobs、goal、subagent 和 compaction 状态 |
| 多模态 | 缺失 | 仅文本输入和文本 transcript | 无图片粘贴、附件、图片消息和图片工具结果 |
| Agent 工作流 | 大量缺失 | bash、skills、jobs 等 spine 基础能力可被模型调用 | 无 plan/goal/todo/subagent/MCP 等完整人机交互入口 |
| TUI 扩展性 | 外层插件化 | TUI service、local provider、runner 都是 Cordis 插件 | commands、blocks、tool renderers、settings 尚未形成 contribution seam |

## 已经完成的能力

### 运行与 composition

当前应用通过 [`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml) 挂载：

- DeepSeek LLM adapter；
- Harness settings 和 credentials；
- agent registry/default model；
- local sandbox、filesystem、subprocess 和 bash executor；
- `dsh-agent-spine-demo`；
- omdsh TUI provider 和 runner。

命令行支持一个初始 prompt、`--model`、`--provider`、`--help` 和 `--version`，实现见 [`apps/omdsh/src/args.ts`](../apps/omdsh/src/args.ts)。

### Transcript 与渲染

[`packages/tui/omdsh-tui/src/event-views.ts`](../packages/tui/omdsh-tui/src/event-views.ts) 当前处理：

- `turn/start`、`turn/end`；
- 人类来源的 `user/message`；
- `assistant/chunk` 的正文和 reasoning delta；
- settled `assistant/message`；
- `tool/call`、`tool/result`；
- turn error 和 aborted notice。

其余 session vocabulary 当前进入默认分支，不显示在 TUI，包括 usage、compaction、approval 等扩展事件。

[`packages/tui/omdsh-tui/src/renderer.ts`](../packages/tui/omdsh-tui/src/renderer.ts) 提供 ANSI 差分输出；[`packages/tui/omdsh-tui/src/provider-local.ts`](../packages/tui/omdsh-tui/src/provider-local.ts) 负责 raw mode、同步刷新、resize、鼠标、滚动和非 TTY 降级。

### 编辑与补全

[`packages/tui/omdsh-tui/src/editor.ts`](../packages/tui/omdsh-tui/src/editor.ts) 已支持：

- 多行输入和垂直光标移动；
- Home/End、Ctrl+A/Ctrl+E；
- word-left/word-right；
- backward/forward word delete；
- kill ring、yank、yank-pop；
- undo；
- jump-to-character；
- 双 Ctrl+C 退出并打印恢复命令、Ctrl+D、Ctrl+Z 和 display reset。

[`packages/tui/omdsh-tui/src/autocomplete.ts`](../packages/tui/omdsh-tui/src/autocomplete.ts) 和 [`packages/tui/omdsh-tui/src/path-complete.ts`](../packages/tui/omdsh-tui/src/path-complete.ts) 已支持 fuzzy slash completion、slash 参数提示，以及 `@`、`./`、`../`、`~/` 和绝对路径补全。

### 当前本地命令

当前命令静态注册于 [`packages/tui/omdsh-tui/src/autocomplete.ts`](../packages/tui/omdsh-tui/src/autocomplete.ts)：

| 命令 | 能力 |
| --- | --- |
| `/help` | 显示本地命令 |
| `/settings` | 打开 TUI 设置 |
| `/hotkeys` | 显示快捷键 |
| `/copy` | 选择或直接复制回复、代码块和 bash 命令 |
| `/tools` | 显示当前 agent 可见工具 |
| `/pwd` | 显示 cwd、branch 和 model |
| `/clear` | 仅清除本地 transcript 显示 |
| `/quit` | 退出应用 |

`/clear` 当前不会清除模型会话上下文，这一点与 oh-my-pi 的 conversation clear 语义不同。`/dirs` 目前只是 `/pwd` 的别名，也不等同于 oh-my-pi 的 multi-root workspace 管理。

## 缺失能力与优先级

### P0：建立 Harness 插件接入层

#### 1. 通用 command adapter

当前 slash command 的目录、补全和执行逻辑由 TUI 自己硬编码。应改为消费 Harness 的 `@deepseek-ai/dsh-commands`：

- 从当前 agent scope 获取命令目录；
- 动态刷新插件注册/卸载后的列表；
- 使用统一的命令执行与取消协议；
- 将直接结果显示为 notice/command block，而不是提交给模型；
- 保留少量纯 UI 命令，但也通过同一个 contribution seam 注册。

Harness 参考：[`refs/deepseek-harness/packages/interaction/commands/README.md`](../refs/deepseek-harness/packages/interaction/commands/README.md)。

oh-my-pi 会合并 builtin、skill、file、extension 和 MCP 等命令来源，参考 [`refs/oh-my-pi/packages/coding-agent/src/slash-commands/available-commands.ts`](../refs/oh-my-pi/packages/coding-agent/src/slash-commands/available-commands.ts)。omdsh 不需要复制这些来源，但需要达到“插件注册即可发现”的效果。

#### 2. Session persistence、query 与恢复

runner 当前在每次启动时使用随机 ID 创建新 session，见 [`packages/tui/omdsh-tui/src/runner.ts`](../packages/tui/omdsh-tui/src/runner.ts)。composition 未挂载 persistence/query，因此欢迎页的 Recent sessions 只是静态占位。

需要接入：

- `dsh-session-persistence-jsonl` 或 SQLite backend；
- session query/listing；
- session projection、title 和 stats；
- create/resume 入口；
- recent session selector；
- crash recovery；
- 后续 fork/tree/rename/delete 能力。

Harness 参考：[`refs/deepseek-harness/packages/session/session-persistence-jsonl/README.md`](../refs/deepseek-harness/packages/session/session-persistence-jsonl/README.md)。

#### 3. Approval 与 user questions provider

当前 composition 使用 local sandbox，但没有 TUI answerer/provider。需要实现：

- approval request 卡片；
- allow-once/reject/cancel；
- 通用单选、多选和自定义答案问题；
- abort 和 teardown；
- `plan-review` presentation intent；
- 等待人类输入时接管 composer，完成后恢复编辑器。

Harness 已有固定 service definition：

- [`refs/deepseek-harness/packages/interaction/user-approval/README.md`](../refs/deepseek-harness/packages/interaction/user-approval/README.md)
- [`refs/deepseek-harness/packages/interaction/user-questions/README.md`](../refs/deepseek-harness/packages/interaction/user-questions/README.md)

#### 4. Workspace context

当前 [`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml) 明确配置 `workspaceContext: false`。这意味着 agent 不会通过 Harness 的 agent-instructions provider 自动读取项目指令。

应为交互式 coding agent 配置合理的 workspace context 字节预算，并验证：

- 项目级 Agent Instructions/AGENTS.md；
- 嵌套目录规则；
- runtime context 与 skill catalog 的顺序；
- 大仓库下的截断行为。

### P1：补全 Coding Agent 核心体验

#### 1. Tool renderer registry

当前所有工具共用一个通用输出框，只展示工具名、序列化参数、状态和文本输出。应建立 name/capability keyed renderer registry，并支持插件贡献 renderer。

首批建议：

- **bash**：命令、cwd、exit code、timed out、实时输出；
- **read/write/edit/apply_patch**：路径、范围、diff 和修改统计；
- **grep/glob**：文件分组、匹配数和可点击路径；
- **todo/goal/jobs/subagent**：领域状态组件；
- **ask-user**：交互组件；
- generic fallback：未知插件工具仍然可读。

同时需要支持：

- streamed/partial arguments；
- partial result；
- call/result 合并；
- per-tool expand；
- 图片和结构化 result；
- renderer 出错时安全回退。

oh-my-pi 的 registry 参考：[`refs/oh-my-pi/packages/coding-agent/src/tools/renderers.ts`](../refs/oh-my-pi/packages/coding-agent/src/tools/renderers.ts)。

#### 2. 会话内模型选择

当前 model/provider 只在进程启动时确定。应消费 Harness 的 model directory/selection seam，提供：

- `/model`；
- provider/model 两级选择；
- reasoning/effort 选择；
- 不影响当前进行中的 step，下一次请求生效；
- model 路由失败和目录刷新状态；
- status line 与真实 selection 同步。

Harness 参考：[`refs/deepseek-harness/packages/client/ui-model-selection/README.md`](../refs/deepseek-harness/packages/client/ui-model-selection/README.md)。

#### 3. Context、usage 与运行状态

已接入 Harness `sessionStats`、`tokenUsage` 和 `contextPressure` whole-log projections；输入框下边框状态标签已展示：

- input/output/cache token；
- token rate、turn、step、LLM/tool 时间和平均首 token。

剩余差距是 context 占用/阈值、当前 jobs、goal、subagent、compaction 状态/checkpoint 与 cost。

oh-my-pi 的状态栏 preset 参考：[`refs/oh-my-pi/packages/coding-agent/src/modes/components/status-line/presets.ts`](../refs/oh-my-pi/packages/coding-agent/src/modes/components/status-line/presets.ts)。

#### 4. Session 生命周期命令

command adapter 和 persistence 完成后，优先暴露：

- `/new`；
- `/resume`；
- `/compact`；
- `/retry`；
- `/session`；
- `/model`；
- `/goal`；
- `/todo`。

其中 `/compact` 不应由 TUI 自己总结历史，应挂载并调用 Harness 的 compaction command/backend，参考 [`refs/deepseek-harness/packages/compaction/command-compact/README.md`](../refs/deepseek-harness/packages/compaction/command-compact/README.md)。

#### 5. 第一方 Coding Agent 工具

当前 spine 主要提供 bash、skills 和 jobs 等基础能力。若产品目标不仅是“用 bash 完成一切”，还应按需挂载 Harness 的第一方插件：

- fs/read/write/edit 类工具；
- todo；
- goal；
- ask-user；
- subagent；
- plan mode；
- MCP；
- session query。

这些工具应通过 composition 决定是否存在，TUI 只消费它们公开的 service/event/renderer contract。

### P2：交互与视觉补全

#### 输入与快捷键

- 外部编辑器；
- 图片粘贴和图片-only prompt；
- raw clipboard paste；
- 复制当前行和当前 prompt；
- 持久化输入历史；
- 自定义 keybindings 文件；
- follow-up、steer、queue 和 dequeue 的明确语义；
- retry 快捷键；
- tool visibility 与 tool expansion 分离。

oh-my-pi 的应用级快捷键定义参考：[`refs/oh-my-pi/packages/coding-agent/src/config/keybindings.ts`](../refs/oh-my-pi/packages/coding-agent/src/config/keybindings.ts)。

omdsh 当前虽然允许 agent 忙碌期间继续输入，但这些文本只进入本地 FIFO，runner 会在 `whenIdle()` 后按普通 follow-up 发送；它还没有 oh-my-pi 的 steer/follow-up/queue mode 区分。

#### Markdown 与多模态

- 代码语法高亮；
- LaTeX inline/block；
- Mermaid ASCII；
- 更完整的 GFM/HTML；
- terminal hyperlink capability detection；
- Kitty/iTerm2 图片协议；
- assistant 和 tool result 图片；
- 流式表格稳定布局。

oh-my-pi 参考：[`refs/oh-my-pi/packages/tui/src/components/markdown.ts`](../refs/oh-my-pi/packages/tui/src/components/markdown.ts)。

#### Welcome、主题与状态栏

- Recent sessions 使用真实持久化数据；
- LSP server 状态；
- 动态 Tips；
- 自定义主题和更多内置主题；
- status line preset；
- 主题、颜色和符号 capability 的动态刷新。

当前静态 Recent sessions 占位位于 [`packages/tui/omdsh-tui/src/box.ts`](../packages/tui/omdsh-tui/src/box.ts)。oh-my-pi 的真实数据入口参考 [`refs/oh-my-pi/packages/coding-agent/src/modes/components/welcome.ts`](../refs/oh-my-pi/packages/coding-agent/src/modes/components/welcome.ts)。

#### Transcript 与错误恢复

- transcript/session 全文搜索；
- provider error banner；
- retry、fallback 和 countdown 状态；
- compaction summary、todo、goal 和 command result 的专用 block；
- native scrollback 或可导出的完整 transcript；
- session 恢复后的稳定重建，而不是只消费当前进程 live events。

## 非首要对齐项

以下功能属于 oh-my-pi 自身生态，不应作为 omdsh 第一阶段 parity 指标。只有明确产品需求时才应实现，并优先寻找 Harness 中对应的 domain/plugin：

- advisor、vibe、live voice、STT；
- marketplace/plugin 管理 UI；
- collaboration、share、join；
- OMP memory、security scan、TTSR/omfg；
- GitHub、browser、computer-use 的专属产品流程；
- OMP 自有 RPC、ACP 和 stats dashboard。

## 推荐实施路线

### 第一轮：插件骨架

1. 挂载并适配 `dsh-commands`；
2. 挂载 persistence/query/projection/title；
3. runner 支持 create/resume；
4. welcome 显示真实 recent sessions；
5. 实现 approval 和 user-questions TUI provider；
6. 开启并验证 workspace context。

完成标准：omdsh 不再是一次性随机 session；插件注册的命令无需修改 TUI 即可发现和执行；需要人类输入的 Harness 插件可以在终端完成闭环。

### 第二轮：Coding UX

1. 建立 tool renderer registry；
2. 实现 bash、file/diff、todo/jobs/subagent renderer；
3. 接入 model selector；
4. 接入 usage/context/session stats；
5. 暴露 compact、goal、todo、retry 等命令。

完成标准：常用 coding tool 不再只显示原始 JSON；用户可以在同一 session 内管理模型、上下文和关键 agent 状态。

### 第三轮：高级交互

1. 图片与附件；
2. 外部编辑器和可配置 keybindings；
3. 持久历史与 transcript 搜索；
4. 高级 Markdown；
5. 多主题和状态栏 preset；
6. 按产品需求接入 plan、goal、subagent、MCP 等完整工作流。

完成标准：日常 Coding Agent 使用体验接近 oh-my-pi，但领域语义和后端能力仍由 DeepSeek Harness 插件拥有。

## 架构约束

后续实现建议遵循以下边界：

1. **业务插件拥有状态和行为**：TUI 不重新实现 compaction、goal、session、approval 等 domain logic。
2. **TUI provider 只拥有终端交互**：键盘、鼠标、overlay、布局、焦点和渲染。
3. **展示通过贡献点扩展**：command source、tool renderer、transcript block、status segment 和 settings row 都应允许插件注册。
4. **未知能力必须安全降级**：未知事件可以忽略并记录，未知工具必须有 generic fallback，未知命令不得作为普通 prompt 静默提交。
5. **TTY 与非 TTY 共用语义**：pipe 模式可以简化布局，但不能改变命令、审批和 session 的业务结果。
6. **优先使用 Harness 公开 seam**：不依赖 Web UI 私有 React 组件，也不复制 oh-my-pi 的 Bun/TUI 内部实现。

## 当前工程状态备注

- 三轮推荐路线已经实施；逐项落点见 [`implementation-rounds.md`](implementation-rounds.md)。
- `@agi-fans/dsh-tui` 的 typecheck、测试和完整 app EOF 启动冒烟均通过。
- 本文前半部分保留为实施前的功能快照，用于解释设计取舍；“推荐实施路线”不再表示当前缺失项。
- 本文是指定日期的功能快照；Harness 或 oh-my-pi submodule 更新后应重新核对命令、插件和交互能力。
