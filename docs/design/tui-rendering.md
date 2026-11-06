# TUI 渲染与浏览约束

当前实现采用逐项展开与回合收尾折叠。用户键位见[键盘与快捷键](../../apps/site/content/zh/keyboard.md)，外观配置见[设置](../../apps/site/content/zh/settings.md)。Pi、Codex 和 oh-my-pi 提供交互研究依据，运行时与渲染实现均由 omdsh 自有包维护。

## 回合与工具

运行中的 turn 将思考和工具调用显示为紧凑的可展开行，助手回复保持正文展示。结束后过程收为 `Worked for 16s` 一类耗时摘要，所有助手回复和失败事实继续显示。正在检视的项目保持展开，直到读者回到实时底部。回合分组由 block 列表投影，持久事实继续来自 Harness 事件。

| 操作 | 行为 |
| --- | --- |
| `Ctrl+O` | 浏览当前阅读的运行中或已完成回合，方向键选择，Enter 展开，Home 回到工具标题；再次按下或 Esc 结束检视 |
| `Alt+O` | 切换当前阅读回合的完整工具输入和结果；若过程被折叠，同时打开过程。再次按下恢复工具预览，保留过程检视 |
| `End`、跳转浮层或检视中滚动到底 | 返回最新内容，关闭回合检视并重置工具详情 |
| `/trajectory` | 独立检查事件与请求轨迹，不共用转录的工具详情状态 |

工具详情的作用域是 turn。PTC 子调用和同一运行中 turn 后到达的调用继承已打开的详情状态。浏览长工具输出时，目标按视口顶部所在 block 定位，不能误选下一回合；从实时底部操作则定位最新回合。搜索命中隐藏内容时必须让命中可见，且搜索导航位置与 block 实际绘制起点保持独立。

“完整结果”指当前 session 记录中可用的内容。若 spill policy 已把原始结果替换为预览和私有文件路径，展开不能凭空恢复被替换的全文；这与转录自身的预览截断不同。

四档转录密度已移除。[fold-policy](../../packages/tui/omdsh-tui/src/session/fold-policy.ts)仅保留旧配置的枚举值供 schema 兼容读取；运行时不再维护密度策略或对应的缓存条件。旧值不影响当前统一布局，不能据此恢复多个产品档位。

## 键位归属

所有应用程序级按键都属于 [action catalog](../../packages/tui/omdsh-tui/src/input/actions.ts) 中的唯一一个 action。每个条目声明 ship 默认键（`primary`）、迁移期仍可解析但不再展示的别名（`aliases`）、面向读者的标签和作用域。`input/editor.ts` 只处理缓冲区内的编辑：Esc、Ctrl+C、Ctrl+Z、Alt+L 一律返回 `ignored`，由 provider 通过用户实际生效的绑定解析，因此改键不会和编辑器争抢同一个键。

`interrupt`（默认 `Esc`）优先关闭当前临时交互面，返回转录后中断活动回合。`clear-composer`（默认 `Ctrl+C`）在输入非空时清空，输入为空时中断，连续两次退出。已由 Harness 接收的排队与插话消息在会话保持挂载时继续保留，可从 `/queue` 编辑或撤回。子会话检视中的中断作用于当前子会话，具体边界见[会话收尾与子 Agent](session-lifecycle.md)。

`keysForAction` 只打印 ship 主键和用户自己写的键，迁移别名永远不出现在提示里。用户文档把两个 action 绑到同一个键时，`reportBindingConflicts` 报告该键实际解析到的 action，而不是让其中一方静默失效。

## 列表导航

所有列表型界面的移动语义由 [list-navigation.ts](../../packages/tui/omdsh-tui/src/views/list-navigation.ts) 一处解释：`↑`/`shift+tab` 上移，`↓`/`tab` 下移，`Home`/`End` 到两端，`PgUp`/`PgDn` 翻页，`Enter` 确认，`Esc` 与 `Ctrl+C` 都是"关闭一层"。

这条共享的是**解释**，不是行为。每个 surface 仍决定意图如何落地，并在需要别的含义时**先**处理该键：

| surface | 覆盖 | 理由 |
| --- | --- | --- |
| Settings | `tab`/`shift+tab` 切区块；`home`/`end` 跳当前区块两端 | 行属于不同分类，跳到全表首尾没有意义 |
| Trajectory | `Tab` 切列表和详情焦点，`←`/`→` 切详情分区，滚动键操作当前焦点面板，列表 End 跟随新记录 | 分别维护记录选择与内容阅读位置 |
| Prompt 选择器 | 树形视图的翻页用 clamp 而非 wrap | 树是结构，越过末枝会让读者落到无关位置 |
| Transcript 搜索 | 只取关闭与匹配步进 | 它没有列表 |

覆盖必须写在覆盖处并说明理由，不能只在实现里悄悄不同。

交互式列表统一通过 [views/list-view.ts](../../packages/tui/omdsh-tui/src/views/list-view.ts) 渲染：固定两格的选中前缀（`❯`，边缘行显示 `↑`/`↓`）、对齐到同一列宽的主列、描述列、右对齐的数值或计数，以及 `(n/total)` 脚注。宽度按 display cell 相加并在末尾精确收口，绝不靠估算填空；描述列窄于 12 格时直接省略而不是截断成没有意义的片段。

## Header

启动 Header 在常规宽度下占六行，DeepSeek 标志与名称、版本、口号并排，文字块相对标志垂直居中，整体带一格左侧留白。窄终端将文字移到标志下方，宽度小于标志时仅显示文字。快捷键说明可通过 `/help` 查看。

模型与推理强度由状态栏显示，最近会话列表由 `/resume` 提供。

## 状态与确认

composer 上边框承载活动状态（spinner + 标签），下边框承载上一步操作的确认。两者都不写入 transcript：活动行不占转录行，确认在下一次按键时清除。降级顺序为 完整标签 → 仅 spinner，宽度不足时先丢文字而保留“仍在工作”这一事实。上边框右角属于 Access Level；`Esc` 是全 TUI 统一的取消键，不需要在每个运行中的回合上重复提示。真正的会话事件仍然作为 notice block 进入转录。

过程中的工具详情使用中性底色和四周留白，状态文字与符号表达进行中、成功和失败。独立工具卡片使用配套状态底色与文字色。深浅主题分别适配 Catppuccin Mocha 和 Latte，System 跟随终端报告的颜色，普通正文与页面背景由终端控制。有限颜色下仍须保留可读状态标记。

## 思考

思考默认折叠成一行 `Thinking · …`，预览采用最新段落，流式段落的首行完整后才进入预览。已有明确 Shown 偏好继续生效，`Ctrl+T` 修改全局可见性，单个思考仍可独立展开。搜索命中必须打开对应内容。`Shift+Tab` 循环推理强度。

## 滚动与视口控件

折叠态和展开态都支持向上浏览。离开最新内容时显示 `Latest · End` 控件；点击或按 End 回到底部。某 turn 的用户消息已滚出视口、回答仍在视口中时，在顶部显示该请求的摘要，不添加 `›` 前缀。请求范围必须按当前文档行定位，不能把上一 turn 的提示固定在下一 turn 上。

置顶请求和跳转控件只属于视口，不能作为 transcript 内容写入原生历史，也不能改变正文的行映射。工具详情、搜索和普通滚动都需要维持 composer 与两行 footer 的底部位置。

本地 provider 按当前交互面接管鼠标，转录、选择列表、文本阅读器、Trajectory 与 Diff 各自提供点击和滚动目标。Auto 尊重 tmux 的 mouse off，Native 将鼠标留给终端。拖动选择、选中即复制与手动复制遵循用户偏好。退出或交还终端时恢复模式，纯渲染层只提供 display-cell 坐标。

## 原生历史与实时文档

终端原生 scrollback 是不可改写的展示快照；实时视图才是当前 transcript 的事实来源。已显示的过程滚入历史后，turn 完成、工具完成、折叠切换或宽度变化都不能重新播放、清空或改写那些行。因此历史快照与现在折叠后的同一回合不同，是预期行为。

浏览历史留在主屏，仅重绘当前 viewport，不把检视内容重复推入 scrollback。真正的全屏 overlay 可以根据终端 profile 使用备用屏。Frame 的 `transientSurface` 显式区分这两种用途，不能仅用 `liveStart === 0` 推断进入备用屏。

替换文档时保留早先历史，把新文档追加到带标签的边界之后：

- `/clear`、会话切换、resume 和 fork 创建文档边界。
- 首次展示新会话，以及同一文档的 preset、工具目录或 inspector 刷新不创建边界。
- `/new` 只有在此前实时 transcript 含有 notices 和工具目录以外的内容时才创建边界。

renderer 的 `startEpoch()` 开始新的逻辑文档；`reset()` 只修复当前屏幕。两者不能互相替代，也不能擦除启动前的 shell 输出。

## Frame 与 resize

[Frame 契约](../../packages/tui/omdsh-tui/src/chrome/renderer.ts)把正文来源和屏幕位置显式传给 renderer：

| 字段 | 约束 |
| --- | --- |
| `documentRows` | 半开区间标识本帧来自哪些文档行及其屏幕起点；`null` 表示明确无正文，缺省表示来源未知，三者不能混用 |
| `blockStarts` / `blockDrawStarts` | 前者用于导航，后者用于实际绘制跨度；搜索移动导航起点时不能改变绘制跨度 |
| `liveStart` | 原生历史提交边界，不是宽度缓存的失效起点 |
| `foldShape` / `foldMarks` | 描述打开内容引起的行形状变化，用于映射边界，不授权回写历史 |
| `stickyHeaders` / `jumpToLatest` | 视口装饰与点击区域，不是 durable 内容 |

resize 时终端可能把可见行推入历史，也可能在增高时拉回历史行。[主屏 renderer](../../packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts)通过物理行 ledger 对齐实际移动，不能只按新高度估算并重复提交。连续增高、缩高后增高、宽度重排和 overlay 期间的主屏变化都必须保留已经冻结的快照。overlay 使用自己的屏幕时，主屏 resize 状态仍需保存，退出后再对齐。

## 布局、主题与增量更新

assistant 内容和工具结果有水平内边距，工具详情另有上下留白。过程详情使用中性 surface，独立卡片使用主题状态 surface 与配套文字色，无色模式保持相同布局。Shell 输出按纯文本展示，只有可确定语言的源码使用语法高亮，Read 行号列与折行内容分开布局。颜色统一由 [theme](../../packages/tui/omdsh-tui/src/chrome/theme.ts) 拥有。

布局按 display cells 计算，处理 ANSI、CJK、emoji、字素簇、组合字符、tab 和长无断点命令。截断纯文本不应额外产生 ANSI reset，右侧 padding 和边框不能因 JavaScript 字符串长度判断而消失。宽度实现及独立预言机位于 [width.ts](../../packages/tui/omdsh-tui/src/chrome/width.ts) 和 [width.oracle.ts](../../packages/tui/omdsh-tui/src/chrome/width.oracle.ts)。

带样式的文本折行必须用 `wrapTextStable`，不能用 `wrapText`。后者把 ANSI 转义附着到后续字形上，折行时不会重新开启，因此包裹整段的样式只在第一行生效——一条长命令会呈现“首行有色、其余裸奔”。`wrapTextStable` 追踪前景色、粗体、斜体、下划线、反显和超链接并在每个续行开头重开。纯文本或保证单行的调用才可以直接用 `wrapText`。

格式化行按内容版本、宽度、主题和展开状态缓存；稳定内容不随每次 scroll 或 token 重新排版。流式更新复用显示调度器，后台子 Agent 的更新边界见[会话收尾与子 Agent](session-lifecycle.md)。工具 pending 和原生历史提交状态不能直接决定整个后缀是否重新测宽。

长源码阅读器按可见行格式化并复用语法缓存，Markdown 阅读滚动复用已解析布局，流式 Markdown 缓存稳定 token 并继续校验完整语法边界。当前测量和适用限制见[性能报告](../../apps/site/content/zh/performance.md)。

## 实现与验证入口

| 所有者 | 入口 |
| --- | --- |
| 事件投影与终态 | [event-views.ts](../../packages/tui/omdsh-tui/src/views/event-views.ts) |
| 回合投影、工具布局与视口 | [transcript-render.ts](../../packages/tui/omdsh-tui/src/views/transcript-render.ts) |
| 检视状态、键位、鼠标和显示调度 | [provider-local.ts](../../packages/tui/omdsh-tui/src/runtime/provider-local.ts) |
| 原生历史、resize 与实际写屏 | [main-screen-renderer.ts](../../packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts) |
| resize 调查工具 | [trace-resize.mjs](../../scripts/trace-resize.mjs) |

交互回归至少覆盖折叠与展开两种滚动、跨 turn 置顶、长工具输出中的 Alt+O、PTC 和新增调用、返回底部后的状态重置、搜索隐藏内容、文档替换及连续 resize。纯渲染断言与 fake-TTY/终端模型共同验证；涉及原始输入或 viewport 的实现改动另跑 `pnpm smoke`。原始实施与校准记录保留在 [Git 历史](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/tui-transcript-folding-plan.md)，其中被替代的方案不是当前交互规范。
