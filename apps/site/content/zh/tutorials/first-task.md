---
description: 安装 omdsh、登录 DeepSeek 账户或配置 API Key，选择模型并完成一次项目检查，同时学会阅读思考、工具和回复。
---

# 完成第一个任务

完成本教程后，你会得到一份 Agent 整理的项目概览，并知道如何查看它的工作过程。准备好 Node.js 22.19 或更高的 22.x 版本，或者 Node.js 24 及更高版本，以及一个终端和 DeepSeek 账户或 API Key。

## 安装并打开项目

安装 omdsh，然后在想要探索的项目中启动。将示例路径替换为你自己的项目目录。

```sh
npm install --global @agi-fans/oh-my-dsh
cd /path/to/your/project
omdsh
```

也可以在项目目录中运行 `npx @agi-fans/oh-my-dsh` 临时体验。启动目录会成为会话的工作区，底部状态栏显示它的路径，并在可用时显示 Git 状态。

## 登录并选择模型

在标有 `🐳` 的输入区运行 `/login`。选择 **DeepSeek account**，在浏览器中完成登录，或选择 DeepSeek API Key 入口，在专用提示中粘贴 Key。与 DSH 共享的已有账户授权可以复用。

接着运行 `/model`。如果使用账户登录，选择 `deepseek-account` 下的模型；如果使用 API Key，选择对应 DeepSeek 提供方的模型。按 `Enter` 选用并保存为默认模型。发送第一条请求前，确认底部状态栏已显示所选模型。

Key 只应粘贴到凭据输入框中。`/login <key>` 会被拒绝，以免密钥进入命令历史。远程主机的浏览器回调和其他登录问题见[故障排查](../troubleshooting.md)。

## 请 Agent 检查项目

本教程使用默认的 Standard Agent 预设。运行 `/permission` 并选择 **Read only**，然后发送下面的请求。

```text
检查这个项目的结构，介绍它的用途、主要入口，以及如何运行和测试。请引用你依据的文件。不要修改文件或安装依赖。
```

Agent 应当阅读项目文件，返回带有文件路径依据的概览。可以对照它引用的文件，检查运行和测试说明是否准确。还有不清楚的部分，就继续追问。

Access 控制工具权限，需要提升权限的操作仍会进入审批流程。之后希望 Agent 修改项目时，可以选择 Workspace write。各项策略见[权限与 Access](../permissions.md)。

## 看懂界面

<video src="/omdsh-demo.mp4" poster="/omdsh-demo-poster.png" controls muted autoplay loop playsinline width="100%"></video>

这段约 26 秒的真实终端录像展示了 Agent 读取仓库 README 并回复。完成后的过程收起为 `Worked for …` 摘要，随后再次展开，回顾思考与工具行。输入区与状态栏全程可见。

| 界面部分 | 如何使用 |
|---|---|
| 思考与工具行 | 按 `Ctrl+O` 浏览过程，用方向键选中一行，再按 `Enter` 展开；也可以点击左侧展开箭头。 |
| 已完成的回合 | 阅读回复和失败信息，需要回顾过程时展开耗时摘要。 |
| 对话内容 | 用鼠标滚轮或 `PgUp` 回看，按 `End` 或点击 `Latest · End` 返回实时底部。 |
| 想保存的文字 | TUI 鼠标处理启用时，拖动选择并复制文字；也可以用 `/copy` 复制最近的回复。 |
| 输入区和状态栏 | 编写下一条请求时，底部持续显示模型、工作区和会话数据。 |

鼠标行为取决于 **Settings → Terminal → Mouse interaction**。Auto 尊重 tmux 的鼠标设置，Native 使用终端原生选择。选择、引用、完整工具结果与导航操作见[键盘与快捷键](../keyboard.md#转录)。

## 从第一个结果继续

现在可以围绕已有对话继续工作。用 `/help` 查找命令，或用 `/context` 查看上下文占用与会话详情。任务变复杂后，再逐步使用下面三项控制。

| 控制 | 何时使用 |
|---|---|
| `/plan` | 先调查任务并审核实施方案，再继续执行。`/plan off` 退出 Plan 模式，工具权限由 Access 单独控制。 |
| `/permission` | 为希望授权的工作选择访问级别。 |
| `/agent` | 在新会话的第一条请求之前选择其他 Harness 预设。一旦有模型历史，预设便会锁定。 |

接下来可以[调整工作环境](environment.md)，选择外观、语言和模型偏好。如果默认设置已经合适，可以直接学习[提供精确的项目上下文](precise-context.md)。
