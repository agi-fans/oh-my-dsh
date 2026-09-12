---
description: "omdsh 插件背后的契约：ctx.tui 表面、规划中的贡献注册表，以及所有权边界。"
---

# 插件内部机制

本页记录插件模型中面向插件作者与 TUI 开发者的契约部分，而不是安装或发布 bundle 的步骤。安装路径与兼容边界见[用户插件](plugins.md)。

## TUI 贡献层

Pi 的生态之所以丰富，是因为一个 extension 就能从同一个 TypeScript 文件注册工具、命令、提供方、渲染器、快捷键和模态 UI。omdsh 要的是这种*能力*的多样性，而不是那种加载器。每一个对等能力都落成注入 Harness 或 TUI 服务的 Cordis 插件。

| Pi 扩展点 | 解决什么 | omdsh 的落点 |
|---|---|---|
| `registerCommand` + 参数补全 | 零 UI 成本的 `/name` 目录 | `dsh-commands` 的元数据与处理器（挂上之后已经可用） |
| `registerTool` + `tool_call` 拦截/改写 | 额外的 LLM 工具和权限门 | Harness 工具加上随包的审批 / 权限插件。不另起一套拦截总线 |
| `presentCall` / `presentResult` 与带类型的卡片 presenter | 有专属外观的工具卡片 | 优先用 ToolDefinition 字段；只有这些字段不够时才在 `ctx.tui.contributions` 上注册 presenter |
| `ctx.ui.select` / `confirm` / `input` / `notify` | 向导和 toast | `ctx.tui.prompt`、`notice`、`commandOutput` |
| `setStatus(key, text)` | 每个插件各占一格的持久 footer | 只追加、且只读 Harness projection 的 status segment |
| `registerMessageRenderer` / entry renderer / Markdown transformer | 不是工具卡片的 Transcript 装饰 | 后置。未知 Session Event 不进入 Transcript |
| 编辑器上下的 `setWidget` | 常驻轻量面板 | 后置。需要 Composer 尚未露出的预留布局槽 |
| `ctx.ui.custom` / overlay | 模态或全屏插件 UI | 后置。只通过 `ctx.tui.prompt` 注册纯 view/action 描述 |
| 主题 JSON + `setTheme` | 门槛最低的视觉包 | 后置的 token 覆盖。内置调色板仍由产品拥有；不采用 Pi/oh-my-pi 品牌 |
| `registerProvider` + OAuth 表单 | 额外的模型路由与登录 | 用户挂载的 LLM bundle，走 `ctx.llm` 和 `ctx.authorization` 流程；TUI 提供 `AuthorizationInteraction` |
| `setEditorComponent` / `addAutocompleteProvider` | vim 模式、自定义补全 | 关闭。Composer 所有权留在本地 Provider |
| `onTerminalInput` / 全屏抢 TTY | 游戏和原始终端监听 | 永不采用。TTY 只有本地 Provider 一个所有者 |
| `~/.pi/agent/extensions/*.ts` 和 `pi` 包清单 | 自动加载源文件和第二套安装器 | 永不采用。安装方式是 `omdsh plugin add` 一个 `dsh.bundle` 包 |
| Pi packages + `/reload` + 项目信任门 | 真正让生态变大的引擎 | `omdsh plugin` 加重启。不对 `node_modules` 做热替换。项目信任继续走现有的 MCP 审阅路径 |
| 会话/消息生命周期 hook | 改写输入、观察 turn、响应工具结果的反应型插件 | 注入 Harness session / agent 服务、并观察持久化 `SessionEvent` 的 Cordis 插件。TUI 不另起一套 hook 总线 |
| 自定义 agent / 角色 | 另一套 prompt、工具和人格 | Harness Agent preset 和 Skills。TUI 只通过 `/agent` 和 `/skill:` 列出并切换 |

Pi 的大多数插件是反应型，不是呈现型。它们属于 Harness 的事件和服务树：观察 `turn/start`、`turn/end` 和工具结果，或贡献一个 Agent preset。TUI 不另起平行的生命周期 hook，也不另建角色注册表。

今天的 `ctx.tui` 是输入和通知通道（`event`、`prompt`、`notice`、`readInput`）。呈现型插件还需要一个窄而稳定的 `ctx.tui.contributions` 服务。插件向该服务注册句柄；Cordis 在 plugin fiber dispose 时注销这些句柄，因此卸掉的 bundle 不会留下过期渲染器。该服务是只读注册表，不是新的输入路径，也不能碰 TTY。

`ctx.tui.contributions` 尚未发布。没有消费者的注册表就是没有用户的 API；omdsh 也没有 `/reload`，所以第一版公共形状必须耐用。等第一批真实 bundle 需要现有缝表达不了的展示槽时，再冻结 TypeScript 联合类型和优先级规则，不要单独预览。

贡献记录是可扩展的判别联合。第一批落地的变体是 `status`，以及只有真实工具证明 `presentCall` / `presentResult` 不够时才加的带类型 `card`。TUI 不再开命令注册表，也不开放可注册的 `/settings` 行。斜杠命令继续走 `dsh-commands`。插件偏好存 `ctx.settings`，通过该插件自己的斜杠命令加 `ctx.tui.prompt` 编辑。`/settings` 仍由产品拥有：`tuiSettingItems` 和 `TuiPrefs`、持久化、校验、分页导航、status 重排绑在一起。若日后多个插件反复实现同一套设置向导，再抽一个表单式的 `prompt` 缝，而不是打开产品设置列表。之后的 `overlay` 必须加 case，且不能破坏已有记录。每个卡片 presenter 声明工具或展示 id、数字优先级和注册插件 id。两个 presenter 抢同一 id 时，优先级高的胜出；优先级相同则保留先注册者，并在启动时打出警告。第一版就把这套注册表当成正式渲染 API 来设计，而不是垫片。在至少一个真实用户 bundle 用过这套形状之前，不要把它放进 `@agi-fans/dsh-tui` 的稳定公共导出。

产品的 Agent 语言设置通过 system-prompt section registry 投影。声明为 `complete: true` 的自定义 persona 会按设计抑制普通 section；若希望响应 Language，必须在自己的 persona 文本末尾追加 `{{omdsh_agent_behavior}}`。`Auto` 时该变量解析为空字符串；省略变量不会报错，但 Language 对该 complete persona 不生效。

等到 `ctx.tui.contributions` 发布后，`@agi-fans/dsh-tui` 将导出贡献 token、对应的 TypeScript 类型，以及一小套展示原语（按显示宽度处理的文本、主题颜色名、卡片分区形状）；没有这些原语，插件卡片一定会撑破布局。以上目前都还没有导出——该包当前只发布 `definition.ts` 与 provider 入口，宽度与主题相关的辅助函数仍是私有实现模块。它不导出 renderer、editor 或 TTY 所有者。注册表永远不能变成第二条输入路径：`readInput` 保持单消费者，`onInterrupt` / `onQueueEdit` / `onRewind` / `onInspect*` 保持宿主私有。插件向人提问只走 `prompt()`。

Pi 第一批里的大部分丰富度已经是 Harness 缝：命令、工具、审批、提问、notice、Session Event 和 Agent preset，bundle 一挂上就能用。挂上一个真实用户 bundle 之后：

1. **Status segment。** 插件只发布 projection id 和标签。数值来自 Harness projection，而不是插件自己发明的计数器。两行 footer 仍然按 cache、tokens、TTFT，然后是 duration，最后是 turns 降级。Loop 已经在写入进程内 footer 状态；这就是 [架构](architecture.md) 里的「第二个 owner」检验。
2. **卡片。** 优先使用 `ToolDefinition.presentCall` / `presentResult`。只有真实工具证明这些字段表达不了卡片时，才在 `ctx.tui.contributions` 上注册带类型的卡片 presenter。布局、内边距、通用回退和上面的优先级规则仍由 TUI 拥有。

后置批次只在出现第二个 owner 时开放：

- 把更多 `prompt` 展示种类做成带版本的判别联合（select、confirm、input、list 和 action 描述），让向导保持「数据进、动作出」；
- 预留 `interactive-view` 贡献 case，再做成仍走 `prompt()` 同一套独占仲裁的瘦身 `custom<T>()`；
- Composer 旁预留、且不得移动 composer 或 footer 锚点的 widget 槽；
- 只改现有槽位、不发明新调色板格式的主题 token 覆盖。

omdsh 不克隆 Pi 的宿主 `TUI` 对象、`extensions/*.ts` 加载器或 `/reload`。以后可以复刻 Pi 已经证明的那条所有权分割：插件返回 Component，本地 Provider 仍拥有 raw mode、焦点、光标、viewport、合成和原子写。这和发布第二套 UI 框架不是一回事。在真实外部 bundle 需要之前，公共贡献 API 保持关闭。

未来的 Component 契约保持很窄：`render(width)` 返回宽度安全的行，可选的 `handleInput` 只收解码后的按键事件（绝不是原始终端字节），再加上 `invalidate()` 和可选的 `dispose()`。宿主负责 ANSI 规范化、裁切宽度和放置光标。`custom<T>()` 只给 factory 语义主题、`requestRender`、`done(result)` 和 `AbortSignal`。不传入 renderer、editor、keybinding manager 或 TUI 实例。调用会暂停 `readInput`、保存 composer 草稿、把焦点交给 Component，并在结束、取消或 fiber dispose 时恢复草稿、焦点和光标。第一版 overlay 是 capturing modal，只有宿主解释的宽高和锚点选项。

若这条缝落地，最小积木是：宽度安全的 `Text`、`Spacer`、`Box`、`VStack`、`SelectList`，以及复用 composer 行、不重做 CJK IME 的宿主 `Input`。不导出 Markdown、Editor、Renderer 或通用布局引擎。禁止插件自绘输入框。卡片 presenter 以后可以返回 Component；status 仍是声明式 projection 段。消息和 transcript 渲染器要等持久化事件契约成熟，不能借 Component 绕过 session schema。

绝不克隆 `setFooter` 整条替换、`setEditorComponent`、`onTerminalInput`、全局快捷键钩子、直接 TTY 控制、第二套 tool/command 总线，或 extensions 目录热加载。

内部 prototype 可以走未导出的 experimental 路径，由产品自有插件驱动，并用 fake-TTY 覆盖嵌套、abort、dispose、异常、resize、ANSI、CJK、emoji 和 composer 恢复。在有一个真实外部 bundle 用过之前，不得进入 `@agi-fans/dsh-tui` 的稳定导出。

本地 Provider 仍然独占 raw mode、按键解码、光标定位与可见性、viewport 分页、差分写入，以及 Ctrl-C / Ctrl-D 生命周期。modal 必须保留宿主保留键集（两次 Ctrl-C、Ctrl-D、Alt 快捷键），并在插件 render 抛错或死循环时强制 `done()`。

## 所有权

`apps/omdsh` 拥有 Profile、安装器、转储和 composition。`@agi-fans/dsh-tui` 拥有 `ctx.tui`。插件依赖这些服务和已发布类型，不依赖 Renderer 内部实现。

`ctx.tui.contributions` 尚未发布。等有真实外部 bundle 需要 `presentCall` / `presentResult` 和 `ctx.tui.prompt` 表达不了的展示槽时，再把 `status`、以及必要时的 `card` 冻进稳定导出。

## 相关文档

- [用户插件](plugins.md) — 安装、兼容边界与编写
- [架构](architecture.md) — 产品 composition 与 TUI 所有权
