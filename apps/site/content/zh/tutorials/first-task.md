---
description: 安装 @agi-fans/oh-my-dsh，运行 /login，设置 Agent、Workflow 和 Access，并完成第一个 DeepSeek 编程任务。
---

# 完成第一个任务

读完本教程，你将完成 omdsh 的安装和登录，并跑完第一个 Agent 任务。

### 安装并启动

全局安装命令；如果只想临时体验当前版本而不进行全局安装，可以使用 `npx @agi-fans/oh-my-dsh`：

```sh
npm install --global @agi-fans/oh-my-dsh
```

然后进入希望 Agent 理解的项目目录，再从这里启动 omdsh：

```sh
cd /path/to/your/project
omdsh
```

启动目录会成为会话工作区。如果目录位于某个 Git 仓库内，状态栏会自动识别该仓库。

### 安全登录

运行 `/login`。对于 DeepSeek，omdsh 会打开 API Key 页面，通过遮罩输入框接收 Key，验证后将其保存到凭据存储中。

如果某个已挂载的提供方注册了自己的授权流程（例如浏览器登录），它会带着该流程的方法出现在 `/login` 列表中，omdsh 只渲染流程要求的通知和提问。

不要把 Key 追加到命令后：程序会主动拒绝 `/login <key>`，避免密钥进入命令历史或 Transcript。

外部管理的 `DEEPSEEK_API_KEY` 仍然可以作为回退来源。通过 `/login` 保存的 Key 会在后续请求及重启后保持更高优先级；`/logout` 只会删除由 omdsh 管理的选择，并在环境变量可用时回退到环境变量。

### 在第一条 Prompt 前配置会话

omdsh 将三项会话控制分别建模，而不是折叠成一个 Mode。如果不确定，第一个任务全部保持默认即可。

| 概念 | 命令 | 选项 |
|---|---|---|
| Agent | `/agent` | Standard 是完整 Coding Agent；PTC 默认使用程序化工具调用；Minimal 只保留持久 Bash 与 `str_replace_editor`；Cordis 增加运行时检查与插件实验能力。 |
| Workflow | `/workflow` | Default 直接工作；Plan 先调查并提交可审阅计划，再进入实现。 |
| Access | `/permission` | Read only、Workspace write 或 Full access。 |

Agent 会改变模型可见的内容，因此要在第一条 Prompt 前选择；产生模型历史后，它会被锁定。每个 preset 自己决定工具暴露方式：PTC 使用 `run_code` 和生成的 TypeScript SDK，Standard、Minimal 与 Cordis 则将各自的工具暴露为原生函数。Workflow 与 Access 是持久化的会话状态，之后仍可切换。

### 选择安全的 Access

在可能修改文件的任务前运行 `/permission`。交互式选择器提供三种策略：

| 模式 | 适用场景 |
|---|---|
| Read only | 只检查而不写入工作区；提权仍然需要审批。 |
| Workspace write | 允许修改当前工作区，但访问更大范围时仍然需要审批。 |
| Full access | 你信任当前工作区，并明确需要不经审批的完整文件系统访问。 |

Full access 需要二次确认。Access 才是实际的执行边界；Plan Workflow 只提供工作流指导，不能代替 Sandbox 或审批策略。每个 preset 背后的沙箱与审批行为见[权限与 Access](../permissions.md)。

### 发送具体任务

第一条消息最好同时说明结果、范围和验证方式。例如：

```text
找出用户设置无法持久化的原因，只修改负责该行为的最小模块，并运行对应测试。不要修改 refs/ 下的文件。
```

Agent 工作时，`Deep Driving` 表示当前回合仍在运行。Tool Card 会分别展示 Input 与 Output；按 `Ctrl+O` 可以展开或折叠最近一次工具输出。两行状态栏会持续展示当前 Agent、Workflow、模型、工作区、Git 状态和 Token 遥测，Composer 边界则显示 Access；这些内容都不会被写入对话。
