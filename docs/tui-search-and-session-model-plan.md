# TUI 特性实现计划：Transcript 搜索导航与会话级模型选择

Status: **implemented and shipped** — this is the design record for the slice that landed across `49848d8`…`ef07081` (search navigation and session-scoped `/model`), not a pending plan. Both features are live in 0.14.0: transcript search lives in `packages/tui/omdsh-tui/src/views/transcript-search.ts`, and the session-scoped route switch is the `sessionOnly` path in `packages/tui/omdsh-tui/src/commands/model.ts`. The audit below was written against DSH cohort `0.1.3-alpha.1`; the dependency queue has since moved through `0.1.5-alpha.2` to `0.1.5-rc.1` (see [`dsh-0.1.5-rc.1-upgrade.md`](./dsh-0.1.5-rc.1-upgrade.md)), so re-verify any claim here against the current worktree rather than trusting this text. Branch: `alpha`. Scope: first slice of the codex feature-brainstorm shortlist. Everything below stays inside omdsh-owned code; upstream DSH seams are consumed, never replaced.

## 1. 背景与目标

Codex 特性讨论的共识首片：**Transcript 搜索导航**（高频长会话操作）与**会话级 `/model` 选择**（用户可见的行为缺口）。两特性都落在现有纯函数 + fake-TTY 可测路径上，不需要新的运行时插件 seam。

非目标（明确不做）：
- 鼠标捕获/hover/滚轮（architecture 的 no-1000/1006 决策保持；价值由键盘 paging 与 OSC 8 链接覆盖）
- 扩展状态行注册表（等两个独立贡献者；现有 `status-config.ts` 覆盖内置定制）
- /worktree 分叉、emoji reactions、read `:-N`/video 提取（DSH 层职责或超范围）

## 2. 特性 1：Transcript 搜索导航

### 2.1 现状与缺口

`packages/tui/omdsh-tui/src/views/trajectory.ts`（行号指当前 HEAD）：

- `trajectoryVisibleRecords`（:350）先折叠（`collapsedTurns` 每回合只留首个记录，:355-360）再按 `query` 过滤（:361-365）。**折叠里隐藏的记录不参与匹配**，搜索只能在可见集合里过滤。
- `TrajectoryLedger` **原地修改**已存在记录：assistant summary/result（:215-223）、tool result（:250）、compaction result（:275，含 :279 的 end-summary 修改）；主键如 `assistant:<turn>:<step>` **跨会话重复**（:204）。任何按 ID 的进程级缓存都会串会话或读到旧文本。
- 非搜索态的文本分支（:393-404）只处理 `/`（进入搜索，:393）、`c`（折叠调用，:394）、`t`（折叠回合，:397-400），其他字符忽略；搜索态文本直接拼接到 `query`（:385-386），**backspace 使用 `query.slice(0, -1)`**（:387）——会切碎代理项/组合字符。
- 无匹配高亮、无片段、无 next/prev 定位；移动只有 up/down/pageUp/pageDown（:413-424，固定 ±10）；`home`/`end`（:425-429）；`following` 在 `appendTrajectoryEvent` 中**仅当已经跟随**时更新选择（:343-347），`move` 触底时重新跟随（:372）。
- 布局：`ledgerRows`（:493-500）每个记录一行 + 偶尔 turn header；详情页（:507-517）为 wrap 行另加 2 行；外层 body 高 `height-4`（:539）。

### 2.2 设计

**共享 grapheme 模块（前置小重构）**：`moveGraphemeLeft`/`moveGraphemeRight`/grapheme 分段目前导出自 `input/editor.ts`（:82,93，`editor.spec.ts` 已有边界测试）。提取到共享纯模块 `chrome/grapheme.ts`（chrome 是底层布局层，`input/editor` 与 `views/trajectory` 都导入，无 views→input 反向依赖；`editor.ts` 保留 re-export 以兼容既有导入，`editor.spec.ts` 的现有边界测试原样通过并追加 `chrome/grapheme.spec.ts` 等价覆盖）。查询文本的 backspace 与编辑器的移动/删除用同一实现。

**状态扩展**（`TrajectoryState`，:314；全部纯字段，派生值不入状态）：

```ts
// 新增字段
searchFocus: number | null   // 指向派生 match 列表的序号；0 基
followNotice: number         // 自上次跟随以来新追加的可显示记录数（append 时统计）
// 派生（渲染/导航时实时计算，不入 state）：
//   matches: { record, field, offset, length }[]  —— 记录序 × 字段序 × 偏移序
//   counts: Map<recordId, number>
```

`query`/`searching`/`following`/`collapsedTurns` 保留。

**"搜索激活"的定义**（明确）：
- `searching === true`：**查询编辑态**。可打印文本（**包括 `/`、`n`、`N`、`c`、`t`**）一律作为字面字符追加；backspace 用 grapheme 边界删除；`enter` 确认退出；`escape`/`ctrl+c` 退出并保留 query；`ctrl+n`/`ctrl+p` 为 next/prev match 导航（对查询内容零冲突）。
- `searching === false && query !== ''`：**结果态**。`n`/`N` = **新增**的 next/prev match 导航键；`c`/`t` = **现状**折叠键（仅有的两个现有文本折叠键）；`enter` = 详情切换（现状）；`/`（与其他非编辑态一致）→ 重新进入编辑态，**不插入**字符；其余可打印字符 → 重新进入编辑态，**并把该字符作为新 query 的首字符**（否则"任意文本进入编辑"无从输入）。
- `searching === false && query === ''`：无高亮无计数；`/`（非编辑态唯一入口）→ 进入编辑态，**不追加** `/`（现状 :393 语义保留）。
- 统一规则：**`/` 在一切非编辑态都只进入编辑态、不插入字符**；编辑态中 `/` 永远字面追加（`src/foo` 等路径查询可输入）。

**匹配语义（关键变化）**：匹配扫描基于**全量记录**（`ledger.records`），折叠只影响显示与导航的可见集合。匹配到折叠回合（或 `callsCollapsed` 隐藏的 subtool）内的记录时，"定位"动作自动展开该 turn，**并**清除 `callsCollapsed`（若目标是 subtool，:354）。派生 match 列表不缓存——渲染/导航按当前 `query` 实时扫描。

**焦点重同步（append/变更后，两阶段）**：变更**前**先捕获目标快照——`searchTarget = { record 身份, field, 该字段内 occurrence 序数 }`（`focus === null` 时无目标），因为旧 matches 在变更后无法重建；变更（追加或原地修改）后重扫 matches，再恢复：
1. 目标快照存在 → 在新 matches 中找"同一 record + field + occurrence 序数"（同字段多个 occurrence 按 occurrence 序数推移；该字段内 occurrence 越界时 clamp 到该字段内最后一个），得到新 `searchFocus`，并把 `selectedId` 同步到该 match 的 record；
2. 目标不存在（修改删除了该匹配） → `searchFocus = clamp(原序号, 0, matches.length - 1)`，并把 `selectedId` 同步到该序号对应 match 的 record；
3. `matches` 为空 → `searchFocus = null`，`selectedId` 保持不变（现状选中保留）；变更前 `focus === null` 且变更后出现 matches → 保持 `null`（用户变更前并未定位）。 两阶段由一个纯函数对实现：`captureSearchTarget(state)` / `restoreSearchTarget(state, target)`（ledger 所有修改点调用）；聚焦序号漂移（更早记录新增 match）由"记录身份"目标自然处理。

**规范化文本缓存（修正）**：缓存**归 ledger 所有**且按记录对象（`WeakMap<TrajectoryRecord, string>`）；`TrajectoryLedger` 的**每个文本修改点**（:215/250/275/**:279** 及任何后续修改）显式删除对应记录的缓存项。收益仅为"拼接 + 大小写归一化"（`json()` 已在投影期执行，:135），不缓存 JSON 化。重建 ledger（`createTrajectory`）即获得新缓存。

**渲染**（`renderTrajectory` 保持在 `trajectory.ts`；`event-views.ts:1382` 已透传整个 state，无改动）：
- 当前选中记录整行高亮（沿用现有样式）。
- 搜索激活（`query !== ''`）时：命中字段片段反显。**高亮实现**：重写该行并插入 ANSI 装饰；span 来自对"原文 `toLocaleLowerCase()` 后 `indexOf`"的索引——**约束**：`toLocaleLowerCase()` 对 CJK/emoji/ASCII 不改变码位长度，因此 span 映射精确；对会发生 case 展开的字符（如 `İ`）不保证子串精确，此时仅装饰字段起点（退化为"整字段高亮"）。ANSI/控制字符经现有 `sanitizeDisplayLine`；显示宽度由 width helpers 保证。
- 计数徽标：`counts` 中 >0 的记录行尾部显示 `×N`（仅搜索激活时）。
- 状态栏（trajectory 头顶）：编辑态 `search: <query> (3/10)`；结果态 `(3/10)` 保留；`following === false` 时右侧 `End: follow · +5 new`（`followNotice`，跟随恢复时清零——`end` 键与 `move` 触底（:372）都是恢复路径；查询/折叠变化不回溯影响计数）。

**分页与布局（分离两类指标）**：两个纯 helper，与渲染共享同一布局常量，**不依赖先前的 render 或保留绘制行**：
- `trajectoryListMetrics(state, height) → { pageSize }`：列表导航的记录页大小（基于 `ledgerRows` 行数 → 每记录 1 行 + turn header 计 1 行；**clamp 到实际可渲染行数**，`height` 过小（≤3）时 `pageSize = 0` 表示零正文 no-op）；
- `trajectoryDetailMetrics(state, height) → { pageLines }`：详情页 wrap 行页大小——现有布局详情区可用行 = `max(1, (height-4) - 2)`（外层 body `height-4`（:539）与详情区 `height-2`（:510）），即 `pageLines = max(1, height-6)`；不取 3 的下限（height=7 时容量仅 1）。 `applyTrajectoryEvent` 追加可选参数 `{ pageSize, detailPageLines }`（默认 10/10 保持既有单测；provider-local 从 `term.height()` 与两个 metrics 计算；`pageSize === 0` 时翻页为 no-op）。

**按键汇总**（全部在纯 `applyTrajectoryEvent`）：

| 状态 | 键 | 行为 |
| --- | --- | --- |
| 非编辑态 | `/` | 进入编辑态，不追加字符（现状 :393） |
| 编辑态 | 可打印文本（含 `/ n N c t`） | 追加 query（grapheme 安全） |
| 编辑态 | backspace | 按 grapheme 边界删除 |
| 编辑态 | enter | 退出编辑，定位到当前 match（若在折叠 turn/subtool 内，先展开） |
| 编辑态 | escape/ctrl+c | 退出编辑，保留 query |
| 编辑态 | ctrl+n / ctrl+p | next / prev match（循环） |
| 结果态（query≠''） | n / N | **新增** next / prev match 导航（循环） |
| 结果态 | c / t | 现状折叠键（不变） |
| 结果态 | 其他可打印文本 | 重新进入编辑态，该字符作为 query 首字符 |
| 任意态 | home/end | 现状（:425-429） |

**边界**：match 扫描为线性扫描（全量记录）；`followNotice` 只在 `appendTrajectoryEvent` 时按"追加的新记录对象身份"计数（`turn/start`、`request/header` 不产生记录；`tool/result` 更新已有记录不计数）。

## 3. 特性 2：会话级 `/model` 选择

### 3.1 现状与缺口

`packages/tui/omdsh-tui/src/commands/model.ts`（行号指当前 HEAD）：

- `/model` 只接受子命令 `favorite|unfavorite|favorites|next|previous|reasoning`（:136 的 Usage 错误路径），**不接受裸模型查询**；`selected()`（:36）与 `fixedChoice`（:26）服务于**裸 `/model` 选择器**（任意列表大小都走 `tui.prompt`，:142-153）。
- `session-controller.ts` `changeSelection`（:708-718）**无条件** `saveSelection(selection)`——每次切换都写默认。

### 3.2 设计

**命令语法**（唯一限定符语法：`provider:model`；省略 provider 时为 catalog-wide）：

```
/model <query>                当前 agent 会话切换 + 保存为默认（现状语义延续）
/model --session <query>      仅当前 agent 会话切换，不写默认
/model favorite|...           现状不变
```

**`<query>` 解析**（纯函数 `resolveModelQuery`；catalog 获取由调用方异步提供 `catalog: { provider, model }[]`，解析器与 I/O 分离；**只匹配公共契约字段 `id`/`name`/`description`**——refs `packages/llm/llm/src/types.ts:299-310` 的 `LlmModelInfo`；不读 displayName/catalog 标签等未公开字段）：

1. **限定符命中**：`provider:model` → 在该 provider 内精确匹配 `id`（次选 `name`/`description` 全等）。零命中 → 就近该 provider 的模糊匹配（**不跨 provider 回退**）；命中但 provider 无效 → `error: unknown provider`。
2. **裸精确**：全 catalog 内大小写不敏感 `id` 全等。恰好 1 个 → 切换；>1（如 `deepseek:agent` 与 `alibaba:agent`）→ 进入选择器并提示用 `provider:model` 消歧；0 → 级联模糊。
3. **模糊**：`id`/`name`/`description` 大小写不敏感子串，catalog-wide；唯一命中 → 切换；多命中 → **一律** `tui.prompt` 交互选择器（`fixedChoice` 现有 compact/filterable 行为，任何列表大小；取消/esc → 输出 `cancelled`——**不用 notice 列数字项**）。
4. **零命中**：`error: no model matches "<query>"` + 3 个相近项（对全量 `id`/`name` 集做编辑距离 ≤3 或公共前缀匹配）；相近项仅提示，不可点击。
5. 冲突次序统一：**保留规范 id**、**收集全部精确候选**、**任何剩余歧义一律 prompt**（含 case-fold 碰撞）。

**scope 语义（修订，明确边界）**：

```ts
async changeSelection(agent, selection, info?, options?: { persist?: boolean })
```

- `persist === false` 跳过 `saveSelection`（默认 `true`，既有调用点不变）。
- 承诺：`--session` 只影响"当前 agent 会话 + 不写默认"。**`/new` 与 `/resume` 都从当前进程内选择继承**（session-controller :722-724 与 :729-738 均用 `this.selection(agent)` 构造 `ModelSelectionRef`，并把 provider/model 提供给 `agents.create/resume`）——这是既有行为且保留。**只有 fresh 启动**（全新进程）才从被保存的默认开始（默认从未被 `--session` 写）。**不承诺**恢复历史会话自身的模型（resume 的 agentOptions 来自当前选择而非历史记录）。
- `--session` 无值 → `error: usage`；与子命令共存 → `error: invalid arguments`；`listProviders`/`listModels` 失败 → `error` 消息（原样返回 provider 错误）。
- `reasoningEffort` 校验沿用 `resolveFavorite` 的既有路径（**model.ts:62-66**：清单中存在才使用）。

**复用与边界**：
- 不建第二模型注册表；catalog 全部来自 `ctx.llm`。
- 输出：会话切换 `Session model: <provider>/<model>`；默认切换 `Default model: <provider>/<model>`（English status 规则）。
- 歧义选择器用 `tui.prompt`（列表语义），不经 provider-local 新造界面。

## 4. 测试计划

**纯状态**（`trajectory.spec.ts`、`model.spec.ts`）：
- 匹配：全量扫描（折叠/隐藏 subtool 计匹配）；`enter` 定位展开 turn + 清除 `callsCollapsed`；match 排序（记录序 × 字段序 × 偏移序）；query 变更重置 focus；空 query 无高亮/计数。
- **焦点重同步**：追加记录在聚焦 match 之前（focus 目标保持稳定标识；`captureSearchTarget`/`restoreSearchTarget` 两阶段）；修改文本删除聚焦 match（clamp + selectedId 同步）；matches 清空（focus=null 且 selectedId 保留）；变更前 focus=null 时变更后保持 null；同字段多 occurrence 的序数推移与越界 clamp；更早记录新增 match 的序号漂移测试。
- 变更一致：`TrajectoryLedger` 原地修改记录（assistant/tool/**compaction/end-summary**）后重扫正确；缓存失效点（:215/250/275/:279 修改后 `searchTextOf` 重新拼接）。
- 按键：编辑态 `/ n N c t` 字面追加；编辑态外 `/` 进入不追加；结果态 `n/N` 导航、`c/t` 折叠不变；结果态其他可打印字符进入编辑并成为首字符；背删除鲸鱼/组合字符（grapheme 边界）；`ctrl+n/p` 循环；单/全/零命中。
- 布局：`trajectoryListMetrics`/`trajectoryDetailMetrics` 纯计算（不依赖先前 render）；turn header、折叠、窄/宽详情、小高度 clamp（height<10）、resize 后变化。
- `followNotice`：append 新记录计数（turn/start 不计数；tool/result 更新不计数）；`end` 与 `move` 触底清零；查询/折叠变化不影响。
- 显示：CJK/emoji/组合字符下 span/高亮 no-error（宽度安全）；ANSI 控制被 sanitize；case-fold 不展开字符的精确 span（`İ` 退化为字段级高亮）。
- `resolveModelQuery`：限定符命中/未命中不跨 provider 回退；裸精确多候选（消歧提示）；模糊唯一/多命中/零命中（相近项 ≤3）；`--session` 无值；与子命令冲突；provider 失败。
- `changeSelection({persist:false})` 不调 `saveSelection`（mock 断言）。

**契约**（既有 fake-TTY / command 契约模式；**包含或更新**：`session-controller.spec.ts`、`provider-local.spec.ts` 的现有 mock 期望 —— `changeSelection` 签名扩展后更新所有调用点桩）：
- provider-local 按键路由：`/` 编辑、`ctrl+n`/`ctrl+p` 导航、`enter` 定位展开、结果态 `n`/`N` 新增导航键、`c/t` 折叠键不变、pageSize/detailPageLines 传递。
- `/model --session <query>` 端到端（mock `agentDefaultModel.saveSelection` 未调；`/model <query>` 被调）；`/model` 之后 `/new` 继承当前选择；**重启验证**：新建 SessionRuntime（默认 provider 提供 `currentSelection()` 返回旧默认）断言 `--session` 后默认未被写（fresh default provider 桩）。
- 歧义多命中弹出选择器（`tui.prompt` stub 调用），选择后 `selection()` 反映且 footer `setModel` 更新。

**性能**（`scripts/benchmark-tui.mts` 追加，先取基准再定阈值）：
- 10,000 记录 ledger 查询命中 37 条：扫描 + 单帧渲染。
- 10,000 记录 `searchTextOf` 冷/热（缓存只省拼接，验证无回归）。

## 5. 涉及文件

| 文件 | 改动 |
| --- | --- |
| `chrome/grapheme.ts`（新） | 共享 grapheme 边界 helpers（自 `input/editor.ts` 提取；editor 保留 re-export） |
| `chrome/grapheme.spec.ts`（新） | 边界 helpers 等价覆盖（迁移自 editor.spec 既有断言） |
| `input/editor.ts` | 改为导入共享 helpers + re-export（行为不变，现有 spec 通过） |
| `views/trajectory.ts` | 状态字段、全量匹配、`trajectoryListMetrics`/`trajectoryDetailMetrics`、派生 matches（实时扫描）、`captureSearchTarget`/`restoreSearchTarget` 两阶段焦点同步、WeakMap 文本缓存（含 :279 等所有变更点失效）、按键扩展、grapheme 背删除、`followNotice` |
| `views/trajectory.spec.ts` | 上述纯状态用例 |
| `runtime/provider-local.ts` | `applyTrajectoryEvent` 的 pageSize/detailPageLines 与按键路由；无新界面 |
| `runtime/provider-local.spec.ts` | 按键路由契约（更新既有 mock 期望） |
| `commands/model.ts` | `resolveModelQuery`、`--session` 解析、统一 `tui.prompt` 选择器、零命中相近项 |
| `commands/model.spec.ts` | 命令契约用例 |
| `session/session-controller.ts` | `changeSelection` `persist` 选项 |
| `session/session-controller.spec.ts` | `persist:false`/默认行为/重启桩（更新既有 mock 期望） |
| `scripts/benchmark-tui.mts` | 两个搜索基准场景 |
| `CHANGELOG.md` | **与实现同一提交**写入两个特性 Unreleased 条目 |

## 6. 风险与约束

- `pageSize`/`detailPageLines` 与渲染共享同一布局常量与纯 metrics，避免行高估算漂移；含 resize/折叠/详情宽窄/小高度测试。
- 高亮的 case-fold span 约束（仅对码位长度不变的字符精确）在渲染测试中由 CJK/emoji/组合字符用例覆盖。
- `TrajectoryLedger` 文本变更点（:215/250/275/:279）必须都走同一个私有缓存失效方法，后续新增变更点必须走它（代码注释声明）。
- `/model` 公共契约字段匹配仅限 `id/name/description`；其余元数据（catalog 标签等）不进入匹配，避免绕过公开 API。
- 无安装验证：npm 0.1.3-alpha.1 未发布，代码随 alpha 分支发布后验证；纯函数部分先以 TS 编译期检查 + 依赖无关探针验证；`pnpm check:md` 覆盖本文档与 CHANGELOG 改动。
