# TUI 渲染与浏览约束

状态：已实现；按 omdsh `0.19.0` 核对。用户键位见[键盘与快捷键](../../apps/site/content/zh/keyboard.md)，外观配置见[设置](../../apps/site/content/zh/settings.md)。Pi、Codex 和 oh-my-pi 提供交互研究依据，运行时与渲染实现均由 omdsh 自有包维护。

## 回合与工具

运行中的 turn 平铺显示思考正文、中途回复和工具预览。结束后把中间过程收为 `Worked for 16s` 这样的耗时摘要，保留完整最终答复；失败事实不能只藏在摘要内。回合分组是 block 列表的渲染投影，不增加新的 durable 事件或独立分组模型。

| 操作 | 行为 |
| --- | --- |
| `Ctrl+O` | 恢复当前阅读的已完成回合的过程预览；在检视中再次按下关闭检视并返回实时底部。运行中的回合已经平铺，不另切换形态 |
| `Alt+O` | 切换当前阅读回合的完整工具输入和结果；若过程被折叠，同时打开过程。再次按下恢复工具预览，保留过程检视 |
| `End`、跳转浮层或检视中滚动到底 | 返回最新内容，关闭回合检视并重置工具详情 |
| `/trajectory` | 独立检查事件与请求轨迹，不共用转录的工具详情状态 |

工具详情的作用域是 turn。PTC 子调用和同一运行中 turn 后到达的调用继承已打开的详情状态。浏览长工具输出时，目标按视口顶部所在 block 定位，不能误选下一回合；从实时底部操作则定位最新回合。搜索命中隐藏内容时必须让命中可见，且搜索导航位置与 block 实际绘制起点保持独立。

“完整结果”指当前 session 记录中可用的内容。若 spill policy 已把原始结果替换为预览和私有文件路径，展开不能凭空恢复被替换的全文；这与转录自身的预览截断不同。

四档转录密度已移除。[fold-policy](../../packages/tui/omdsh-tui/src/session/fold-policy.ts)只负责兼容读取旧配置，所有旧值解析为当前统一布局，不能据此恢复多个产品档位。

## 滚动与视口控件

折叠态和展开态都支持向上浏览。离开最新内容时显示 `Jump to latest message · End` 控件；点击或按 End 回到底部。某 turn 的用户消息已滚出视口、回答仍在视口中时，在顶部显示该请求的摘要，不添加 `›` 前缀。请求范围必须按当前文档行定位，不能把上一 turn 的提示固定在下一 turn 上。

置顶请求和跳转控件只属于视口，不能作为 transcript 内容写入原生历史，也不能改变正文的行映射。工具详情、搜索和普通滚动都需要维持 composer 与两行 footer 的底部位置。

本地 provider 拥有鼠标输入模式：转录浏览启用 `1000`/`1006`，overlay 和 dispose 恢复终端所有权。纯渲染层只提供点击目标的行、列和宽度，不处理原始输入字节。

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

assistant 内容和工具结果必须有水平内边距。工具色块还保留上下留白，pending、success、error 分别读取主题的 `toolPendingBg`、`toolSuccessBg`、`toolErrorBg`；无色模式也保持相同的留白与错误信息。用户消息使用 `userMessageBg`。颜色属于[theme](../../packages/tui/omdsh-tui/src/chrome/theme.ts)，不能散落为工具组件里的固定 ANSI 色值。

布局按 display cells 计算，处理 ANSI、CJK、emoji、字素簇、组合字符、tab 和长无断点命令。截断纯文本不应额外产生 ANSI reset，右侧 padding 和边框不能因 JavaScript 字符串长度判断而消失。宽度实现及独立预言机位于 [width.ts](../../packages/tui/omdsh-tui/src/chrome/width.ts) 和 [width.oracle.ts](../../packages/tui/omdsh-tui/src/chrome/width.oracle.ts)。

格式化行按内容版本、宽度、主题和展开状态缓存；稳定内容不随每次 scroll 或 token 重新排版。流式更新复用显示调度器，后台子 Agent 的更新边界见[会话收尾与子 Agent](session-lifecycle.md)。工具 pending 和原生历史提交状态不能直接决定整个后缀是否重新测宽。

## 实现与验证入口

| 所有者 | 入口 |
| --- | --- |
| 事件投影与终态 | [event-views.ts](../../packages/tui/omdsh-tui/src/views/event-views.ts) |
| 回合投影、工具布局与视口 | [transcript-render.ts](../../packages/tui/omdsh-tui/src/views/transcript-render.ts) |
| 检视状态、键位、鼠标和显示调度 | [provider-local.ts](../../packages/tui/omdsh-tui/src/runtime/provider-local.ts) |
| 原生历史、resize 与实际写屏 | [main-screen-renderer.ts](../../packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts) |
| resize 调查工具 | [trace-resize.mjs](../../scripts/trace-resize.mjs) |

交互回归至少覆盖折叠与展开两种滚动、跨 turn 置顶、长工具输出中的 Alt+O、PTC 和新增调用、返回底部后的状态重置、搜索隐藏内容、文档替换及连续 resize。纯渲染断言与 fake-TTY/终端模型共同验证；涉及原始输入或 viewport 的实现改动另跑 `pnpm smoke`。原始实施与校准记录保留在 [Git 历史](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/tui-transcript-folding-plan.md)，其中被替代的方案不是当前交互规范。
