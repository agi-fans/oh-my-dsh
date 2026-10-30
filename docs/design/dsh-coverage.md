# DSH 能力覆盖表

omdsh 是 DeepSeek Harness 的 TUI。能力归属因此是单向的：DSH 有什么，omdsh 就有；omdsh 只决定形态。

这条规则是本文的判据，也是它存在的理由。此前删除命令时用的是临场判断——「有没有别的路径能到」——那个标准会误杀：`/trajectory` 被当成调试器删掉，而它是 DSH 官方 Web 与桌面客户端的 `ui-trajectory`，是这套事件溯源历史本身的呈现。**存在替代路径不等于存在同等的表达能力。**

所以规则改写为：

> DSH 每个承载能力的客户端 UI 包，omdsh 必须有一个 TUI 表面，形态按 pi 对齐（输出进转录、选择进贴底卡片、输入留 composer）。只属于 Web 外壳的包不需要。

## 一、形态规则

| 内容 | 形态 |
|---|---|
| 命令产出、报告、诊断、状态 | 转录结果；超过十二行折叠成一行，`Ctrl+O` 展开 |
| 需要人在若干项里选一个 | 贴底卡片；行在卡片内滚动，打字过滤，选中项预览 |
| 需要逐行读的长文与 diff | 阅读器（唯一占屏的形态，需要行号、查找与阅读位置） |
| 参数可枚举的命令 | 输入即补全，Enter 执行已写的那一行 |
| 高频动作 | 键，不必敲命令 |

DSH 官方客户端是 Web GUI，一个表面可以同时容纳侧栏、右栏、模态与通知。终端只有一个纵向视口，所以同一个能力在 omdsh 里往往落在一个更小的形态上——这是允许的差异，因为被削减的是并行度，不是能力。

## 二、Web 外壳：不需要 TUI 对应物

这些包解决的是浏览器布局、品牌与扩展点，终端里没有对应问题。

`ui-layout` `ui-dockkit` `ui-sidebar` `ui-sidebar-right` `ui-renderer` `ui-slots` `ui-primitives` `ui-session` `ui-brand-official` `ui-deepseek-model-label-1017` `ui-entry-customization` `ui-file-drag` `ui-sidebar-browser` `ui-directory-picker-native`

`ui-file-drag` 与 `ui-sidebar-browser` 列在这里而不是缺口：前者是浏览器到浏览器或桌面的拖拽，终端里粘贴与 `@` 路径已覆盖同一意图；后者在沙箱内浏览网页，终端没有浏览器，同一个 web 能力由模型侧的 `tool-web` 承担。

## 三、已覆盖

| DSH | omdsh 表面 |
|---|---|
| `ui-chat` `ui-conversation` | 转录与 composer |
| `ui-tool` | 工具卡；`Ctrl+O` 展开、`Alt+O` 单次调用详情 |
| `ui-approval` | 审批卡片（动作、原因与精确匹配规则都在卡片上） |
| `ui-user-questions` | 问题卡片；`/questions` 补答 |
| `ui-plan` | `/plan` 与 plan review 卡片 |
| `ui-goal` | `/goal` 与底部目标条 |
| `ui-jobs` | `/jobs` 与 `/jobs <id>`（回放一次运行的观察者叙述） |
| `ui-workflow-run` | `/jobs <id>` 的 `log` 通道回放 |
| `ui-subagent` | 转录里的子 Agent 行与检查 |
| `ui-model-selection` | `/model`（列表与参数补全） |
| `ui-permission-presets` | `/permission` |
| `ui-agent-preset` | `/agent` |
| `ui-trajectory` | `/trajectory` |
| `ui-deliverables` | Changed files 卡与 `/diff` |
| `ui-attachment` | `/attach` 与消息图片 |
| `ui-reference` `ui-input-trigger` `ui-skill` | `@` 补全、内联提示、`/skill:` |
| `ui-commands` | 斜杠补全与参数补全 |
| `ui-shortcuts` | `/help full` |
| `ui-sidebar-documentpreview` | 文档阅读器 |
| `ui-sidebar-files` | `@` 补全与 `/diff` 文件列表 |
| `ui-sidebar-terminal` | `!cmd`、`!!cmd` 与终端控制台 |
| `ui-workspace` | `/resume`（含搜索、pin、archive、fork） |
| `ui-schedule` | `/schedule` |
| `ui-secret-mask` | 转录里绘制的用户消息；凭证尾部打码 |
| `ui-theme` | `/settings → Theme` |
| `ui-open-in-app` | 阅读器的 Open 与 Editor |
| `ui-settings` | `/settings` |
| `ui-settings-general` | `/settings → Interface` |
| `ui-settings-models` | `/login` 与 `/settings → Model` |
| `ui-settings-account` | `/login` 与 `/settings → Integrations` |
| `ui-settings-shell` | `/settings → Tools` |
| `ui-settings-web-search` | `/settings → Tools` |
| `ui-settings-agent-loop` | `/settings → Agent` |
| `ui-settings-subagent` | `/settings → Tools` |
| `ui-plugin-manager` | `/plugins` |
| `ui-plugin-market` | `/plugins → Discover`（`dsh-plugin-market` Host 服务只做呈现） |
| `ui-settings-plugins` `ui-settings-plugin-inventory` | `/plugins` 与 `/settings → Integrations` |

## 四、缺口

按影响排序。

### `ui-settings-session-log`：会话日志上传开关

这个设置页由 `session-log-deepseek` 的 Host 设置提供，而 omdsh 没有挂载它，所以设置本身不存在——不是表面缺失，是能力未挂载。要在终端里提供它，先决定是否接受「随官方 API 请求上传会话日志」，这属于产品政策问题而不是 UI 问题。

## 五、呈现层的分工

覆盖一个能力面不等于用同一个容器。通用卡片只承诺**选项、筛选、预览、选择结果、共享行与导航**；一个界面若必须持续编辑（设置的行内改值）、按事件结构分组并跟随（trajectory 的账本）、或同时显示两个独立视口，它拥有自己的控制器与布局，只复用纯粹的渲染原语。三个界面现在都已复用共享导航，settings 另外复用了共享行；统一在**原语**层已经发生，不必再统一在**布局**层。

判据写在 [philosophy.md](philosophy.md)：把交互写成按键序列与状态断言，能在不改通用卡片公共类型、控制器或按键语义的前提下通过，就用卡片；否则专用。

### 子代理条取代了 Agent Hub

Agent Hub 曾是三项里被反复讨论的「该不该统一」之一。结论不是统一到通用卡片，而是**整块删掉，把唯一不可替代的动作搬进子代理条**：`↓` 选中一行、`Enter` 打开那个子会话。

它独占过四样东西，逐条有了去处：

| 曾是 Hub 独占 | 现在 |
|---|---|
| 打开子会话转录（唯一的 `#openInspect` 入口） | 条上 `Enter` 直接打开 |
| 完整的 roster（条只显示 5 行） | 条本身就是名册；`↑↓` 在其中移动 |
| external 子代理的详情（它们没有转录） | `Enter` 打印成转录结果，可折叠 |
| workflow 运行状态（最近三次） | 条首的 `Workflow · …` 行 |

教训是**「唯一入口」不等于「需要一块屏」**：Hub 之所以存在，是因为它是 `#openInspect` 的唯一触发点，而那不是布局需求，是一次按键没接上。接上之后，228 行的界面、它的 `Alt+A`、它自己的按键表、`T` 开关与双视口都随它消失。

## 六、有意不提供

| DSH | 理由 |
|---|---|
| `ui-message-feedback` | DSH 自己的契约写明：评分是「关于输出的信号，永不作为输入」，是只写进日志再由官方产品面读取的数据。omdsh 不是官方客户端，没有那个下游，`/rate` 会变成写进日志再没人读的记录。 |
| `ui-directory-picker-browse` | 选择一个工作目录的浏览器内界面。终端里启动目录由 shell 决定，`--cwd` 与 `omdsh` 的工作目录参数已经回答同一个问题。 |

## 七、外部子代理默认关闭

`@deepseek-ai/dsh-subagent-codex` 与 `@deepseek-ai/dsh-subagent-claude-code` 随包安装（`availability: installation`），但**默认 `enabled: false`**，只能由读者在 `/plugins → Bundles` 显式开启。这不是保守，是三个具体事实的结果：

1. **Codex 那条钉死在自己的载荷上。** 插件 `resolve` 自己的依赖 `@openai/codex`，不读 PATH，也没有宿主 CLI 回退（README：「no host-CLI fallback」）。它钉的是 **0.153.4**，而同期上游 CLI 已到 0.166.0——相差十余个版本。插件 README 写明换掉它需要「重新生成上游 schema 证据并重跑带凭据的 nonce 测试」。
2. **这条钉法不随 DSH 版本变化。** `0.2.1-rc.3` 与 `0.2.1-rc.5` 的 `lib/index.js` 逐字节相同，同一个 Codex 版本声明，同一句协议基线。升级 DSH 不会移动它。
3. **它没有人类审批通道。** 已知的审批请求直接拒绝，未知的服务器请求 fail closed（同上 README）。需要批准才能完成的任务在 Codex 子代理里必然失败，而失败只回一句安全诊断。

所以默认关闭的理由是**适配性风险**，不是偏好：开启它等于把一个自己钉住协议版本、且无法接受审批的外部代理放进会话。Claude Code 那条没有这个问题（走 `@anthropic-ai/claude-agent-sdk`，不钉 CLI 版本），但两条保持同一个默认值，因为开启它们是同一种决定——把一个外部进程接进来。

判断它是否仍然必要，用 `omdsh doctor` 之前先看 `node -p "require('@deepseek-ai/dsh-subagent-codex/package.json').dependencies['@openai/codex']"` 与分析版 CLI 是否接近；差距在一个大版本内再考虑默认开启。

## 八、维护

这张表随 DSH 版本更新。升级到新的 DSH cohort 时，先 `ls packages/client | grep '^ui-'` 比对本文，把新增包按「已覆盖 / 缺口 / Web 外壳 / 有意不提供」归档，再决定是否实现。

一个能力面在表里处于「缺口」是允许的状态，但必须写在这里并给出理由——否则它会在下一次清理里被误当作冗余删掉，`/trajectory` 就是这样丢过一次。
