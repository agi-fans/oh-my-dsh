# oh-my-dsh 架构

[English](architecture.md) | 简体中文

oh-my-dsh 是一个通过组合已发布 DeepSeek Harness 软件包构建的终端 Coding Agent。TUI 负责终端表现和人机交互；会话、模型、工具、命令、权限、Skills、MCP 集成和 Projection 仍由 Harness 插件负责。

## 边界

- **运行时：** `@deepseek-ai/*` 软件包以固定版本从 npm 安装，并通过其公开导出使用。
- **产品：** `apps/omdsh` 负责 CLI 和运行时组合；`packages/tui/omdsh-tui` 负责可复用的终端插件套件。
- **参考项目：** `refs/deepseek-harness` 和 `refs/oh-my-pi` 是只读的架构与交互设计参考，不参与依赖解析、构建、测试或运行时执行。

本项目刻意避免建立第二套 Agent Core。它将 Harness 能力适配到本地终端，而不重新实现这些能力的领域状态。

## 软件包布局

```text
apps/omdsh/                         @agi-fans/oh-my-dsh
├── src/bin.ts                      CLI 入口与参数处理
├── src/boot.ts                     启动 Harness 插件树
└── config/cordis.yml               应用组合

packages/tui/omdsh-tui/            @agi-fans/dsh-tui
├── src/index.ts                    本地 Provider 插件入口
├── src/definition.ts               与 Provider 无关的 TUI Service
├── src/runtime/                    终端 Provider、会话运行时、Runner、启动提示
├── src/commands/                   斜杠命令贡献插件
├── src/chrome/                     主题、Markdown、渲染、Status、工具卡片
├── src/input/                      按键、编辑器、剪贴板、粘贴
├── src/views/                      会话记录、浮层、搜索、复制
└── src/session/                    会话控制器与 TUI 设置
```

TUI 软件包从同一个 npm 软件包公开多个 Cordis 入口，因为它们共享依赖与发布周期。只有当一项能力具备独立复用、所有权、依赖或版本管理需求时，才值得拆成新的 npm 软件包。

## 插件所有权

“一切皆插件”描述的是所有权，而不是文件数量。当一项能力拥有独立的生命周期、配置、依赖集合、注册协议、作用域或替换点时，它才应该成为插件。

- 只有本地 Provider 负责 raw mode、按键解码、光标定位、viewport 状态和原子化终端写入。
- `session-runtime` 负责创建 Agent、创建与恢复持久会话、替换活跃会话、选择模型、挂载 Agent preset、设置每个 Agent 的工具展示、读取 Projection 和清理资源。
- 命令插件通过 `dsh-commands` 注册元数据和处理器；Runner 不维护第二份命令注册表。
- Loop 命令以独立插件负责进程内调度与 Footer Projection。重复 Prompt 仍通过 `session-runtime` 提交；Loop 状态不会写入持久会话历史，并在活跃 Agent 发生变化时丢弃。
- 工具插件负责工具语义和与 Provider 无关的展示意图。TUI 将 `ToolDefinition.presentCall` 和 `presentResult` 映射为终端卡片，并保留通用回退展示。
- Harness Projection 插件负责 token、上下文、耗时、标题和会话统计；状态栏只负责格式化这些输出。
- `session-runtime` 把带 `origin: subagent` 的后代会话投影为 Composer 上方的实时名册，并可以把视口切换到其中一个孩子的 Transcript。可续写的孩子通过 `ctx.subagents.followup` 接收 Composer 的后续消息；一次性运行保持只读。子会话日志留在各自的 Session 中，不会回放到父 Transcript。
- 人机交互适配器将审批和提问 Service 连接到终端选择器，而不把这些领域迁入终端 Provider。

纯算法仍然保留为内部模块，包括 ANSI 解析、终端显示宽度、Markdown 格式化、编辑器移动、路径匹配、主题映射、帧差分、viewport 切片和 Overlay 状态转换。除非出现第二个拥有独立所有权的适配器并形成真实边界，否则不应将它们改造成运行时插件。

## 运行时组合

[`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml) 是应用 Profile 的权威来源，其中组合了：

- Cordis Loader 与 Timer 基础设施；
- DeepSeek LLM Adapter、设置、凭据、默认模型、Agent preset roster、Code Runtime 和 Agent Runtime；
- 持久化 JSONL 会话、Checkpoint、查询、标题、统计与 Token Projection；
- 本地附件、文件系统、子进程、Bash、Sandbox 和权限 Provider；
- Standard、PTC、Minimal 与 Cordis 的 Agent-plane 组合，以及 Harness 命令、Compaction、Todo、Goal、Plan、审批、提问和 Subagent；
- 文件系统 Skill 发现以及项目级和用户级 MCP Server Adapter；
- 本地 TUI Provider、工具展示适配桥、Session Runtime、人机交互适配器、命令贡献插件、启动提示和 Runner。

Skills 与 MCP 的部署细节见 [`skills-and-mcp.zh-CN.md`](skills-and-mcp.zh-CN.md)。

## 数据与交互流

```text
终端输入
  → 本地 TUI Provider
  → Runner 或命令注册表
  → Session Runtime / Harness 能力
  → 持久化会话事件与 Projection
  → 与 Provider 无关的对话和状态 View
  → 差分终端 Renderer
```

普通消息通过 `session-runtime` 进入活跃 Agent。Slash Command 通过当前作用域内的 Harness Registry 执行。Agent preset 与工具展示会在 Agent 发布前完成组合，并写入日志以供重建；产生第一条 Prompt 后，模型可见组合会被锁定。Workflow 与 Access 仍是相互独立、由 Harness 拥有的会话状态。Session Event 是对话回放的持久化事实来源；Projection Service 提供派生状态，TUI 不维护重复计数。工具调用及其结果最终合并为一张卡片，并以 Input 和 Output 分区展示。后代 subagent 的活动从这些子会话折叠进 Composer 旁的名册。

## 终端保证

- 布局以终端显示单元格为准，正确处理 ANSI 序列、CJK 文本、emoji、组合字符和不可断行的长内容。
- Composer 和两行状态 Footer 固定在底部，Transcript Viewport 可以独立滚动。
- 已完成的 Transcript 布局会被缓存，滚轮更新会被合并，Renderer 只输出发生变化的行，而不重绘整个屏幕。
- Modal Selector 在交互结束前独占输入和光标可见性，结束后恢复 Composer。
- 第一次 Ctrl-C 清空输入或中断任务，第二次 Ctrl-C 退出。Ctrl-D 直接退出；存在持久会话时会输出 `omdsh --resume <session-id>` 提示。
- Pipe 模式使用相同的命令与会话语义，但不接管交互式屏幕。

## 公共接口

软件包支持的公开导出包括 Provider、Service Definition、Session Runtime、人机交互适配器、工具展示适配桥、命令组、启动提示和 Runner。Renderer、Editor、Markdown、Width、Overlay、Clipboard 和 Selector 模块仍是实现细节，即使测试通过相对路径导入它们。

只有在主题、状态栏 Segment、Overlay 或按键 Action 至少出现两个拥有独立所有权的贡献者时，才应引入新的 Contribution Registry。在此之前，配置和内部状态机比预设的公共边界更合适。

## 验证

- 纯渲染测试覆盖宽度、ANSI、CJK、emoji、边框、Markdown、工具卡片、viewport 行为和光标目标。
- Runtime 测试覆盖命令注册、会话创建与恢复、消息队列、Projection、模型与权限选择、人机交互和资源清理。
- `pnpm smoke:happy` 使用已发布 Harness Mock LLM 路径启动完整组合。
- `pnpm smoke` 通过真实 PTY 运行构建后的命令，验证 raw input、渲染、中断和退出行为。
- 依赖边界检查要求使用已发布的 npm 软件包、保持参考子模块干净，并禁止指向 `refs/` 的链接或别名。

改动所需执行的具体命令由 [`AGENTS.md`](../AGENTS.md) 规定。
