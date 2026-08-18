# 用户插件

[English](plugins.md) | 简体中文

omdsh 通过 DeepSeek Harness 插件扩展，这些插件与产品自带的 composition 挂在同一棵 Cordis 树上。用户安装的能力是一个声明了 `dsh.bundle.patch` 的 npm 软件包，它加入 omdsh 的 Profile 层列表，并随其余插件一同启动。

本文是计划中的支持模型。启动已经会应用随包发布的 [`apps/omdsh/config/cordis.yml`](../apps/omdsh/config/cordis.yml)、可选的 `$OMDSH_HOME/cordis.patch.yml`，以及 MCP 的 insert patch。`omdsh --dump-config` 会打印这棵组合后的树。Profile 目录、`omdsh plugin` 命令和 `@agi-fans/oh-my-dsh` 的 bundle 声明尚未随产品发布。

Skills 与 MCP 仍是独立的部署面，见 [Skills 与 MCP](skills-and-mcp.zh-CN.md)。TUI 的丰富度来自安装层之上的 Cordis 贡献服务，而不是某个 TypeScript extensions 目录。主题、Overlay 和按键注册表在出现第二个拥有独立所有权的贡献者之前保持关闭，见 [架构](architecture.zh-CN.md) 和 [TUI 贡献层](#tui-贡献层)。

## 插件挂上之后已经可用的能力

TUI 不维护第二份命令、工具或模型注册表。插件进入树之后，这些 Harness 缝已经能到达终端：

| 能力 | 插件使用的缝 | TUI 的行为 |
|---|---|---|
| 斜杠命令 | `dsh-commands` 的元数据与处理器 | 出现在 `/help`、自动补全和 Runner 中 |
| 工具 | `ToolDefinition`，包括 `presentCall` / `presentResult` | 渲染为卡片，否则使用通用回退 |
| 模型提供方 | `ctx.llm` 的路由与设置 | 出现在 `/model`；`/login` 可以保存目录密钥或自定义 profile |
| 凭据与设置 | `ctx.credentials` 和 `ctx.settings` | 与树中其余部分已经读取的 `$DSH_HOME` 文档共用 |
| 人机提问 | `ctx.tui.prompt`、审批和提问 | 由终端选择器收集答案 |
| Skill | Harness Skill Registry | 出现在 `/skill:` 下 |
| MCP Server | 每个 Server 对应一行 `dsh-mcp-client` | 出现在 `/mcp` 和 `/tools` 中 |

只需要这些缝的插件，不必再写 TUI 展示适配器。

## 当前启动缺口

`apps/omdsh/src/boot.ts` 先挂随包 composition，若存在则再挂 `$OMDSH_HOME/cordis.patch.yml`，最后挂 [`loadMcpPatches()`](../apps/omdsh/src/mcp-config.ts) 产生的 MCP insert patch。补丁文件存在但为空、或不是 YAML 列表时，启动失败并大声报错。启动和 `omdsh --dump-config` 会先共用一次 `loadLayeredEnv` 快照，因此项目级和用户级 `.env` 对 home patch 路径以及 MCP 变量展开的影响在两条路径上相同。`--dump-config` 打印这棵组合树，但不启动 TUI。

Profile 的 `dsh.profile.bundles` 列表和 `omdsh plugin` 仍未被读取。因此即使用 npm 安装了标准 DSH bundle，也不会生效，除非该软件包已经能从 omdsh 安装位置解析，并且 home patch 把它 insert 进去。只在 `settings.yaml` 里写入提供方 profile，也无法激活 composition 从未挂载的 adapter。

`/login` 已经能通过随包、默认休眠的 `@deepseek-ai/dsh-llm-pi-ai` adapter 接入目录提供方和手写自定义路由。OAuth、refresh token 的所有权，以及 adapter 不在随包树中的提供方，仍然需要用户挂载插件。

## 目标组合

omdsh 保留产品自己拥有的 composition。它不会把官方 `@deepseek-ai/dsh-base` 当作第一层启动，也不会变成官方 `web` 或 `headless` Profile 上的一层皮。那些层会挂上 TUI composition 明确排除的 Host、HTTP 和 Web UI 行。

第一层是当前的 omdsh composition，通过 `dsh.bundle.patch` 清单字段发布为 `@agi-fans/oh-my-dsh` bundle。用户 bundle 追加在这层产品层之后。

```text
$OMDSH_HOME/profiles/omdsh/
  package.json          # dsh.profile.bundles 以及用户依赖
  cordis.yml            # 空根 []；只给 Loader 当 baseUrl
  cordis.patch.yml      # 可选的用户行级补丁
  node_modules/         # 用户 bundle，由 pnpm 管理
```

Profile 目录使用 omdsh 已经用于会话、设置、凭据和 MCP 的同一主目录：`$OMDSH_HOME`，否则 `$DSH_HOME`，再否则 `~/.dsh`。Profile 名称是 `omdsh`，因此不会与可能共用 `$DSH_HOME` 的官方 `web` 或 `headless` Profile 冲突。

启动按以下顺序应用补丁：

1. 随包发布的 `@agi-fans/oh-my-dsh` bundle（今天的 `cordis.yml`，改写成对空根的 insert）。
2. `dsh.profile.bundles` 中的其余名称，按列表顺序。
3. `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`。
4. `$OMDSH_HOME/cordis.patch.yml`（作用于每个 omdsh Profile 的机器级覆盖）。
5. 现有的、来自用户级和项目级 `mcp.json` 的 MCP insert patch。

后一层按行 id 覆盖前一层。针对 id 的补丁会整份替换 `config` 对象，不做深层合并。补丁点名了一个不存在的 id 时，向 stderr 发出警告，而不是静默忽略。

模块解析保持双锚点，并使用已发布的 `dsh-app-boot` 辅助函数。`@deepseek-ai/*` 和 `@agi-fans/dsh-tui` 通过 `healProfilesModuleFallback` 优先从 omdsh 安装位置解析。用户 bundle 从 Profile 的 `node_modules` 解析。insert 了一个 Node 无法解析的软件包时，启动失败并大声报错。

omdsh 基于同一套已发布 API 实现 `omdsh plugin`。它不要求安装官方 `dsh` CLI，也不重新实现安装目录、版本求解或分层顺序。

omdsh 不会从某个 extensions 目录加载 TypeScript 文件。那是另一套产品模型，等于在 Cordis 旁边再造一个插件管理器。

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
| `registerProvider` + OAuth 表单 | 额外的模型路由与登录 | 用户挂载的 LLM / Auth bundle，走 `ctx.llm` 和 `ctx.tui.prompt` |
| `setEditorComponent` / `addAutocompleteProvider` | vim 模式、自定义补全 | 关闭。Composer 所有权留在本地 Provider |
| `onTerminalInput` / 全屏抢 TTY | 游戏和原始终端监听 | 永不采用。TTY 只有本地 Provider 一个所有者 |
| `~/.pi/agent/extensions/*.ts` 和 `pi` 包清单 | 自动加载源文件和第二套安装器 | 永不采用。安装方式是 `omdsh plugin add` 一个 `dsh.bundle` 包 |
| Pi packages + `/reload` + 项目信任门 | 真正让生态变大的引擎 | `omdsh plugin` 加重启。不对 `node_modules` 做热替换。项目信任继续走现有的 MCP 审阅路径 |
| 会话/消息生命周期 hook | 改写输入、观察 turn、响应工具结果的反应型插件 | 注入 Harness session / agent 服务、并观察持久化 `SessionEvent` 的 Cordis 插件。TUI 不另起一套 hook 总线 |
| 自定义 agent / 角色 | 另一套 prompt、工具和人格 | Harness Agent preset 和 Skills。TUI 只通过 `/agent` 和 `/skill:` 列出并切换 |

Pi 的大多数插件是反应型，不是呈现型。它们属于 Harness 的事件和服务树：观察 `turn/start`、`turn/end` 和工具结果，或贡献一个 Agent preset。TUI 不另起平行的生命周期 hook，也不另建角色注册表。

今天的 `ctx.tui` 是输入和通知通道（`event`、`prompt`、`notice`、`readInput`）。呈现型插件还需要一个窄而稳定的 `ctx.tui.contributions` 服务。插件向该服务注册句柄；Cordis 在 plugin fiber dispose 时注销这些句柄，因此卸掉的 bundle 不会留下过期渲染器。该服务是只读注册表，不是新的输入路径，也不能碰 TTY。

在用户 bundle 能够安装之前，不要发布 `ctx.tui.contributions`。没有安装路径的注册表就是没有用户的 API；omdsh 也没有 `/reload`，所以第一版公共形状必须耐用。TypeScript 联合类型和优先级规则，要跟第一批真实 bundle 一起冻结，不要单独预览。

贡献记录是可扩展的判别联合。第一批落地的变体是 `status`，以及只有真实工具证明 `presentCall` / `presentResult` 不够时才加的带类型 `card`。TUI 不再开命令注册表，也不开放可注册的 `/settings` 行。斜杠命令继续走 `dsh-commands`。插件偏好存 `ctx.settings`，通过该插件自己的斜杠命令加 `ctx.tui.prompt` 编辑。`/settings` 仍由产品拥有：`tuiSettingItems` 和 `TuiPrefs`、持久化、校验、分页导航、status 重排绑在一起。若日后多个插件反复实现同一套设置向导，再抽一个表单式的 `prompt` 缝，而不是打开产品设置列表。之后的 `overlay` 必须加 case，且不能破坏已有记录。每个卡片 presenter 声明工具或展示 id、数字优先级和注册插件 id。两个 presenter 抢同一 id 时，优先级高的胜出；优先级相同则保留先注册者，并在启动时打出警告。第一版就把这套注册表当成正式渲染 API 来设计，而不是垫片。在至少一个真实用户 bundle 用过这套形状之前，不要把它放进 `@agi-fans/dsh-tui` 的稳定公共导出。

`@agi-fans/dsh-tui` 导出贡献 token、对应的 TypeScript 类型，以及一小套展示原语（按显示宽度处理的文本、主题颜色名、卡片分区形状）。没有这些原语，插件卡片一定会撑破布局。它不导出 renderer、editor 或 TTY 所有者。注册表永远不能变成第二条输入路径：`readInput` 保持单消费者，`onInterrupt` / `onQueueEdit` / `onRewind` / `onInspect*` 保持宿主私有。插件向人提问只走 `prompt()`。

Pi 第一批里的大部分丰富度已经是 Harness 缝：命令、工具、审批、提问、notice、Session Event 和 Agent preset，bundle 一挂上就能用。在 `omdsh plugin` 存在、并且挂上一个真实用户 bundle 之后：

1. **Status segment。** 插件只发布 projection id 和标签。数值来自 Harness projection，而不是插件自己发明的计数器。两行 footer 仍然按 cache、tokens、TTFT，然后是 duration，最后是 turns 降级。Loop 已经在写入进程内 footer 状态；这就是 [架构](architecture.zh-CN.md) 里的「第二个 owner」检验。
2. **卡片。** 优先使用 `ToolDefinition.presentCall` / `presentResult`。只有真实工具证明这些字段表达不了卡片时，才在 `ctx.tui.contributions` 上注册带类型的卡片 presenter。布局、内边距、通用回退和上面的优先级规则仍由 TUI 拥有。

后置批次只在出现第二个 owner 时开放：

- 把更多 `prompt` 展示种类做成带版本的判别联合（select、confirm、input、list 和 action 描述），让向导保持「数据进、动作出」；
- 预留 `interactive-view` 贡献 case，再做成仍走 `prompt()` 同一套独占仲裁的瘦身 `custom<T>()`；
- Composer 旁预留、且不得移动 composer 或 footer 锚点的 widget 槽；
- 只改现有槽位、不发明新调色板格式的主题 token 覆盖。

omdsh 不克隆 Pi 的宿主 `TUI` 对象、`extensions/*.ts` 加载器或 `/reload`。以后可以复刻 Pi 已经证明的那条所有权分割：插件返回 Component，本地 Provider 仍拥有 raw mode、焦点、光标、viewport、合成和原子写。这和今天就发布第二套 UI 框架不是一回事。三家否决的是「在可安装 bundle 出现之前冻结公共贡献 API」，不是否定这个最终模型。

未来的 Component 契约保持很窄：`render(width)` 返回宽度安全的行，可选的 `handleInput` 只收解码后的按键事件（绝不是原始终端字节），再加上 `invalidate()` 和可选的 `dispose()`。宿主负责 ANSI 规范化、裁切宽度和放置光标。`custom<T>()` 只给 factory 语义主题、`requestRender`、`done(result)` 和 `AbortSignal`。不传入 renderer、editor、keybinding manager 或 TUI 实例。调用会暂停 `readInput`、保存 composer 草稿、把焦点交给 Component，并在结束、取消或 fiber dispose 时恢复草稿、焦点和光标。第一版 overlay 是 capturing modal，只有宿主解释的宽高和锚点选项。

若这条缝落地，最小积木是：宽度安全的 `Text`、`Spacer`、`Box`、`VStack`、`SelectList`，以及复用 composer 行、不重做 CJK IME 的宿主 `Input`。不导出 Markdown、Editor、Renderer 或通用布局引擎。禁止插件自绘输入框。卡片 presenter 以后可以返回 Component；status 仍是声明式 projection 段。消息和 transcript 渲染器要等持久化事件契约成熟，不能借 Component 绕过 session schema。

绝不克隆 `setFooter` 整条替换、`setEditorComponent`、`onTerminalInput`、全局快捷键钩子、直接 TTY 控制、第二套 tool/command 总线，或 extensions 目录热加载。

内部 prototype 可以走未导出的 experimental 路径，由产品自有插件驱动，并用 fake-TTY 覆盖嵌套、abort、dispose、异常、resize、ANSI、CJK、emoji 和 composer 恢复。在 Profile 安装可用、且有一个真实外部 bundle 用过之前，不得进入 `@agi-fans/dsh-tui` 的稳定导出。

本地 Provider 仍然独占 raw mode、按键解码、光标定位与可见性、viewport 分页、差分写入，以及 Ctrl-C / Ctrl-D 生命周期。modal 必须保留宿主保留键集（两次 Ctrl-C、Ctrl-D、Alt 快捷键），并在插件 render 抛错或死循环时强制 `done()`。

## 兼容边界

无需额外 TUI 工作即可支持：

- 通过 `dsh-commands` 注册的命令。
- 工具，包括与 Provider 无关的 `presentCall` / `presentResult` 卡片。
- 在 `ctx.llm` 上注册路由的 LLM adapter。
- 使用随包 Store 的设置与凭据插件。
- 通过 `ctx.tui.prompt`、notice 或命令输出收集密钥或选项的 Auth 插件。
- Skills 与 MCP Server，它们继续走现有发现路径。
- 观察持久化 Session Event，或通过 Harness 注册 Agent preset 的反应型插件。

不承诺：

- 官方 `dsh-client-ui-*` Web UI 插件。omdsh 没有 web Profile。
- 抢占 TTY、监听原始终端字节，或假定已经挂上 Host / HTTP 面的插件。
- Pi 的 extensions 目录加载器、`pi` 包清单，以及对散落 TypeScript 文件的 `/reload`。
- Pi 或 oh-my-pi 的品牌。产品保持 DeepSeek 身份。
- Pi 的「不要 MCP」立场。omdsh 已经通过 Harness 挂载 MCP Server。
- 自定义 Session Event 类型。未知事件不会进入 Transcript，也不会让回放崩溃。
- 主题包或 Overlay 组件。这些在出现第二个拥有独立所有权的贡献者之前保持关闭。
- 第二套工具调用拦截总线。权限门留在 Harness 审批插件里，避免架空审计。
- 自定义 Session Event 类型进入 Transcript。这条边界不会放宽。
- 替换 Composer、按键映射，或任何其他由 TTY 拥有的表面。
- 第二套斜杠命令注册表，或无限的 `/settings` 行列表。
- 把宿主 TUI 实例、原始终端字节，或插件拥有的 assistant transcript 渲染器交给插件。瘦身 `custom()` Component 缝如果落地，在可安装 bundle 出现之前只能是 experimental。

版本不匹配、已列入列表的 bundle 缺少 `dsh.bundle` 声明，或软件包名称无法解析时，沿用现有的 `boot()` / `assertEntriesActivated` 路径在启动阶段失败。剩下最大的风险是用户 bundle 再带一份 Cordis，或带上不兼容的 DSH 版本：service token 会分裂，插件看起来已激活，却无法注入或正确 dispose。核心 `@deepseek-ai/*` 和 `@agi-fans/dsh-tui` 保持为随包发布版本的 peer；`omdsh plugin` 在安装时拒绝不兼容的版本范围，若解析出两份拷贝，启动失败并大声报错。

安装或移除 bundle 后需要重启；对 `node_modules` 做热替换不在范围内。监视 `cordis.patch.yml` 可以后补，以对齐官方长驻 DSH 界面，但不是第一次落地的必要条件。

## 计划中的用户流程

```sh
omdsh plugin add @scope/dsh-llm-example
omdsh plugin remove @scope/dsh-llm-example
omdsh --dump-config
```

`omdsh plugin` 在首次使用时初始化 `$OMDSH_HOME/profiles/omdsh`，在该目录运行 `pnpm`，并对照已安装且声明了 `dsh.bundle.patch` 的软件包，调和 `dsh.profile.bundles`。不属于 Profile 依赖的模板 / 产品 bundle 留在列表中。普通库依赖会被安装，但不会成为一层；后续版本若增加 `dsh.bundle.patch`，会在下一次成功的 `omdsh plugin` 运行时加入列表。

`--dump-config` 通过 `renderConfigDump` 打印组合后的入口列表，并用注释标出每一层的来源。该转储是查看实际 composition 的受支持方式。

成功添加后，重启 omdsh。新的 LLM 路由出现在 `/model`。新命令出现在 `/help`。需要浏览器或 device-code 步骤的 Auth 由插件自己拥有该生命周期，并使用 `ctx.tui.prompt` 提出任何终端问题。

## 实现顺序

1. 已完成。启动会应用 `$OMDSH_HOME/cordis.patch.yml`，`omdsh --dump-config` 会打印组合后的树。
2. 把随包的 `cordis.yml` 表达为 `@agi-fans/oh-my-dsh` bundle，并以空 Profile 根按「产品 → 用户 bundles → Profile patch → home patch → MCP」启动。
3. 针对应用软件包运行 `healProfilesModuleFallback`，并保留 `assertEntriesActivated`，让随包插件可解析，也避免损坏的用户层启动一棵只挂了一半的树。
4. 初始化 `$OMDSH_HOME/profiles/omdsh`，并增加 `omdsh plugin add` / `remove`，包括对照随包 DSH 版本的 peer 范围检查。
5. 等真实用户 bundle 能挂上之后，再发布带冻结 `status`、以及必要时 `card` case 的 `ctx.tui.contributions`。安装器存在之前，不要把这些类型放进稳定导出，也不要打开活的注册表。

`apps/omdsh` 拥有 Profile、安装器、转储和 composition。`@agi-fans/dsh-tui` 拥有 `ctx.tui` 和 `ctx.tui.contributions`。插件依赖这些服务和已发布类型，不依赖 Renderer 内部实现。

## 编写 bundle

bundle 是一个 npm 软件包，其 `package.json` 包含：

```json
{
  "name": "@scope/dsh-example",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

`cordis.patch.yml` 是 Cordis include 补丁组成的 YAML 数组。常见写法是一个 `insert` 列表，列出插件行：

```yaml
- insert:
    - id: example-provider
      name: '@scope/dsh-example'
```

将 `@deepseek-ai/*` 和 `@agi-fans/dsh-tui` 作为 peer，固定到 omdsh 随包发布的同一 DSH 版本。不要在 bundle 自己的 dependencies 里再嵌一份 `cordis` 或 `dsh-*`。只导入已发布的软件包导出。不要进入 `refs/`。不要假定存在 Host、HTTP 或 Web UI。

优先使用现有缝：

- 在 `dsh-commands` 上注册命令；
- 在工具定义上注册带展示意图的工具；
- 在 `ctx.llm` 上注册 LLM 路由；
- 通过 `ctx.credentials` 存储密钥；
- 通过 `ctx.tui.prompt` 向用户提问。

需要自定义 Transcript 块、overlay、主题包或独占 TTY 的插件，不在第一批兼容集合内。`ctx.tui.contributions` 发布后，只有 `presentCall` / `presentResult` 表达不了卡片时才注册带类型的卡片 presenter，status segment 发布的是 projection id，而不是本地计数器。

## 相关文档

- [架构](architecture.zh-CN.md) — 产品 composition 与 TUI 所有权
- [Skills 与 MCP](skills-and-mcp.zh-CN.md) — 文件系统 Skills 与 MCP Server 文档
- [Issue #1](https://github.com/agi-fans/oh-my-dsh/issues/1) — 本模型所回应的用户请求
