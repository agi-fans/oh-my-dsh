# Harness 交互对齐契约

omdsh 以已发布 Harness 的产品语义为基线，以终端的输入、布局和原生历史契约决定呈现方式。官方基线为 `0.2.2-rc.3`，参考 checkout 为 `fcc0ad4621`，另以 `dsh-v0.2.2-rc.3` 标签做只读比对；上游源码只用于研究，运行时仍使用 npm 包。

## 已落实的对应关系

| 用户意图 | 官方行为与来源 | omdsh 入口与契约 |
| --- | --- | --- |
| 选择模型 | [Model selection](../../refs/deepseek-harness/packages/client/ui-model-selection/README.md)：`/model` 使用所选模型默认 effort；Host 同时保存默认模型 | `/model` 和 Settings → Models 共用选择器；列表和参数查询均使用模型的默认 effort。`/model reasoning` 明确修改强度。 |
| 设置未来权限 | [Permission presets](../../refs/deepseek-harness/packages/client/ui-permission-presets/README.md)：设置改未来默认，composer 改当前会话 | General → Default access 修改 `permission.defaultPreset`；Current session access 和 `/permission` 修改当前会话。默认选择器只列出 `catalog.defaultOptions`，不混入仅当前会话可用的 Auto。 |
| 设置未来 Agent | [Agent preset](../../refs/deepseek-harness/packages/client/ui-agent-preset/README.md)：默认值与会话的已选模式分别存储 | Agent presets → Default Agent preset 修改 `agent-preset-registry.selectedDefault`，保留当前会话；Current session preset 只允许修改空白会话。 |
| 创作插件 | 官方 Plugins 页面可以进入 Creator，保留草稿且不提交消息 | `/plugins` 的 Let the agent create a plugin 与 `/agent creator` 使用同一入口。空白会话切换为 `cordis`；已有对话时创建指定 preset 的新会话；不改变默认值。不可用或失败时保留当前会话。 |
| 配置插件 | [Plugin settings](../../refs/deepseek-harness/packages/client/ui-settings-plugins/README.md)：插件配置由其所有者提供 | Settings → Plugins 与 `/plugins` → Configure plugins 打开同一套 schema 表单，继续使用原 namespace、revision 和 credentials 服务。 |
| 设置终端 | 终端呈现属于 omdsh | 外观、输入、通知、启动偏好和状态栏集中在 Terminal；搜索覆盖所有分类，空分类隐藏。 |

默认设置的修改必须经过 Harness 的版本校验；取消不写入，恢复继承使用 unset，不把读取到的默认值复制成永久覆盖。Agent preset 列表保留自定义名称和描述，内置 `cordis` 的展示名称为 Creator。

## 语言契约

General 分开提供界面语言与回复语言。界面语言由 TUI 的 `uiLanguage` 实时字段持久化，Auto 依次读取 `LC_ALL`、`LC_MESSAGES`、`LANG`；中文环境选择简体中文，其他环境回退英语。翻译在布局测量前进行，主题缓存键包含解析后的语言。只翻译产品拥有的文字，用户内容、模型输出、工具参数与文件内容保留原文，已进入原生 scrollback 的行不重写。底部状态栏与设置中的状态栏预览固定使用英文标签，保持宽度和位置稳定；设置控件与说明仍跟随界面语言。

回复语言继续由 `agent-behavior.language` 插件拥有，增加 `follow-ui` 值。它在回合边界解析为具体语言并冻结到本回合结束。旧配置的 schema 默认值仍为 Auto；首次创建 Profile 时才显式写入 Follow UI，已有补丁不重写，home 补丁仍有更高优先级。指令只表达面向用户的沟通语言偏好，不声称控制内部思考语言。

## 运行中输入契约

Enter 默认将消息排入下一回合，可通过 Terminal → Input 的 busyEnter 偏好改为插话；Alt+S 始终插话，排队快捷键始终投递到下一回合，空闲发送和命令不受影响。两种方式共用完整文本与附件提交路径，投递意图在提交时冻结；沿用 Harness 的 `followup`、`steer` 与 durable inbox。待处理区区分 Steer／下一步、Queue／下一回合和 Sending／尚未接收，产品文字跟随 UI 语言，消息原文保持不变。`/queue` 与 Alt+Q 共用实时列表，支持编辑、撤回和同组排序；运行中 Alt+S 将已接收的下一回合消息转为下一步插话，沿用原消息身份和附件引用；Alt+Up 则明确撤回到 composer 后重新提交。

Stop 使用 `cancel({ kind: 'user' }, { keepInbox: true })`，保留两个 inbox，不取回最后一条后清空其余消息。消息取出由实时 inbox claim 的 splice 推导，确认仅显示在 composer，不写入转录或在 resume 时重播。已被取出的消息无法再编辑，修改内容恢复为未发送草稿；切换会话时中断的修改保存在原会话。等待交付的含图片消息修改文字后丢弃旧文本位置记录，保留全部图片与文件。

当前发布包的 `AgentHandle.dispose()` 无保留 inbox 选项，正常退出及会话切换后的 handle 清理会写入取消消息的 splice。真实终端验证已确认，正常退出后 resume 不能恢复这些消息；重放未清空日志的单元测试不能证明退出恢复。此项需要上游提供保留 inbox 的释放接口，不能通过 TUI 私存已接收消息或覆写 Agent 方法绕过。[生命周期评估与上游报告](../integrations/harness-inbox-lifecycle.md)记录已发布版本、可运行复现和接口建议。

## 账户交互契约

Settings → Models → DeepSeek account、服务商列表的账户项和 `/login` 共用账户页。页面消费已发布 `deepseekAccount` 的安全快照、资料、钱包和状态订阅，不读取或缓存 token。资料和余额独立加载，刷新重试，充值与赠送钱包分开呈现；服务端金额字符串不变，格式化只发生在界面。状态切换和页面关闭使旧请求结果失效。账户模型选择复用 `/model` 的选择器与会话／默认范围，不只返回命令提示。

浏览器授权与退出继续调用 Harness 服务；取消只针对本次 attempt，退出须确认。`deepseek-account/session-expired` 和模型要求登录的事件只触发一次临时提示，快照与会话回放不生成提示，新登录后可再次提醒。请求元数据使用当前界面语言和时区偏移。行为依据为[官方账户界面](../../refs/deepseek-harness/packages/client/ui-settings-account/README.md)及已发布账户服务；不引入桌面嵌入页面、充值支付或额外账户状态存储。

## 定时任务交互契约

`/schedule` 消费已发布 `schedule.catalog()`，按 `involvedSessionIds` 限定当前会话。列表与详情订阅 `schedule/changed` 后刷新；失败保留上次内容，刷新成功前禁止写操作，关闭或取消后忽略迟到结果。暂停、恢复、改名、改指令与删除调用 `schedule.edit()`，保留编辑开始时的 `expectedUpdatedAt`，确认或输入结束后重新检查任务是否正在执行；版本冲突提示重新查看，不覆盖新值。执行中的任务不开放这些操作，删除须确认。

立即运行调用 `schedule.run()`，不修改计划时间；尊重 `executionActive`、`deliveryFloorEndsAt` 与目标会话归档状态。投递成功与模型完成分开表达，写入成功后的刷新失败不改写成功结果。历史使用公开游标每页读取二十条，追加更早记录并按消息身份去重；读取失败保留内容及可重试游标，游标失效后要求刷新。仅显示记录保存的历史指令，缺失时不以当前指令冒充；读到末页才说明更早记录的保留限制。行为依据为[官方定时任务界面](../../refs/deepseek-harness/packages/client/ui-schedule/README.md)及已发布服务；创建、改时间规则和改时区仍交给 `schedule_*` 工具，TUI 不接管计时、持久化或执行调度。

## 子代理交互契约

子代理继续使用原地转录与名册，不增加独立面板。Enter 沿用运行中输入偏好，Alt+Enter 排队，Alt+S 插话，完整文本与附件分别经已发布的 `queueHostSubagentPrompt`／`steerHostSubagentPrompt` 交付给确切的直接父代理；冷恢复、接纳与执行归 Harness 管理。一次性子代理只读，外部执行无本地转录。子代理队列只展示自己的日志投影，不显示主会话尚未接收的输入。Alt+Q 与 `/queue` 复用同一列表，支持编辑、撤回、同组排序与 Queue → Steer；Alt+Up 取回该子代理最新的下一回合消息。操作绑定确切的存活后代与查看代次，切换后不修改新会话；附件恢复完成后才撤回，过期结果保留在原草稿。连续提交按顺序进入 Harness，不能因图片存储较慢而倒序。未在本地加载的子代理提示先继续对话，不因打开队列自动恢复。

切换查看对象会取消尚未接收的投递，失败草稿恢复到原子代理并保留较新的草稿。父子草稿隔离在没有磁盘草稿存储的嵌入环境也成立。Ctrl-C 优先中断查看中的子代理，不能落到父会话的 Shell 或 Agent；Esc 负责清空草稿和返回。停止投影为 Stopped，失败为 Failed，可继续的空闲子代理为 Ready；恢复名册不会把可继续对话的孩子显示为已完成。

审批适配器仅接收活动根代理及其确切存活后代的请求；子代理审批显示请求者与其自身工具参数。Needs approval 只反映实时请求的生命周期，完成、取消、会话释放或切换根会话后移除。`dsh-user-questions` 的公开 `ask` 在派发事件前拒绝受委派调用者（`DELEGATED_CALLER`），因此不绕过服务给子代理新增用户问题入口。

## Workflow 查看契约

顶层 `tool-workflow/*` 日志投影进入现有名册，和子代理共用有界窗口。选择工作流打开现有树列表，按已开始成员的准确 phase 分组；缺省和空字符串是不同分组，成员按开始顺序保留，结算不删除或重排。产品状态翻译，运行、阶段和成员名称保持原文。列表刷新保留选择与手动折叠，不额外复制官方 Web 节点的自动折叠状态机。

成员导航在列表展示和提交时均检查：成员未结算、子代理正在运行、直接父会话为当前根会话、registry 确认实际所有权、名册中有身份记录。不可用、外部、已结算或独立恢复的成员不从该入口打开；普通子代理名册保留自己的历史查看契约。关闭、切换视图或释放根会话结束查看，不改变工作流执行或用户草稿。

普通 step/turn 结束不能证明后台工作流停止。只有 run-start 所在回合以 `interrupted` 或 `forked` 关闭且缺少 run-end 时，投影才显示 Interrupted；已有成员结算与后到的 run-end 保持优先。该推导不写回日志，也不改变工具结果。后台工作流的停止与运行日志沿用 `/jobs` 的已发布接口；不新增没有 Harness 支持的暂停、重试或独立调度状态。

## Models 服务商管理契约

Settings → Models 的模型服务商入口由现有 settings consumer 提供，复用键盘列表和受保护输入。读取 Harness 的 configurable-provider directory、脱敏 settings descriptor 和 credentials 描述，显示凭据来源、模型数量和目录错误；所有权事件刷新列表，编辑中的草稿与 revision 不随后台更新替换。已发布 `llm` 服务通过可选服务查询访问，服务商入口不会让其他设置依赖模型服务的生命周期。

字段修改先进入草稿，Apply 只提交变化的路径，沿用显示时的 revision。已有模型参数和未编辑字段保留，恢复默认模型使用 unset。设置写入成功后更新基线再保存密钥；密钥失败保留输入，重试不会重复提交配置。Cancel 只放弃尚未保存的修改。服务商变更不修改模型选择，凭据只写入 credentials 服务。删除仅开放给 user 层独有的路由，只清理精确匹配 omdsh 派生引用的可写本地密钥。

添加支持目录服务商和自定义 API，协议选项读取已挂载 schema。自定义路由 ID 固定；目录发现采用已发布 `discoverModels`，返回值先进入可搜索选择列表，既有参数和未返回的已配置模型不丢失。模型列表支持新增、确认删除、Alt+Up/Down 排序及逐项编辑 ID、名称、容量和输入类型。模型与列表各自的取消只丢弃本层编辑，保留后进入服务商草稿，Apply 才写入。只查看继承目录不产生覆盖；首次编辑将已有 modelOverrides 合入替换数组，并移除互斥的 modelOverrides 路径。DeepSeek 使用 inputModalities，移除图片输入时清理 imagePixelBudget 和 imageMaxBytes；pi-ai 使用 input。自定义 API 的 reasoningEfforts 等级从已挂载 schema 读取，保留未知键和 off 值，开启时必须包含思考等级；目录模型不开放此编辑。

## Web 搜索与抓取契约

Plugins → Web search and fetch 合并 `web` 的服务商选择、`web-deepseek-api.count` 和旧版 `web-search-deepseek` 的密钥、地址、`maxUses`。其他字段进入 Advanced。列表区分未加载与注册但不可用的服务商，保留已保存的未知 ID，注册变化刷新，读取失败保留上次目录并允许重试。默认仍为 DeepSeek Search API／Fetch API，托管抓取规避本地 fake-IP DNS；Direct fetch 保持可选，这一默认值差异是产品选择。

`0.2.2-rc.3` 已发布 `web.listProviders()` 与 `web/providers-changed`，注册、目录、重复 ID 拒绝和事件都由上游拥有。宿主的 `web-runtime` 适配插件仍然保留，但只补一项上游目录没有的信息：每个已注册服务商的 `available()` 快照。它通过公开注册方法跟踪 provider 对象，服务商卸载时清理，事件观察者失败不影响注册；不读取私有注册表，不修改参考仓库。上游目录项只含 id、title 和 description，不判断可用性，因此设置页的不可用标记仍由适配层读取 provider。

草稿按 namespace 保留 revision，Apply 先校验所有待写部分，再按参数、凭据、选择的顺序写入。部分成功后只保留剩余草稿供重试；取消不回滚成功写入。切换服务商保留隐藏参数草稿，但切离旧版搜索丢弃密钥；凭据引用变更也丢弃密钥草稿。已有明文密钥先尝试移除本地覆盖，仍由部署提供时拒绝声称引用密钥已生效。选择部署默认服务商使用 unset，部署未指定时才提供 Automatic。

## 子代理设置契约

Plugins → Subagents 合并 `subagent` 的深度／容量和 `subagent-model-selection-settings` 的开关／允许路由，任一 namespace 可独立存在；额外字段留在 Advanced。字段修改与恢复继承均先暂存，Apply 才写入。开关与名单通过同一次 revision 校验写入；开启必须有模型，关闭保留名单。两个 namespace 独立保存，失败保留原草稿与版本，成功后清理对应草稿；取消只放弃未保存内容，不回滚已经成功的部分。

模型目录消费已发布 `llm.listProviders/listModels`，分别处理各服务商结果，刷新响应带代次且关闭后失效。适配器／设置事件刷新目录，手动 Refresh models 可重试；已保存的缺失路由保持可选和可删除，同一次选择过程中已经显示的路由也不移除，避免刷新丢失勾选。界面明确深度从主代理 0 开始且工具自身的限制优先，并发数跨所有层级且排除主代理；降低限制不停止已有子代理。模型策略由 Harness 在新会话建立时冻结，已有会话与 fork 继承不被 TUI 改写。

## Shell 与工具并行度设置契约

Shell 和 Tool parallelism 共用单 namespace 的字段草稿表单；分别绑定已挂载的 `bash`／`pwsh` 和 `agent-loop`，不改变命名空间或执行器配置语义。编辑、空输入和 Ctrl+R 恢复继承均只修改草稿；Apply 以打开表单时的 revision 一次提交变更字段，unset 恢复继承。取消不写入，保存失败保留输入和版本供重试，并发修改拒绝覆盖。平台专有字段仍在 Advanced；其他即时设置保持原入口。

单位解析与有效值格式化复用现有字段逻辑，产品说明区分内存尾部与 spill 文件上限、默认与最大超时、终止宽限时间和工具并行度。已发布 Shell schema 比运行时检查宽，表单补充正有限数及 `graceMs <= 2147483647` 的同等校验，不添加默认超时必须低于最大超时等执行器没有的限制。Shell 参数用于新命令，工具并行度由 Harness 在后续工具批次读取；TUI 不重配正在运行的进程或子代理。

## Plan 行为契约

状态与持久化沿用已发布 `planMode` 和会话投影。空闲切换立即生效，运行中切换由 Harness 在下一步边界提交；`pending` 是目标布尔值，只有它与 `active` 不同时，TUI 才呈现待切换状态。取消待退出后宿主仍可能保留 `pending: true`，不能据此反转显示。空白 composer 使用有效目标决定规划提示，切换会话后读取新会话状态；Access 独立展示且不被 Plan 改写。

`plan-review` 意图进入现有完整阅读器，保留模型原文，只翻译审核问题与选项。决定只能来自明确选项；Keep planning 后单独收集可选反馈，`Approve`、数字或空反馈均不改变拒绝决定。意见页 Esc 返回原计划并保留草稿，审核页 Esc 以 `ASK_CANCELLED` 交回 Harness，结束当前回合并保持 Plan。Ctrl+C 沿用 `ASK_ABORTED`，过期／取消后的响应不能成为批准。TUI 不另存计划文档，已完成调用的完整输入通过现有工具详情查看，分支与冷恢复消费相同持久事件，包含 PTC 子调用。

部署指令声明 Plan 是行为约束而非权限沙箱。首次进入时 Harness 注册 `exit_plan_mode`，之后保留工具目录项，但调用仍要求已提交的 Plan 为开启状态。批准后移除规划指令并继续执行；修改后继续规划；关闭审核后等待新消息，不将关闭或中断解释成批准。正文不得声称工具目录在首次进入前后始终相同。

普通文件和图片统一通过命令准入。主动输入的斜杠命令在空闲和运行中都调用已发布 `commands.execute`，由 `input.attachments` 与命令自身语法判断是否接收；未知或拒绝的命令不会降级为模型消息。Session runtime 随 `commands` 服务生命周期注册唯一 `registerFileReceiptResolver`，只解析本次提交为确切 Agent 创建的临时文件回执，执行结束、异常或释放时清理；不重传已存储文件，也不绕过准入。失败草稿返回原会话，粘贴字面意图与显式 Steer 不变。图片和文件共用有序 submission segments，恢复、重试及队列取回保留相对位置；`/plan off` 拒绝附件。

## Goal 与后台任务交互契约

目标栏从 durable goal projection 读取目标、phase 与轮数，再按确切 ID 和 revision 合并 `goals.get(agent).activation`；订阅 `goal/activation-changed` 更新本进程的继续权限。恢复后的 active 不等于 armed，disarmed 显示 Goal waiting。`Alt+G` 和 General → Current goal 共用目标管理页，使用公开 edit/pause/resume/clear；`/goal` 的命令所有权与语法不变。编辑保留提交前的 CAS ref，冲突保留本次草稿；清除默认取消，轮数耗尽时不开放继续。页面绑定活动根会话，取消、替换、卸载或审批抢占后不再写入。

`/jobs` 交互列表来自 `jobs.list` 和事件订阅，运行中优先，展示 progress、耗时与终态 detail。选择任务后查看输出或确认停止；确认后重新检查任务仍在运行，调用公开 kill，不把 stopping 当成已结束。列表读取失败保留旧快照并禁用任务操作，显式刷新成功后恢复。输出阅读器通过 `readAt` 观察全部通道，绝不调用消费式 read；以正在观察的任务事件触发刷新，在用户离开底部时冻结快照，End 继续跟随。后端 retention 丢失与视图截断分别提示；退出阅读器释放订阅，不停止任务。行模式保留静态列表和 narration-only 输出。

## Skill 调用契约

技能列表读取已发布 `skills.list` 的用户调用策略，以 `/<name>` 为主入口，区分普通技能和仅用户调用的技能。遇到宿主命令或 TUI 本地命令同名时，列表保留命令；技能仍可在正文中以 `/name` 引用，由 Harness 识别。标识跟随界面语言，技能名称和说明保持原文。

技能调用携带完整正文、图片和文件，通过普通 Harness inbox 提交，由 `dsh-tool-skill` 的 pre-step 边界加载指令。TUI 不改写技能调用文本，保留正文、附件顺序和原始待提交记录身份。目录查询及图片存储完成后重新检查取消与会话归属，过期结果不得交付给新会话。

## 转录渐进展开契约

转录使用“回合过程 → 单项”两层展开，不引入 Web 分组面板。运行中默认只显示思考摘要和工具事实行；正文回复完整保留，失败原因直接可见。Ctrl+O 进入键盘过程浏览，↑↓ 选择、Enter 切换、←→ 收起与展开；Esc、Ctrl+O、End 返回实时底部。输入与粘贴交还 composer 焦点，保留草稿。单项展开优先呈现命令与输出、文件内容、Diff 和搜索位置；Alt+O 提供当前回合的完整参数与结果。左侧箭头与标题前留白支持鼠标点击，区域内轻微移动与同项预览更新不会取消点击。标题与正文保留选中复制；拖出点击区、Shift 点击和目标位置变化不会触发展开。已展开并正在浏览的过程在回合结束时保持位置；退出浏览才恢复整体折叠。

默认思考偏好改为折叠，已有显式 Shown 配置继续有效；单项展开不修改持久设置。完成后所有助手回复与错误事实都留在摘要之外。搜索使用实际展开行的显示单元定位，能命中折叠的思考和工具内容。样式由 omdsh 渲染器拥有：紧凑行使用轻量箭头与选择标记，详情使用对应状态的底色与左右留白，正文对齐箭头后的文字。思考预览随最新段落更新，流式首行完整后才切换，避免逐字抖动。原生历史仍是不可改写的当时快照。

## 有意保留的终端差异

- Settings 中明确标注的 Current session 操作是便捷入口；默认设置与当前状态分别呈现。
- `/model --session` 和选择器的 This session only 是 omdsh 的附加能力；收藏保留明确保存的 effort。
- Settings 把常用插件配置放在 Plugins 分类，Advanced 保留尚未收编的字段；`/plugins` 的 Plugin entries 提供安装条目与状态，不照搬 Web 的独立侧栏。
- 默认 Agent 的修改只作用于之后创建的会话，不自动重组已存在的空白会话；当前空白会话可以显式选择 preset。
- 原生 scrollback、底部 composer、Ctrl-C 和键盘选择遵守仓库终端契约。

## 后续对齐范围

正常退出／切换后的队列恢复、官方设置的其余页面仍需单独设计与验收。不得仅凭底层包已挂载就宣称交互已经对齐。每次升级同时复核 composition、persona 和 Plan 指令的覆盖内容；语言偏好仅调整独立的 agent-behavior 提示段。

## 验收

按相同用户意图比较配置字段、会话事件、生效时机和错误处理，而非像素或键位。覆盖默认值保存与恢复、当前会话不变、过期版本拒绝、Creator 的空白／已有对话／不可用分支、模型默认 effort，以及窄终端和从子表单返回的位置。真实 provider 认证与模型效果必须另行验收，模拟服务不能替代。
