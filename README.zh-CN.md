<div align="center">

# oh-my-dsh

**探索未至之境**

oh-my-dsh 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的终端编程助手，以 `omdsh` 命令启动，专注清晰的终端阅读层次、顺手的键鼠交互与可控的长会话编程工作流。

[![CI](https://github.com/agi-fans/oh-my-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/agi-fans/oh-my-dsh/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/%40agi-fans%2Foh-my-dsh?style=flat-square&logo=npm)](https://www.npmjs.com/package/@agi-fans/oh-my-dsh) [![npm downloads](https://img.shields.io/npm/dm/%40agi-fans%2Foh-my-dsh?style=flat-square&logo=npm)](https://www.npmjs.com/package/@agi-fans/oh-my-dsh) [![Node.js ^22.19 or >=24](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?style=flat-square&logo=node.js)](https://nodejs.org/) [![MIT License](https://img.shields.io/npm/l/%40agi-fans%2Foh-my-dsh?style=flat-square)](LICENSE)

[官方文档](https://omdsh.agi.fans/zh/) · [English](README.md) · 简体中文

</div>

https://github.com/user-attachments/assets/bedf83db-df50-43e4-a786-61ad42cf5a7d

这段 72 秒的完整展示（基于 v0.29.2 真实终端采集）覆盖了 omdsh 对 DeepSeek Harness 四大 Agent 预设（`Standard`、`PTC`、`Minimal`、`Creator`）、`/model` 模型切换、完整六分组 `/settings`（含 Catppuccin 深浅配色实时生效）、`/plugins` 扩展包与 `/mcp` 实时服务，以及日常终端体验（`!shell`、`@` 引用、`/btw`、`/diff`、`#L` 源码预览）和自主协作与恢复能力（`/permission` Auto review、`/team`、`/trajectory`、会话树分支与 `Alt+R` 文件快照恢复）。

## 快速开始

需要 Node.js 22.19+（22.x）或 Node.js 24+，以及 DeepSeek 账户或 API Key。

```sh
npm install --global @agi-fans/oh-my-dsh
omdsh
```

进入 omdsh 后运行 `/login` 登录 DeepSeek 账户或保存 API Key，再用 `/model` 选择模型（账户登录请选择 `deepseek-account` 下的模型），即可开始对话。也可以用 `npx @agi-fans/oh-my-dsh` 免安装临时体验。跟着[快速上手教程](https://omdsh.agi.fans/zh/docs/tutorials/first-task/)几分钟就能完成第一次代码改动与 Diff 审阅。

## 核心体验

- **过程清晰、改动好审阅。** 思考过程与工具调用默认以紧凑行展示，完成后折叠成耗时摘要，回复与报错始终可见。用 `/diff` 双栏对比改动并引用代码行，随时按 `Ctrl+O` 展开完整执行细节。
- **克制耐看的终端界面。** Markdown、代码块、表格与 Diff 留白清晰，内置 Catppuccin 深色、浅色与跟随系统三种配色，中英文与 emoji 混排稳定对齐，并完整保留终端原生滚动历史。
- **高效的日常输入与旁路操作。** 用 `@` 引用文件或历史会话、粘贴截图，用 `!命令` 在输入框内直接运行持久 Shell，或用 `/btw` 临时问一个旁路问题而不打乱当前主对话。
- **掌控复杂任务与多智能体协作。** 大改动前先用 `/plan` 审阅方案，运行中随时排队、插话或打断；用 `/goal`、`/jobs`、`/schedule` 跟进长任务，用内置子智能体、Codex/Claude Code 集成或 `/team` Agent Teams 并行协作。
- **长会话可回退、文件可恢复。** 搜索与恢复历史会话，双按 `Esc` 探索会话分支并配合文件恢复快照（`Alt+R`）安全还原改动，用 `/context`、`/trajectory` 和底部状态栏随时掌握上下文和耗时。
- **按需扩展，无需折腾。** 通过项目 `SKILL.md` 沉淀团队规范，在 `/mcp` 中免重启增删与探测 MCP 服务器，接入本地语言服务器（LSP）获得精准代码跳转，或在 `/plugins` 中管理外部插件与内置扩展。

## 文档导航

如果你是第一次使用，建议从[教程导读](https://omdsh.agi.fans/zh/docs/tutorials/)按顺序上手；已经熟悉后可按需查阅对应页面：

| 你想做什么 | 推荐入口 |
|---|---|
| 第一次安装、登录并完成一次代码改动 | [快速上手](https://omdsh.agi.fans/zh/docs/tutorials/first-task/)、[调好终端与模型偏好](https://omdsh.agi.fans/zh/docs/tutorials/environment/) |
| 提升日常编程效率 | [精准上下文与快捷操作](https://omdsh.agi.fans/zh/docs/tutorials/precise-context/)、[掌控长任务](https://omdsh.agi.fans/zh/docs/tutorials/guide-a-turn/)、[多智能体与 Agent Teams](https://omdsh.agi.fans/zh/docs/tutorials/multi-agent/)、[管理长会话与恢复](https://omdsh.agi.fans/zh/docs/tutorials/long-session/) |
| 给项目加 Skills、MCP、LSP 或插件 | [Skills 与 MCP 教程](https://omdsh.agi.fans/zh/docs/tutorials/skills-and-mcp/)、[安装插件与内置集成](https://omdsh.agi.fans/zh/docs/tutorials/install-plugin/)、[语言服务器](https://omdsh.agi.fans/zh/docs/language-servers/) |
| 速查命令、快捷键、设置或排查问题 | [命令参考](https://omdsh.agi.fans/zh/docs/commands/)、[快捷键与鼠标](https://omdsh.agi.fans/zh/docs/keyboard/)、[设置](https://omdsh.agi.fans/zh/docs/settings/)、[状态与诊断](https://omdsh.agi.fans/zh/docs/observability/)、[故障排查](https://omdsh.agi.fans/zh/docs/troubleshooting/) |
| 编写插件或了解底层架构 | [编写与发布插件](https://omdsh.agi.fans/zh/docs/tutorials/write-a-plugin/)、[插件开发内部机制](https://omdsh.agi.fans/zh/docs/plugin-internals/)、[架构概览](https://omdsh.agi.fans/zh/docs/architecture/) |

全部双语文档源码位于 `apps/site/content/`。遇到问题或有建议，欢迎通过 [Issue 表单](https://github.com/agi-fans/oh-my-dsh/issues/new/choose)反馈。

## 常用配置入口

日常配置不需要手写配置文件，在终端里即可完成：

- **账号与模型**：运行 `/login` 登录 DeepSeek 账户、保存 API Key 或添加自定义模型服务商；运行 `/model` 切换模型，用 `/model favorite` 收藏常用模型后可用 `Ctrl+P` / `Alt+P` 快速轮换，用 `Shift+Tab` 切换推理强度。
- **界面与偏好**：运行 `/settings` 打开停靠在底部的设置面板，调整主题、语言、状态栏显示项、权限和内置扩展，修改即时生效。详细选项见[设置参考](https://omdsh.agi.fans/zh/docs/settings/)。
- **扩展与工具**：运行 `/mcp` 实时管理 MCP 服务器，运行 `/plugins` 安装插件或开关内置能力，运行 `omdsh doctor` 一键检查本地环境。
- **Shell 补全**（不启动界面，不访问网络）：

```sh
omdsh completions bash
omdsh completions zsh
omdsh completions fish
```

## 与 DeepSeek Harness 的关系及性能

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供核心的 Agent 运行时、插件体系以及会话、模型、工具与权限管理；omdsh 将这些已发布的软件包组合为社区维护的终端应用，专注于终端内的阅读体验、键盘鼠标操作与渐进式信息展示。关于分层边界与设计取舍，请参阅[架构概览](https://omdsh.agi.fans/zh/docs/architecture/)。

针对长会话、流式 Markdown 与大文件预览的专项优化让界面在大项目中保持顺滑（2026 年 11 月 6 日 Apple M5 Pro 本地 CPU 基准：10,000 回合会话回放 2.567 ms、109,500 字符 Markdown 预览滚动 0.383 ms、10,000 行源码预览平移 0.212 ms）。完整方法与实际保护上限见[性能与边界](https://omdsh.agi.fans/zh/docs/performance/)，也可以在本地运行 `pnpm benchmark:tui`。

## 本地开发

```sh
pnpm install
pnpm omdsh "list files"  # 从源码运行
pnpm typecheck           # 检查 TypeScript
pnpm test                # 单元测试与管道模式测试
pnpm build               # 构建全部 workspace 软件包
pnpm smoke               # 交互式 PTY 冒烟测试
pnpm smoke:happy         # 使用模拟 LLM 验证正常流程
```

`refs/deepseek-harness`、`refs/oh-my-pi` 与 `refs/pi` 中的代码是只读参考项目。开发 omdsh 时不要将它们用作运行时依赖，也不要修改其内容。

## 变更日志

面向用户的变更与版本发布记录统一维护在 [CHANGELOG.md](CHANGELOG.md) 中。

## 致谢

oh-my-dsh 的诞生离不开这些项目：

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供了运行时基础、插件架构，以及 Agent 能力应当通过组合而非内嵌于单一应用中的设计信念。
- [Pi](https://github.com/earendil-works/pi) 是最初的开放式 Agent Harness，其终端交互、差分渲染和紧凑的 Coding Agent 工艺，至今仍是这个社区继续建设的基准。
- [oh-my-pi](https://github.com/can1357/oh-my-pi) 延续了这条脉络，并展示了细致的终端交互、紧凑的信息设计和精心设计的键盘工作流，如何让 Agent 既快速又易于使用。

感谢这些项目及其所有贡献者。omdsh 是一个独立的社区项目：它构建于 DeepSeek Harness 之上，并从 Pi 与 OMP 学习，但不是其中任何一个项目的官方发行版本。

## 许可证

oh-my-dsh 使用 [MIT License](LICENSE) 发布。
