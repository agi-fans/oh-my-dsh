---
description: 使用 /plugins 与 omdsh plugin 安装、更新和管理第三方插件及随包内置集成（Codex、Claude Code、Git Worktree、自动审查与 Tmux 上下文）。
---

# 插件与内置集成

omdsh 构建在 DeepSeek Harness 插件体系之上：内置能力与你安装的第三方扩展共享同一套安全、可组合的插件架构。如果你想跟着走一遍安装和启用流程，先看[安装插件与内置集成教程](tutorials/install-plugin.md)；想自己写插件请看[编写与发布插件](tutorials/write-a-plugin.md)。

## 一、日常管理：`/plugins` 与 `omdsh plugin`

### 在终端界面中管理（`/plugins`）

运行 `/plugins` 可以完成几乎所有日常管理，改动对当前 `$OMDSH_HOME` 下的所有会话生效：

- **发现（`Discover`）**：从配置的插件索引浏览、搜索并一键安装插件，已安装但有新版时会标出 `Update available` 支持就地更新；
- **插件包（`Bundles`）**：查看每个已安装或内置扩展包的 README（`详情`）、启停、更新或卸载；
- **插件条目（`Plugin entries`）**：查看单个插件的加载状态与诊断信息（终端必需的内置核心条目为只读，无法误关）；
- **配置插件（`Configure plugins`）**：直达 Shell、子智能体、网页搜索与已安装插件的配置表单；
- **安装插件包（`Install bundle`）**：直接输入 npm 包名、版本、Git URL 或本地绝对路径安装；
- **让代理创建插件**：等同 `/agent creator`，启动内置 Creator 预设（含 `dsh-doc` 开发技能）辅助编写插件，不改变你的默认预设。

### 在命令行中管理（`omdsh plugin`）

适合脚本化部署或在启动前安装（需要 `PATH` 上有 `pnpm`）：

```sh
omdsh plugin add <包名|Git地址|./本地路径>
omdsh plugin update <包名>
omdsh plugin remove <包名>
omdsh plugin list
```

任何未识别的子参数都会直接转发给用户配置目录（`$OMDSH_HOME/profiles/omdsh/`）下的 `pnpm`。安装或移除后可运行 `omdsh --dump-config` 或 `omdsh doctor` 核对最终挂载结果。

## 二、随包内置的集成与扩展包

安装 `omdsh` 后即自带以下扩展，随版本一起更新（不能单独卸载，但随时可以在 `/plugins` → `插件包` 中禁用，禁用选择在升级后会保留）：

| 内置扩展 | 默认状态 | 配置入口 | 作用 |
|---|---|---|---|
| **Codex / Claude Code 子智能体** | 默认关闭 | `/settings` → **`插件` → `子代理`**（或 `/plugins` → `插件包`） | 把独立纯文本子任务委派给内置的 Codex 或 Claude Code 平台运行时；登录沿用原生配置，权限独立且默认保守（Codex `never`、Claude Code `dontAsk`）。 |
| **Git Worktrees**（`@deepseek-ai/dsh-experimental-worktree`） | 默认开启 | `/plugins` → `插件包`；归档保留项在 `/settings` → `插件` → `工具` | 在独立 Git 工作树里做实验性改动，不影响当前分支；归档会话时默认保留 worktree（`retainOnArchive: true`）。 |
| **自动审查**（`@deepseek-ai/dsh-experimental-auto-review`） | 默认开启 | `/permission`（当前会话切换）与 `/plugins` → `插件包` | 在 `/permission` 中提供 `自动审查`（`Auto review`）模式，在写操作前进行额外模型审查。 |
| **Tmux 位置上下文**（`@deepseek-ai/dsh-tmux-context`） | 在 tmux 内默认开启 | `/settings` → **`插件` → `工具` → `Tmux 位置上下文`** | 仅在真实 POSIX tmux 窗格（`$TMUX_PANE`）内自动挂载，同步窗格与布局变化；非 tmux 零开销。 |

## 三、插件包兼容性契约（给作者与高级用户）

第三方插件进入 omdsh 时遵循以下清晰边界，保证终端体验稳定、不冲突：

1. **标准 npm 包 + `dsh.bundle.patch`**：在 `package.json` 中通过 `dsh.bundle.patch` 指向补丁文件（如 `./cordis.patch.yml`）。缺少该字段的普通库安装时会收到警告，只作为依赖库保留，不挂载任何插件行。
2. **共享单一运行时**：所有 `@deepseek-ai/*` 包必须放在 `peerDependencies` 且与当前 `omdsh` 所搭载的 DeepSeek Harness 版本兼容；放在 `dependencies` 会被安装器拒绝，防止进程内出现两套分裂的运行时。
3. **现成可用、无需自写 TUI 代码的能力**：只要通过标准 Harness 接口注册斜杠命令（`commands`）、模型工具（`tools`）、模型服务商（`llm`）、凭据（`credentials`）、配置项（`settings`，自动出现在 `/settings → 高级`）、审批或人类提问（`tui.prompt`），omdsh 会自动完成终端呈现。
4. **不依赖 Web / HTTP 宿主**：TUI 宿主刻意不挂载 Web UI 或外部 HTTP 服务；插件不应假定它们存在，也不应直接抢占 TTY 或读取原始键盘字节流。

关于插件启动加载顺序、终端接口细节与可运行代码示例，请参阅[插件开发内部机制](plugin-internals.md)和[架构概览](architecture.md)。

## 相关

- [安装插件与内置集成（教程）](tutorials/install-plugin.md) —— 面向用户的快速上手
- [开发者进阶：编写与发布插件](tutorials/write-a-plugin.md) —— 从零写一个插件并发布
- [插件开发内部机制](plugin-internals.md) —— 公共接口与代码示例
- [子智能体与团队协作](subagents.md) —— Codex / Claude Code 子智能体详细行为
