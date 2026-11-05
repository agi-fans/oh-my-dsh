# Harness 交互对齐契约

omdsh 以已发布 Harness 的产品语义为基线，以终端的输入、布局和原生历史契约决定呈现方式。官方基线为 `0.2.2-rc.1`，参考 checkout 为 `fcc0ad4621`；上游源码只用于研究，运行时仍使用 npm 包。

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

## 子代理交互契约

子代理继续使用原地转录与名册，不增加独立面板。Enter 沿用运行中输入偏好，Alt+Enter 排队，Alt+S 插话，完整文本与附件分别经已发布的 `queueHostSubagentPrompt`／`steerHostSubagentPrompt` 交付给确切的直接父代理；冷恢复、接纳与执行归 Harness 管理。一次性子代理只读，外部执行无本地转录。子代理队列只展示自己的日志投影，不显示主会话尚未接收的输入。Alt+Q 与 `/queue` 复用同一列表，支持编辑、撤回、同组排序与 Queue → Steer；Alt+Up 取回该子代理最新的下一回合消息。操作绑定确切的存活后代与查看代次，切换后不修改新会话；附件恢复完成后才撤回，过期结果保留在原草稿。连续提交按顺序进入 Harness，不能因图片存储较慢而倒序。未在本地加载的子代理提示先继续对话，不因打开队列自动恢复。

切换查看对象会取消尚未接收的投递，失败草稿恢复到原子代理并保留较新的草稿。父子草稿隔离在没有磁盘草稿存储的嵌入环境也成立。Ctrl-C 优先中断查看中的子代理，不能落到父会话的 Shell 或 Agent；Esc 负责清空草稿和返回。停止投影为 Stopped，失败为 Failed，可继续的空闲子代理为 Ready；恢复名册不会把可继续对话的孩子显示为已完成。

审批适配器仅接收活动根代理及其确切存活后代的请求；子代理审批显示请求者与其自身工具参数。Needs approval 只反映实时请求的生命周期，完成、取消、会话释放或切换根会话后移除。`dsh-user-questions` 的公开 `ask` 在派发事件前拒绝受委派调用者（`DELEGATED_CALLER`），因此不绕过服务给子代理新增用户问题入口。

## 有意保留的终端差异

- Settings 中明确标注的 Current session 操作是便捷入口；默认设置与当前状态分别呈现。
- `/model --session` 和选择器的 This session only 是 omdsh 的附加能力；收藏保留明确保存的 effort。
- Settings 把常用插件配置放在 Plugins 分类，Advanced 保留尚未收编的字段；`/plugins` 的 Plugin entries 提供安装条目与状态，不照搬 Web 的独立侧栏。
- 默认 Agent 的修改只作用于之后创建的会话，不自动重组已存在的空白会话；当前空白会话可以显式选择 preset。
- 原生 scrollback、底部 composer、Ctrl-C 和键盘选择遵守仓库终端契约。

## 后续对齐范围

正常退出／切换后的队列恢复、工作流状态的直接操作、Models 中完整 provider 编辑、官方设置的其余页面仍需单独设计与验收。不得仅凭底层包已挂载就宣称交互已经对齐。每次升级同时复核 composition、persona 和 Plan 指令的覆盖内容；语言偏好仅调整独立的 agent-behavior 提示段。

## 验收

按相同用户意图比较配置字段、会话事件、生效时机和错误处理，而非像素或键位。覆盖默认值保存与恢复、当前会话不变、过期版本拒绝、Creator 的空白／已有对话／不可用分支、模型默认 effort，以及窄终端和从子表单返回的位置。真实 provider 认证与模型效果必须另行验收，模拟服务不能替代。
