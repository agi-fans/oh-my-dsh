# TUI 渲染加固实现方案：字素宽度权威、性能上限与决策时刻信息呈现

状态：待评审。范围：`packages/tui/omdsh-tui` 与 `apps/omdsh` 自有代码。本文档只处理**当前工作树核实后**仍然成立的问题，不采信历史计划文档的自述，也不重复 [`tui-upgrade-plan.md`](tui-upgrade-plan.md) 已完成或已登记触发条件的条目。

## 目标与范围

本轮结论来自对当前工作树的只读代码审计、Node 24 直接 import 真实模块的微基准，以及真实渲染帧的终端写出量测量。每项都附可复现的复现命令或断言，未复现的推断一律标注为待验证。

交付分四批：P0 正确性（用户可见的错误布局）→ P1 性能上限与增量渲染 → P1 决策时刻信息呈现 → P2 待决策项与文案一致性。每批独立可验证、可回退。

明确非目标：不改动 `refs/`；不引入新的 DSH cohort；不重做 Renderer / Editor / Overlay 状态机；不做鼠标捕获、UI 本地化、主题市场；不为 `session-projection-cache` 之类的上游能力新建私有缓存层。

## 结论摘要

| 类别 | 问题 | 实测证据 | 量级 |
| --- | --- | --- | --- |
| 正确性 | `charWidth` 漏掉 U+1F650–U+1F8FF，🚀 等 emoji 少计 1 格 | `visibleWidth('🚀') === 1`，终端渲染 2 | 行超宽 → 主屏禁用自动换行 → 右端被吞 |
| 正确性 | ZWJ 序列按码点累加 | `visibleWidth('👨‍👩‍👧') === 6`，终端渲染 2 | 边框内缩 4 格 |
| 正确性 | emoji 修饰符落在宽字符区间 | `visibleWidth('👋🏽') === 4`，终端渲染 2 | 同上 |
| 正确性 | `truncateToWidth` 在字素中间切断 | `truncateToWidth('ab👨‍👩‍👧cd', 5) === 'ab👨…'` | 悬空 ZWJ 残片 |
| 正确性 | `charWidth('\t') === 0`，且 tab 只在两条路径展开 | `wrapText('\tfoo bar', 8) === ['\tfoo bar']` | 含 tab 的代码块丢右侧内容 |
| 性能 | 行内 diff 对齐对 token 建全表 LCS，无上限 | 3000 token 单行替换 63 ms（另一台机器 200 ms） | 长单行 edit 卡整帧 |
| 性能 | `trajectorySearch` 每次全量扫描，按键与每帧各扫 2 遍 | 10k 记录单次扫描 18.3 ms | 搜索态每次按键 +36 ms、每帧 +34 ms |
| 性能 | reveal 每 tick 重切全文，缓存以全文为键必然 miss | 200k 字 2.20 ms/tick | 整段回复累计 O(n²) |
| UX | 审批卡不显示待批调用的具体内容 | `ApprovalRequest.callId` 全仓库零消费 | 审批靠回滚 transcript 找卡片 |
| UX | 回合失败只进 transcript，会滚走 | `event-views.ts:428` 仅 push notice | 回到界面看到安静的空闲态 |
| 能力 | 产品不读 `NO_COLOR`；`#trueColor` 不重算 | 两个 smoke 脚本都设了它 | 偏好失效、CI 无颜色路径未覆盖 |

已确认**不是**问题、不要顺手改的项：滚动帧不重建 block（`transcriptBodyCache` 以 blocks 数组身份为键，滚动只做 `body.slice()`）；空闲重绘 0 字节；200 个流式帧 = 200 次 write / 43 KiB；CJK 换行、CJK 光标列、markdown 表格与长 token 均不溢出；`sanitizeDisplayLine` 正确删除 8 位 C1 CSI（曾怀疑可穿透，实测为误报）。这些是当前实现的既有优点，改动前请保留。

## 批次 1（P0）字素宽度权威

### 1.1 宽度计算引入字素簇

**现状与证据**

- `chrome/width.ts:54-77` 的 `charWidth` 是纯码点函数。emoji 区间只覆盖 `0x1F300–0x1F64F`、`0x1F900–0x1F9FF`、`0x1FA00–0x1FAFF`，**漏掉 U+1F650–U+1F8FF**；`0x1F3FB–0x1F3FF`（肤色修饰符）落在 `0x1F300–0x1F64F` 内被计为 2。
- `chrome/grapheme.ts` 已经用 `Intl.Segmenter` 提供字素几何，但消费者只有编辑器与两个查询框（`input/editor.ts:9`、`views/transcript-search.ts:9`、`views/trajectory.ts:8`）；宽度层完全没有使用它，两套「字符」定义互不通气。
- 后果分两个方向：高估（ZWJ/修饰符）让 `padToWidth` 少补空格，`chrome/box.ts:103` 的右边框左移、`views/event-views.ts:782` 的正文右 padding 塌陷；低估（U+1F650–1F8FF）让行超出终端宽度，而主屏渲染器关闭自动换行（`chrome/main-screen-renderer.ts:26`），超出部分被终端直接丢弃。

**目标**

- 宽度、截断、换行、光标列四类计算对同一段文本给出与主流终端一致的结果。
- 无 ZWJ / VS16 / 修饰符 / 区域指示符的文本（绝大多数行）保持现有逐码点快速路径，不引入可测量的性能回归。
- `charWidth` 的单码点签名不变，避免改动既有调用方。

**方案**

1. 修 `charWidth` 的两处区间：把 emoji 区间补成 `0x1F300–0x1F64F`、`0x1F650–0x1F8FF`、`0x1F900–0x1F9FF`、`0x1FA00–0x1FAFF`（或合并为 `0x1F300–0x1F8FF` 与既有后两段）；在组合字符判断中把 `0x1F3FB–0x1F3FF` 归为 0 宽。
2. 新增字素层 `graphemeWidth(cluster: string): number`：簇内出现 `Extended_Pictographic` 且簇长大于一个码点 → 2；簇为两个 `Regional_Indicator` → 2；否则累加 `charWidth`。
3. `visibleWidth`（`width.ts:80-86`）加一条快速路径：`stripAnsi` 后若不含 `[\u200D\uFE0F\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]`，走现有逐码点循环；否则按字素簇累加。顺带把 `stripAnsi` 的中间字符串分配摊平为一次扫描（当前每行都会分配一个新字符串，而每帧会扫同一行 2–4 次）。
4. `truncateToWidth`（`width.ts:139-159`）改为按簇推进：下一个簇放不下就立即收尾，绝不切开簇，省略号仍然计入预算。
5. `hardWrapAnsi`（`width.ts:195-220`）与 `wrapText`（`width.ts:226-262`）同样按簇推进，保证换行不切断 ZWJ 序列与国旗。
6. `wrapIndexed`（`width.ts:358-399`）、`indexOnWrapped`（`:402-415`）、`cursorOnWrapped`（`:418-436`）按簇推进并保持 UTF-16 偏移语义（`IndexedLine.start/end` 仍是源串下标），`cursorOnWrapped` 的列用簇宽累加而不是 `visibleWidth` 前缀重算。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/width.ts` | 修 `charWidth` 区间；新增 `graphemeWidth`；`visibleWidth` / `truncateToWidth` / `hardWrapAnsi` / `wrapText` / `wrapIndexed` / `indexOnWrapped` / `cursorOnWrapped` 按簇推进 |
| `packages/tui/omdsh-tui/src/chrome/grapheme.ts` | 复用同一 `Intl.Segmenter` 实例；导出供宽度层使用的簇迭代器（避免两处各建一个） |
| `packages/tui/omdsh-tui/src/chrome/width.spec.ts` | 见 1.3 的 golden 表 |
| `CHANGELOG.md` | `Fixed`：emoji 与含制表符内容的终端宽度计算 |

**验证**

- golden 表（与实现解耦的常量）：`🚀`=2、`🛸`=2、`👨‍👩‍👧`=2、`👋🏽`=2、`🇨🇳`=2、`e\u0301`=1、`中`=2、`✅`=2。
- 不变量：任意文本 `visibleWidth(truncateToWidth(t, w)) <= w`；截断结果不以 ZWJ、VS16 或半个区域指示符结尾。
- 渲染级：`renderFramedBlock` 的每一行在含 ZWJ 与含 🚀 两种输入下都必须严格等于给定宽度（当前两者都会失败）。
- 性能：新增一条基准断言，`visibleWidth` 对 200 字纯 ASCII 与纯 CJK 行的吞吐不低于改动前的 80%。

### 1.2 tab 宽度与路径统一

**现状与证据**

- `charWidth(0x09) === 0`，所以 tab 在换行计算里不占宽度。
- `expandTabs`（`width.ts:106-128`，按 8 列制表位）只有两个调用点：`chrome/box.ts:102`、`chrome/diff-render.ts:352`。
- 未处理 tab 的路径：markdown 代码块（`chrome/markdown.ts:449-452`）、表格（`:409`）、`views/trajectory.ts:898`、`views/settings-list.ts:693`；`views/copy-selector.ts:139` 手搓 `.replace(/\t/g,'  ')` 使用了与制表位不同的固定两空格。
- 叠加主屏禁用自动换行后，**模型输出的含 tab 的 fenced code block 会丢掉右侧内容**，而 `fitFrame`（`views/event-views.ts:967-977`）的兜底使用同一个错误度量，抓不住。

**目标**

- 所有面向 transcript 的文本渲染路径对 tab 使用同一制表位语义，且不出现内容被终端截断。

**方案**

1. 把 `expandTabs` 前移到块级渲染入口：markdown 的代码块与表格分支、`trajectory` 详情、`settings-list` 描述、`copy-selector` 预览各自在包装/测量之前展开一次，并删除 `copy-selector.ts:139` 的手搓替换。
2. `box.ts:102` 与 `diff-render.ts:352` 保持现状（已经正确），但改为调用同一个 helper，避免第三套实现出现。
3. `wrapIndexed` 的调用方是 composer 输入。composer 里 tab 是补全键（`input/keys.ts` 的 `tab`）而不是字面字符，因此展开不会破坏光标索引映射；实现时在 `wrapIndexed` 入口加一条断言或注释锁定这个前提。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/markdown.ts` | 代码块与表格分支在测量/包装前 `expandTabs` |
| `packages/tui/omdsh-tui/src/views/trajectory.ts`、`views/settings-list.ts` | 同上 |
| `packages/tui/omdsh-tui/src/views/copy-selector.ts` | 删除手搓替换，改走统一 helper |
| `packages/tui/omdsh-tui/src/chrome/width.ts` | 导出统一的 `expandTabs` 入口（签名不变） |
| `CHANGELOG.md` | 与 1.1 合并为一条 `Fixed` |

**验证**

- 新增用例：含 tab 的 fenced code block 在 `renderMarkdown` 后每一行 `visibleWidth <= width`，且不含 `\t`。
- 回归：`box.spec.ts:27-38` 的既有 tab 用例保持通过（它是当前唯一正确的路径，不要改坏）。
- 人工：用一段 `\t` 缩进的 diff 输出确认右侧不再被吞。

### 1.3 独立宽度预言机（测试基建）

**现状与证据**

- `chrome/box.spec.ts:8-15` 的 `terminalWidth()` 用**被测的 `visibleWidth`** 逐字符拼出期望宽度，只额外处理了 tab。因此 `expect(terminalWidth(line)).toBe(40)`（`:24`、`:35`）与渲染器共享同一套错误认知，`charWidth` 的 emoji 缺口永远测不出来。
- `width.spec.ts` 15 个用例只覆盖 ASCII、CJK 与 `isWideEmojiSymbol` 白名单里的 3 个符号；没有 ZWJ、肤色、VS16、区域指示符、U+1F680 的期望值。
- 全仓库没有一个 spec 引入 `Intl.Segmenter` 或独立宽度来源。

**目标**

- 宽度类断言不再依赖被测函数，形成能捕获 `charWidth` 缺口的独立预言机。

**方案**

1. 新增 `packages/tui/omdsh-tui/src/chrome/width.golden.spec.ts`：期望值写成显式常量表（输入字符串 → 单元格数），由 `Intl.Segmenter` 加手写规则独立计算，**不 import `visibleWidth`**。
2. `box.spec.ts` 的 `terminalWidth()` 改为引用该预言机，使既有的 `toBe(40)` 断言获得真实判别力。
3. 表格覆盖：ASCII、CJK、组合附加符号、VS16 序列、ZWJ 家族与职业、肤色修饰符、区域指示符对、U+1F650–U+1F8FF 的符号、tab、以及 `\t` 与宽字符混排。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/width.golden.spec.ts` | 新增独立预言机与 golden 表 |
| `packages/tui/omdsh-tui/src/chrome/box.spec.ts` | `terminalWidth` 改引预言机 |
| `packages/tui/omdsh-tui/src/chrome/width.spec.ts` | 把仅断言 `<=` 的用例改为断言精确值 |

**验证**

- 预言机自检：对纯 ASCII 输入，预言机结果等于字符串长度（防止预言机自身写错）。
- 反向自检：把 `charWidth` 的 emoji 区间临时改回旧值，1.1 的 golden 用例必须失败——这是本批次的验收核心，测试必须真的有判别力。

## 批次 2（P1）性能上限与增量渲染

### 2.1 行内 diff 对齐加 token 上限

**现状与证据**

- `chrome/diff-render.ts:35` 的 `ALIGN_LINE_LIMIT = 200` 只在行级对齐处生效（`:179`）。
- 行内替换走 `highlightPair`（`:118-124`）→ `alignSequences`（`:68-81`），对 **token** 建 `Uint16Array` 全表且没有任何上限。
- 实测单行替换：200 token = 1.6 ms、1000 token = 7.4 ms、3000 token = 63.0 ms（另一台机器 200 ms），二次方增长，3000 token 时临时表约 18 MB。
- 触发场景具体：模型 `edit` 一个压缩过的长单行文件（长 JSON / 长 JS）。且工具卡运行中时 spinner 每 80 ms 让 `blockLinesCache` 失效（`views/event-views.ts:1023-1038`），卡住的是整帧而不是单卡。

**目标**

- 单卡重渲染耗时与 token 数解耦，最坏情况有明确上界。

**方案**

1. 在 `highlightPair` 内、调用 `alignSequences` 之前加 token 数闸门：任一侧超过 `TOKEN_ALIGN_LIMIT`（建议 400，与实测曲线和 `ALIGN_LINE_LIMIT` 的量级一致）时直接退化为整行 `del` / `add` 两个 `plainRow`，保留增删语义、放弃行内高亮。
2. 闸门常量与行级 `ALIGN_LINE_LIMIT` 放在一起并注释实测依据，避免后来者误以为可以随便调大。
3. 不改 `alignSequences` 本身（行级路径仍需要它，且已被 `ALIGN_LINE_LIMIT` 保护）。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/diff-render.ts` | 新增 `TOKEN_ALIGN_LIMIT` 与 `highlightPair` 闸门 |
| `packages/tui/omdsh-tui/src/chrome/diff-render.spec.ts` | 新增上限与语义一致性用例 |
| `CHANGELOG.md` | `Fixed`：超长单行改动不再拖慢工具卡片渲染 |

**验证**

- 性能门：3000 token 单行替换在宽松上限内完成（建议 20 ms，实测改动前 63 ms、改动后应低于 1 ms）。
- 语义：退化结果的行文本与改动前逐行一致（只有 token 级高亮消失），`countDiffStats` 的增删计数不变。
- 回归：200 token 以下仍走高亮路径，既有用例不受影响。

### 2.2 `/trajectory` 搜索记忆化

**现状与证据**

- `views/trajectory.ts:507-543` 的 `trajectorySearch` 每次调用都遍历整个 ledger 并重建 `matches` 数组与 `counts` Map，没有缓存，注释也写明是 "derived on demand"。
- 按键路径：`moveMatch`（`:568`）扫一遍，再调 `locateMatch`（`:547`）扫第二遍。渲染路径：`ledgerRows`（`:857`）与 `searchPosition`（`:911`）每帧各扫一遍。
- 实测（10,000 条记录、查询 `cache`、15,000 个命中）：单次扫描 18.3 ms；`Ctrl+N` 键路径 36.5 ms；渲染一帧 34.1 ms（无搜索时 8.2 ms）。
- 会话内既有 `TrajectoryLedger`、也有 `normalizedFields` 的字段级缓存，缺的只是结果级缓存。

**目标**

- 搜索态下按键与每帧渲染的成本与 ledger 长度解耦，且不改变匹配语义（仍扫描全量 ledger，包含折叠的 turn 与隐藏的 subtool）。

**方案**

1. `TrajectoryLedger` 增加单调递增的 `version`，`append()` 时自增，并暴露只读 getter。
2. 模块级 `WeakMap<TrajectoryLedger, { version: number; query: string; result: TrajectorySearchResult }>` 缓存 `trajectorySearch` 的结果；键不匹配（版本变化或 query 变化）时重算并覆盖。以 ledger 实例为键，随 ledger 一起被回收，不需要显式失效逻辑。
3. `trajectorySearch` 的返回类型从匿名对象提升为具名 `TrajectorySearchResult`，供缓存与调用方共用；调用点（`:454`、`:456`、`:465`、`:547`、`:568`、`:857`、`:911`）签名不变。
4. 导出 `trajectorySearchCacheStats()`（或等价的可测接缝），让测试能断言「连续两次调用只扫描一次」，否则这个优化无法被回归测试锁定。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/views/trajectory.ts` | ledger `version`、结果级缓存、具名结果类型、可测接缝 |
| `packages/tui/omdsh-tui/src/views/trajectory.spec.ts` | 缓存命中与失效用例 |
| `scripts/benchmark-tui.mts` | 收紧「Search and navigate a 10,000-record ledger」的基线 |
| `CHANGELOG.md` | `Changed`：大会话的 `/trajectory` 搜索导航不再随会话长度变慢 |

**验证**

- 纯逻辑：同一 state 连续调用返回同一结果对象引用；`append` 之后必须重算；改 query 必须重算。
- 语义：缓存开启前后匹配集完全一致（用同一份 ledger 对拍）。
- 基准：现有 `benchmark:tui` 的搜索导航一项从 5139 ms 量级降到百毫秒量级。

### 2.3 流式 reveal 增量切片

**现状与证据**

- `views/streaming-reveal.ts:15-25` 的 `partsCache` 以**全文**为键，而流式文本每帧都在增长，所以除首帧外必然 miss。
- 每个 tick 会调用 `streamingAssistantUnits`（`:44-48`，对 reasoning 与 text 各分一次字素）与 `revealStreamingAssistant`（`:60-67`，再各分一次），即同一段文本每帧被 `Intl.Segmenter` 处理 2–4 次。
- 实测：0.07 ms @ 10k 字、0.52 ms @ 50k、2.20 ms @ 200k；整段回复累计为 O(n²/step)。
- 附带的内存问题：`partsCache` 上限 32，但每项都是**全文**的字素字符串数组，长回复下等于驻留数十份全文副本。

**目标**

- 单个 reveal tick 的成本与「已揭示长度」而非「全文长度」相关，且缓存不再持有全文副本。

**方案**

1. 删除以全文为键的 `partsCache`。
2. `revealText` 改用 `Intl.Segmenter` 的惰性迭代器，取够 `units` 个簇即停止，返回 `text.slice(0, end)`——每 tick 成本降为 O(已揭示簇数)。
3. `streamingAssistantUnits` 的总簇数改为增量维护：由调用方（`runtime/provider-local.ts` 的 `#syncStreamingReveal`）在收到 delta 时累加 `revealUnitCount(delta)` 并缓存在本地，而不是每帧对全文重算。若该改动波及面偏大，退而求其次只在文本变化时重算一次总数（当前是每帧 2–4 次），仍然消除重复。
4. `revealStreamingAssistant` 的返回保持「前缀 block 引用相等」，避免下游 `transcriptBodyCache` 每帧整体 miss（当前 `:70` 每帧新建数组）。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/views/streaming-reveal.ts` | 删除全文缓存；惰性切片；前缀引用稳定 |
| `packages/tui/omdsh-tui/src/runtime/provider-local.ts` | 增量维护总簇数（`#syncStreamingReveal` 一带） |
| `packages/tui/omdsh-tui/src/views/streaming-reveal.spec.ts` | 增量与等价性用例 |
| `scripts/benchmark-tui.mts` | 新增「200k 字单 tick」基准 |
| `CHANGELOG.md` | `Changed`：长回复的流式呈现开销不再随长度二次增长 |

**验证**

- 等价性：对同一 `(text, revealed)` 组合，改动前后 reveal 结果逐字符一致（随机文本对拍，含 ZWJ 与 CJK）。
- 性能门：200k 字单 tick 低于 0.5 ms（当前 2.20 ms）。
- 引用稳定：连续两帧若文本未变，前缀 block 的对象引用必须相等。

## 批次 3（P1）决策时刻信息呈现

### 3.1 审批卡接入 `callId`

**现状与证据**

- `session/interaction-adapter.ts:67-84` 的 `askApproval` 只发 `title: 'Approval required'`、`question: 'Allow <tool> once?'` 与 `detail: request.reason`。
- 上游 `ApprovalRequest.callId` 的注释明确写着 *"lets a UI attach the prompt to the tool call it already streamed"*（`@deepseek-ai/dsh-user-approval` 类型定义）。
- omdsh 侧基础设施已具备：`runtime/tool-presentation.ts` 已建立 callId → 工具调用的索引，`TuiPrompt.detail`（`definition.ts:42`）已在 `views/prompt-selector.ts:288` 渲染。全仓库对 `callId` 与 approval 的组合**零消费**。
- 后果：审批一条 `bash` 时用户必须回滚 transcript 去找那张卡片。

**目标**

- 审批卡直接显示这次待批调用已经流式呈现过的语义内容（命令、路径、diff 摘要等），`reason` 退为补充说明。

**方案**

1. 在 `runtime/tool-presentation.ts` 上暴露一个只读查询：`summarizeToolCall(callId): string[] | undefined`，复用已有的 presentation 索引与 `chrome/tool-renderers.ts` 的既有渲染分支，输出少量纯文本行（不含 ANSI）。
2. `bindHumanInteraction`（`session/interaction-adapter.ts:86` 起）接受该查询作为可选注入，`askApproval` 在有 `request.callId` 时把摘要行拼进 `detail`（`reason` 作为最后一行，保持既有语义）。
3. 取不到快照时（callId 缺席、索引 miss、presentation 尚未到达）静默回退到当前行为——审批路径绝不能因为拿不到摘要而失败或延迟。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/runtime/tool-presentation.ts` | 新增 `summarizeToolCall` 只读查询 |
| `packages/tui/omdsh-tui/src/session/interaction-adapter.ts` | 注入查询；`askApproval` 组装 `detail` |
| `packages/tui/omdsh-tui/src/runtime/provider-local.ts` | 绑定 human interaction 时提供查询 |
| 两个模块对应的 spec | 有/无 callId、索引 miss、reason 缺席四种组合 |
| `CHANGELOG.md` | `Added`：审批卡显示待批调用的具体内容 |

**验证**

- 契约：`bash` 审批卡的 `detail` 含命令文本；`reason` 仍出现；无 callId 时输出与当前完全一致。
- 纯逻辑：摘要生成不抛异常，且对未注册的工具名返回 `undefined` 而不是空串。
- 人工：真实触发一次 `workspace-write` 下的越界写，确认无需回滚即可判断。

### 3.2 回合失败的持久错误位

**现状与证据**

- `views/event-views.ts:428-430`：`turn/end` 且 `reason.kind === 'error'` 时只是往 blocks 里 push 一条 `notice`，紧接着状态归 `idle`（`:453-456`）。
- composer 上方只渲染 Queued / Todos / Agents（`:1435`、`:1296`、`:1352`），没有持久的失败区域。
- 已有的补救入口 `Alt+R`（重试）与 `/retry` 都要求用户先意识到失败发生了。

**目标**

- 一次以错误结束的回合在界面回到空闲后仍然可见，直到下一轮提交，且不与「composer 与两行 footer 固定底部、不得抖动」冲突。

**方案**

1. 在 `ViewOptions` 增加 `lastTurnError?: { text: string }`（或等价的投影字段），由 `session-controller` 在 `turn/end` 为 error 时置位、在下次提交时清除。
2. 在 Queued 行之上、Todos 之下渲染固定两行（一行错误摘要 + 一行可用动作提示，如 `Alt+R retry`）。使用真实边框表达交互状态是允许的（`AGENTS.md` 只禁止给普通通知套无谓边框），但行数必须有上界，避免长错误把 transcript 挤扁。
3. 关闭方式要明确：提交新消息即清除；提供显式取消键时需同步写入 `/help`。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/definition.ts` | 新增投影字段 |
| `packages/tui/omdsh-tui/src/session/session-controller.ts` | 置位/清除时机 |
| `packages/tui/omdsh-tui/src/views/event-views.ts` | 渲染固定错误位 |
| `packages/tui/omdsh-tui/src/runtime/provider-local.ts` | 把字段传进 `renderView`；提交时清除 |
| 各模块 spec | 置位、清除、非错误回合不显示、窄宽度截断 |
| `CHANGELOG.md` | `Added`：失败的回合在 composer 上方保持可见 |

**验证**

- 纯渲染：给定该字段时 frame 内含错误行且总行数仍等于高度预算；不给时不出现任何额外行。
- 交互：失败后空闲帧仍显示；下一次提交后消失。
- 布局：40 列下不破坏右边框（与批次 1 的宽度修复共用断言）。

### 3.3 流式工具参数解码预览

**现状与证据**

- `views/event-views.ts:344-365` 在 `tool-call-delta` 上把参数累加成原始 JSON 片段并置 `partial: true`。
- `chrome/tool-renderers.ts` 的 `renderTool` 没有 `partial` 入参，回退路径 `fallbackArgumentLines`（`:38-44`）在 `JSON.parse` 失败时直接 `raw.split('\n')`。
- 结果：从参数开始流式到 `tool/call` 到达之间，用户看到的是 `{"command":"ls -la /tm` 这类裸 JSON，而这正是最想预读的几秒。

**目标**

- 参数流式期间就显示解码后的语义预览（如 `ls -la /tmp`），且实时路径与 replay 路径走同一解码器。

**方案**

1. 新增容错 partial 解码器：先尝试补齐未闭合的字符串与括号后 `JSON.parse`，失败再按已知字段名做正则提取（`command`、`path`、`file_path`、`pattern` 等）。
2. `renderTool` 增加可选 `partial` 入参，`toolBlockLines` 在 `partial === true` 时走解码预览；**实时与 replay 两条路径必须调用同一函数**，避免只在实时下正确。
3. 解码失败时保持现有回退（原始片段），不引入新的失败面。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/tool-renderers.ts` | 容错解码器 + `renderTool` 的 `partial` 入参 |
| `packages/tui/omdsh-tui/src/views/event-views.ts` | 把 `partial` 透传到渲染；replay 路径同源 |
| `packages/tui/omdsh-tui/src/chrome/tool-renderers.spec.ts` | 半截 JSON、转义引号、含中文参数、解析失败回退 |
| `CHANGELOG.md` | `Changed`：流式工具参数在参数到达期间即显示可读预览 |

**验证**

- 纯逻辑：对每个工具的关键字段给出「半截 JSON → 期望预览行」的表驱动用例。
- 一致性：同一串事件走实时增量与一次性 replay，得到的工具卡行必须相同。
- 不回归：`tool-presentation.spec.ts` 既有的「有语义标题时不重复原始 JSON」用例保持通过。

### 3.4 颜色能力与偏好

**现状与证据**

- `chrome/theme.ts:691-698` 的 `detectTrueColor` 只认 `COLORTERM`、`WT_SESSION` 与 `TERM ∈ {dumb, '', linux}`；`TERM=xterm-256color` 直接判定为 truecolor。
- 产品代码**不读 `NO_COLOR`**：全仓库出现该变量的只有 `scripts/pty-smoke.mjs:37` 与 `scripts/stream-interrupt-smoke.mjs:83`，`colors` 的来源是 `config.colors ?? output.isTTY`（`runtime/provider-local.ts:2734`、`:2751`）。
- `#trueColor` 在构造时计算一次且为 `readonly`（`provider-local.ts:361`、`:447`），`applyStoredPrefs` 只更新 `#colors`（`:743`）——以 `colors:false` 启动后在 `/settings` 打开颜色，会永久停留在 16 色回落。
- `Theme.bg` 复用前景回落表（`theme.ts:679-685`、`:713-717`），今天靠手工把背景色映射成 `'40'` 才没出错；`DARK_ANSI16` 里 `toolPendingBg` 与 `toolSuccessBg` 同为 `'40'`。

**目标**

- 尊重标准环境变量；颜色偏好在会话内可切换且立即生效；16 色下背景不再有输出前景码的风险。

**方案**

1. `detectTrueColor` 增加 `NO_COLOR`（存在且非空 → false）与 `FORCE_COLOR=0`（→ false）判定，并放在 `COLORTERM` 之前；`TERM` 含 `256color` 且无 `COLORTERM` 时归为「非 24 位」（是否引入独立 256 档见决策点 D3）。
2. `#trueColor` 改为在应用偏好时重算（或将 `createTheme` 的调用改为延迟到首次渲染）。
3. 给背景色补一张独立的 ANSI16 回落表，消除 `bgCode` 输出前景码的可能；同时确认 `toolPendingBg` 与 `toolSuccessBg` 在 16 色下的可区分性（若确实无法区分，明确记录为已知限制而不是静默相同）。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/theme.ts` | `detectTrueColor` 读标准变量；背景回落表独立 |
| `packages/tui/omdsh-tui/src/runtime/provider-local.ts` | `#trueColor` 重算；`colors` 来源接入环境判定 |
| `packages/tui/omdsh-tui/src/chrome/theme.spec.ts` | 环境变量矩阵（含 `NO_COLOR` 与 `TERM`）用例 |
| `CHANGELOG.md` | `Fixed`：尊重 `NO_COLOR`；`/settings` 打开颜色后立即生效 |

**验证**

- 纯逻辑：`detectTrueColor` 对 `{NO_COLOR:'1'}`、`{COLORTERM:'truecolor'}`、`{TERM:'xterm-256color'}`、`{TERM:'dumb'}` 的判定表。
- 交互：`colors:false` → `/settings` 打开颜色 → 断言 `theme.trueColor` 与 `getFgAnsi('error')` 的实参。
- 端到端：`scripts/pty-smoke.mjs` 已经设了 `NO_COLOR=1`，批次落地后它才第一次真正走到无颜色路径（当前是摆设）。

## 批次 4（P2）待决策项与文案一致性

### 4.1 `liveStart` 语义拆分（需产品决策）

**现状与证据**

- `chrome/main-screen-renderer.ts:162` 用 `liveStart === 0` 同时表示两件事：全屏 overlay（`/trajectory`、`/settings`）与滚动到历史窗口。
- `views/event-views.ts:1707` 在非跟随态把 `liveStart` 置 0，因此在 `terminalProfile === 'direct'`（不在 tmux/screen/zellij 里，即大多数用户的默认终端）时，**按 PgUp 会进入备用屏**：

  ```text
  follow tail         liveStart=4813  escape=2J
  PgUp (scroll back)  liveStart=0     escape=?1049h,2J
  End (back to tail)  liveStart=4813  escape=?1049l
  ```

- 后果一：原生 scrollback 在滚动期间被遮蔽，用户不能用终端自己的滚动条与搜索——与 `AGENTS.md`「The terminal owns native scrollback」的主张冲突。
- 后果二：`multiplexer`（tmux/screen/zellij）下 `alternateScreenOverlays` 为 false，同一操作走重画路径，**行为因终端而异**。
- 后果三：备用屏分支不消费 `#resize` 与 `#reanchor`（`:175`、`:188` 对比 `:228`、`:339-348`），滚动期间每帧全屏重绘。

**待决策**

滚动历史时是否允许遮蔽原生 scrollback。留主屏的代价是重画窗口会把重复内容推进 scrollback；用备用屏的代价是原生 scrollback 不可用。两个选项都需要产品取向，本方案不预设结论，只给出最小改动面：

1. 给 `Frame` 增加显式语义字段（如 `transientSurface: 'overlay' | 'scroll' | undefined`），让 `render()` 按语义而不是按 `liveStart === 0` 分支。
2. 若选「滚动留在主屏」，需要同时给出「不污染 scrollback」的策略（例如滚动期间只重画视口并在退出时重新锚定）。
3. 无论选哪个，都补齐备用屏分支的 `#resize` / `#reanchor` 消费，并加两条用例：滚动帧不产生 `?1049h`（或按决策产生）、备用屏内 resize 后第二帧不含 `\x1b[2J`。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts` | 语义字段分支；备用屏分支消费 resize/reanchor |
| `packages/tui/omdsh-tui/src/views/event-views.ts` | 设置语义字段而非重载 `liveStart` |
| `packages/tui/omdsh-tui/src/chrome/main-screen-renderer.spec.ts` | 新增两条用例（Emulator 需补备用屏模型） |

### 4.2 帮助页与提示行对齐

**现状与证据**

- `search-transcript`（默认 `Ctrl+F`，`input/keybindings-config.ts:26`，实现 `runtime/provider-local.ts:2618-2626`）在 `views/hotkeys.ts` 中**零命中**；welcome tips 也没有它。这是 0.15.0 新增的能力，目前没有任何发现入口。
- `views/hotkeys.ts:126-128` 的 essential 段硬编码 `Ctrl+R`、`PgUp / PgDn`、`Ctrl+O`，而同表最后一行用 `keysForAction(bindings, 'paste-clipboard')` 动态生成——用户重绑后这三行即失效。
- 7 个 overlay 都有底行提示，唯一例外是 autocomplete 的斜杠命令模式（`views/autocomplete.ts:392-399`）；`views/prompt-selector.ts:164` 把 `No sessions found.` 写死在通用选择器里，而它同时服务审批与提问。

**目标**

- 可绑定的动作与 overlay 内的按键都能在 `/help` 里找到，且绑定变化后帮助文本跟随更新。

**方案**

1. `hotkeys.ts` 的 essential 段改为全部走 `keysForAction`，删除字面量。
2. 新增 `search-transcript` 行，并在 welcome tips 里补一条 `Ctrl+F`。
3. 每个 overlay 增加「Overlay 键」小节（内容来自各视图的实际按键分支），并加一条测试断言：每个视图提示行文案 ∪ 帮助页 ⊇ 该视图 `applyXEvent` 实际接受的键集合。
4. `prompt-selector` 的空态文案改为由请求方提供，缺省时才用通用文案。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/views/hotkeys.ts` | 动态键位；新增 Ctrl+F 行；overlay 小节 |
| `packages/tui/omdsh-tui/src/chrome/welcome-tips.ts` | 补 `Ctrl+F` 提示 |
| `packages/tui/omdsh-tui/src/views/prompt-selector.ts`、`definition.ts` | 空态文案由请求提供 |
| `packages/tui/omdsh-tui/src/views/hotkeys.spec.ts` | 覆盖性断言 |
| `CHANGELOG.md` | `Fixed`：`/help` 的按键说明与实际绑定一致 |

**验证**

- `grep search-transcript packages/tui/omdsh-tui/src/views/hotkeys.ts` 必须命中。
- 覆盖性用例在删掉任一 overlay 提示行时会失败。
- 重绑 `scroll-page-up` 后，`formatEssentialHotkeysText` 的输出随之变化。

### 4.3 状态栏降级与数字格式

**现状与证据**

- `chrome/status-line.ts:192-200` 的 `selectGroups` 与 `:247-263` 的 `selectFooterGroups` 遇到第一个放不下的组就 `break`。实测 100 列时右列留有约 32 列空白，却因为 `durations` 放不下而连 `counts`（约 21 列）也一并丢弃。整组语义（不显示半个组）是刻意的，但「一个中优先级组挡住后面所有更窄的组」是副作用。
- 实测 50 列时第一行出现孤立省略号：`deepseek-v4-pro · …`、`main *3` → `m…`。整项丢弃比留下一个字母更有信息量。
- `formatTokens(999_500)` 返回 `1000K`（应为 `1M`）；`formatDuration(60_000)` 返回 `1m0s`。

**目标**

- 窄终端下不浪费可用列；截断不产生无信息量的残片；数字进位符合直觉。

**方案**

1. 决定降级策略（见决策点 D4）：建议保持前缀稳定（当前行为）但增加一次「跳过超宽组继续尝试后续更窄组」的机会，代价是窄宽度下显示的组集合可能随宽度跳变，需要在 `/settings` 预览里可观察。
2. `packPreviewParts`（`status-line.ts:446-478`）的截断分支改为「剩余宽度不足以容纳最小可读长度时整项丢弃」而不是留下一个字母加省略号。
3. `formatTokens` 在取整后跨过千位时进位到下一档；`formatDuration` 的秒部分补零或进位到分钟（`1m0s` → `1m`，`60m0s` → `1h`）。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/status-line.ts` | 降级与截断策略；两个格式化函数 |
| `packages/tui/omdsh-tui/src/chrome/status-line.spec.ts` | 各宽度下的期望行、进位边界 |
| `CHANGELOG.md` | `Fixed`：窄终端状态栏与 token/时长格式 |

**验证**

- 表格驱动：30/40/50/60/70/80/100/120/200 列下的完整两行快照（用批次 1 的独立预言机校验宽度）。
- 边界：`999_499`、`999_500`、`999_999`、`1_000_000`；`59_900`、`60_000`、`3_600_000`。

## 验证计划

每批次独立执行仓库要求的验证集（`AGENTS.md` 的 Required Verification）：

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:md
pnpm smoke:happy
git diff --check
```

额外要求：

- 批次 1 触及宽度与布局不变量，批次 2 触及 TTY 写入节奏与按键路径，两者都必须额外跑 `pnpm smoke`（真实 PTY）与 `pnpm smoke:interrupt`。
- 批次 2、4 额外跑 `pnpm benchmark:tui`，并把收紧后的基线写进该脚本的注释，避免后续无声回退。
- 批次 1 必须完成 1.3 的**反向自检**（把 `charWidth` 改回旧值、确认新用例失败），否则测试基建不算交付。
- 依赖或组合未变动，因此不需要 `pnpm check:boundaries`；若实现过程中确实动了 `apps/omdsh/config/cordis.yml`，补跑该命令与 `AGENTS.md` 的 refs 审计三命令。
- 每批次落地时同步在 `CHANGELOG.md` 的 `Unreleased` 下补条目（`Added`/`Changed`/`Fixed`），本方案文档本身不写 CHANGELOG。

## 决策点

- **D1 · 宽度层是否引入 `Intl.Segmenter` 作为权威**：引入（推荐）意味着与 `grapheme.ts` 合流，但热路径需要快速路径保护；不引入则只能继续打补丁，🚀 一类缺口会反复出现。本方案按「引入」设计。
- **D2 · diff 行内高亮的退化阈值**：建议 400 token。过低会让常见的中等行改动失去高亮，过高则保不住帧预算。落地前用真实 edit 负载标定一次。
- **D3 · 是否引入 256 色档**：当前只有 16 色与 24 位两档，`Swatch` 的 number 分支是死代码。引入第三档需要扩 `Theme` 接口；不引入则 `TERM=xterm-256color` 会继续按 24 位输出（多数终端能降级，风险可接受）。建议本轮只加 `NO_COLOR`/`FORCE_COLOR` 与 `#trueColor` 重算，256 档另立条目。
- **D4 · 状态栏降级是否允许跳过超宽组**：允许则窄终端信息更满但组集合可能随宽度跳变；不允许则维持当前稳定的前缀行为。建议允许，并在 `/settings` 里可观察。
- **D5 · 滚动是否允许遮蔽原生 scrollback**（4.1）：影响 `AGENTS.md` 主张的架构一致性，需要产品取向，本轮不预设。
- **D6 · 批次顺序**：建议 1 → 2 → 3 → 4。批次 1 是其他批次布局断言的共同前提；批次 4.1 独立于前三批，可以在决策明确后任意时点插入。

## 风险与回退

- **宽度层的性能回归**：字素簇计算比逐码点慢。缓解是快速路径（正则探测后再决定），并用基准确认纯 ASCII/CJK 行不掉速；回退方式是保留 `graphemeWidth` 但让 `visibleWidth` 仅在探测命中时使用。
- **`wrapIndexed` 的源索引语义**：按簇推进要保证 `IndexedLine.start/end` 仍是合法 UTF-16 边界，否则光标映射会把光标放到代理对中间。这是批次 1 里最容易出错的地方，必须用「代理对中间的光标输入」做定向用例。
- **tab 展开与光标索引冲突**：若将来 composer 允许字面 tab，展开会破坏索引映射。本方案以当前「tab 是补全键」为前提，实现时用注释与断言锁住。
- **diff 阈值退化影响可读性**：长单行改动的行内高亮会消失。这是有意的取舍，需要在 CHANGELOG 里说明，避免被当成回归。
- **审批卡摘要的时效性**：`callId` 对应的调用可能尚未完整到达。回退路径必须无副作用（拿不到就沿用现状），且不能在审批路径上引入额外的异步等待。
- **固定错误位挤压 transcript**：错误文本必须限行；窄终端下的截断要复用批次 1 的宽度语义。
- **`liveStart` 拆分波及渲染器契约**：`Frame` 是渲染器与视图之间的核心接口，加字段要考虑向后兼容（新字段可选、缺省等价于当前行为）。
- **回退粒度**：每批次是独立提交，`git revert` 单个提交即可；批次 1 与批次 2 互不依赖，批次 3 的三项互不依赖。

## 实施清单

进度与提交状态：批次 1、2 已提交（`9a5e30f`、`eab433c`）。批次 3 与批次 4 的非决策项已实现，完整验证集通过（`pnpm typecheck`、`pnpm test` 825 + 103 + 13、`pnpm build`、`pnpm check:md`、`pnpm smoke:happy`、`pnpm smoke`、`git diff --check`），但**尚未提交**：本工作树同时被另一个会话修改，`runtime/provider-local.ts`、`views/event-views.ts`、`CHANGELOG.md` 三个文件由两个会话共同修改，部分提交会留下不可编译的半成品，提交需要跨会话协调。

批次 1（P0，已提交 `9a5e30f`）：

- [x] `chrome/width.ts`：修 `charWidth` 区间（补 U+1F680–U+1F6FF 与 U+1F7E0–U+1F7EB；emoji 修饰符归零）
- [x] `chrome/width.ts`：新增 `graphemeWidth` 与 `visibleWidth` 快速路径（`CLUSTER_RE` 探测后才分段）
- [x] `chrome/width.ts`：`truncateToWidth` / `hardWrapAnsi` / `wrapText` 按簇推进
- [x] `chrome/width.ts`：`wrapIndexed` / `indexOnWrapped` 按簇推进并保 UTF-16 索引语义
- [x] 偏离：未改 `chrome/grapheme.ts`；簇迭代与 `Intl.Segmenter` 收在 `width.ts` 内部，避免两处分段器
- [x] `chrome/width.oracle.ts` + `chrome/width.golden.spec.ts`：独立预言机与 golden 表（`.oracle.ts` 由 `tsconfig.json` 排除出产物）
- [x] `chrome/box.spec.ts`：`terminalWidth` 改引预言机，删除「用被测函数拼期望值」的老写法
- [x] tab 路径统一：`wrapText` 入口展开，带 gutter 的入口（box / diff / markdown 代码块 / copy 预览）按各自列展开
- [x] 反向自检：回退 emoji 区间 → 5 条失败；回退两处 tab 展开 → 2 条失败
- [x] 批次 1 验证集 + `pnpm benchmark:tui`（与原始 `width.ts` 对照确认无回归）+ CHANGELOG

批次 2（P1，已提交 `eab433c`）：

- [x] `chrome/diff-render.ts`：`TOKEN_ALIGN_LIMIT = 400` 闸门（回退后 3000 token 用例实测 65.6 ms 失败）
- [x] `views/trajectory.ts`：ledger `version` + `WeakMap` 结果级缓存（10,000 记录 200 帧导航 5139 ms → 0.04 ms）
- [x] `views/streaming-reveal.ts`：删除全文簇数组缓存、惰性切片、按末簇边界增量计数（121k 字 2.9 ms/帧 → 0.26 ms）
- [x] 偏离：未改 `runtime/provider-local.ts`；增量计数收在 `streaming-reveal.ts` 内，不把流式状态散布到 provider
- [x] `scripts/benchmark-tui.mts`：记录收紧后的基线，新增 121k 字追加计数基准
- [x] 批次 2 验证集 + CHANGELOG

批次 3（P1，已实现并验证，未提交）：

- [x] 偏离：摘要查询落在 `TuiService.toolCallContext`（`LocalTui` 从 transcript 的 tool block 复用 `renderTool`），因为 `runtime/tool-presentation.ts` 的 callId 索引是 `session()` 内的局部变量、不可查询
- [x] `session/interaction-adapter.ts`：`approvalDetail` 把调用摘要排在 asker 理由之前（三种组合用例）
- [x] 回合失败持久错误行：`TranscriptState.turnError` 由 `turn/end` 置位、`user/message` 与无失败的 `turn/end` 清除；`renderTurnError` 限一行，窄终端先丢重试提示
- [x] 流式参数容错解码：`renderTool` 的 `partial` 入参 + 三级解码（直接 parse / 补全后 parse / 正则提取），失败回退原始片段
- [x] `detectTrueColor` 读 `NO_COLOR` / `FORCE_COLOR=0`；`#syncTrueColor` 在颜色偏好变化时重算；16 色背景回落表独立
- [x] `resolveColors(preference, isTty)`：显式偏好赢过 `NO_COLOR`，未配置时 `isTty && !colorDisabledByEnv()`
- [x] 批次 3 验证集（含 `pnpm smoke` 真实 PTY）

批次 4（P2）：

- [ ] 4.1 `liveStart` 语义拆分：待 D5 决策，本轮未做
- [x] 4.2 帮助页：essential 段改走 `keysForAction`、新增 `Ctrl+F` 行与 welcome tip、`prompt-selector` 空态文案由请求方提供
- [ ] 4.2 未做：overlay 按键小节与「提示行 ∪ 帮助页 ⊇ 视图按键集合」的覆盖性断言 —— 需要各 overlay 先导出自己的按键集合常量（单一事实来源），否则断言只会复述渲染代码
- [x] 4.3 状态栏：`selectGroups` / `selectFooterGroups` 的 `break` → `continue`、`MIN_CLIPPED_CELLS = 8` 整项丢弃、`formatTokens` / `formatDuration` 进位
- [x] 批次 4 验证集（含 4.3 的宽度表驱动用例，用独立预言机校验每行宽度）
