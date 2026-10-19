# DeepSeek Harness 集成与兼容

状态：按 omdsh `0.20.0` 的 Unreleased 工作区、DSH `0.2.1-rc.2` 核对，日期为 2026-10-18。这是当前兼容决策，不是 npm 最新版本查询。升级操作由 [dsh-upgrade 技能](../../.agents/skills/dsh-upgrade/SKILL.md)维护，产品架构见[站点文档](../../apps/site/content/zh/architecture.md)。

## 依赖基线

| 层 | 当前版本与来源 |
| --- | --- |
| omdsh 根、CLI、TUI | `0.20.0`，保持同步；本次适配尚未发布 |
| 直接 DSH 运行时依赖 | npm `0.2.1-rc.2`，精确 pin；lockfile 保持单一 DSH cohort |
| Cordis / Loader / Timer / Schemastery | `4.0.5` / `1.0.6` / `1.1.7` / `3.18.5`；Cosmokit 由同一 release-age 白名单放行 `1.8.6` |
| pi-ai | lockfile 解析到 `@earendil-works/pi-ai@1.1.0` |

事实来源是[CLI manifest](../../apps/omdsh/package.json)、[TUI manifest](../../packages/tui/omdsh-tui/package.json)、[lockfile](../../pnpm-lock.yaml)和[产品组合](../../apps/omdsh/config/cordis.yml)。`refs/` 仅用于研究，不参与解析、编译、测试或运行；`examples/hello` 是独立插件示例，不是 workspace 成员。

2026-10-02 的 rc.1 → rc.2 迁移保留了阻塞式问答，更新模型目录并带入上游 PowerShell 完成标记修复。[原始升级记录](https://github.com/agi-fans/oh-my-dsh/blob/7c6dae0/docs/dsh-0.2.0-rc.2-upgrade.md)记录当时的完整检查和隔离打包安装结果；它实施时的产品版本为 `0.18.0`，随后随 `0.19.0` 发布。记录中的测试数量和 macOS 结果不能冒充当前测试数量或 Windows 实测。

2026-10-04 迁移至 [DSH `0.2.1-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)，同步升级 Cordis 配套包。上游移除了 `dsh-invariants` 和五个 `/invariant` 插件导出，产品组合随之移除这六行；不保留旧包兜底。插件的 Cordis peer 使用 `~4.0.5-alpha.1`，因为旧的稳定版区间不接受预发布版本。目标循环取消时会撤回仍在 inbox 中的自动消息，避免后续用户输入被阻塞。会话事件、工具参数、preset 注册和 legacy 问答的产品消费接口保持兼容；默认 preset、Ralph 开关与 TUI 折叠行为不变。

2026-10-09 迁移至 [DSH `0.2.1-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)。删除已合并的 `dsh-subagent-in-process-driver` 依赖，挂载 `dsh-working-directory` 和 `dsh-tool-working-directory`。三个 preset 不再引用已移除的 `{{cwd}}` 变量，当前目录由上游模型上下文贡献提供。子代理工具移除 `backgroundMode` 配置，执行与结果回传由 runtime-managed activation 拥有。Session 格式仍为 v4；旧日志、历史 one-shot 子转录和 fork 种子保留原有恢复路径。

2026-10-18 迁移至 [DSH `0.2.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)，同步 Cordis 稳定线（`4.0.5` / `1.0.6` / `1.1.7` / `3.18.5`），并把 `node-addon-require-builtin` 提到 `^0.1.9`，满足 loader `1.0.6` 的新 peer。插件兼容判断改用 app-boot 导出的 `evaluatePluginCompatibility`：声明 `engines.dsh` 时只按该区间判定，否则才看 DSH peer；`/plugins` 相应展示 `requirements` 与 `restartReason`，不再自行推导 peer 规则。`dsh-session-persistence-jsonl` 不再默认导出持久化类，改为 Cordis 插件；YAML 组合不变，直接挂载它的测试改用命名空间。子代理能力声明移除 `toolFilter`/`persona`、新增 `agentPreset`，产品本来就不传这两个字段。headless 凭据优先级变化只发生在上游 `headless` profile 的组合里，`omdsh exec` 使用自己的 profile，仍读取已保存凭据。Session 格式仍为 v4，token 投影的公开形状未变。完整证据见[升级记录](../history/dsh-0.2.1-rc.2-upgrade.md)。

## 工作目录

`working_directory` 查询当前目录，`cd` 切换到已经存在的目录；原始 `session.header.cwd` 保持不变。TUI 从 `workingDirectory` 服务读取当前值，文件浏览、diff、附件、补全、Skill 查询、新终端和底部路径跟随切换。现有 shell 不移动，会话归类与原始 workspace 权限不扩大。恢复或 fork 时重放 `working-directory/change`，查看本地子代理时显示该子代理自己的当前目录。

## 问答兼容

产品设置 `tool-ask-user.config.mode: timed`、默认等待 120 秒。[interaction-adapter](../../packages/tui/omdsh-tui/src/session/interaction-adapter.ts)通过 `user-questions/request` 和 `attachWait` 接入问答与剩余时间；终端负责倒计时，编辑和 `Ctrl+T` 会持有当前 wait。`Ctrl+S` 跳过单题，有限时问题按 `Esc` 返回 pending，`Ctrl+C` 与调用方取消返回中断。整批问题共享一个 deadline；排队中的问题仍按 Host 原截止时间结束，不先持有 wait。

待答计数与 `/questions` 从公开 `userQuestions` 投影读取，补答调用 `answer()`，沿 Harness 的 `user-question-reply` 排队与入日志，转录重放显示同一问答文本。收起不提交答案；已排队补答不能重复发送；命令卸载与会话释放会取消输入。Profile 可显式恢复 legacy，模型也可在 timed 下设置 `timeout: -1`；这些阻塞调用没有有限倒计时，收起作为取消处理。

PTC 默认执行预算为 180 秒，留出默认问答等待和 sub-call 记录时间。问答的 Take time 不暂停外层程序预算；PTC 进程若在记录 dispatch 结果前结束，上游无法恢复该问题用于补答，这仍是上游契约限制。Standard 和 PTC 的真实 CLI 调用验证见 [timed-question.spec.ts](../../apps/omdsh/src/timed-question.spec.ts)。

## 插件管理、配置与创作

运行态入口为 `/plugins`，消费已发布 `pluginManager` 的清单和事务。HMR 使用公开 `appReady` 启动成功信号，默认 `root: []`，只监视 Profile/主目录配置。CLI 与运行态共享 Profile manifest 写锁；新 bundle 可即时应用，已安装包代码替换仍要求重启。取消等待进程停止和文件恢复，待执行脚本另需明确授权，终端自身的 consumer 在管理列表中保持只读。

Codex/Claude Code bundle 作为 CLI 的精确 npm 依赖默认安装，初始未选入 Profile；Bundles 显示 Installed · Disabled，并提供 Enable。随包依赖跟随 omdsh 更新，不提供会被安装位置覆盖的 Profile 重装。缺失的官方包仍提供 Install，Profile 安装的包提供 Reinstall，版本匹配正在运行的 Harness；沿用人工确认、事务取消与脚本审批。等待卡片仅 Esc／Ctrl+C 取消，Enter 不触发取消；失败或取消不显示请求中的启用意图，每次操作后重新查询清单。配置入口按 bundle 声明的 Provider row id 查找 Settings namespace，只打开 model 与 permissionMode，复用版本检查；诊断重新读取包状态与条目的实际 phase。原生平台运行时由 bundle 提供，不探测 PATH、凭证或自动发起委派，真实启动与认证仍需对应环境验收。

`/settings` 按用户任务收编自带设置，Advanced 遵守自动表单策略，并按字段去重；现有 terminal provider 消费公开 settings descriptor 生成表单，只编辑 live 字段，带 revision 按路径写入。API-key/ref 配对使用 credentials；包含密钥的复合字段不通过 JSON 重写。子代理模型选择由已发布 `model-selection-settings` 服务拥有，默认关闭；omdsh 的 preset consumer 沿用全局委派行的配置，在 Standard/PTC/Cordis 的会话 scope 内接入上游取样与清理。Minimal 保持双工具，fork 继续继承父路由。

Cordis 加载 `dsh-agent-preset` 发布产物中的 Skills 和权限门控管理工具，不读运行时 `refs/`。`/agent inspect` 对照当前声明和当前 Agent 保留的实际模块；公开接口没有 revision 编号，不另造计数。配置、安装及隔离诊断复用上游，不复制 Web 页面模型。真实安装、启停、移除、监视与配置冲突验证见 [plugin-management.spec.ts](../../apps/omdsh/src/plugin-management.spec.ts)，模型侧工具/Skills 见 [presentation-mode.spec.ts](../../apps/omdsh/src/presentation-mode.spec.ts)。

## 产品组合决策

- **DeepSeek 路由**：API-key provider 是 `dsh-llm-deepseek-api-key`；Profile 行 id 保持 `llm-deepseek`，以延续已有用户 patch。`dsh-llm-deepseek` 是 transport library，不能把历史 provider 包名直接恢复到挂载行。
- **Preset**：产品自己的 preset 声明拥有 persona 和工具呈现配置。PTC 是运行时 preset 的真实配置，不由 TUI 根据名字伪装；TUI 只展示 Harness 投影。
- **会话检索**：人类与模型侧检索都已提供。SQLite 索引按 `first-search` 延迟打开，持久路径为 home 下的 `sessions-query.sqlite`；JSONL 日志仍是事实来源。模型侧只读工具的跨会话访问要求 cwd 匹配。旧文档中的 `openAt: never`、内存索引或“模型检索未挂载”已失效。
- **LSP/MCP**：`apps/omdsh` 拥有配置到组合的适配。LSP 仅在配置服务器时挂载，不内置服务器或自动探测；MCP 提供工具与资源能力。配置方式见[语言服务器](../../apps/site/content/zh/language-servers.md)和 [Skills 与 MCP](../../apps/site/content/zh/skills-and-mcp.md)。
- **Web Search 与反馈**：均已提供，实际开关及配置见[工具](../../apps/site/content/zh/tools.md)和[设置](../../apps/site/content/zh/settings.md)，不再重复维护为待挂载计划。逐条 Assistant 回复的评分、分类、备注与清除走 `dsh-message-feedback` 与 TUI `/rate`，只写本地日志，并按消息版本做 compare-and-set。上游 session 级 `/feedback` 因只有写入、没有读取或外发路径而未挂载。网页搜索与抓取默认走官方 DeepSeek Search/Fetch API（`deepseek-search-api`/`deepseek-fetch-api`），使用上游 `DEEPSEEK_API_KEY`；在 `deepseek-account` 会话中改由共享账户 token 鉴权。Messages 搜索与本地 HTTP 抓取保留为可切换 fallback。DeepSeek 账户路由（`deepseek-account-platform` + `llm-deepseek-account`）既复用 DSH Web/Desktop 已建立的授权，也能从 `/login` 发起浏览器登录：主机挂载 `dsh-host-webserver`，仅监听 `127.0.0.1` 的随机端口并在尝试期间注册 `/oauth/callback`。
- **Spill 与压缩**：单次工具 spill 会改变写入日志的结果，当前显式 `maxInlineTokens: 50000`；压缩前 pruner 则只裁剪模型上下文，完整结果仍在日志。组合顺序固定为 token meter → tool-result pruner → compaction，不能混淆两者对工具展开的影响。
- **Workflow**：仅挂 `dsh-workflow-ptc` provider，`dsh-workflow` 保留为依赖；同时挂两个 seam provider 会重复注册 `workflowEngine`。工具保持 `workflow_run` 命名，以兼容已有会话与工具策略；Plan 状态通过上游 `/plan` 命令管理。
- **提醒**：`dsh-schedule` 挂在 storage-domain 之后，`dsh-tool-schedule` 作为全局工具行，minimal 的 allow 列表自然隐藏，子代理由工具自身拒绝。TUI 提供 `sessionController.resolveAgent`：活会话直接返回，冷会话按记录的 preset 与当前默认模型恢复并常驻，交付只追加 `followup` 并 flush，不激活或替换当前界面。`/schedule` 负责列表、交付记录、改名/改指令与删除，定时修改仍由模型工具完成。真实定时器回归覆盖活会话投递与重启后的冷会话恢复投递。
- **Ralph**：工具行保留但默认禁用，用户显式启用才进入自动循环；不能因升级上游默认组合而自动打开。

## 隔离子任务

默认 `subagent` 与 `subagent_fork` 使用进程内 continuable provider，保留后续消息、控制和父级 composition。可选 `subagent_isolated` 使用 ACP 的独立进程，提供的是 one-shot 委派，不能在派发后 steering 或追问。

新的外部 catalog 模式为 `external`，没有本地 Session 转录。Agent Hub 消费公开 `subagent/start` 与 `subagent/end` 显示生命周期；结果由 Harness 回传父会话。EOF 等待仍在推进的后代并重新检查父级是否空闲，释放会话前先 drain 后代。历史 `one-shot` 模式仍按原有日志呈现。

ACP 工具必须使用 `maxDepth: provider-managed`，不设置 `agentOptions`、`persona` 或 `toolFilter`。子进程运行独立 home/Profile；默认启动方式要求 PATH 上的 `dsh` 提供 `acp` Profile，`OMDSH_ACP_COMMAND` 和 `OMDSH_ACP_ARGS` 可覆盖命令。不能将这一可选 transport 描述为全部子 Agent 已进程化。

## 后续接入条件

完整覆盖清单见[上游功能支持盘点](upstream-feature-support.md)，区分核心交互与平台缺口、可选扩展、替代 Provider 和独立宿主；按用户能力统计，不按缺少的包数统计。

Codex 与 Claude Code hooks 已提供 Settings 中的显式启用入口；time-context 已在 Standard/PTC/Cordis 默认挂载、Minimal 不挂，tmux context 与 skill-badge 当前未由产品默认挂载。它们不是依赖版本遗漏：接入前需有明确用户场景，核对已发布 API、权限与生命周期，再决定产品默认值和最小交互面；上游 base 挂载不等于 omdsh 必须挂载。

`/plugins` 查看实际激活状态与安装事务；`omdsh --dump-config` 查看组合声明，两者不互相替代。冷会话投影缓存或 turn 大纲也应由实际加载瓶颈触发，先确认产品消费路径能使用该缓存，不能为了包名齐全而挂载。

## 升级证据与验证

alpha.2 的可选 Git Worktrees bundle 随产品安装但默认关闭。`/worktree` 通过公开 `worktrees.create()` 创建，通过执行 provider 在当前 Access 下读取 Git 的 NUL porcelain registry，并使用 `workingDirectory.set()` 切换或返回；不复制 service 内部实现，不清理 checkout 或分支。Session Library 按 `formatStatus` 读取历史 header，恢复时确认迁移，取代启动时的批量写入迁移。

思考沿用 Turn 中的原有展示和过程展开。产品不挂载独立思考阅读命令、translator 或翻译设置；已有 Session plugin records 保留在日志中。

升级时比较选定版本走廊的发布产物、exports、peer closure 和组合，不用聚合 release notes 代替 API 核对。工作区成功不证明 npm 消费者拥有同一依赖图；预发布 peer 区间可能吸收较新 cohort，产生同名服务的重复副本。

升级技能的两个[历史案例](../README.md#历史证据)保留了公开 API 迁移与 npm 混装证据。当前升级仍需按 [AGENTS.md](../../AGENTS.md)完成全套依赖和边界验证，并检查两个候选包的 packed manifest 与隔离消费者安装。将本机 macOS 验证、Windows CI 和真实模型请求分别报告，不能相互替代。

2026-10-09 的 alpha.2 适配在 macOS 上通过安装、清除编译缓存后的类型检查、1,973 条测试、构建、Markdown、边界检查、对话及 PTY 冒烟和 `git diff --check`。真实 CLI 回归覆盖工作目录切换后的模型上下文、托管子代理的父级结果回传、Standard/PTC timed 问答、旧会话恢复与 fork，以及 Git Worktree 创建、源改动保留和只读权限拒绝；终端测试覆盖目录补全与 footer、Worktree 创建取消与切换、历史列表只读和迁移确认、外部执行状态和 EOF 等待的卸载取消。该次验证曾包含 translator 回环 HTTP 与 JSONL 缓存测试；产品随后撤销翻译和独立思考阅读入口。外部配置回归验证版本检查、字段筛选与未安装包诊断。lockfile 的 161 个 DSH 包全部为 alpha.2，参考子模块保持干净。两个候选 tarball 共同安装到隔离 npm 消费者，61 个 export/bin 目标均存在，160 个 DSH 运行时包版本一致且 DeepSeek 包没有重复副本；实际安装入口通过版本、组合、Standard/PTC mock 对话、可选 Worktree 创建验证；该次产物还包含随后移除的独立思考原文阅读入口。尚未验证 Windows 实机、付费模型或 Codex/Claude Code 原生运行时与认证。

2026-10-04 在 macOS 上完成安装、清除编译缓存后的类型检查、1,401 条测试、构建、Markdown、边界检查、对话与 PTY 冒烟，以及 `git diff --check`。新增回归逐一验证产品和四个 preset 挂载的 DeepSeek 插件入口确实存在于安装产物。工作区解析到 151 个 DSH 包，包含开发用 mock server，全部为 `0.2.1-alpha.1`；三个参考子模块内部均保持干净。

上述 alpha.1 验证中，CLI 与 TUI 经各自的 prepack 构建并共同安装到独立 npm 消费者，检查了 exports、bin、组合文件和改写后的 workspace 依赖。消费者的 150 个 DSH 运行时包全部为目标版本，DeepSeek 包无重复副本，两个产品包均来自本次 tarball。实际安装的 `omdsh` 编译入口通过 `--version`、`--dump-config` 和 Standard、PTC 两种 preset 的 mock 对话验证；mock 允许复用成功响应以同时覆盖会话标题请求。终端脚本使用工作区源码入口；直接在 pnpm 工作区用 Node 运行 `lib/bin.js` 时，上游 bundle 查找不会解析安装锚点自身，因此不能用该启动方式代替隔离消费者验证。本次未进行 Windows 本机或真实 Provider 请求验证。
