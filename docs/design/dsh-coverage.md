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
| `ui-jobs` | `/jobs` |
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
| `ui-settings-plugins` `ui-settings-plugin-inventory` | `/plugins` 与 `/settings → Integrations` |

## 四、缺口

按影响排序。

### `ui-plugin-market`：市场索引

DSH 的 Plugins 面板有一个 Discover 标签页，浏览市场索引并安装其中的 bundle。omdsh 需要先有 `/plugins` 面板（已恢复），市场索引才可以挂上去。

### `ui-workflow-run`：workflow 运行回放

DSH 把持久 workflow 运行作为嵌套对话展开。omdsh 只有模型侧 `tool-workflow`，运行过程在转录里只是一张工具卡。

### `ui-settings-session-log`：会话日志上传开关

这个设置页由 `session-log-deepseek` 的 Host 设置提供，而 omdsh 没有挂载它，所以设置本身不存在——不是表面缺失，是能力未挂载。要在终端里提供它，先决定是否接受「随官方 API 请求上传会话日志」，这属于产品政策问题而不是 UI 问题。

### `ui-secret-mask`：粘贴凭证的打码显示

共享屏幕或截图时，DSH 把已识别凭证的首八位之后画成 `*`，只改绘制，消息文本、复制内容与模型输入都保持原文。终端面对同一个场景——录屏、结对、投屏——所以这不是 Web 专属问题。

## 五、有意不提供

| DSH | 理由 |
|---|---|
| `ui-message-feedback` | DSH 自己的契约写明：评分是「关于输出的信号，永不作为输入」，是只写进日志再由官方产品面读取的数据。omdsh 不是官方客户端，没有那个下游，`/rate` 会变成写进日志再没人读的记录。 |
| `ui-directory-picker-browse` | 选择一个工作目录的浏览器内界面。终端里启动目录由 shell 决定，`--cwd` 与 `omdsh` 的工作目录参数已经回答同一个问题。 |

## 六、维护

这张表随 DSH 版本更新。升级到新的 DSH cohort 时，先 `ls packages/client | grep '^ui-'` 比对本文，把新增包按「已覆盖 / 缺口 / Web 外壳 / 有意不提供」归档，再决定是否实现。

一个能力面在表里处于「缺口」是允许的状态，但必须写在这里并给出理由——否则它会在下一次清理里被误当作冗余删掉，`/trajectory` 就是这样丢过一次。
