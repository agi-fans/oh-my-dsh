# TUI transcript 折叠改造方案

状态：**批次一、二、三已实施，批次四起未实施**。v2 依据 DeepSeek Harness 官方 Web 客户端（`refs/deepseek-harness`，tag `dsh-v0.2.0-rc.1`）的实际实现重写了 v1 的两个核心决策，并引入官方采用的两级折叠模型与策略表。v3 记录批次一的实际落地结果与三处 omdsh 自主决策。

## omdsh 的自主立场

三个参考项目（DSH Web、oh-my-pi、pi）都是**证据来源，不是模板**。批次一落地时有三处明确偏离了参考实现，理由是 omdsh 已有更好的答案：

**P1 · 状态归页脚，transcript 只记事实。** 官方 Web 在组头上重复活动状态与 `liveProcessDetail` 标题；omdsh 已有常驻的两行状态栏承担"现在在做什么、花了多久"。折叠行因此**不画 spinner 相位、不画耗时、不写 running 字样**——重复一遍只会让两个地方打架。状态只有一个来源。

**P2 · 复用既有展示层，不新造摘要层。** 官方需要 `deriveSummary`，因为它的 `ToolCallView` 常常给不出标题，必须从原始参数里反推。omdsh 已经有完整的 `renderTool`，为每个工具族算好了语义 title 与尾部事实。批次一直接复用它，只补了一个 `toolArgSubject` 处理"无 card 时原始参数对象被 pretty-print 成 `{`"这个真实缺口——这比移植整个 `deriveSummary` 少一层概念。

**P3 · 边框只表示"你打开过它"。** `AGENTS.md` 既有规则要求"边框只在表达真实组件边界或交互状态时使用"。批次一最初让成功调用不带框、失败调用保留框，于是边框表示"这里有值得读的内容"；批次二按 DSH Web 的做法改成失败也折成一行（错误文本即那一行的事实，详见 E2），边框因此只剩下一个含义：**读者打开过它**。成功与失败一视同仁，都默认一行，唯一的差别是那行末尾写什么。

**P5 · 不把 reasoning 拆成独立的 block。** 官方把 assistant 消息的内容建模成 `AssistantBlock` 五路联合（`text | reasoning | image | tool-call | other`），于是思考天然是一个可寻址、可折叠的单位。我们没有照搬这个形状：`reasoning` 仍是 assistant block 上的一个扁平字符串，折叠态用一个 `turn:step` 键挂在 provider 侧。理由是收益不成比例——拆成独立 block 会牵动 replay、resume 和旧日志兼容，而批次三要解决的是"别把思考铺满屏幕"，段落边界预览一行就够。批次四做 turn 分组时再一起决定形状，届时如果分组需要一个"一个 assistant 可以贡献 reasoning 到组、贡献回答到组外"的能力，才真的需要 `groupPart` 那种结构。

**P4 · 一行就是一行，全文就是全文，没有中间态。** omdsh 原本有第三种形态：带框但输出截到 10 行，末尾挂 `… N more lines · ⟨Ctrl+O: Expand⟩`。折叠之后这条路径不可达（一个 tool block 只在 `toolsExpanded` 为真时才带框），于是整段删除。半截输出是唯一一种读者无法主动阅读的呈现——他无法知道被丢掉的是开头还是结尾。代价是打开一个 5000 行的构建日志会刷屏，由 `windowTranscript` 的窗口裁剪和滚动承担，这与终端里任何长内容的处理一致。

关于折叠层级：官方是"turn 窗口 > step group"两级。omdsh 只做**一级**（turn 边界）——终端只有 35–45 行可用，再嵌一层披露会让读者多记一个层级，而 turn 本来就是他心里的单位（发一条消息、agent 干活、给出回答）。官方那条"回复内容结束过程窗口"的打断规则（`process-groups.ts:159-161`）正好支持一级折叠。

## 批次一至三已实施

| 文件 | 改动 |
| --- | --- |
| `views/transcript-render.ts` | 新增 `toolRowLine` 与 `toolFailureFact`；tool 分派在未展开时一律走行；删除 `slicePreview` / `toolPreview` / `TOOL_COLLAPSED_LINES` 与展开提示 |
| `chrome/tool-renderers.ts` | 新增导出 `toolArgSubject`，从原始参数里取单行主语 |
| `chrome/renderer.ts` | `TranscriptScroll` 增加可选 `blockStarts` |
| `views/transcript-render.ts` | 把 `blockStarts` 挂进 frame 的 transcript |
| `runtime/provider-local.ts` | 新增 `#blockStarts` 与 `#viewportBlock()`；`#toggleToolExpansion` 改为瞄准视口所在的调用 |
| `views/tool-row.spec.ts` | 新增，折叠行与失败行契约测试 |
| `views/reasoning-row.spec.ts` | 新增，思考预览算法与折叠行契约测试 |
| `chrome/theme.ts` | `SYMBOL.reasoning`（`⋆`，单色星号算符，非 emoji 呈现） |
| `views/transcript-types.ts` | 新增 `reasoningKey()`，以 `turn:step` 定位某一步思考的折叠态 |
| `views/event-views.spec.ts` | 重写折叠语义测试；框体测试改走展开路径；补"失败行显示错误、展开后恢复 diff" |
| `runtime/provider-local.spec.ts` | 重写 Ctrl+O 折叠测试；新增滚动后可展开测试 |

实际效果（84 列，典型一回合）：

改前 3 次工具调用约 51 行；改后 3 行：

```
✔  read  package.json
✔  read  pnpm-workspace.yaml
✔  bash  pnpm test
```

失败的命令折成一行，事实是工具自己抱怨的第一句（跳过终端回显的命令行和空行），并用 error 颜色上色，在滚动中一眼可辨：

```
✘  bash  pnpm --filter @agi-fans/dsh-tui te…  FAIL  src/views/settings-list.spec.ts…
```

**一处必须随批次一起做的配套**：折叠后回滚到历史的老行如果无法展开，就是把内容永久藏起来了。`#toggleToolExpansion` 因此从"最后一个工具块"改为"视口所在的工具块"，需要 `blockStarts` 才能把视口行号映射回块下标。该行为有一条**已验证能捕获回归**的测试：把实现回退到旧的 `findLast` 后该测试失败（屏幕上看不到任何变化），恢复后通过。

**一处实施中踩到的陷阱**：删除 `TOOL_COLLAPSED_LINES` 导出后，`event-views.spec.ts` 仍在导入它。vitest 对缺失的具名导出**静默给出 `undefined`**，于是 `Array.from({ length: undefined + 4 })` 变成空数组，测试用空数据通过了断言。`tsc` 没有拦住（spec 之外还有 re-export 链）。凡是删除导出，必须同步检查所有 import 点而不是只信类型检查。

## 相对 v1 的修订

v1 是只看 oh-my-pi 得出的结论。读过官方实现后，有两处必须推翻：

| | v1 结论 | 官方实际做法 | 判定 |
| --- | --- | --- | --- |
| 工具失败时 | **强制展开**输出框 | 错误文本**提进折叠摘要行**，不强制展开 | v1 错。摘要行直接显示失败原因，展开与否交给用户，信息不丢而噪声更低 |
| 折叠粒度 | 每个 tool 一行 | 一个 turn 内的过程归为一个 **process group**，组头是**类别聚合** | v1 太浅。官方是两级折叠，v1 只想到一级 |

另有三处 v1 遗漏或写错：

- v1 的 UI 稿给折叠行画了 `⏱ 12.4s` 耗时。官方折叠行**不显示耗时**，后缀是 diff 增减 `+N -M` 或视图自定义后缀。
- v1 沿用 `TOOL_COLLAPSED_LINES = 10` 的"偷看 N 行"语义。官方**没有任何行数上限**——工具输出要么全显、要么全隐。这两种语义不能混用，见 D7。
- v1 没意识到折叠密度应该是一个**用户设置**而不是一次重设计。官方用一张四行策略表解决（见 D3）。

## 官方折叠基线

以下均来自 `refs/deepseek-harness`，是 omdsh 的参考而非依赖。

### 两级折叠

**外层 · turn process window**：一个 turn 关闭后整块折叠，折叠条件是 `foldCompletedTurns && turnClosed && !alwaysOpen`（`packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx:152-153`）。

**内层 · step/process group**：turn 内的 reasoning、tool call 归为一个组，用 `useDisclosure()` 控制（`ChatGroupSeat.tsx:136`）。

两层状态都是**内存态**，不随 reload 或 resume 保留；持久化的只有密度模式本身（`chat-settings.ts:1-12`）。

### 策略表

`packages/client/ui-chat/src/client/presentation-policy.ts:24-53`：

| mode | `foldCompletedTurns` | `stepGrouping` | `liveProcessDetail` | `settledReasoningPreview` |
| --- | --- | --- | --- | --- |
| `compact` | true | `collapsed` | false | false |
| `standard` | true | `collapsed` | true | true |
| `detailed`（默认） | true | `history` | true | true |
| `verbose` | false | `none` | false | true |

渲染器**只读布尔字段，不比较枚举**（`presentation-policy.ts:1-4`, `:74-77`），加一个模式是改一张表的事。

### 分组是一等模型

`GroupSnapshot<Data> = { key, data, members: readonly NodeReference[] }`（`packages/client/ui-conversation/src/client/contract/groups.ts:29-33`），存在 `ConversationGroupStore` 的 `Map` 里，配一个 `NodeKey → Set<groupPart>` 的位置索引（`conversation/group-store.ts:44-48`）。

`NodeReference` 可以只指向一个 Node 的**某一部分**（`groups.ts:13-17`），所以同一个 assistant 记录的 reasoning 可以进组、回答留在组外。

打断规则五条（`conversation-nodes/process-groups.ts:146-165`）：顺序断裂、遇到独立节点（user / steering / turn-trigger / model-retry / turn-error / turn-max-tokens / turn-tail）、assistant 产生回复内容、`turn-process` 独立成组、turn 结束关闭全部。

组键由内容派生 `brandString(['process', first.key, first.groupPart])`（`:132`），`extendedGroup`（`:173-190`）只在整组连续存在时复用旧键，使披露状态在流式追加中不丢。

### 组头是类别聚合

`ProcessActivitySummary.counts[]` 是按类别排序的计数（`contract/process-groups.ts:6-12`），类别含 read / write / edit / search / commands / subagents / plan / questions（`ChatGroupSeat.tsx:37-52`）。

关闭态标题由 `processTitle()` 生成（`step-process.ts:11-28`）：取**前三个类别**，**不带次数**，两个类别走 `joinTwo` 模板并做 `sharedPrefix` 去重，超过三个时追加 `and N more`。

运行中标题另有 `liveProcessDetail` 控制，并带 **150ms 防抖**（`PROCESS_TITLE_MINIMUM_MS`，`ChatGroupSeat.tsx:27`, `:58-81`）——这是行为防抖，不是动画，目的是让一串快速工具调用不把标题闪成一团乱码。

### 错误进摘要行

这是推翻 v1 的那条。`ToolRow.tsx:182-183`：

```
failureLine = state === 'error' ? errorSummary ?? normalSummary : null
```

失败时**摘要行本身**换成错误首行。`useDisclosure` 无条件初始为关闭（`use-disclosure.ts:11-21`），`ToolRow.tsx:171` 的 `open = expanded && expandable` 从不覆盖它。

唯一的强制展开在 **turn** 级，且看的是 turn 的结束原因而非单次工具失败：`turnProcessAlwaysOpen` 对 `status === 'open' || reason === 'aborted' || reason === 'error'` 返回 true（`contract/turn-process.ts`，消费于 `ChatGroupSeat.tsx:146-147`）。

### 思考预览

reasoning 是 assistant 消息里的**独立有序 block**（`AssistantBlock` 五路联合 `text | reasoning | image | tool-call | other`，`records.ts:33-38`），不是扁平字段。

折叠态摘要算法（`ReasoningRow.tsx:11-32`）：

- **流式中**：取**最后一个完整段落**的首行（按空行切段），因此永远不会显示半句。
- **已结束**：取全文首行。
- 剥离 `**` 标记，**不显示 token 数、不显示耗时**。

展开后是完整 Markdown（compact 变体，`ReasoningRow.tsx:69-72`）。

### 通用回退行

没有专用视图的工具走 `GenericToolCard`（`packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx:33-74`），摘要由纯函数 `deriveSummary`（`models/tool-call-model.ts:226-240`）派生：

- 先 `JSON.parse` 失败则当原始字符串（流式截断的 args 也走这里）。
- 按工具族取第一个非空字符串键：`bash: description|command`、`read: path|file_path|url`、`search: query|pattern|url`、`write/edit: path|file_path`、`code: description`（`:215-223`）。
- 再退到任意首个字符串值属性，再退到原始 args。
- 一律 `firstLine` 截断。
- 路径相对 `cwd`、home 缩写为 `~`（`:293`）。
- 折叠行**无行数上限**，靠 CSS ellipsis 处理宽度（`ToolRow.tsx:41-47`）；`summarySuffix` 刻意放在 ellipsis 之外，让窄屏先裁摘要、保留尾部事实。

注册机制是单一 keyed slot `tool.call.toolview`，`renderSlot(..., { fallback: <GenericToolCard/> })` 一次原子派发同时覆盖根调用和递归子调用（`ToolCallTree.tsx:57-61`, `:90-108`）。

### 按工具的行数上限

只对**展开后的正文**生效：read 与 search 各 8 行（`ToolRow.tsx:269`, `:293-298`），diff 走 `CHAT_DIFF_MAX_LINES`，**bash 是 `Infinity`（可滚动）**（`bash-sample.tsx`、`ToolRow.tsx:259-264`）。折叠行本身没有上限。

## 可借鉴 vs 不可借鉴

**结构性（可移植）**

1. reasoning 作为独立有序 block，而非扁平字符串字段。
2. 四行策略表 + 渲染器只读布尔。
3. 组作为一等不可变快照 + 稳定内容键 + 独立位置索引。
4. `NodeReference` 可指向 node 的某一部分。
5. 组键内容派生 + 连续性复用键。
6. 五条打断规则。
7. `counts[]` 聚合模型与"前三类别 + and N more"的关闭态标题。
8. 150ms 运行标题防抖。
9. 错误提进摘要行。
10. `deriveSummary` 的按族取键 + 首行截断 + 路径相对化。
11. 单一 keyed registry + 强制通用回退。
12. 折叠时不构造内容（`ReasoningRow.tsx:70-74`、bash 视图同构）。

**web 专属（不要移植）**

1. `hidden="until-found"` + `beforematch` 浏览器查找揭示（`searchable-hidden.ts:21-29`）。终端没有"已布局但隐藏"这个状态——可见性就是**不发出单元格**。
2. `max-height: min(400px, 50vh)` 的组体上限与淡出边（`ChatGroupSeat.module.css:76-77`）。终端没有 `50vh`，回滚区里再嵌一个滚动区是糟糕交互。
3. `use-process-scroll` 整套机制（`ResizeObserver` / `scrollend` / 平滑滚动 / 边缘淡出）。
4. 全部 DOM / ARIA / 动画 / React 机制。
5. `openFile` 拉起宿主编辑器、`loadImage` 图库 slot。
6. CSS ellipsis 处理宽度。**这是最需要改写的一处**：终端必须按显示格预算截断（`AGENTS.md` 已有规则），纯模型要接受"可用宽度"参数而不是吐出整串。
7. `presentCall` / `presentResult`：**全仓零消费者**。它们只是声明式词汇（`packages/core/tools/src/index.ts:290`, `:298`），软校验失败返回 `undefined` 以便回放旧日志（`schema.ts:609-624`），但 `apps/web`、`apps/desktop`、`apps/cli`、`packages/client`、`packages/tui` 里没有任何渲染器调用。**不投入。**

## omdsh 改造方案

### 决策

**E1 · 采纳两级折叠。** 外层 turn process window + 内层 step group。当前 omdsh 只有"每个 tool 一个块"这一级。

**E2 · 错误进摘要行，不强制展开**（推翻 v1 的 D1，批次二已实施）。工具失败时折叠行直接显示错误首行，并按 error 颜色上色；展开才看完整输出。信息不丢，噪声更低，且与官方一致。turn 级的整组强制展开等批次四。

**E3 · 引入策略表。** `compact | standard | detailed | verbose` → 四个布尔，渲染器只读布尔。折叠密度进 `/settings`，不再是一次性重设计——这同时回答了"这个框到底该不该存在"，答案交给用户偏好。

**E4 · 思考预览取最后一个完整段落的首行**，流式时不显示半句。需要把 `reasoning: string` 从扁平字段提升为独立 block（对齐官方 `AssistantBlock` 联合）。

**E5 · 采纳 `deriveSummary` 的按族取键规则**，并把 CSS ellipsis 换成显示格预算。折叠行不加耗时，尾部放 diff 增减 `+N -M`。

**E6 · 折叠时不构造内容。** 终端直接不产出行，不做"渲染后遮盖"。

**E7 · 不做"偷看 N 行"。**（批次二已落地，见 P4）官方对折叠行没有任何行数上限，只有全显或全隐。原来的 `TOOL_COLLAPSED_LINES = 10` 预览路径在折叠后不可达，已整段删除，现在只有一行和全文两种形态。

**E8 · 运行中组标题 150ms 防抖**，避免快速工具调用把标题闪成乱码。

**E9 · 折叠态持久化——与官方有意分歧。** 官方只持久化密度模式，逐条披露状态丢失。我们有 `--resume`，会话从磁盘恢复，用户大概率希望折叠态跟着回来。建议与 E3 的密度一起持久化到 profile。

**E10 · 不实现 `presentCall` / `presentResult`。** 零消费者，投入无回报。

**E11 · 折叠行光标仍然需要**（保留 v1 的 D2 结论）。官方用点击展开，终端没有鼠标。这条与官方无法对齐，只能自建。

### UI 对照

折叠行符号沿用 `SYMBOL`（`chrome/theme.ts:24-34`），边框取 `BOX`（`theme.ts:9-21`）。

**一个回合读 3 个文件、跑 1 条命令**

改前，约 51 行：

```
╭─── ✔ Read packages/tui/omdsh-tui/src/views/event-views.ts 581/581 lines ─────────╮
│    1  import type { Block } from '../views/transcript-types.ts'                   │
│   … （共 10 行预览）                                                              │
│ ╰────────────────────────────────────────────────────────────────────────────────╯
╭─── ✔ Read packages/tui/omdsh-tui/src/views/transcript-render.ts 1210/1210 lines ─╮
│   … （共 10 行预览）                                                              │
│ ╰────────────────────────────────────────────────────────────────────────────────╯
╭─── ✔ Read packages/tui/omdsh-tui/src/views/transcript-types.ts 135/135 lines ────╮
│   … （共 10 行预览）                                                              │
│ ╰────────────────────────────────────────────────────────────────────────────────╯
```

改后，运行中约 3 行：

```
⟳ 思考 · 先确认这个回合读了哪些文件
  ⟳ 读文件 · event-views.ts 581/581 · transcript-render.ts 1210/1210 · +1 more
  > 运行命令 · pnpm test
```

turn 结束后整块折叠，约 1 行：

```
▾ 处理 · 读文件、运行命令  ✓ 3 +2 −0                        ⟨Enter: 展开⟩
```

**命令失败**

```
▸ 思考 · 先确认这个回合读了哪些文件
▸ 读文件 · event-views.ts 581/581 · transcript-render.ts 1210/1210 · +1 more
✘ > 运行命令 · pnpm test
```

失败行的摘要**就是错误本身**，不强制展开。展开后：

```
✘ > 运行命令 · pnpm test
│ ╭─ Output ───────────────────────────────────────────────────────────────────────╮
│ │ ✘ FAIL  packages/tui/omdsh-tui/src/views/settings-list.spec.ts                  │
│ │   × toggles a feature row off                       4 passed | 1 failed          │
│ │ ╰────────────────────────────────────────────────────────────────────────────────╯
```

**turn 以 error 结束**（E2 的例外）：整组强制展开，与官方 `turnProcessAlwaysOpen` 一致。

### 分期

| 批次 | 状态 | 内容 | 依据 | 规模 |
| --- | --- | --- | --- | --- |
| 一 | 已实施 | 工具单行折叠（复用 `renderTool` 而非移植 `deriveSummary`） | P1, P2, E6 | ~90 行 |
| 二 | 已实施 | 失败折成一行，错误文本即事实；删除不可达的截断预览 | E2, P3, P4 | ~60 行 |
| 三 | 已实施 | 思考折叠 + 段落边界预览（**不改数据结构**） | E4, P5 | ~90 行 |
| 四 | 未实施 | process group 分组 + 类别聚合组头 | E1, E8 | ~220 行 |
| 五 | 未实施 | 策略表 + `/settings` 密度设置 + 持久化 | E3, E9 | ~130 行 |
| 六 | 未实施 | 折叠行光标 | E11 | ~120 行 |

批次一至三已发布；四补上分组，五、六是打磨。

**下一步建议做批次四**：把一个 turn 内的过程归为一个组，组头是类别聚合。批次一至三已经让每个调用和每段思考各占一行，缺的是把一整段过程收成一个可折叠的单位。

## PTC 前向兼容

PTC（programmatic tool calling）模式下模型不再直接发 `tool/call`，而是发一个 `run_code`，程序里的每个工具调用记录为 `tool/ptc-dispatch-start` / `tool/ptc-dispatch`（`packages/core/tools/src/types.ts:10-25`），携带 `rootCallId` / `parentCallId` / `subCallId`。这些事件**只进日志，不进模型上下文**（`:60-62`）。

**这不是假设性的未来风险，omdsh 现在就有这个缺口。** `apps/omdsh/config/cordis.yml:364` 挂载 `@deepseek-ai/dsh-ptc-runtime-node`，`:595` 挂载 `@deepseek-ai/dsh-workflow-ptc`，并且 `/agent` 有一个 **PTC preset**（见 `apps/site/content/*/tutorials/first-task.md` 的 Agent 一行）。

当前状态：

- `views/trajectory.ts:275,289` **已经**处理 PTC 事件，用 `parentCallId` 区分 `TOOL` / `SUBTOOL`，把 `parentCallId` 存在记录上。也就是说 `/trajectory` 检视面能看到内层调用。
- `views/event-views.ts`（主 transcript）**完全没有**处理 `tool/ptc-dispatch*`。

后果：选中 PTC preset 时，一条 PTC 回合的持久化日志里只有 1 个 `tool/call`（`run_code`），主 transcript 显示这一行，**所有内层工具调用静默消失**——事件都在，只是匹配不到任何 `tool/call` 头。折叠改造不会造成这个问题（改前改后都丢），但折叠让外层那一行更不显眼，问题更难被发现。

官方为此把工具调用渲染成**递归树** `ToolCallTree` / `ToolCallBranch`（`packages/client/ui-tool/src/client/tool/ToolCallTree.tsx:90-108`），内层子调用**常驻可见**、只有正文折叠；投影前强制做**深度上限 256 与环检测**（`packages/client/ui-chat/src/client/model/tool-call-tree.ts:164-199`）。

需要的是：一个 `parentCallId → children` 索引、一个带 `parentCallId` / `subCalls` 的块形状、投影前的环与深度防护、以及能容忍窗口切断 start/settle 配对的追加逻辑。

**建议：这不是「可选批次」，是一个已存在的缺陷，应单独立项修复。** 但它与折叠改造无耦合，且修复规模（树形投影 + 渲染 + 索引）超过本方案任一批次，因此不并入折叠批次。`trajectory.ts` 已经有可复用的 `parentCallId` 处理与 `#toolByCallId` 索引，是修复的起点。

## 影响面

| 文件 | 改动 |
| --- | --- |
| `views/transcript-types.ts` | `Block` 联合扩展：reasoning 独立块、group 块、工具块带 `turn`/`step` |
| `views/transcript-render.ts` | `blockLines` 分派；新增 `deriveSummary` 系列的纯函数；组渲染器 |
| `views/event-views.ts` | 事件到块的映射，产出 groupPart |
| `views/workspace-changes.ts` | 跟随折叠语义 |
| `runtime/provider-local.ts` | 折叠态存储、策略读取、组光标 |
| `views/settings-list.ts` | 新增密度设置项 |
| `input/keybindings-config.ts` | 折叠行光标动作 |
| `chrome/width.ts` | 复用显示格预算；如需则加按预算截断的助手 |
| `CHANGELOG.md` | `Unreleased` 记 `Changed` |
| `apps/site/content/{en,zh}/` | 用户可见行为变化，双语同步 |

**不改**：`session/session-controller.ts` 的投影适配、`definition.ts` 的服务契约、组合行 `cordis.yml`。

## 风险

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 渲染缓存键漏掉新折叠态，复用错误的 `blockStarts` | 高 | 现有 `cached.toolsExpanded` 已在比较里（`transcript-render.ts:510`），所有新折叠态必须一并进入；写一个"折叠态变化必须使缓存失效"的纯函数测试锁死 |
| 分组改变 block 数组长度，冲击搜索 / focus / `blockStarts` 位置索引 | 高 | 这正是 v1 推迟 Read 分组的原因。批次四必须先给这三处加回归测试再改 |
| 流式期间组标题抖动 | 中 | 150ms 防抖（E8），并用纯函数测标题合成 |
| reasoning 从扁平字段升为 block，触及 replay 与 resume | 中 | 旧日志无独立 reasoning 事件，需在 `event-views.ts` 保留从 assistant 消息回填的兼容路径 |
| 折叠态持久化（E9）与 profile 写入路径冲突 | 低 | 复用 Features 分区已验证的 patch 托管块写法 |
| 展开后正文行数不再有上限，长输出刷屏 | 中 | E7 明确了全显语义；必要时单列 peek 设计，不与折叠混用 |

## 测试计划

**纯函数**（`views/*.spec.ts`）

- `deriveSummary` 逐族：read / bash / search / write / edit / code / 未知；args 为非法 JSON（流式截断）；空 args；首行截断；`~` 与 cwd 相对化。
- 错误摘要行：error 首行优先、无错误文案时回退正常摘要。
- reasoning 预览：无完整段落时为空、单段落、多段落取最后一个、流式半句不泄漏、`**` 剥离。
- 策略表：四模式 → 期望布尔；渲染分支只读布尔。
- 组标题：1 / 2 / 3 / >3 个类别的合成；`sharedPrefix` 去重；`and N more`。
- 分组打断规则：五种打断各一例；组键内容派生；连续性复用。
- 折叠态与缓存键：折叠态变化时缓存必须失效（锁死上面那条高风险）。
- 显示格：20 / 40 / 80 / 120 列下折叠行不溢出；CJK、emoji、组合字符按显示格。

**交互**（fake-TTY 或 provider 层）

- 折叠行光标：进入、移动、Enter 切换、Esc 退出。
- 仲裁：光标激活时 ↑/↓ 不进 editor。
- 策略切换后渲染差异。

**端到端**（`apps/omdsh/src/*.spec.ts`）

- 真实进程跑一个回合：思考一行、工具按组折叠、失败命令摘要行显示错误、turn 错误时整组展开。

**门禁**：触及共享渲染与输入路径，`pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm check:md` 全量，并补 `pnpm smoke`。

## 未纳入本批

- **Read 调用合并分组**。已被本方案批次四的 process group 覆盖——官方分组是通用的过程分组，不是 Read 专用。单独做 Read 分组会与批次四重复。
- **配额 / 限流面板**。DSH 0.2.0-rc.1 无任何 cost 或 rate-limit API，全量扫描已发布 `.d.ts` 对 `cost|usd|price|rateLimit|quota|resetAt|remaining` 零命中；上游显式不读 provider cost 元数据（`refs/deepseek-harness/packages/llm/llm-pi-ai/src/catalog.ts:34-37`）。且 `/context` 已打印等价表格（`session/context-diagnostics.ts:39-46`）。
- **会话分叉**。DSH 已原生提供 `SessionStore.fork()`（`node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:469`），官方 Web 也有 `fork-mid-turn` 相关形态，值得单独立项，与折叠无耦合。
- **PTC 树形渲染**。见前向兼容一节：omdsh 已挂载 PTC runtime 并提供 PTC preset，主 transcript 目前会静默丢掉全部内层调用。**已存在的缺陷，应单独立项**，不并入折叠批次。
- **`presentCall` / `presentResult`**。零消费者，不投入。

## 待验证

- 官方 `stats-paged-history`、`streaming-fence-highlight`、`live-job-stream`、`sidebar-subagent-activity` 四个 fixture 尚未核查，可能还含折叠相关断言。实施批次四前应先看完。
- 官方是否对 turn 内 tool call 数量设上限（超长回合的组如何退化）未验证。
- 策略表是否可经 `ui-chat` 命名空间的用户设置文档被 TUI 消费尚未验证——大概率不可，TUI 需要自己的一套。
