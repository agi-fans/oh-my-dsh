---
description: omdsh 如何基于已发布的 DeepSeek Harness 插件构建终端编程助手，包括软件包分层、核心组件所有权、渲染保证与验证体系。
---

# 架构概览

oh-my-dsh 构建在已发布的 **DeepSeek Harness（DSH）** 软件包之上：会话、模型、工具、命令、权限、Skills、MCP、LSP 与统计计量均由 Harness 插件负责，omdsh 专注于把这些能力呈现为清晰、流畅、可靠的终端体验，刻意避免重造第二套 Agent Core。

## 一、仓库与依赖边界

- **运行时依赖**：所有 `@deepseek-ai/*` 软件包均以固定版本从 npm 消费，仅使用公开导出。
- **产品包**：
- `apps/omdsh`（`@agi-fans/oh-my-dsh`）：CLI 参数解析、启动引导、`omdsh doctor`、`omdsh exec`、`omdsh plugin` 安装器与运行时组合配置。
- `packages/tui/omdsh-tui`（`@agi-fans/dsh-tui`）：可复用的终端 UI 套件（服务定义、本地终端 Provider、会话运行时、命令插件、Markdown/工具渲染与交互视图）。
- **只读参考目录**：`refs/deepseek-harness` 与 `refs/pi` 仅作设计与 API 研究参考，绝不参与依赖解析、构建、测试或运行。

```text
apps/omdsh/                         @agi-fans/oh-my-dsh
├── src/bin.ts                      CLI 入口与参数解析
├── src/boot.ts                     启动并组合插件树
├── src/doctor.ts                   只读诊断 (`omdsh doctor`)
├── src/exec.ts                     脚本模式 (`omdsh exec --json`)
├── src/plugin.ts                   `omdsh plugin` 管理命令
└── config/cordis.yml               默认产品组合清单

packages/tui/omdsh-tui/             @agi-fans/dsh-tui
├── src/definition.ts               与实现无关的 TUI Service 定义
├── src/runtime/                    本地终端 Provider、会话运行时、Runner、设置表单
├── src/commands/                   斜杠命令插件（model/session/team/plugins/mcp 等）
├── src/chrome/                     主题、显示宽度、Markdown、工具卡片、状态栏
├── src/input/                      按键解析、编辑器、剪贴板与粘贴保护
├── src/views/                      对话视口、设置面板、Diff/文件/轨迹/搜索视图
└── src/session/                    会话状态机与辅助投影
```

## 二、核心所有权与数据流

```text
终端输入 → 本地 TUI Provider → Runner / 命令注册表 → Session Runtime & Harness 服务
       → 持久化会话事件 & 计量 Projection → 纯函数视图层 → 差分终端 Renderer
```

- **本地终端 Provider**：唯一负责 raw mode、按键解码、光标定位、鼠标事件与原子化终端写入。
- **Session Runtime**：负责创建/恢复会话、管理模型与预设、挂载工具展示映射、维护子智能体列表（支持通过公开 `SubagentRuntime.prompt` 接口对可续跑子智能体发送文本与图片追问，以及冷子会话恢复）。
- **工具与命令插件**：命令统一注册到 `dsh-commands`，工具通过 `presentCall`/`presentResult` 表达展示意图，TUI 统一处理留白、配色和回退。
- **计量与状态栏**：Token、上下文占用、耗时、标题与会话统计全部直接读取自 Harness 计量服务，TUI 不维护第二套计数器。
- **纯算法模块**：ANSI 宽字符计算、Markdown 排版、帧差分、视图状态转换等保持为纯函数内部模块，不强行拆成运行时插件。

## 三、运行时组合概览

[`apps/omdsh/config/cordis.yml`](https://github.com/agi-fans/oh-my-dsh/blob/main/apps/omdsh/config/cordis.yml) 将以下模块组合到用户的 `$OMDSH_HOME/profiles/omdsh` 之上：

- **基础设施与模型**：Cordis Loader、DeepSeek 账户/API Key 双路由与本地 OAuth 回调宿主、多服务商适配器、凭据库、设置与默认模型；
- **会话与安全保护**：持久化 JSONL 会话、全文搜索索引（SQLite FTS5）、会话标题与统计计量、审批规则（`approval-rules`）、文件恢复快照（`file-recovery`）、每轮改动汇总（`workspace-changes`）、工具结果剪枝与图片卸载防爆保护；
- **平台工具与工作流**：按平台挂载单套 Shell（POSIX `bash` / Windows `pwsh`）、持久交互终端（`terminal`）、后台任务（`jobs`）、定时提醒（`schedule`）、网页搜索抓取、Todo、`/goal`、`/plan`、`/btw` 旁路提问、命令钩子（`hook-settings`）；
- **预设与多智能体**：`Standard` / `PTC` / `Minimal` / `Creator` 预设、三种子智能体通道（`subagent`、`subagent_fork`、`subagent_isolated`）、按会话开启的 Agent Teams（`/team`），以及随包内置的 Codex、Claude Code、Git Worktrees、自动审查与 Tmux 位置上下文扩展；
- **扩展协议**：文件系统 Skills、实时 `/mcp` 服务器管理、静态 `mcp.json` 与只读 `lsp.json` 语言服务器；
- **终端层**：本地 TUI Provider、工具展示桥、人机审批交互适配器、斜杠命令集与 Runner。

用户通过 `/plugins` 或 `omdsh plugin add` 安装的插件包，以及 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml` 的个人配置，会在启动时叠加在这棵组合树之上（可用 `omdsh --dump-config` 查看最终结果）。

## 四、终端渲染与交互保证

### 1. 主屏与原生滚动历史
- 严格按终端**显示单元格宽度**排版（正确处理 ANSI 序列、中文、emoji、组合字符与超长命令），底部锚定输入框与状态栏。
- **绝不擦除终端原生滚动历史**：已滚出视口的行作为当时的不可变快照保留；`/clear`、切换会话、`/resume` 和分叉会在一条带标签的分界线下方追加新视图（`/new` 仅在原对话有实质内容时画分界线）。
- 仅在真正全屏的浏览界面且为直连终端时借用备用屏幕；在 tmux / screen / ConPTY 下合并 resize 突发并保留宿主滚动历史。

### 2. 增量差分与帧同步
- 已完成回合的布局按区块缓存，滚动或流式更新时只重绘发生变化的可见行，每帧包裹在一次 DEC 2026 同步写入中减少闪烁。
- 流式增量在 8 ms 窗口内合并渲染，用户按键、工具状态切换与控制事件仍同步即时刷新。

### 3. 焦点、鼠标与安全退出
- 弹窗和底部面板在关闭前独占输入与光标焦点；审批弹窗始终优先于普通浏览，完成后恢复原界面与草稿。
- 鼠标支持（1000/1006）尊重 `Mouse interaction` 设置及 tmux `mouse off`；原生模式下所有键盘操作完整可用。
- 运行中 `Ctrl+C` 清草稿或中断，空闲连按两次 `Ctrl+C`（或空输入框 `Ctrl+D`）退出并打印 `--resume` 提示；非 TTY 管道模式复用同一套会话与命令语义。

## 五、验证体系

- **纯渲染与合约测试**：覆盖宽字符、ANSI、Markdown、工具卡片、视口缓存、假终端按键路由与生命周期清理；
- **端到端冒烟测试**：`pnpm smoke:happy`（模拟模型完整流程）与 `pnpm smoke`（真实 PTY 交互测试）；
- **边界与文档门禁**：`pnpm check:boundaries` 确保零依赖落入 `refs/`，`pnpm check:md` 与站点构建校验全站双语文档。详见 [`AGENTS.md`](https://github.com/agi-fans/oh-my-dsh/blob/main/AGENTS.md)。
