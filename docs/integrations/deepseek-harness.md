# DeepSeek Harness 集成与兼容

状态：按 omdsh `0.19.0`、DSH `0.2.1-alpha.1` 核对，日期为 2026-10-04。这是当前兼容决策，不是 npm 最新版本查询。升级操作由 [dsh-upgrade 技能](../../.agents/skills/dsh-upgrade/SKILL.md)维护，产品架构见[站点文档](../../apps/site/content/zh/architecture.md)。

## 依赖基线

| 层 | 当前版本与来源 |
| --- | --- |
| omdsh 根、CLI、TUI | `0.19.0`，保持同步 |
| 直接 DSH 运行时依赖 | npm `0.2.1-alpha.1`，精确 pin；lockfile 保持单一 DSH cohort |
| Cordis / Loader / Timer / Schemastery | `4.0.5-alpha.1` / `1.0.6-alpha.1` / `1.1.7-alpha.1` / `3.18.5-alpha.1` |
| pi-ai | lockfile 解析到 `@earendil-works/pi-ai@0.87.1` |

事实来源是[CLI manifest](../../apps/omdsh/package.json)、[TUI manifest](../../packages/tui/omdsh-tui/package.json)、[lockfile](../../pnpm-lock.yaml)和[产品组合](../../apps/omdsh/config/cordis.yml)。`refs/` 仅用于研究，不参与解析、编译、测试或运行；`examples/hello` 是独立插件示例，不是 workspace 成员。

2026-10-02 的 rc.1 → rc.2 迁移保留了阻塞式问答，更新模型目录并带入上游 PowerShell 完成标记修复。[原始升级记录](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/dsh-0.2.0-rc.2-upgrade.md)记录当时的完整检查和隔离打包安装结果；它实施时的产品版本为 `0.18.0`，随后随 `0.19.0` 发布。记录中的测试数量和 macOS 结果不能冒充当前测试数量或 Windows 实测。

2026-10-04 迁移至 [DSH `0.2.1-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)，同步升级 Cordis 配套包。上游移除了 `dsh-invariants` 和五个 `/invariant` 插件导出，产品组合随之移除这六行；不保留旧包兜底。插件的 Cordis peer 使用 `~4.0.5-alpha.1`，因为旧的稳定版区间不接受预发布版本。目标循环取消时会撤回仍在 inbox 中的自动消息，避免后续用户输入被阻塞。会话事件、工具参数、preset 注册和 legacy 问答的产品消费接口保持兼容；默认 preset、Ralph 开关与 TUI 折叠行为不变。

## 问答兼容

产品设置 `tool-ask-user.config.mode: timed`、默认等待 120 秒。[interaction-adapter](../../packages/tui/omdsh-tui/src/session/interaction-adapter.ts)通过 `user-questions/request` 和 `attachWait` 接入问答与剩余时间；终端负责倒计时，编辑和 `Ctrl+T` 会持有当前 wait。`Ctrl+S` 跳过单题，有限时问题按 `Esc` 返回 pending，`Ctrl+C` 与调用方取消返回中断。整批问题共享一个 deadline；排队中的问题仍按 Host 原截止时间结束，不先持有 wait。

待答计数与 `/questions` 从公开 `userQuestions` 投影读取，补答调用 `answer()`，沿 Harness 的 `user-question-reply` 排队与入日志，转录重放显示同一问答文本。收起不提交答案；已排队补答不能重复发送；命令卸载与会话释放会取消输入。Profile 可显式恢复 legacy，模型也可在 timed 下设置 `timeout: -1`；这些阻塞调用没有有限倒计时，收起作为取消处理。

PTC 默认执行预算为 180 秒，留出默认问答等待和 sub-call 记录时间。问答的 Take time 不暂停外层程序预算；PTC 进程若在记录 dispatch 结果前结束，上游无法恢复该问题用于补答，这仍是上游契约限制。Standard 和 PTC 的真实 CLI 调用验证见 [timed-question.spec.ts](../../apps/omdsh/src/timed-question.spec.ts)。

## 插件管理、配置与创作

运行态入口为 `/plugins`，消费已发布 `pluginManager` 的清单和事务。HMR 使用公开 `appReady` 启动成功信号，默认 `root: []`，只监视 Profile/主目录配置。CLI 与运行态共享 Profile manifest 写锁；新 bundle 可即时应用，已安装包代码替换仍要求重启。取消等待进程停止和文件恢复，待执行脚本另需明确授权，终端自身的 consumer 在管理列表中保持只读。

`/settings` 的 Plugins 分区由现有 terminal provider 消费公开 settings descriptor 生成常用字段表单，只编辑 live 字段，带 revision 按路径写入。API-key/ref 配对使用 credentials；包含密钥的复合字段不通过 JSON 重写。子代理模型选择由已发布 `model-selection-settings` 服务拥有，默认关闭；omdsh 的 preset consumer 沿用全局委派行的配置，在 Standard/PTC/Cordis 的会话 scope 内接入上游取样与清理。Minimal 保持双工具，fork 继续继承父路由。

Cordis 加载 `dsh-agent-preset` 发布产物中的 Skills 和权限门控管理工具，不读运行时 `refs/`。`/agent inspect` 对照当前声明和当前 Agent 保留的实际模块；公开接口没有 revision 编号，不另造计数。配置、安装及隔离诊断复用上游，不复制 Web 页面模型。真实安装、启停、移除、监视与配置冲突验证见 [plugin-management.spec.ts](../../apps/omdsh/src/plugin-management.spec.ts)，模型侧工具/Skills 见 [presentation-mode.spec.ts](../../apps/omdsh/src/presentation-mode.spec.ts)。

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

完整覆盖清单见[上游功能支持盘点](upstream-feature-support.md)，区分核心交互与平台缺口、可选扩展、替代 Provider 和独立宿主；按用户能力统计，不按缺少的包数统计。

hooks、schedule、time/tmux context、skill-badge 当前未由产品默认挂载。它们不是依赖版本遗漏：接入前需有明确用户场景，核对已发布 API、权限与生命周期，再决定产品默认值和最小交互面；上游 base 挂载不等于 omdsh 必须挂载。

不额外提供 `/plugins` 来重复 `omdsh --dump-config` 的组合树；只有需要诊断“实际激活状态”且配置树不足以回答时，再设计运行时查询。冷会话投影缓存或 turn 大纲也应由实际加载瓶颈触发，先确认产品消费路径能使用该缓存，不能为了包名齐全而挂载。

## 升级证据与验证

升级时比较选定版本走廊的发布产物、exports、peer closure 和组合，不用聚合 release notes 代替 API 核对。工作区成功不证明 npm 消费者拥有同一依赖图；预发布 peer 区间可能吸收较新 cohort，产生同名服务的重复副本。

升级技能的两个[历史案例](../README.md#历史证据)保留了公开 API 迁移与 npm 混装证据。当前升级仍需按 [AGENTS.md](../../AGENTS.md)完成全套依赖和边界验证，并检查两个候选包的 packed manifest 与隔离消费者安装。将本机 macOS 验证、Windows CI 和真实模型请求分别报告，不能相互替代。

2026-10-04 在 macOS 上完成安装、清除编译缓存后的类型检查、1,401 条测试、构建、Markdown、边界检查、对话与 PTY 冒烟，以及 `git diff --check`。新增回归逐一验证产品和四个 preset 挂载的 DeepSeek 插件入口确实存在于安装产物。工作区解析到 151 个 DSH 包，包含开发用 mock server，全部为 `0.2.1-alpha.1`；三个参考子模块内部均保持干净。

CLI 与 TUI 经各自的 prepack 构建并共同安装到独立 npm 消费者，检查了 exports、bin、组合文件和改写后的 workspace 依赖。消费者的 150 个 DSH 运行时包全部为目标版本，DeepSeek 包无重复副本，两个产品包均来自本次 tarball。实际安装的 `omdsh` 编译入口通过 `--version`、`--dump-config` 和 Standard、PTC 两种 preset 的 mock 对话验证；mock 允许复用成功响应以同时覆盖会话标题请求。终端脚本使用工作区源码入口；直接在 pnpm 工作区用 Node 运行 `lib/bin.js` 时，上游 bundle 查找不会解析安装锚点自身，因此不能用该启动方式代替隔离消费者验证。本次未进行 Windows 本机或真实 Provider 请求验证。
