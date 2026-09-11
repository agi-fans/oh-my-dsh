# TUI 结构性拆分方案：provider-local、event-views 与 session-controller 的协作者提取

状态：已落地。范围：`packages/tui/omdsh-tui`。本文档只处理**当前工作树核实后**仍然成立的拆分点；小粒度去重（版本比较、blocksText、工具参数字段、JSON 原子写、smoke 样板、history-store 移位）已由 `1702e33` 与 `33c543a` 完成，不在本方案内。拆分顺序与边界判定吸收了外部评审意见（opencode,2026-02-24）。

## 目标与范围

三个文件承担了过多职责：`runtime/provider-local.ts`(2805 行）、`views/event-views.ts`(1786 行）、`session/session-controller.ts`(1549 行）。每个文件内部都存在**已有明确输入输出契约、且与宿主耦合点可数**的子簇。本方案按「最便宜、最自洽的先做」排序，四个批次各自独立可验证、可回退，不为拆而拆。

明确非目标：不改 Harness/TUI 属主边界；不引入第二个终端属主（provider 仍是唯一持有 raw mode、光标与写序列的地方）;不动 `commands/`、`chrome/` 渲染器、`input/editor.ts`；不顺手改上游兼容字段（`statusPreset`、主题别名）与 live-attempt-tracker 的正确性护栏。

## 结论摘要

| 批次 | 提取物 | 现状证据 | 规模 | 风险 |
| --- | --- | --- | --- | --- |
| 1 | `runtime/plain-tui.ts`(PlainTui 协作者） | `provider-local.ts:321-323,1020-1104,1321` 的 `#plain*` 状态机自洽，唯一入耦合是 `#plainResolve` 里的 `#prompt`/`#finishPrompt` | ~150 行 | 低：非 TTY 路径，`pnpm smoke:happy` 与 pipe 场景直接覆盖 |
| 2 | `views/transcript-render.ts`(Block→lines 渲染半边） | `event-views.ts` 内 fold(83-752）从不调渲染助手；渲染缓存（`transcriptBodyCache`/`blockLinesCache`,1016-1062）只服务渲染 | ~1100 行 | 低：纯函数搬移，`Block`/`TranscriptState` 类型上移即可 |
| 3 | `session/subagent-tracker.ts`（名册追踪服务） | `#noteSubagent*`/`#observeCatalogChildren`/`#syncSubagents`/`#pushSubagents`/`#subagentDepth`(498-505,1245-1313）是纯 事件→snapshot 映射，包裹已纯的 `SubagentRoster` | ~120 行 | 中：推送到 TUI 的时机（`#pushSubagents` 调用点）必须逐一保住 |
| 4 | `runtime/composer-images.ts`（图片草稿属主） | `#images` + `insertImageDraft`/`removeImageAtCursor`/`reconcileImageDrafts`/`admitImage`(319,1446-1523,1637）是状态化草稿域 | ~130 行 | 中：只收草稿属主；`#onData` 键解码、`#startAsyncPaste` 队列、`#acceptPastedText`/`#pasteClipboard` 的分支判断属输入路由，**留在 provider** |

评审确认不改的项：`history-store` 已在 `session/`;`keybindings-config` 的手写 JSON 读因 try/catch 兼作 fallback 语义而保留；`NO_COLOR=1` 进 `smokeEnv` 属无害统一；inspect/steer 簇（`#inspectSubagent`/`#steerInspected`/`#closeInspect`/epoch/`forwardLiveDelta`/`replayLivePrefix`,505-514,1285-1309）牵涉 `#replaceTranscript` 与流调度，若与批次 3 同拆会得到 god-collaborator，**待批次 3 落地后单独评审**。

## 批次 1:`PlainTui` 协作者（最先做）

**现状与证据**

- 非 TTY 路径集中在 `provider-local.ts`:`#lineReader`/`#plainPending`/`#plainQueue`/`#plainClosed`/`#plainPrinted` 五个字段（321-323,1023,1321)，方法 `#readlinePlain`(1020-1044)、`#plainResolve`(1052-1073)、`#pumpPlain`(1075-1091)、`#printPlain`(1093-1104)。
- 入口分派点在 `#readline` 的 `if (!this.#tty) return this.#readlinePlain(signal)`(845);`#printPlain` 由 `applyEvent`/`streamDelta`/`prompt` 尾部各调一次（527,696,702,755)，均为 `else` 分支——TTY 与 plain 已是互斥双轨。
- 入耦合只有两处：`#plainResolve` 读 `#prompt.request` 并按 `allowCustom`/`options` 匹配后调 `#finishPrompt`(1053-1069);`#printPlain` 读 `#state.blocks` 与 `#term.width()`、写 `#term.output`(1093-1104)。

**方案**

1. 新建 `runtime/plain-tui.ts`，导出 `class PlainTui`，构造注入 `{ term, finishPrompt: (value) => void, promptState: () => PendingPrompt | null, blocks: () => readonly Block[] }`。
2. `PlainTui` 内部持有 lineReader/pending/queue/closed/printed 全部状态；`#plainResolve` 中读 `#prompt` 的逻辑改为读 `promptState()` 快照，解析结果经 `finishPrompt` 回调交还 provider。
3. provider 侧 `#readline` 的 `!tty` 分支改调 `plain.readline(signal)`;`applyEvent` 等处的 `else this.#printPlain()` 改调 `plain.print()`。
4. `PendingRead`/`PendingPrompt` 类型若只被 plain 与 prompt 共享，移入 `plain-tui.ts` 或就地导出。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/runtime/plain-tui.ts` | 新建：PlainTui 协作者 |
| `packages/tui/omdsh-tui/src/runtime/provider-local.ts` | 删 `#plain*`/`#lineReader`/`#readlinePlain`,dispatch 与 print 改走 `plain` |
| `packages/tui/omdsh-tui/src/runtime/plain-tui.spec.ts` | 新建：readline 队列、EOF 排干、prompt 选项匹配、print 只打新增 block |

**验证**

- 新增 fake-TTY spec:`isTTY=false` 下连续多行输入排队、EOF 后 resolve null、`allowCustom:false` 的数字/标签匹配、`printPlain` 增量打印（`#plainPrinted` 游标语义）。
- `pnpm smoke:happy`(pipe 路径）+ `node scripts/stream-interrupt-smoke.mjs`。
- 回归：现有 `provider-local.spec.ts`(122 用例）与 `non-tty` 相关用例保持绿。

## 批次 2:`event-views` 拆 fold/render

**现状与证据**

- fold 半边：`isBlockPending`/`initialTranscript`/`contentToText`/`contentToReasoning`/`prettyArgs`/retry 与 compaction notice 工具/`hideFailedAttempt`/`dropPartialToolPreviews`/`settleUnfinishedToolCalls`/`editableBlocks`/`settleAssistant`/`applyStreamChunk`/`applyEvent`/`replayEvents`/`foldEvent`/`applyToolResult`/`settleTool`(83-752)。全部是 `SessionEvent|StreamDelta → TranscriptState` 纯函数。
- render 半边：`slicePreview`/`toolPreview`/`exclusiveDiffs`/`assistantMarkdown`/`userBubble`/`toolBlockLines`/`blockLines`/`blockSearchText`/`fitFrame`/两级 `WeakMap` 缓存/`renderTranscriptBody`/`windowTranscript`/`imageMarker` 绘制/`renderTodos`/`renderSubagents`/`renderInspectBanner`/queued 标签/`renderTurnError`(753-1786)。
- 依赖方向已是单向：fold 不 import 任何渲染助手；`Block`/`TranscriptState`/`ToolBlockStatus` 类型定义在文件头（68-122),`contentToText` 带占位符语义（`[image WxH]`）是**渲染侧**职责——评审确认它应随 render 走，而 `blocksText`/`contentToReasoning` 已共享。

**方案**

1. 新建 `views/transcript-types.ts`:`Block`/`TranscriptState`/`ToolBlockStatus`/`ReplayIndexes` 等共享类型上移（fold 与 render 都 import)。
2. 新建 `views/transcript-render.ts`：搬 753-1786 全部渲染函数与缓存；`contentToText`（占位符版）随它走。
3. `event-views.ts` 留 fold 核心（83-752)+ `initialTranscript`，并 re-export render 侧公开 API(`blockLines`/`renderTranscriptBody`/`windowTranscript`/`renderTodos`/`renderSubagents`/`renderInspectBanner`/`renderTurnError`/`blockSearchText` 及 `*_COLLAPSED_LINES`/`TRANSCRIPT_FAST_SCROLL`/`QUEUED_SUBMISSION_PREVIEW` 等常量），消费者零 import 改动。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/views/transcript-types.ts` | 新建：Block/TranscriptState 等 |
| `packages/tui/omdsh-tui/src/views/transcript-render.ts` | 新建：渲染半边 + 缓存 |
| `packages/tui/omdsh-tui/src/views/event-views.ts` | 剩 fold 核心 + re-export |
| `packages/tui/omdsh-tui/src/index.ts` | 确认导出路径不变 |

**验证**

- `pnpm --filter @agi-fans/dsh-tui test`:`event-views.spec.ts`(132 用例）原样通过即证明搬移无损。
- `pnpm typecheck` + `git diff --stat` 核对只有搬移无逻辑改动。
- `pnpm smoke`（滚动/窗口化走 `windowTranscript` 与缓存）。

## 批次 3:`session-controller` 先抽名册追踪

**现状与证据**

- 名册追踪簇（纯 事件→snapshot):`#subagents`/`#publishedSubagents`(498-499)、`#subagentDepth`(1245)、`#noteSubagentSession`(1251)、`#noteSubagentEvent`(1264)、`#observeCatalogChildren`(1280)、`#noteSubagentStatus`(1310)、`#syncSubagents`/`#pushSubagents`（定义在追踪簇尾部，调用点散布在 `bind`/`adoptSession`/`selectSession`/`onSessionData` 等）。它把 `SessionEvent` 折进已纯的 `SubagentRoster`，再把 snapshot 推给 `tui.setSubagents`。
- inspect/steer 簇（不同状态域，牵涉活动会话与流调度）:`#inspectEpoch`/`#inspectedId`(505-507)、`onInspectSubagent`/`onInspectClose`/`onInspectSubmit` 绑定（512-514)、`#forwardLiveDelta`/`#replayLivePrefix`(1285-1309)、`steer` 的 interrupt 分支（630-633)、`inspectView`。评审判定：同拆会得到同时摸 `sessions`/`live`/`#replaceTranscript` 的 god-collaborator，故单列、后做。

**方案**

1. 新建 `session/subagent-tracker.ts`，导出 `class SubagentTracker`，注入 `{ lookupDepth: (session) => number | undefined, publish: (roster) => void }`；内部持 `SubagentRoster` + `published`。
2. 把 `noteSession`/`noteEvent`/`observeCatalog`/`noteStatus`/`sync` 五法搬入；`#pushSubagents` 的「浅比较后调 `tui.setSubagents`」改为 `publish` 回调。
3. provider 侧保留调用点原语义：`bind`/`adoptSession`/`selectSession`/`clear` 各处的 `sync`/`push` 时机逐一保留（共约 6 处）。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/session/subagent-tracker.ts` | 新建 |
| `packages/tui/omdsh-tui/src/session/session-controller.ts` | 删追踪簇，改走 `tracker.*` |
| `packages/tui/omdsh-tui/src/session/subagent-tracker.spec.ts` | 新建：catalog 观察、深度过滤、状态升降、snapshot 只在变化时 publish |

**验证**

- `session-controller.spec.ts` 与 `subagent-roster.spec.ts` 原样绿；新增 tracker spec 钉住 publish 时机。
- `pnpm smoke`（子代理名册在真实 TTY 下的面板更新）。

## 批次 4:`ComposerImages` 只收草稿属主

**现状与证据**

- 草稿属主域：`#images` 字段（319)、`#admitImage`(1446)、`#insertImageDraft`(1457)、`#removeImageAtCursor`(1475)、`#reconcileImageDrafts`(1509)、`#images` 的清空/快照点（875-915,1637)。输入是 `TuiInputImage` + `#editor` 的 marker 文本，输出是 `#images` 列表与文本插入/删除。
- 评审划清的界：`#onData`(1322）的键解码、`#startAsyncPaste`(1344）的 deferred 队列、`#acceptPastedText`(1361）与 `#pasteClipboard`(1405）里对 prompt/settings/search 状态的分支，是**输入路由**，不属草稿属主，留在 provider。
- 入耦合：`#insertImageDraft`/`#removeImageAtCursor` 直接操作 `#editor`;`#reconcileImageDrafts` 之后 provider 要重绘（当前调 `#render`/`#refreshAutocomplete`)。

**方案**

1. 新建 `runtime/composer-images.ts`，导出 `class ComposerImages`，持有 `images: TuiInputImage[]`，方法 `insert`/`removeAtCursor`/`reconcile`/`admit`/`clear`/`snapshot`；对 `#editor` 的访问通过注入的 `editor: Editor` 直接进行（同属一包，无需回调）。
2. `#validateImageDraft` 校验回调注入构造函数（现为 `LocalTui` 字段，657 赋值）。
3. `reconcile`/`removeAtCursor` 返回 `changed: boolean`,provider 据返回值决定 `#render`/`#refreshAutocomplete`——**不把渲染回调传进协作者**（评审明确反对）。
4. `#pasteClipboard`/`#acceptPastedText` 留在 provider，调 `images.admit`/`images.insert`。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/runtime/composer-images.ts` | 新建 |
| `packages/tui/omdsh-tui/src/runtime/provider-local.ts` | 删 `#images`/`#insertImageDraft`/`#removeImageAtCursor`/`#reconcileImageDrafts`/`#admitImage`；提交/清空点改走 `images.*` |
| `packages/tui/omdsh-tui/src/runtime/composer-images.spec.ts` | 新建：marker 插入、光标删除、reconcile 的 changed 语义、校验失败不落草稿 |

**验证**

- 新增 spec 覆盖 marker 生命周期；现有 `provider-local.spec.ts` 的图片用例原样绿。
- `pnpm smoke`（粘贴图片路径走 `#onData`/`#startAsyncPaste`，路由未动但草稿写路径变了）。

## 后续（不在本方案）

- inspect/steer 簇提取（`SubagentInspector`)：待批次 3 合并后单独评审，需先确认 `#replaceTranscript` 与流调度的注入面。
- `apps/omdsh/src/plugin.ts` 手写 semver→`semver` 包：依赖变更，`workspace:` range 语义需适配层，另议。
- `docs/` 旧规划文档归档：待本方案落地后统一整理。

## 统一验证门槛

每批次合并前：`pnpm --filter @agi-fans/dsh-tui test && pnpm typecheck && git diff --check`；涉及 raw TTY/提交路径的批次（1、4）加 `pnpm smoke` + `pnpm smoke:happy`；批次 2 为纯函数搬移，spec 全绿即可。全部批次完成后跑完整集（`pnpm install && pnpm typecheck && pnpm test && pnpm build && pnpm check:md && pnpm smoke:happy`)。
