# DSH 0.2.1-rc.5 → 0.2.2-rc.1 升级记录

状态：2026-11-04 在 macOS arm64 上完成。模式是 **Harness cohort migration**：产品依赖整体从 `0.2.1-rc.5` 迁到 `0.2.2-rc.1`，并把 Cordis 一族换到新 cohort 声明接受的版本。产品版本仍为未发布的 `0.22.0`。

## 走廊

| 层 | 源 | 目标 |
| --- | --- | --- |
| DSH | `0.2.1-rc.5`（2026-10-29） | `0.2.2-rc.1`（2026-11-04） |
| Cordis | `4.0.5` | `4.1.0` |
| Loader / Include / Group | `1.0.6` / 1.0.10 / 1.0.5 | `1.1.0` |
| Timer | `1.1.7` | `1.2.0` |
| Schemastery | `3.18.5` | `3.19.0` |
| Cosmokit | `1.8.6` | `1.9.0`（随 Cordis 传递） |

上游在这一档推进了 2,623 个提交、372 个包。参考检出同时推进到 `origin/master`（`fcc0ad4`，rc.1 之后 811 个提交），只作为研究材料，不参与解析。npm 上 omdsh 直接声明的 145 个 DSH 包全部有 `0.2.2-rc.1`，`@deepseek-ai/cordis` 的 peer 要求 `~4.1.0`、loader 一族要求 `~1.1.0`、timer 要求 `~1.2.0`、Schemastery 要求 `~3.19.0`，因此这一族必须同步换线而不是只换 DSH 版本。

`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 为每个 DSH 白名单条目追加了 `|| 0.2.2-rc.1`，并为 Cordis 一族追加了稳定版本；`pnpm install` 又自动补了 5 条新传递依赖（`dsh-tool-executor-native`、`dsh-tool-executor-ptc`、`dsh-fs-patch`、`dsh-official-bundles`、`dsh-plugin-detail`）。

## 确认的契约变化与适配

证据优先级按安装产物的 `lib/types/*.d.ts`；`refs` 只用于解释行为。安装产物与 tag 源码在本次一致。

| 变化 | 证据 | 适配 |
| --- | --- | --- |
| 模型选择变成 Session 的持久投影：`ModelSelectionRef` 删除，新增 `AgentModel`（实现 `Model`）、`modelSelectionProjectionDefinition`、`ModelSelectionProjectionState`；`installModelSelection(agentCtx, selection)` 收敛为 `installModelSelection(agentCtx)` | `dsh-agent` 的 `model-selection.d.ts` 与 README 的 Durable model selection 节（默认 driver 负责构造 `AgentModel` 并注册投影） | 删除产品侧的 ref：`agent-profile` 只装切换提示，`session-controller`、`btw`、`exec-runtime`、reminder controller 全部改读 `agent.model.current()` / `agent.model.select()`；`ActiveSession` 不再缓存选择 |
| 工具执行离开 registry，改为执行器插件；`dsh-tools` 的 `mode`/`maxParallelSubCalls` 配置在加载期被拒；`tool-executor-native` 与 `tool-executor-ptc` 成为启动必需条目 | `dsh-tools` 的 `executor.d.ts`、`dsh-app-boot` 的必需条目表、上游 `docs/upgrade-guide/v0.2.1-rc.2/tool-executor-plugins/guide.md` | 部署层挂 `tool-executor-native`，`tool-executor-ptc` 以 `disabled` 保持条目存在；`code` 预设改挂 PTC 执行器；`btw` 不再声明 presentation，改为继承部署的 native |
| `tools.restrict()` 只认得出调用作用域可见的工具；预设的常驻作用域看不到 Agent 作用域注册的工具（`workflow_run`、subagent、schedule 等），命名即失败 | `dsh-tools` 的 `restrict()` 校验与 `view(scope).restrictableNames`，以及 `schemas(agent)` 的实际结果 | `workflow_run` 改由 native 预设（`standard`、`cordis`）自己挂载，`code` 不再 deny；`minimal` 的 allow 列表仍走预设作用域的 `restrict`，`schemas(agent)` 只剩 `bash` 与 `str_replace_editor` |
| `ScheduleService` 的 `update`/`delete` 合并为 `edit(request, actorSessionId?)`；请求形态改为 `action` + `patch` + `expectedUpdatedAt`；`catalog()` 条目以 `involvedSessionIds` 取代 `sessionId`，`status` 变为 `active \| paused \| ended`；`ScheduleUpdateResult` 改名 `ScheduleEditResult`；新增 `rrule` 记录 | `dsh-schedule` 的 `types/types.d.ts` | `/schedule` 的编辑、删除、交付历史、列表过滤与状态文案全部跟随；暂停态显示 `paused · next …`，`rrule` 有自己的规则行 |
| 子代理的 `modelSelectionSettings` 删除，拆成 `modelSelection` 与 `modelDiscovery` 两个独立开关 | `dsh-tool-subagent` 的 `Config` 与 `model-selection-settings.d.ts` | 采样变体显式请求 `modelSelection: true` 与 `modelDiscovery: true`，`list_subagent_models` 与可选的子模型字段都保留 |
| PTC 的两个子调用事件改由 `@deepseek-ai/dsh-tool-executor-ptc/types` 声明 | 该包的 `types.d.ts` 中 `declare module '@deepseek-ai/dsh-session/types'` | `tool-presentation` 与 `event-views` 增加类型导入；折叠逻辑不变 |
| `@deepseek-ai/dsh-tool-subagent-control` 的主入口同时注册 `send_message`、`interrupt_agent`、`list_agents`，`/list-agents` 子路径不再导出 | 安装产物的 `exports` 与 README | 删除 `subagent-list` 组合行 |
| 未发布 `0.2.2-rc.1` 时 tag 源码与安装产物出现过的差异（`queueHostSubagentPrompt` 在 master 已移除、rc.1 仍在） | `master` 与 rc.1 的 `dsh-subagent/internal.ts` | 以安装产物为准，产品用法不变 |

## 核对后无需改动

- Session 格式仍为 v4，存量日志不需要迁移。
- `dsh-llm` 的 `GenerateOptions` 只是新增泛型参数与 badge 类型，产品构造的请求对象不需要改写。
- `dsh-session-projection` 新增 `ProjectionHandle`、视图/摘要辅助类型，但产品只通过 `sessionProjections` 读既有投影，未使用新面。
- `dsh-sandbox`、`dsh-commands`、`dsh-system-prompt` 的导出变化都是新增或重命名内部类型，产品未命中。
- `dsh-subagent-codex` 仍声明 `@openai/codex 0.153.4`，其 `lib/index.js` 与 `0.2.1-rc.5` 的 SHA-256 相同，`docs/design/dsh-coverage.md` 的钉法说明随之更新到新的版本对。

## 验证

macOS arm64，Node 24.18.0，pnpm 11.20.0。

| 检查 | 结果 |
| --- | --- |
| `CI=true pnpm install --no-frozen-lockfile` | 通过；lockfile 重解析 1,178 条，`0.2.1-rc.5` 残留 0 处、`0.2.2-rc.1` 2,312 处 |
| `pnpm typecheck`（删除两个 `tsconfig.tsbuildinfo` 后） | 通过；未删缓存的首次运行是假阳性，与 rc.2 那次相同的坑 |
| `pnpm test` | TUI `2231 passed`（147 文件）、CLI `210 passed`（38 文件）、站点 `13 passed`（2 文件），合计 2,454 |
| `pnpm build` | 通过 |
| `pnpm check:md` / `pnpm check:boundaries` / `git diff --check` | 通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS status=0` |
| `pnpm smoke` | 三个 PTY 脚本全绿：`PTY_SMOKE_PASS exit=0 draft-recovery=pass message-queue=pass`、`PTY_MODES_SMOKE_PASS exit=0 kitty=2/2`、`PTY_INSPECT_SMOKE_PASS exit=0 inspection=open-end-reopen modes=restored` |
| 参考子模块 | 三个 `refs/*` 工作区干净；无符号链接指向 `refs/` |

## 未解决的上游缺陷

`dsh-hmr` 的卸载会「关闭 watcher 并 drain 当前 refresh」，而首次启动的配置事件已经排了一个防抖刷新；Cordis 4.1.0 又要求提供方（timer 服务）等到依赖方（hmr）卸载完成才能卸载，于是首次启动后立刻关闭会互相等待。

- **症状**：全新 home 上 `mountOmdsh({ mode: 'exec' })` 后立即 `fiber.dispose()` 永不结算；已有 home（首启事件已消费）或等过一个防抖窗口（300ms）后正常。
- **定位**：Cordis registry 里只剩 `Loader`、`include`、`timer` 与 `hmr` 四个 fiber 停在 UNLOADING；禁用 `timer` 或 `hmr` 任一都消失，说明是这两者的卸载循环，不是产品插件的泄漏。
- **规避**：`omdsh exec` 不再挂载 HMR。一次性运行本就不会观察热更新，禁用后 `first-run` 与其余 exec 回归全部通过。
- **残余风险**：交互式首次启动若在 HMR 首次刷新结算前立刻退出，仍可能卡住卸载。升级后未在真实终端复现（`pnpm smoke` 覆盖的启动路径通过），但这条上游问题值得跟进。

## 回滚

`git revert` 本次提交即可回到 `0.2.1-rc.5`；`pnpm-workspace.yaml` 保留历史版本白名单，回滚后可直接 `pnpm install --no-frozen-lockfile` 重建旧 cohort。Session 格式未变，回滚不涉及日志迁移；由 rc.1 写入的 `model/selection` 事件在旧版本中按未知事件忽略，恢复的选择仍来自 `agentOptions` 与默认模型。
