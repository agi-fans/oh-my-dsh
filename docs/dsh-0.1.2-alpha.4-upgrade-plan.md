# DSH 0.1.2-alpha.3 → alpha.4 升级方案（Session 读取面重构适配）

## 目标与范围

把 omdsh 的 DeepSeek Harness 依赖队列从已适配的 `0.1.2-alpha.3` 升级到 `0.1.2-alpha.4`。模式：**Harness cohort migration**。基础层不动（Cordis `4.0.2`、cordis-plugin-loader `1.0.3`、cordis-plugin-timer `1.1.4`、Schemastery `3.18.2` 均无变化），全部 `@deepseek-ai/dsh-*` 同步 bump。本次破坏面集中在一个上游重构（事件 seq 与 log offset 品牌化分离）及其在 subagent 面上的伴生改动。

本方案的全部代码适配点都已在独立 git worktree 的 dry run 中**实际验证通过**（install/typecheck/test/build/smoke:happy 全绿，详见验证计划）。

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort（apps/omdsh 直接依赖） | `0.1.2-alpha.3`（74 个 dsh 依赖；另有 4 项基础层：cordis、loader、timer、schemastery） | `0.1.2-alpha.4`（同名同数量，纯版本替换） |
| packages/tui/omdsh-tui dsh 依赖 | `0.1.2-alpha.3`（dependencies 28 个 + devDependencies `dsh-scope` 1 个） | `0.1.2-alpha.4` |
| 根 devDependency | `dsh-llm-mock-server@0.1.2-alpha.3` | `0.1.2-alpha.4` |
| Harness source tag | `dsh-v0.1.2-alpha.3`（refs 已由 c869d94 指到 alpha.4，无需改动） | `dsh-v0.1.2-alpha.4` |
| 产品源码改动 | — | `packages/tui/omdsh-tui` 12 个文件（8 源码 + 4 测试）；`apps/omdsh/src` 零改动；另有 `apps/site/content/{en,zh}/architecture.md` 文档同步与 2 个新增回归测试（见下） |

上游 alpha.3..alpha.4 共 297 个提交（--no-merges），其中 176 个属于 `code-runtime-python`（Python 运行时迁移到 experimental，我们不消费），其余以 fix 为主（108）、feat 仅 8 个。npm `0.1.2-alpha.4` dist-tag 已确认全量发布。

## alpha.3 → alpha.4 契约差异（omdsh 相关）

根因是两个上游提交，加上一次 invariant 修剪：

| 上游变更 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- |
| `27bf1039db` refactor(session)!: 区分事件 seq 与 log offset——`Session.events` getter 删除；`SessionHeader.seedLength` 删除（逻辑头校验显式拒绝该字段，改为必填 `isSeeded: boolean`）；新增 `SessionSeq`/`SessionLogOffset` 品牌类型、`snapshotEvents()`/`eventAt()`/`ownEvents()`/`isOwnSeq()`、`Session.inheritedEventCount` | **主要破坏面**：tui 包 14 处 `.events` 读取 + 4 处 `seedLength` 读写编译失败 | 本文档主体（逐点补丁表） |
| `ec493c2db8` 等 unify adjacent agent delivery——`SubagentRuntime.followup()`/`reportFrom()` 删除，收敛为 `sendMessage(sender, targetId, …)`（模型署名、parent↔child 双向 steer）；新增 `@deepseek-ai/dsh-subagent/internal` 子路径导出 `queueHostSubagentPrompt()`（宿主专用 FIFO 投递，语义等价旧 `followup`）；`send_message` 工具参数 `subagent_id` → `agent_id`，且工具语义从「parent→child FIFO 下一轮」变为「双向 direct-adjacent steer」（运行中目标在最近 step 边界收货，空闲目标才起 turn）；continuable child 可见标准 `send_message` 时初始 prompt 追加「用 `send_message({agent_id: parentId})` 回报父级」指引；`registerContinuableSetup`/`activation-setup-registry` 整体删除 | TUI「查看子代理时发消息」路径 1 处编译失败；工具卡片渲染 1 处行为破坏（参数名变了，摘要行会空白）；**模型可见行为变化**（child 会被引导用 `send_message` 回报，parent→child 投递时机从 FIFO next-turn 变为 steer） | followup → `queueHostSubagentPrompt`；渲染器读 `agent_id`（保留 `subagent_id` 回退兼容旧会话回放）；行为变化写入 CHANGELOG `Changed` 并纳入验证（child→parent 回报帧折叠、parent→child steer 时机） |
| `15f2997bcb` 修剪空 invariant 伴生——约 200 个「无运行时断言」包删除 `src/invariant.ts`、`./invariant` 导出与 `dsh-invariants` 依赖边 | **无影响**：我们挂载的 5 个伴生（`dsh-session/agent/scope/agent-loop` 与 `dsh-authorization` 的 `/invariant`）与 `dsh-invariants` 服务全部保留（它们有真实断言）；被删的伴生我们一个都没挂 | 无改动（已逐一验证 alpha.4 仍导出） |
| `dsh-agent`：`CreateAgentOptions.meta.seedLength` → `meta.isSeeded` + 新顶层 `inheritedEventCount?: SessionLogOffset` | rewind 分叉创建 1 处编译失败 | `isSeeded: true`（我们始终传 seed 数组，与上游 `seed !== undefined` 判定一致）+ `inheritedEventCount: SessionLogOffset(branchIndex)` |
| `dsh-session-persistence`：`SessionInspection` 扩展 `SessionStorageMetadata`（`meta` + `inheritedEventCount`） | 检视子代理持久化转录 1 处读取失败 | `inspected.events.slice(inspected.inheritedEventCount)` |
| `dsh-user-approval`：删除公共导出 `effectiveApprovalPolicy`（逻辑内联进 `overrideOf`） | 无：我们只 import `ApprovalOutcome`/`ApprovalRequest` 类型 | 无改动 |
| `dsh-llm-pi-ai`：`discoverModels` 第二参 `storedApiKey` → `storedProfile`；profile headers 现在经 Fetch 校验、发现探测携带路由 headers | 无代码破坏：我们走 `ctx.llm.discoverModels('llm-pi-ai', …)` seam，不直接 import 该包。行为变化：settings 里非法 header 会在加载期报错（改善），header-auth 自定义 provider 的模型发现变准 | 无改动；验证时留意设置错误渲染 |
| `dsh-token-meter`/`dsh-agent-loop`/`dsh-session-stats`/`dsh-session-query(-sqlite)`/`dsh-session-reference`/`dsh-session-title`/`dsh-attachment*`/`dsh-llm(-deepseek/-retry/-mock-server)` | seq 字段品牌化（类型层，branded→number 读取仍编译）；`token-meter/client` 子路径零变化；mock-server CLI 字节级不变；sqlite DDL/路径/配置键不变 | 无改动（页脚遥测数字、流式/中断行为、`/model` 发现、happy-smoke 脚本全部不变） |
| shipped preset 数据：PTC preset 禁用 `tool-workflow`；移除 `tool-subagent-report` 行 | 无代码影响：我们不用该包；`toolPresentationForPreset('code') → 'ptc'` 映射不变 | 无改动 |
| 包结构：`dsh-code-runtime-python` 移入 experimental；`dsh-tool-subagent-report` 删除 | 无：两者都不在我们的依赖里 | 无改动 |

## 已验证的适配补丁集

dry run（独立 worktree，见验证计划）中实际应用并通过全量测试的最小补丁集如下。产品代码全部集中在 `packages/tui/omdsh-tui/src`，共 8 个源码文件；`apps/omdsh/src` 零改动。

### 1. `Session.events` 读取迁移（10 处源码 + 2 处测试）

纯读取全量日志的一律换 `snapshotEvents()`（默认参数命中缓存快照，零拷贝，性能不劣于旧 getter）：

| 文件:行 | 场景 | 替换 |
| --- | --- | --- |
| `commands/export.ts:30,33,34` | 转录导出标题与内容 | `invocation.agent.session.snapshotEvents()` |
| `commands/session.ts:149,150` | `/retry` 逆序找最近人类 prompt | 先 `const log = …snapshotEvents()` 再循环 |
| `commands/session.ts:168` | `/todo` findLast | `snapshotEvents().findLast(…)` |
| `commands/trajectory.ts:12` | `/trajectory` 打开轨迹视图 | `snapshotEvents()` |
| `runtime/tool-presentation.ts:52` | tool/result 反查 tool/call | `snapshotEvents().findLast(…)` |
| `session/session-configuration.ts:24` | 空会话判定 | `snapshotEvents().some(…)` |
| `session/session-controller.ts:757` | rewind 取全量事件算对话轮次 | `snapshotEvents()` |
| `session/session-controller.ts:1206` | 转录整体替换 | `snapshotEvents()` |
| `session/session-controller.ts:1330` | 状态页统计 | `sessionStats(agent.session.snapshotEvents(), …)` |
| `commands/plugins.spec.ts:154` | 真实 `ctx.sessions.create()` 会话断言 | `snapshotEvents().filter(…)` |
| `runtime/tool-presentation.spec.ts:25,57` | Agent 测试替身 | `{ session: { snapshotEvents: () => [call, result] } }` |

### 2. fork 继承边界迁移（seedLength → isSeeded/inheritedEventCount，5 处源码 + 2 处测试）

| 文件:行 | 场景 | 替换 |
| --- | --- | --- |
| `session/session-controller.ts:822-828` | rewind 分叉 `ctx.agents.create` | meta 里 `seedLength: selected.branchIndex` → `isSeeded: true`；新增顶层 `inheritedEventCount: SessionLogOffset(selected.branchIndex)`（import `SessionLogOffset` from `@deepseek-ai/dsh-session`） |
| `session/session-controller.ts:1240` | 检视 live 子代理转录 | `live.events.slice(live.header.seedLength ?? 0)` → `live.ownEvents()` |
| `session/session-controller.ts:1245` | 检视持久化子代理转录 | `inspected.events.slice(inspected.meta.seedLength ?? 0)` → `inspected.events.slice(inspected.inheritedEventCount)` |
| `session/subagent-roster.ts:311-312` | roster 折叠子会话事件 | `seedLength` + `slice` 两行 → `const events = session.ownEvents()` |
| `session/subagent-roster.spec.ts:110,166` | 手搓假 Session 头 | `seedLength: 1\|0` → `isSeeded: true\|false` + `inheritedEventCount` + `ownEvents: () => […]` |

`ownEvents()` 语义上就是旧的 `events.slice(header.seedLength ?? 0)`（继承前缀之后的子代理自有事件），`isOwnSeq`/`eventAt` 本次用不到。

### 3. subagent 投递与渲染（2 处源码 + 1 处测试）

| 文件:行 | 场景 | 替换 |
| --- | --- | --- |
| `session/session-controller.ts:1301-1304` | `#steerInspected`：用户在检视子代理时发消息 | `subagents.followup(parent, id, content, {source:{kind:'user'}, signal})` → `queueHostSubagentPrompt(subagents, parent, SessionId(childId), message.content, { kind: 'user' }, new AbortController().signal)`；新增 `import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'`（该子路径在 alpha.4 发布 export map 中，是上游为宿主适配器提供的官方入口；**不要**用 `sendMessage`——它要求模型 Agent 署名且语义是 step 边界 steer 而非 FIFO 入队） |
| `chrome/tool-renderers.ts:95` | `send_message` 工具卡片摘要 | `stringField(args, 'subagent_id')` → `stringField(args, 'agent_id') \|\| stringField(args, 'subagent_id')`（回退覆盖 alpha.3 旧会话回放） |
| `chrome/tool-renderers.spec.ts:106-107` | 渲染 fixture | 参数与输出文案同步 alpha.4（`agent_id`、`message delivered to agent X`） |

行为说明：alpha.4 里子代理向父级汇报（旧 `reportFrom`）并入 `sendMessage`，转录中会出现新的 `agent-message` 来源帧——parent transcript 隐藏它（与旧 `subagent-report` 帧一致，event-views 仅折叠 `source.kind === 'user'`）；child roster 则把它折叠为 label 回退（与旧 `coordinator` 帧一致）。两侧行为均需按此断言（不能当回归）。同时见上表：continuable child 的回报方式与 parent→child 投递时机对模型可见，CHANGELOG 必须按 `Changed` 记录，不能写「用户可见行为其余无变化」。

## 组合与持久化兼容性结论

- **组合零改动**：`apps/omdsh/config/cordis.yml` 的全部插件行（含 subagent 四件套、`agent-loop-invariant`、`llm-retry`）在 alpha.4 全部有效；上游官方宿主 `apps/cli` 的组合代码与 sdk-minimal bundle patch 两标签间零差异。`composition.spec.ts` 现有断言全部继续通过（其 describe 名里的 `0.1.2-alpha.3` 是历史标签，实施时顺手改成版本中立命名即可，非必须）。
- **持久化兼容**：`SESSION_FORMAT_VERSION` 保持 0；JSONL 物理头在 seeded 时仍写数值 `seedLength`，读入时翻译为 `isSeeded`/`inheritedEventCount`（上游测试明确 round-trip v0 物理 seedLength，含 absent/0/nonzero 三态）；旧 `coordinator`/`subagent-report` 来源帧不会被校验拒绝。alpha.3 存量会话在 alpha.4 下 resume 不受影响。sqlite DDL/路径/配置键不变；指纹改为纳入 inheritedEventCount 只影响持久化索引的一次性重建，我们的查询索引是内存态（`openAt: never`），无感。**注意**：现有 resume smoke 是同 cohort 自建自恢复，证明不了跨版本——产品级结论需新增 alpha.3 产出的 JSONL fixture（至少 seeded nonzero，最好含旧 source 帧）由 alpha.4 `--resume` 加载（见验证计划第 5 条）。
- **页脚遥测零变化**：`@deepseek-ai/dsh-token-meter/client` 子路径（我们仅有的 token-meter import）字节级不变；TTFT/时长/轮步计数来自我们自己的事件遍历，agent-loop 事件类型与负载不变。

## 依赖与仓库配置变更

- `apps/omdsh/package.json`：74 个 dsh 依赖 `0.1.2-alpha.3` → `0.1.2-alpha.4`（无增删）。
- `packages/tui/omdsh-tui/package.json`：28 个 dsh dependencies + `dsh-scope` devDependency 同步 bump（无增删；`@deepseek-ai/dsh-subagent` 已是直接依赖，`./internal` 子路径无需新增依赖条目）。
- `apps/site/content/en/architecture.md:49` 与 `apps/site/content/zh/architecture.md:49`：两文公开描述 `ctx.subagents.followup`（已删除的 API），按双语文档 source-of-truth 规则同步改为 `queueHostSubagentPrompt`（宿主投递）的等价描述，中英语义一致。
- 根 `package.json`：`dsh-llm-mock-server` bump。
- `pnpm-workspace.yaml`：`minimumReleaseAgeExclude` 约 102 条 dsh 条目同步 alpha.4。**注意（LAB-003 同款）**：`pnpm install` 会把条目自动改写成 `@pkg@0.1.2-alpha.3 || 0.1.2-alpha.4` 双版本区间（dry run 已复现）；实施时应手工归一为单版本 `@pkg@0.1.2-alpha.4`（与现仓单版本风格一致），再跑一次 install 确认无二次改写，并审查 diff 无无关放宽。
- `pnpm-lock.yaml`：由 install 重新生成（dry run 中 2916 行变更，纯版本替换）。

## 验证计划

dry run 已在独立 git worktree（HEAD = 当前 alpha 分支 c869d94 + 上述补丁集 + 三个 manifest 版本替换）完成以下步骤，结果全部通过，实施时等价重跑：

| 步骤 | dry run 结果 |
| --- | --- |
| `pnpm install`（--no-frozen-lockfile，cohort 全 alpha.4） | 通过（9.7s，supply-chain 校验 1032 条通过） |
| `pnpm typecheck` | 通过（apps/omdsh 源码零错误；打补丁前 tui 包 28 个错误，补丁后清零） |
| `pnpm test` | 通过（tui 652 + apps/omdsh 68，含 composition、plugins、smoke、happy bundle 用例） |
| `pnpm build` | 通过 |
| `pnpm smoke:happy` | 通过（`HAPPY_SMOKE_PASS status=0`） |
| `pnpm check:boundaries` | 通过 |

实施时需在**真实 worktree** 补充的项（dry run 环境不可替代）：

1. `pnpm smoke`（PTY）：dry worktree 位于 /tmp 时 `pty.spawn` 报 `posix_spawnp failed`（环境性；同代码在主 worktree alpha.3 下通过）。`OMDSH_RUN_MODE=built` 的失败在 alpha.3 主 worktree 同样复现，属预置条件，与本迁移无关、不在本次范围。
2. `pnpm check:md`（含本方案文档与 CHANGELOG）。
3. `git diff --check` 与 AGENTS.md 的 refs 审计三命令（本次 refs 指针已在 alpha.4，预期 clean）。
4. 有凭据时跑一次真实模型 turn，重点人工确认：检视子代理后发消息（queueHostSubagentPrompt 路径）、rewind 分叉（isSeeded/inheritedEventCount 路径）、`/export`、`/trajectory`、`/todo`、`/retry`、`send_message` 工具卡片摘要，以及 child→parent 回报与 parent→child steer 的新语义。
5. **新增回归测试（dry run 未包含，实施时随补丁一起提交）**：
- host 投递**路由与参数契约**测试：Inspector composer 提交路由到 `queueHostSubagentPrompt`（宿主适配器、来源 `{kind:'user'}`、parent 权威与 child id/content 正确），断言不落在公共 `sendMessage`（Agent 署名 steer）路径上；现有 652 个 tui 测试没有一条触达 `#steerInspected` 投递，此路径此前零覆盖。FIFO 独立 turn 与缺席 child 冷恢复属于 `queueHostSubagentPrompt` 本体语义，由上游 `dsh-subagent` 测试拥有，本仓不重复覆盖、亦不宣称已测。
- 跨版本 resume fixture：真实 alpha.3 二进制产出的 zstd 会话 + 按物理 v0 格式合成的 seeded 子日志（含旧 `coordinator` relay 帧；`subagent-report` 与其同形，source 为透传数据，接受性同证）作为 fixture，alpha.4 stock persistence 加载与 `--resume` 断言，坐实「alpha.3 存量会话可继续 resume」。fixture 为不可变输入：load 的 repair 只写临时副本，测试断言源文件不变。
- `agent-message` 帧折叠断言：parent transcript 隐藏该帧；child roster 折叠为 label 且与旧 `coordinator` 帧逐位一致。

## 决策点

- **D1 · send_message 渲染回退**：读 `agent_id` 优先、`subagent_id` 回退，保证 alpha.3 旧会话回放不出现空白摘要。若接受旧回放降级可去掉回退，但不建议。
- **D2 · followup 迁移选型**：选 `queueHostSubagentPrompt`（`/internal` 子路径，export map 在发布物中）而非公共 `sendMessage`。理由：`sendMessage` 要求 live Agent 署名并把来源固化为 `agent-message`（模型署名），而我们是宿主投递用户消息（来源 `{kind:'user'}`，FIFO 下一轮语义）。`/internal` 是上游为宿主适配器开设的入口（源码注释明说「host adapters」），非未发布内部路径，符合仓库依赖边界规则。
- **D3 · composition.spec 命名**：`describe('dsh 0.1.2-alpha.3 spine expansion')` 改为不含版本号的名称，避免下次迁移再动。顺手项，随本次提交。
- **D4 · 发布范围**：与上次 cohort 迁移一致——**仅迁移、不发布**。不 bump 产品版本（root/两个包维持 0.13.0 直至另行发布决策）、不打 tag、不推 npm。

## 风险与回退

- **行为语义**：`ownEvents()` 与旧 `events.slice(seedLength ?? 0)` 逐位等价（上游实现即 `snapshotEvents(inheritedEventCount)`）；`queueHostSubagentPrompt` 与旧 `followup` 同为 FIFO 入队 + 冷恢复。前者已被现有测试间接覆盖（roster/检视路径用例）；后者的路由与参数契约由验证计划第 5 条锚定，其 FIFO/冷恢复本体语义以上游 `dsh-subagent` 测试为准。
- **品牌类型溢出**：`SessionSeq`/`SessionLogOffset` 是 `number & brand`，现有 `event.seq` 数值读取全部继续编译（dry run 已证）；未来新代码若需要构造品牌值，用导出的 `SessionSeq()`/`SessionLogOffset()`（负数/-0/非安全整数会 throw）。
- **`/internal` 子路径依赖**：已在发布 export map 中（`dsh-subagent@0.1.2-alpha.4` 实测安装并通过测试）；若上游未来收紧，替代路径是公共 `sendMessage` + 宿主来源语义妥协，届时再评估。
- **age-gate 双版本区间**：install 自动改写为 `a.3 || a.4`，需手工归一并复查（见依赖变更节）。
- **回退**：改动集中在 3 个 manifest、`pnpm-workspace.yaml`、lockfile、tui 包 12 个文件、site 双语文档 2 个文件、新增测试与 CHANGELOG——单次 revert 即恢复 alpha.3 状态；refs 指针不在回退范围。

## 实施清单

- [ ] 变更前基线：`git status` 快照 + 当前 alpha.3 的 `pnpm typecheck` / `pnpm test` / `pnpm smoke:happy` 记录
- [ ] 三个 manifest 版本替换（apps/omdsh 74 项、tui 28+1 项、根 1 项）
- [ ] 按补丁表修改 `packages/tui/omdsh-tui/src` 8 个源码文件 + 4 个测试文件
- [ ] `apps/site/content/{en,zh}/architecture.md`：`ctx.subagents.followup` 描述改为 alpha.4 宿主投递语义（双语同步）
- [ ] 新增三个回归测试：host 投递契约（queueHostSubagentPrompt）、alpha.3 JSONL 跨版本 resume fixture、`agent-message` 帧折叠（见验证计划第 5 条）
- [ ] `pnpm install` → 审查 `pnpm-workspace.yaml` 改写 → 手工归一 age-gate 单版本 → 复跑 install 确认稳定
- [ ] `composition.spec.ts` describe 改版本中立命名（D3）
- [ ] `CHANGELOG.md` Unreleased 条目：`Changed`——cohort 升级到 `0.1.2-alpha.4`；`send_message` 参数改名 `subagent_id`→`agent_id`（含旧会话回放兼容）、语义变为双向 steer、continuable child 改用 `send_message` 回报父级；不设 `Fixed` 条目，其余差异按实际用户可见影响撰写
- [ ] 完整验证集：`pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm check:md`、`pnpm check:boundaries`、`pnpm smoke:happy`、`pnpm smoke`（真实 worktree）、`git diff --check`、refs 审计三命令
- [ ] 有凭据时人工跑真实模型 turn 复核交互路径（见验证计划第 4 条）
