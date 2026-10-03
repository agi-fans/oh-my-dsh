# DeepSeek Harness 集成与兼容

状态：按 omdsh `0.19.0`、DSH `0.2.0-rc.2` 核对，日期为 2026-10-03。这是当前兼容决策，不是 npm 最新版本查询。升级操作由 [dsh-upgrade 技能](../../.agents/skills/dsh-upgrade/SKILL.md)维护，产品架构见[站点文档](../../apps/site/content/zh/architecture.md)。

## 依赖基线

| 层 | 当前版本与来源 |
| --- | --- |
| omdsh 根、CLI、TUI | `0.19.0`，保持同步 |
| 直接 DSH 运行时依赖 | npm `0.2.0-rc.2`，精确 pin；lockfile 保持单一 DSH cohort |
| Cordis / Loader / Timer / Schemastery | `4.0.4` / `1.0.5` / `1.1.6` / `3.18.4` |
| pi-ai | lockfile 解析到 `@earendil-works/pi-ai@0.87.1` |

事实来源是[CLI manifest](../../apps/omdsh/package.json)、[TUI manifest](../../packages/tui/omdsh-tui/package.json)、[lockfile](../../pnpm-lock.yaml)和[产品组合](../../apps/omdsh/config/cordis.yml)。`refs/` 仅用于研究，不参与解析、编译、测试或运行；`examples/hello` 是独立插件示例，不是 workspace 成员。

2026-10-02 的 rc.1 → rc.2 迁移保留了阻塞式问答，更新模型目录并带入上游 PowerShell 完成标记修复。[原始升级记录](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/dsh-0.2.0-rc.2-upgrade.md)记录当时的完整检查和隔离打包安装结果；它实施时的产品版本为 `0.18.0`，随后随 `0.19.0` 发布。记录中的测试数量和 macOS 结果不能冒充当前测试数量或 Windows 实测。

## 问答兼容

产品明确设置 `tool-ask-user.config.mode: legacy`。[interaction-adapter](../../packages/tui/omdsh-tui/src/session/interaction-adapter.ts)通过 `user-questions/request` 接入问题与回答；rc.2 的服务基类和投影变化没有要求另挂 Web/API 宿主。

`timed` 尚未接入 TUI。当前没有 `attachWait` 倒计时订阅、超时后的补答入口，也没有针对 `user-question-reply` 的转录呈现。Profile 应保持 legacy，不能仅改 mode 就宣称支持异步问答。

若实施 timed，需同时覆盖剩余时间订阅、超时后交互、迟到答复的 durable 呈现、恢复后的待答问题，以及取消和会话切换时的清理；这是独立的交互改动，不属于机械版本升级。

## 产品组合决策

- **DeepSeek 路由**：API-key provider 是 `dsh-llm-deepseek-api-key`；Profile 行 id 保持 `llm-deepseek`，以延续已有用户 patch。`dsh-llm-deepseek` 是 transport library，不能把历史 provider 包名直接恢复到挂载行。
- **Preset**：产品自己的 preset 声明拥有 persona 和工具呈现配置。PTC 是运行时 preset 的真实配置，不由 TUI 根据名字伪装；TUI 只展示 Harness 投影。
- **会话检索**：人类与模型侧检索都已提供。SQLite 索引按 `first-search` 延迟打开，持久路径为 home 下的 `sessions-query.sqlite`；JSONL 日志仍是事实来源。模型侧只读工具的跨会话访问要求 cwd 匹配。旧文档中的 `openAt: never`、内存索引或“模型检索未挂载”已失效。
- **LSP/MCP**：`apps/omdsh` 拥有配置到组合的适配。LSP 仅在配置服务器时挂载，不内置服务器或自动探测；MCP 提供工具与资源能力。配置方式见[语言服务器](../../apps/site/content/zh/language-servers.md)和 [Skills 与 MCP](../../apps/site/content/zh/skills-and-mcp.md)。
- **Web Search 与反馈**：均已提供，实际开关及配置见[工具](../../apps/site/content/zh/tools.md)和[设置](../../apps/site/content/zh/settings.md)，不再重复维护为待挂载计划。
- **Spill 与压缩**：单次工具 spill 会改变写入日志的结果，当前显式 `maxInlineTokens: 50000`；压缩前 pruner 则只裁剪模型上下文，完整结果仍在日志。组合顺序固定为 token meter → tool-result pruner → compaction，不能混淆两者对工具展开的影响。
- **Workflow**：仅挂 `dsh-workflow-ptc` provider，`dsh-workflow` 保留为依赖；同时挂两个 seam provider 会重复注册 `workflowEngine`。工具命名为 `workflow_run`，避免与人类 `/workflow` 的 Default/Plan 选择入口混淆。
- **Ralph**：工具行保留但默认禁用，用户显式启用才进入自动循环；不能因升级上游默认组合而自动打开。

## 隔离子任务

默认 `subagent` 与 `subagent_fork` 使用进程内 continuable provider，保留后续消息、控制和父级 composition。可选 `subagent_isolated` 使用 ACP 的独立进程，提供的是 one-shot 委派，不能在派发后 steering 或追问。

ACP 工具必须使用 `backgroundMode: one-shot`、`maxDepth: provider-managed`，不设置 `agentOptions`、`persona` 或 `toolFilter`。子进程运行独立 home/Profile；默认启动方式要求 PATH 上的 `dsh` 提供 `acp` Profile，`OMDSH_ACP_COMMAND` 和 `OMDSH_ACP_ARGS` 可覆盖命令。不能将这一可选 transport 描述为全部子 Agent 已进程化。

## 后续接入条件

hooks、schedule、time/tmux context、skill-badge 当前未由产品默认挂载。它们不是依赖版本遗漏：接入前需有明确用户场景，核对已发布 API、权限与生命周期，再决定产品默认值和最小交互面；上游 base 挂载不等于 omdsh 必须挂载。

不额外提供 `/plugins` 来重复 `omdsh --dump-config` 的组合树；只有需要诊断“实际激活状态”且配置树不足以回答时，再设计运行时查询。冷会话投影缓存或 turn 大纲也应由实际加载瓶颈触发，先确认产品消费路径能使用该缓存，不能为了包名齐全而挂载。

## 升级证据与验证

升级时比较选定版本走廊的发布产物、exports、peer closure 和组合，不用聚合 release notes 代替 API 核对。工作区成功不证明 npm 消费者拥有同一依赖图；预发布 peer 区间可能吸收较新 cohort，产生同名服务的重复副本。

升级技能的两个[历史案例](../README.md#历史证据)保留了公开 API 迁移与 npm 混装证据。当前升级仍需按 [AGENTS.md](../../AGENTS.md)完成全套依赖和边界验证，并检查两个候选包的 packed manifest 与隔离消费者安装。将本机 macOS 验证、Windows CI 和真实模型请求分别报告，不能相互替代。
