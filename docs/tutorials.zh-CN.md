# 教程

[English](tutorials.md) | [简体中文](tutorials.zh-CN.md)

这些任务式教程覆盖从首次安装到日常可靠使用的完整路径。开始前请准备 Node.js 22.19 或更高的 22.x 版本，或者 Node.js 24 及更高版本、支持 TTY 的终端，以及用于真实模型对话的 DeepSeek API Key。

## 教程一：完成第一个任务

### 安装并启动

全局安装命令，进入希望 Agent 理解的项目目录，再从这里启动 omdsh：

```sh
npm install --global @agi-fans/oh-my-dsh
cd /path/to/your/project
omdsh
```

如果只想临时体验当前版本而不进行全局安装，可以使用 `npx @agi-fans/oh-my-dsh`。启动目录会成为会话工作区；如果外层存在 Git 仓库，状态栏会同时解析对应的项目上下文。

### 安全登录

运行 `/login`。omdsh 会打开 DeepSeek API Key 页面，通过遮罩输入框接收 Key，验证后将其保存到 Harness 凭据存储中。不要把 Key 追加到命令后：程序会主动拒绝 `/login <key>`，避免密钥进入命令历史或 Transcript。

外部管理的 `DEEPSEEK_API_KEY` 仍然可以作为回退来源。通过 `/login` 主动选择的 Key 会在后续请求及重启后保持更高优先级；`/logout` 只会删除由 omdsh 管理的选择，并在环境变量可用时回退到环境变量。

### 选择安全的权限

在可能修改文件的任务前运行 `/permission`。交互式选择器提供三种策略：

| 模式 | 适用场景 |
|---|---|
| Read only | 只检查而不写入工作区；提权仍然需要审批。 |
| Workspace write | 允许修改当前工作区，但访问更大范围时仍然需要审批。 |
| Full access | 你信任当前工作区，并明确需要不经审批的完整文件系统访问。 |

Full access 需要二次确认。Permission 才是实际的执行边界；Plan mode 只提供工作流指导，不能代替 Sandbox 或审批策略。

### 发送具体任务

第一条消息最好同时说明结果、范围和验证方式。例如：

```text
找出用户设置无法持久化的原因，只修改负责该行为的最小模块，并运行对应测试。不要修改 refs/ 下的文件。
```

Agent 工作时，`Deep Driving` 表示当前回合仍在运行。Tool Card 会分别展示 Input 与 Output；按 `Ctrl+O` 可以展开或折叠最近一次工具输出。两行 Status Line 会持续展示当前模型、推理强度、权限、工作区、Git 状态、上下文压力、Token 用量、延迟、缓存率和活动数据，这些内容不会被写入对话。

## 教程二：提供精确的项目上下文

### 提及项目文件

输入 `@`，再输入项目路径中的一部分。弹出列表会搜索工作区；使用方向键移动，并按 `Tab` 插入选中的路径。Mention 会在消息中保持高亮，为 Agent 提供明确的文件目标，随后 Agent 可以使用普通工具读取它。

```text
对比 @packages/tui/omdsh-tui/src/renderer.ts 与 @packages/tui/omdsh-tui/src/renderer.spec.ts，编辑前先解释缺失的边界场景。
```

输入 `./` 和 `~/` 也会打开路径补全。补全只负责插入路径，不会绕过工具权限，也不会静默上传文件内容。

### 添加截图和图片

复制图片后按 `Ctrl+V`。当平台剪贴板读取器可用时，Composer 会插入紧凑的图片标记，而不是临时文件路径；补充说明文字后即可作为一条消息发送。粘贴可读取的图片文件路径时，也会导入对应图片。

在 Linux 上，原生图片粘贴在 Wayland 下使用 `wl-paste`，在 X11 下使用 `xclip`。如果两者都不存在，文本粘贴仍然可用，但无法直接捕获剪贴板图片。

### 编写结构化 Prompt

使用 `Shift+Enter`、`Alt+Enter` 或 `Ctrl+J` 插入换行。对于更长的任务，按 `Ctrl+X` 可以在 `$VISUAL` 或 `$EDITOR` 中编辑当前草稿，退出编辑器后内容会返回 Composer。

```text
目标：移除重复的加载状态行。

约束：
- 保持 Composer 固定在底部
- 保持 CJK 显示宽度正确
- 增加回归测试

验证：运行相关 TUI 测试和 typecheck。
```

## 教程三：引导运行中的任务

### 将后续消息加入队列

继续一个运行中的任务不需要特殊命令。在 `Deep Driving` 状态下照常提交消息，omdsh 会将它放入 next-turn 队列。队列会立即显示在 Composer 上方，便于确认当前回合结束后将要执行的内容。

Composer 为空时，按 `Up` 可以取回最新的队列消息进行编辑。连续按 `Up` 会继续向更早的队列消息移动；修改选中文本后按 `Enter`，即可将其重新放回队列。这样可以在不中断当前工具调用的情况下修正后续要求。

按一次 `Ctrl+C` 会中断当前回合。在退出时间窗口内再次按 `Ctrl+C` 会离开 omdsh，因此如果还要继续当前会话，请不要立刻重复按键。

### 使用 Loop 重复执行 Prompt

需要在每个回合完成后再次执行同一项工作时，可以使用 `/loop`。`/loop 5 检查测试并修复下一个失败` 会立即发送 Prompt，并在之后再重复五次。时长限制支持紧凑写法，例如 `/loop 10m 检查最新结果` 或 `/loop 1h30m 持续改进实现`。

如果希望用下一条普通消息作为循环 Prompt，可以先运行不带内联 Prompt 的 `/loop 5`。Loop 启用后，之后提交的普通消息仍会进入现有 next-turn 队列，同时替换下一轮要重复的 Prompt。固定 Footer 会显示 Loop 正在等待、运行、暂停还是刚刚完成；次数限制使用明确的重复进度，时长限制显示倒计时，并且这些控制反馈不会写入 Transcript。

再次运行 `/loop` 可以关闭。循环执行期间按 `Ctrl+C` 会中断当前回合并暂停 Loop；再发送一条普通消息即可用新的 Prompt 恢复。Loop 被刻意设计为进程内状态，因此切换、恢复或重新打开会话时不会在后台意外重启。

### 修改文件前先制定计划

对于需要先调查再提出实现方案的任务，运行 `/plan`。Plan mode 会指导模型先进行只读检查，再通过 Harness 审批流程提交可审阅的计划。运行 `/plan off` 可以直接退出；也可以使用 `/plan <message>`，在进入 Plan mode 的同时发送第一条规划要求。

### 跟踪任务进度

当 Agent 写入 Todo 列表后，Composer 和队列上方会出现紧凑的任务树，分别表示已完成、当前和待处理工作。需要将当前状态固定到 Transcript 中时，可以运行 `/todo` 查看最新列表。Todo 描述当前回合的工作，而 `/goal <objective>` 用于控制更长时间运行的 Harness Goal；不带参数运行 `/goal` 可以查看当前状态和可用操作。

## 教程四：恢复并管理长会话

### 退出后恢复

第一次 `Ctrl+C` 会清空输入或中断，第二次则退出。当活动会话可以持久化时，omdsh 会输出一条以后可以直接粘贴的命令：

```sh
omdsh --resume <session-id>
```

在 TUI 内运行 `/resume` 会打开可搜索的会话选择器，其中包含最近一条用户消息的预览、更新时间、Event 数量和完成状态。如果已经知道会话 ID，可以使用 `/resume <session-id>` 跳过选择器。

### 在不破坏历史的情况下回退

当 Agent 处于 idle 且 Composer 为空时，连续按两次 `Esc` 可以打开对话轮次选择器。选择一条用户消息后，omdsh 会从该消息之前的历史创建一个新分支，并把原始 Prompt 恢复到 Composer。原会话仍然保留在 `/resume` 中，因此回退是可恢复的，而不是破坏性操作。

如果只是希望把最近一条用户 Prompt 作为新回合重新提交，可以使用 `/retry`。如果希望从空白状态开始，而不是从当前会话分支，可以使用 `/new`。

### 压缩与导出

Agent 处于 idle 时运行 `/compact`，可以使用摘要替换一段有价值的旧历史。Compacting 状态会保持到持久化检查点完成；完成前请等待，不要开始其他会话操作。如果历史不足，命令会直接说明当前没有可压缩内容。

运行 `/export` 会在当前目录将完整 Transcript 写入 `omdsh-transcript-<session-id>.md`，也可以提供目标路径：

```text
/export docs/session-review.md
```

## 教程五：调整工作环境

### 选择模型与推理强度

运行 `/model` 打开模型选择器。omdsh 会先解析 DeepSeek Provider，再让你选择可用模型；模型支持时还可以继续选择 Reasoning Effort。当前选择会显示在第一行 Status Line 中，并写入持久化会话状态。

### 定制界面

运行 `/settings` 可以配置主题、颜色输出、默认 Tool 展开状态、更新检查、启动时 Release Notes，以及 Status Line 遥测信息的内容与顺序。使用 `Up` 和 `Down` 移动，使用 `Left` 和 `Right` 修改值，使用 `Tab` 在 General 与 Status line 分区之间切换。在 Status Group 上按 `Space` 可以显示或隐藏；按 `Enter` 后再使用 `Up` 或 `Down` 可以移动顺序，再按 `Enter` 或 `Esc` 完成移动。

运行 `/help` 可以查看完整的命令与快捷键目录。命令列表由当前启用的 Harness 插件共同组成，因此也会包含 Skills 和其他运行时集成贡献的能力。

## 教程六：使用 Skills 与 MCP 扩展项目

项目 Skills 位于 `.dsh/skills` 或 `.agents/skills`。增加可由用户调用的 Skill 后，输入 `/skill:` 即可像浏览普通命令一样查看并筛选。MCP Server 配置位于 `.dsh/mcp.json`；`/mcp` 用于查看已连接的 Server，`/tools` 则会把 MCP Tools 与原生 Harness Tools 一起展示。

完整的搜索优先级、`SKILL.md` 结构、stdio 与 HTTP 示例、环境变量展开、覆盖规则和当前协议限制，请参阅 [Skills 与 MCP](skills-and-mcp.zh-CN.md)。

## 快速参考

| 目标 | 操作 |
|---|---|
| 浏览命令与快捷键 | `/help` |
| 搜索历史 Prompt | `Ctrl+R` |
| 滚动 Transcript | `PgUp` / `PgDn`、`Shift+Up` / `Shift+Down` 或鼠标滚轮 |
| 复制最近的回复、代码块或命令 | `/copy` |
| 查看会话统计 | `/session` |
| 查看可用工具 | `/tools` |
| 每个回合完成后重复工作 | `/loop [次数\|时长] [Prompt]` |
| 阅读版本说明 | `/changelog` |
| 安装最新版本 | `npm install --global @agi-fans/oh-my-dsh@latest` |

每日更新检查只会提示存在新的 npm 版本，不会自动安装。
