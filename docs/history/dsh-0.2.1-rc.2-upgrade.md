# DSH 0.2.1-alpha.2 → 0.2.1-rc.2 升级记录

状态：2026-10-18 在 macOS arm64 上完成。模式是 **Harness cohort migration**：产品依赖整体从 `0.2.1-alpha.2` 迁到 `0.2.1-rc.2`，并把 Cordis 配套包从 alpha cohort 换到 rc.2 声明接受的稳定线。产品版本仍为未发布的 `0.20.0`。

## 走廊

| 层 | 源 | 目标 |
| --- | --- | --- |
| DSH | `0.2.1-alpha.2`（`d7432673`，2026-10-09） | `0.2.1-rc.2`（`687f282e`，2026-10-17） |
| Cordis | `4.0.5-alpha.1` | `4.0.5` |
| Loader / Include / Group / Timer | `1.0.6-alpha.1` / 1.0.10-alpha.1 / 1.0.5-alpha.1 / `1.1.7-alpha.1` | `1.0.6` / `1.0.10` / `1.0.5` / `1.1.7` |
| Schemastery | `3.18.5-alpha.1` | `3.18.5` |
| Cosmokit | `1.8.6-alpha.1` | `1.8.6` |
| node-addon-require-builtin | `^0.1.6` | `^0.1.9` |
| pi-ai | `1.1.0`（peer `^1.1.0`） | 不变 |

上游在两个月内推进了 990 个提交。npm 上 omdsh 直接声明的 126 个 DSH 包与 TUI 的 50 个 DSH 包全部有 `0.2.1-rc.2` 版本；`@deepseek-ai/dsh` bundle 的依赖只新增了 Web 侧的 `dsh-experimental-plugin-market-bundle`。

`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 为每个 DSH 白名单条目追加了 `|| 0.2.1-rc.2`，并为 Cordis 一族追加了稳定版本；历史条目保留，便于回滚时复用旧 lock。

## 确认的契约变化与适配

证据优先级按 app-boot 的公开声明与安装产物；完整方法见 [dsh-upgrade 技能](../../.agents/skills/dsh-upgrade/SKILL.md)。

| 变化 | 证据 | 适配 |
| --- | --- | --- |
| `IncompatiblePlugin.peers` 改为 `requirements`；`ChangeResult` 新增 `application: 'restart-required'` 与 `restartReason` | `dsh-plugin-manager` 的 `types.d.ts` | [plugins.ts](../../packages/tui/omdsh-tui/src/commands/plugins.ts) 改用 `requirements`，并在结果行展示 `restart required (<reason>)`；新增两条渲染回归 |
| 插件兼容性优先按 `engines.dsh` 判定，未声明时才看 DSH peer | `dsh-app-boot` 的 `plugin-compatibility.d.ts` 与 README | [plugin.ts](../../apps/omdsh/src/plugin.ts) 的 `incompatiblePeerMessage` 改为复用 `evaluatePluginCompatibility`，只保留 `@agi-fans/dsh-tui` peer 与嵌套副本检查；新增 `engines.dsh` 优先/不满足两条回归 |
| `dsh-session-persistence-jsonl` 不再默认导出持久化类，改为 Cordis 插件（`apply`、`name`） | 安装产物运行时导出为 `Config, JsonlCompressionSchema, apply, name` | 产品 YAML 组合不变；7 个直接挂载的测试文件改用命名空间挂载 |
| 子代理能力声明与启动请求移除 `toolFilter`、`persona`，新增 `agentPreset`；`childSessionMeta` 增加可选 preset | `dsh-subagent` 的 `types.d.ts`、`child-agent.d.ts` | 产品 ACP 组合本来就不设置前两者，`subagent` 工具仍返回 child id；无需改动 |
| headless 凭据优先级改为 profile 组合：上游 `headless` profile 禁用 `credentials`、`authorization`、`deepseek-account`，因此不读已保存凭据 | `dsh-headless` README 的 Credentials 节 | `omdsh exec` 使用自己的 `omdsh` profile，仍保留凭据服务；15 项 exec 回归全部通过 |
| token meter 的 `contextBreakdown` 内部 checkpoint 改变，但公开投影仍是 `systemTokens` / `toolsTokens` / `messageTokens` | `dsh-token-meter` 的 `projection.d.ts` | 无改动 |
| app-boot 新增 `recomposeProfile`、`ResolutionRestartRequired`、`readBundlePatches`；移除 `addHarnessSourceSection` / `HARNESS_SOURCE_SECTION` | `dsh-app-boot` 的 `index.d.ts` | 产品未使用被移除项；插件管理由上游 `plugin-manager` 负责重组合 |
| 后台任务 id 从 `<kind>-N` 改为 `<kind>-<short-uuid>`，新增 durable `job/registered`、`job/settled` 事件 | `dsh-jobs` 的 `types.d.ts`、`view.d.ts` | 产品把 id 当作 opaque 值；新事件暂未消费 |

## 核对后无需改动

- `./invariant` 导出、composer `stats` 插槽、tool presentation 的 `both` 模式在 alpha.2 之前已清理或未使用，rc.2 的移除不命中产品代码。
- Session 格式仍为 v4（抽取 `dsh-session@0.2.1-rc.2` 的声明确认 `SESSION_FORMAT_VERSION = 4`），存量日志不需要迁移。
- `web-search-deepseek` 的 Config 形状未变；omdsh 仍挂 `dsh-web-search-deepseek` + `dsh-web-fetch-http`。上游新增的官方 DeepSeek Search/Fetch API 尚未切换，也没有真实 provider 验收。
- Azure provider 更名 `azure`、`conversation.input.model.label` 等 Web slot、插件市场 bundle 都不在产品代码或 TUI 组合内。
- `createRunCodeTool`、`PtcCalls` 等变化属于 tools registry 内部，产品不直接调用。

## 验证

macOS arm64，Node 24.18.0，pnpm 11.20.0。

| 检查 | 结果 |
| --- | --- |
| `CI=true pnpm install --no-frozen-lockfile` | 通过；lockfile 重解析 1,176 条，`pnpm peers check` 无问题 |
| lockfile cohort | `0.2.1-alpha.2` 残留 0 处；`0.2.1-rc.2` 4,378 处 |
| `pnpm typecheck`（删除两个 `tsconfig.tsbuildinfo` 后） | 通过 |
| `pnpm test` | TUI 与 CLI 全绿，见下方计数 |
| `pnpm build` | 通过 |
| `pnpm check:md` / `pnpm check:boundaries` / `git diff --check` | 通过 |
| `node scripts/happy-smoke.mjs` | `HAPPY_SMOKE_PASS status=0` |
| `node scripts/pty-smoke.mjs` | `PTY_SMOKE_PASS exit=0`，含 draft recovery 与 message queue |
| 参考子模块 | 三个 `refs/*` 工作区干净；无符号链接指向 `refs/` |

测试计数：TUI `2023 passed`（138 个文件），CLI `202 passed`（33 个文件），站点 `13 passed`（2 个文件），合计 `2238 passed`。此前 alpha.2 记录的 1,973 项是不同日期、不同测试集合的快照，不能直接比较。

升级过程中出现的两次失败都与 DSH 契约无关：

- 重装后 `node-pty` 的 `spawn-helper` 失去可执行位，`posix_spawnp` 失败；本机 `chmod +x` 后恢复。该文件属于安装产物，不在仓库内。
- `scripts/pty-smoke.mjs` 的关闭终端步骤仍发送 3 个 Tab，而 `/terminal` 文档的操作项在 `191ed80` 增加 `Share to conversation` 后变成 7 项，`Close terminal` 移到第 7 项。现已改为 6 个 Tab，属于对既有脚本的修补，不是 rc.2 引入的回归。

## 未验证与残余风险

- Windows 实机（持久终端 dialect、ConPTY）。
- 真实模型请求；本轮全部使用 mock LLM。
- 官方 DeepSeek Search/Fetch API、账户路由、Codex/Claude Code 原生 bundle 的真实启动与认证。
- Plan Review 在 rc.2 中改为结束轮次等待反馈；产品的 plan-review 问题流沿用原有实现，交互测试通过，但没有真实模型下的端到端验收。
- `omdsh exec` 的凭据路径按组合推导为不受影响，未使用已保存的 GUI 凭据做真实请求验证。

## 回滚

`git revert` 本次提交即可回到 alpha.2；`pnpm-workspace.yaml` 保留了历史版本白名单，回滚后可直接 `pnpm install --no-frozen-lockfile` 重建 alpha.2 cohort。Session 格式未变，因此回滚不涉及日志迁移；由 rc.2 写入的新事件若被 alpha.2 读取，仍按未知事件忽略。
