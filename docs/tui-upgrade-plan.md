# TUI 升级实现方案：会话检索、卡片呈现修正与交互补强

状态：待评审。范围：omdsh 自有代码 + 少量已发布 DSH 能力挂载。本文档只处理**当前代码核实后**仍然成立的升级项；更大的上游能力挂载继续由 [`upstream-adaptation-plan.md`](upstream-adaptation-plan.md) 跟踪。

## 目标与范围

本轮审计不升级任何 DSH 版本。全部结论由当前工作树（`alpha` 分支，cohort `0.1.3-alpha.2`）的代码、组合配置与真实渲染帧得出，不采信历史计划文档的自述。

交付分三批：P0 修正类（成本低、用户立刻可见）→ P1 能力与交互（中等成本）→ P2 暂缓（记录触发条件）。每批独立可验证、可回退。

明确非目标：不改动 `refs/`；不引入新的 DSH cohort；不重做 Renderer、Editor、Overlay 状态机；不做鼠标捕获、UI 本地化、主题市场。

## 对现有文档的更正

`upstream-adaptation-plan.md` 的 P1 表把模型侧会话检索记为"不做，理由：`openAt: never` 阻塞 + 每请求 5 个 schema 的成本"。前半条是循环论证，需要更正。

- `openAt: never` 是 omdsh 自己的配置（`apps/omdsh/config/cordis.yml:49-53`），不是上游限制。该行上方的注释给出了真实理由：**"openAt: never keeps FTS closed so Node 22 never loads experimental node:sqlite"**。
- 上游 `dsh-session-query-sqlite` 的 `openAt` 有三档（`refs/deepseek-harness/packages/session-query/session-query-sqlite/README.md:46`）：`startup` / `first-search` / `never`。`first-search` **在激活时不导入 `node:sqlite`、不打开索引**，把实验性警告推迟到首次真实搜索——这恰好满足 omdsh 原本的约束。
- 因此"Node 22 加载 `node:sqlite`"不再是阻塞理由。剩下的只有 `tool-session-query` 的 schema 成本，那属于模型侧决策，与人类侧检索无关。

同一张表把 `sandboxMode` 投影与 `session/title` 实时反映记为"暂不处理"，这两条**仍然成立**，本文档处理。PTC 子调用呈现与插件清单的"不做"结论保留，不在本轮推翻。

## 批次 1（P0）

### 1.1 会话全文检索

**现状与证据**

- 组合把会话查询后端配成 `path: ':memory:'` + `openAt: never`（`apps/omdsh/config/cordis.yml:49-53`），上游 FTS5 完全关闭。
- `/sessions` 与 `/resume` 共用 `resumeSession`（`packages/tui/omdsh-tui/src/commands/session.ts:39`，注册在 `:185-197`），列表来自 `ctx.omdshSession.recentSessions`，由 `persistence.list()` 加载**全部**非 subagent 会话（`session/session-controller.ts:1015-1024`）。
- 过滤是 `ctx.tui.prompt({ filterable: true })` 的客户端子串匹配，只覆盖标题与预览文本，**搜不了会话正文**。

**目标**

- `/sessions <query>` 能按会话正文检索，结果按相关度排序并展示命中片段。
- `/sessions`（无参数）保持现有列表与 pin/rename 行为不变。
- Node 22 在用户第一次搜索之前仍然不加载 `node:sqlite`。

**方案**

1. 组合改为 `openAt: first-search`，`path` 保持 `:memory:`（索引是派生数据，重建成本可接受）。同步更新该行的注释，说明从"永久关闭"变为"懒加载"。
2. `commands/session.ts` 的 `inject` 增加 `sessionQuery`；把 `/sessions` 从共用 `resumeSession` 中拆出独立 handler，按 `invocation.rawInput` 是否为空分流：空则走现有 Session Library，非空则按查询检索。`/resume <id>` 的精确恢复语义不动。
3. 查询分支调 `ctx.sessionQuery.searchSessions({ query, limit })`（请求字段见 `SessionSearchRequest`，`refs/deepseek-harness/packages/session-query/session-query/src/types.ts:251`）；每个 `SessionSearchHit` 携带 `bestMatch.snippet`（`refs/deepseek-harness/packages/session-query/session-query/src/types.ts:285`），直接作为选项 `preview`；标题不在 `SessionRecord` 里（`SessionRecord` 只有 `header`/`live`/`persisted`，`refs/deepseek-harness/packages/session-query/session-query/src/types.ts:27`），用 `readTitleSnapshots(ids)` 批量取，避免逐会话读日志。
4. 结果仍通过 `ctx.tui.prompt` 呈现：`label` 用标题，`description` 用相对时间与命中数，`preview` 用片段；选中后复用现有 `resumeSession` 的恢复路径。搜索失败（`SESSION_QUERY_SEARCH_DISABLED` 等）原样返回 `error`，不静默回退到子串过滤。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `apps/omdsh/config/cordis.yml` | `session-query` 行：`openAt: never` → `first-search`，更新注释 |
| `packages/tui/omdsh-tui/src/commands/session.ts` | `inject` 加 `sessionQuery`；`resumeSession` 增加查询分支与结果映射 |
| `packages/tui/omdsh-tui/src/commands/session.ts` 的既有 spec | 新增搜索分支用例（命中、零命中、后端报错、无参数不受影响） |
| `CHANGELOG.md` | `Added`：会话库可按正文检索 |

**验证**

- 纯逻辑：`searchSessions` 用桩返回固定命中集，断言选项的 label/preview/description 映射与 `readTitleSnapshots` 的调用。
- 契约：`/sessions <query>` 在 `sessionQuery` 缺席时报明确错误，而不是崩溃。
- 组合级：从 `loadBootPatches()` 读实际行，断言 `openAt === 'first-search'`。
- 人工：真实多会话目录下搜索一个只出现在正文里的词。

### 1.2 工具卡片 Input 回退修正

**现状与证据**

`renderTool` 的回退链是 `call.lines ?? fallback?.lines ?? fallbackArgumentLines(input.arguments)`（`packages/tui/omdsh-tui/src/chrome/tool-renderers.ts:252`）。当工具提供了 `presentCall` 但只给 `title`、不给 `lines` 时，Input 区会回填整段原始参数 JSON。

已用脚本实测：`read` 的 `presentCall` 返回 `{ card: 'generic', title: 'Read src/commands/export.ts', kind: 'read', locations: [...] }`（`refs/deepseek-harness/packages/fs/tool-fs/src/read.ts:198-203`，无 `rawInput`），最终卡片 Input 是 5 行 `{"file_path":…,"offset":1,"limit":100}`，而标题已经写明了路径。

**目标**

presentation 已经给出语义化标题时，Input 区不再回填原始参数；没有 presentation 的工具保持现有回退。

**方案**

把回退条件收紧为"没有 presentation.call，或 presentation.call 没有 title"：

```ts
const semanticCall = input.presentation?.call !== undefined && call.title !== undefined
const callLines = call.lines
  ?? (semanticCall ? [] : fallback?.lines ?? fallbackArgumentLines(input.arguments))
```

需要逐工具核对，确认没有工具依赖"有 title 也要显示原始 JSON"。已知 `terminal` 与 `diff` card 总是带 `lines`，不受影响；`generic` card 里带 `rawInput` 的（如 `terminal_read`）仍会显示自己的 `rawInput`，因为它们走的是 `call.lines`。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/chrome/tool-renderers.ts` | `renderTool` 回退条件 |
| `packages/tui/omdsh-tui/src/chrome/tool-renderers.spec.ts` | 新增"generic + title 不回填参数"用例；保留"无 presentation 仍回填"用例 |

**验证**

- 纯渲染：对 `read` 的 presentation 断言 `input` 为空数组；对无 presentation 的 `bash` 断言仍显示命令。
- 回归：现有工具卡片测试全绿。

### 1.3 状态如实：`sandboxMode` 与会话标题

**现状与证据**

- Access badge 读的是 `permissions` 投影（`session/session-controller.ts:124`），它只反映用户选的 preset。审批临时加宽写的是 `sandboxMode` 投影（`refs/deepseek-harness/packages/sandbox/sandbox-policy/src/index.ts:133-137`），omdsh 没有订阅它——全仓 `sandboxMode` 零消费。
- `session/title` 只在导出与最近列表里读取（`commands/export.ts:18`、`session/session-controller.ts:316`），`session-controller.ts:580` 只触发 `refreshRecent()`；当前会话标题在界面上无处可见，也没有写入终端窗口标题（全仓无 OSC 0/2）。

**目标**

- 审批把沙箱临时加宽后，composer 上的 Access badge 如实反映当前生效模式。
- 当前会话标题可见：状态栏新增可选 `session` 元信息项，并写入终端窗口标题。

**方案**

1. 扩展 TUI 自己的投影类型 `TuiStatsProjection`，加入 `sandboxMode`；`sessionControls()` 增加 `sandboxMode` 字段。渲染优先级：`sandboxMode` 有值时用它，否则回退 `permissions.currentValue`。
2. 会话标题：在 `session-controller` 维护当前标题（复用 `session/title` 事件与 `readTitleSnapshots`），通过 `TuiSessionInfo` 暴露；`status-config.ts` 的 `STATUS_META_IDS` 增加 `session`，默认可见性见决策点 D3。
3. `provider-local` 在标题变化时写 `\x1b]2;${sanitized}\x07`，退出时清空；标题必须剥离控制字符，长度按显示单元格截断。

**涉及文件**

| 文件 | 改动 |
| --- | --- |
| `packages/tui/omdsh-tui/src/session/session-controller.ts` | 订阅 `sandboxMode`；维护当前标题 |
| `packages/tui/omdsh-tui/src/chrome/status-config.ts` | 新增 `session` 元信息项 |
| `packages/tui/omdsh-tui/src/chrome/status-line.ts` | 渲染 `session` 项；Access 优先级 |
| `packages/tui/omdsh-tui/src/runtime/provider-local.ts` | 窗口标题写入与清理 |
| 对应 spec | 投影消费、标题渲染、OSC 序列转义 |

**验证**

- 纯渲染：Access badge 在 `sandboxMode` 覆盖时显示加宽模式。
- 契约：注入一条 `sandbox/mode` 事件后 badge 更新；`session/title` 变更后窗口标题序列更新且控制字符被剥离。
- 窄终端：标题截断不破坏边框。

## 批次 2（P1）

### 2.1 持久终端

**现状与证据**

omdsh 只挂了一次性 shell（`tool-bash` / `tool-pwsh`，`apps/omdsh/config/cordis.yml:237-242`）。上游 `dsh-terminal` + `dsh-terminal-bash` + `dsh-tool-terminal` 提供 6 个 owner-scoped 工具，跨调用保留 cwd、环境变量与交互子进程（`refs/deepseek-harness/packages/terminal/tool-terminal/README.md`）。

**目标**

模型在需要交互式 stdin 或跨调用状态时（调试器、REPL、被中断后回到 shell）可以使用持久终端；不需要时仍优先一次性工具。

**方案**

1. 组合插入三行（与 `cordis.yml` 的 `- insert:` 列表同级，缩进两格）。`terminal` 与 `terminal-bash` 依赖已挂载的 `subprocess`、`sandbox`、`sandbox-policy`；`tool-terminal` 的后台发送依赖 `jobs` 服务，因此放在 `tool-jobs` 之后：

```yaml
  - id: terminal
    name: '@deepseek-ai/dsh-terminal'
  - id: terminal-bash
    name: '@deepseek-ai/dsh-terminal-bash'
  - id: tool-terminal
    name: '@deepseek-ai/dsh-tool-terminal'
```

2. `apps/omdsh/package.json` 增加 `@deepseek-ai/dsh-tool-terminal` 精确版本依赖——`dsh-terminal` 与 `dsh-terminal-bash` 早已在依赖里且已安装，只是从未挂载——`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 增补同版本条目，`pnpm install` 重生成 lockfile。
3. TUI 呈现：这 6 个工具的 `presentCall` 已给出 `generic`/`terminal` card（`refs/deepseek-harness/packages/terminal/tool-terminal/src/index.ts:191-399`），批次 1.2 修完回退后无需专用渲染器；仅需为 `terminal_open`/`list` 这类只有 title 的卡片确认 Input 区为空而不是 JSON。
4. 确认每个 Agent preset 的工具收窄规则不会意外排除这 6 个工具。

**验证**

- 组合级：`composition.spec.ts` 增加三行存在性断言。
- 真实 PTY：`/tools` 出现 6 个 `terminal_*`，且不出现重复的 shell 工具。
- 人工：让模型 `terminal_open` 一个 REPL，跨两次调用验证状态保留。

### 2.2 键位可配置面扩展

**现状与证据**

`TuiAction` 只有 9 个动作（`packages/tui/omdsh-tui/src/input/keybindings-config.ts:6-22`），`Ctrl+O`、`PgUp/PgDn`、`Shift+Up/Down`、`Tab`、`Ctrl+R`、`Ctrl+C`、`Esc Esc` 等高频键全部硬编码在 `provider-local` 的分发里。

**目标**

把高频、语义稳定的动作纳入配置表，同时保留有特殊时序语义的按键（双击 Ctrl-C、双击 Esc）的既有行为。

**方案**

1. 扩展 `TuiAction`：`toggle-tools`、`scroll-page-up`、`scroll-page-down`、`scroll-fast-up`、`scroll-fast-down`、`search-history`、`accept-completion`、`interrupt`、`rewind`。
2. `DEFAULT_KEYBINDINGS` 保持现有默认键位，不改变用户手感。
3. `provider-local` 的按键分发改为先查绑定表，再落到硬编码分支；`Ctrl+C`/`Esc` 的双击计时器逻辑保留在分发层，只把"第一次触发什么"变成可配置。
4. `/help` 的快捷键表自动跟随绑定表（`views/hotkeys.ts` 已经用 `keysForAction`），无需改文案结构。

**验证**

- 纯逻辑：`loadKeybindings` 接受新动作、拒绝未知动作。
- 契约：把 `toggle-tools` 改绑到另一个键后，旧键不再展开工具；双击退出仍然有效。

### 2.3 Transcript 内搜索

**现状与证据**

`/trajectory` 有搜索（事件级），`Ctrl+R` 搜的是输入历史，但当前屏幕上的转录文本**没有**搜索入口。`views/event-views.ts` 只有 `windowTranscript` 的滚动窗口，没有搜索状态。

**目标**

在转录里查找文本、在匹配之间跳转，且不打断流式渲染与底部锚定。

**方案**

1. 新增纯模块 `views/transcript-search.ts`：状态 `{ query, matches, focus, editing }`，匹配基于已渲染 block 的纯文本（user 文本、assistant 文本与 reasoning、tool output），派生 match 列表不缓存。
2. `provider-local` 增加 `Ctrl+F` 入口（纳入 2.2 的 action 表）；编辑态可打印字符追加、Backspace 按 grapheme 边界删除（复用 `chrome/grapheme.ts`）、Enter 退出编辑、`n`/`N` 或 `Ctrl+N`/`Ctrl+P` 在匹配间循环、Esc 退出。
3. 渲染：命中行反显；定位复用现有 `scrollStart`/`focusBlock` 机制，不新造滚动路径。
4. 搜索只读已 settled 的 block；流式 assistant 块不参与匹配，避免每帧重扫。

**验证**

- 纯状态：匹配排序、零命中、grapheme 删除、焦点在新增内容后的重同步。
- 纯渲染：CJK/emoji 下的高亮宽度安全，ANSI 控制字符被 sanitize。
- 契约：`Ctrl+F` 进入/退出不改变 composer 内容；滚动位置在退出后保持。

## 批次 3（P2）

已落地：`/diff` 工作区改动汇总（独立命令插件 `commands/diff.ts`，只读 git 状态；`/diff` 输出逐文件增删表与未跟踪列表，`/diff <path>` 输出单文件补丁）。它走工作区视角而非会话日志——`ToolResultBlock` 不持久化 `meta.diffs`，所以"本会话改动"无法从日志复原。

其余项按触发条件暂缓：

| 项 | 触发条件 |
| --- | --- |
| 模型侧 `tool-session-query` | 人类侧检索稳定后，评估每请求新增的 schema 成本 |
| 会话投影缓存 `session-projection-cache` | 需要先挂 `dsh-storage-*`；冷启动恢复大会话成为可观测瓶颈时 |
| 全日志 turn 大纲 `session-turn-outline` | 单会话日志大到完整加载明显卡顿时 |
| 内联图片（iTerm2/Kitty/Sixel） | 有明确终端目标与降级策略时 |
| 成本估算 | 需要自建定价表；上游无 cost 包 |
| 符号预设（ascii/nerd） | 有用户反馈字体缺失时 |
| 会话分享 | 需要独立 relay 或服务端能力 |
| Vim 编辑模式 | 有明确需求时 |
| hooks / schedule / feedback / workflow / web search 等上游挂载 | 继续由 `upstream-adaptation-plan.md` 跟踪 |

## 验证计划

每批次独立执行仓库验证集，批次 1、2 至少覆盖：

```sh
pnpm install          # 批次 2 新增依赖后
pnpm typecheck
pnpm test
pnpm build
pnpm check:md
pnpm smoke:happy
pnpm smoke            # 批次 1.3、2.2、2.3 改动按键与终端写入后
pnpm check:boundaries
git diff --check
```

批次 2 额外跑 AGENTS.md 的 refs 审计三命令，确认没有指向 `refs/` 的依赖或符号链接。

## 决策点

- **D1 · `openAt` 用 `first-search` 而非 `startup`**：`startup` 会在启动时导入 `node:sqlite` 并打开索引，与 omdsh 保持启动轻量的取向冲突。`first-search` 保留"未搜索不加载"的原有保证。
- **D2 · 索引路径保持 `:memory:`**：JSONL 才是事实来源，索引是可重建的派生数据。若实测重建成本明显，再改为 `$OMDSH_HOME/session-query.sqlite`，届时需要评估索引损坏的降级路径。
- **D3 · 会话标题默认可见性**：默认加入状态栏第一行会让窄终端更早开始降级；建议默认**关闭**、在 `/settings` 的 Status line 分区可开，窗口标题始终写入。
- **D4 · 不新增 `/search` 命令**：复用 `/sessions <query>`，避免与 `/sessions`、`/resume` 形成三套入口。
- **D5 · 键位扩展不改变默认绑定**：只把动作变成可配置，默认手感保持现状，避免升级后用户肌肉记忆失效。
- **D6 · 本轮不发布**：版本号与 npm 发布留待发布决策。

## 风险与回退

- **`first-search` 的首次搜索延迟**：第一次搜索要建索引，大会话目录下可能卡顿。缓解：搜索结果先显示"正在搜索"，并保证失败可重试；`:memory:` 索引在进程内复用。
- **`renderTool` 回退收紧**：个别工具的 presentation 可能不完整，收紧后 Input 区变空。缓解：逐工具核对现有 presentation，spec 覆盖无 presentation 的回退。
- **窗口标题写入**：需要剥离控制字符并限制长度，否则恶意会话标题可以注入转义序列或撑破标题栏。`terminal-notifications` 已有同类转义的先例可参考。
- **持久终端**：`danger-full-access` 直接起 shell，受限模式需要同 world 的 sandbox provider；若组合缺失 provider，`terminal_open` 会在启动前失败而不是降级。挂载时必须在组合级测试里覆盖。
- **回退**：每批次是独立提交，`git revert` 单个提交即可；组合行回退不影响既有会话可读性。

## 实施清单

批次 1（P0，已完成）：

- [x] `cordis.yml`：`session-query` 改 `openAt: first-search` 并更新注释
- [x] `commands/session.ts`：`/sessions <query>` 接 `searchSessions` + `readTitleSnapshots`
- [x] `chrome/tool-renderers.ts`：收紧 Input 回退
- [x] `session-controller.ts`：消费 `sandboxMode` 投影、维护当前标题
- [x] `status-config.ts` / `status-line.ts` / `provider-local.ts`：会话标题项与 OSC 2
- [x] 各模块 spec + `CHANGELOG.md` `Added` 条目
- [x] 批次 1 验证集

批次 2（P1，已完成）：

- [x] `cordis.yml` 三行 + `dsh-tool-terminal` manifest + `pnpm-workspace.yaml` age-gate + `pnpm install`
- [x] `composition.spec.ts` 组合断言（含 `tool-jobs` 先于 `terminal` 的顺序约束）
- [x] `keybindings-config.ts` 动作扩展 + `provider-local` 分发改造 + `/help` 自动跟随
- [x] `views/transcript-search.ts` + `Ctrl+F` 路由 + 渲染反显
- [x] 批次 2 验证集 + refs 审计 + 真实 PTY `/tools` 出现 6 个 `terminal_*`
