---
description: 已发布的插件接口、TUI 交互归属、回复语言集成，以及新增展示 API 的条件。
---

# 插件内部机制

插件通过已发布的 Harness 服务扩展运行中的 Cordis 树。安装方式见[用户插件](plugins.md)，可运行示例见[编写插件](tutorials/write-a-plugin.md)。

## 可用扩展入口

| 能力 | 接口 | 终端行为 |
|---|---|---|
| 斜杠命令 | `dsh-commands` 元数据、处理器和补全 | 命令进入 Help、补全和 runner。 |
| 工具 | Harness 工具注册与 `ToolDefinition.presentCall` / `presentResult` | TUI 按提供方声明展示内容，统一负责内边距、换行和通用回退。 |
| 模型与授权 | `ctx.llm` 和已注册的 `ctx.authorization` 流程 | 模型进入选择器，`/login` 展示授权流程的通知和提问。 |
| 设置与凭据 | `ctx.settings` 和 `ctx.credentials` | schema 声明的 live 设置按自动表单策略进入 Advanced，密钥值通过凭据服务保存。 |
| 提问与通知 | `ctx.tui.prompt`、`notice` 和 `commandOutput` | 本地 provider 负责焦点、取消、可读结果及返回输入框。 |
| 会话行为 | Harness Agent/session 服务与持久事件 | 插件在自己的 Cordis 作用域内观察生命周期并提供行为。 |
| Persona 与技能 | Agent preset 和 Harness skill registry | `/agent` 在产生模型历史前选择 preset，`/<skill-name>` 调用技能。 |

在插件的 `inject` 中声明所需服务，通过自身 Cordis context 注册 effect，使卸载能够释放资源。以已安装包的 exports 和类型为契约，已发布的 provider、服务定义、运行时和命令入口见 [TUI manifest](https://github.com/agi-fans/oh-my-dsh/blob/main/packages/tui/omdsh-tui/package.json)。

## 终端归属

本地 provider 拥有 raw mode、已解码输入的路由、光标状态、视口布局、鼠标选择与终端写入。runner 是 `readInput` 的唯一消费者。插件通过 `prompt()` 和请求的取消信号向用户提问，人工审批优先于普通浏览。

产品拥有输入框、状态页脚、主题配色、转录布局与设置分类。插件通过 `presentCall` 和 `presentResult` 提供工具展示意图。Advanced 展示符合策略的 live schema 字段，专用表单通过所属命令和 prompt 服务提供。固定布局的页脚格式化 Harness 投影，宽度不足时按优先级收起指标。

自定义展示注册表仍属于待论证的设计方向。`ctx.tui.contributions`、自定义组件工厂与主题包注册尚无已发布 API。新增入口需要具有独立所有权的消费者，并证明现有工具和 prompt 契约无法表达其需求。在公共导出前，应明确并验证生命周期、兼容性、取消、焦点恢复和显示宽度约定。实现模块只有被包的 export map 明确列出时才构成公开入口。

持久事件须满足已发布的会话 schema。未知事件只有明确标为 ignorable 且可安全省略时，读取器才可以跳过。展示扩展因此需要先具备持久回放契约，才能增加新的会话事实。权限决定继续经过 Harness 授权与审计。

## 回复语言与完整 Persona

产品的**回复语言（Response language）**设置通过 system-prompt section 生效。跟随界面在下一回合解析界面语言，Auto 生成空片段。声明 `complete: true` 的自定义 persona 会抑制普通 section，需要追加 `{{omdsh_agent_behavior}}` 才能应用该偏好。插件归属及回合快照约定见 [Agent 行为设计](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/design/agent-behavior.md)。

## 组合与生命周期

`apps/omdsh` 拥有 Profile 加载、安装与应用组合，TUI 包拥有终端展示与交互。用户 bundle 共用已发布的 Harness 服务，须声明兼容的 peer 来维持服务身份。CLI 包操作后需要重启，运行时插件操作会报告已实时应用或需要重启，已有 Agent 组合保留其版本。

未来展示接口必须保留 display-cell 布局、ANSI 处理、CJK 与 emoji 宽度、输入草稿、附件顺序、取消及终端恢复语义。验证应覆盖异常、卸载、resize 和嵌套人工提问。源码入口与现有测试见[架构](architecture.md)。

## 相关

- [用户插件](plugins.md) — 安装与兼容性
- [编写插件](tutorials/write-a-plugin.md) — 可运行的 bundle
- [架构](architecture.md) — 包与运行时归属
