---
description: 在 /plugins 中浏览和安装第三方插件包，以及开启和管理内置的 Codex、Claude Code、Git Worktree、自动审查与 Tmux 上下文。
---

# 安装插件与内置集成

除了 Skills 和 MCP，omdsh 还可以直接通过插件包（npm 包）增加新斜杠命令、新工具、新模型服务商或本地工具集成。整个安装、更新、启停过程都可以直接在终端里的 `/plugins` 完成，无需手改配置文件。

## 一、先认识 `/plugins` 插件中心

在 omdsh 中输入 `/plugins` 并按 `Enter`，你会看到 6 个清晰入口：

| 入口（中文 / 英文） | 用途 |
|---|---|
| `配置插件` / `Configure plugins` | 快速配置 Shell、子智能体、网页搜索抓取及已安装插件的选项 |
| `让代理创建插件` / `Let the agent create a plugin` | 启动内置的 Creator 预设（等同于 `/agent creator`），让助手协助你开发新插件 |
| `插件条目` / `Plugin entries` | 查看当前已加载的单个插件状态、报错诊断或单独开关 |
| `插件包` / `Bundles` | 管理已安装的外部插件包和随 omdsh 内置的扩展包（查看详情、更新、启停、卸载） |
| `发现` / `Discover` | 从配置的插件索引浏览、搜索并一键安装现成插件 |
| `安装插件包` / `Install bundle` | 直接输入 npm 包名、版本号、Git 地址或本地绝对路径进行安装 |

> 提示：通过 `/plugins` 所做的改动会影响当前用户配置目录（`$OMDSH_HOME`）下的所有会话。普通启停通常即时生效；涉及替换底层依赖包时，界面会提示你重启 omdsh。

## 二、启用随包内置的高价值集成

omdsh 安装后已经自带了一批实用扩展，不需要额外下载，按需打开即可：

### 1. Codex 与 Claude Code 原生子智能体（默认关闭）

如果你本地已经安装了 Codex 或 Claude Code，可以把独立任务直接委派给它们：

1. 运行 `/settings` → **`插件`（`Plugins`）→ `子代理`（`Agents`）**（或在 `/plugins` → `插件包` 中找到它们并打开集成设置）。
2. 选择 `Codex` 或 `Claude Code` 并启用；先点 **`安装状态`** 确认运行环境正常。
3. **模型**留空会自动继承各自的原生登录与默认设置；**权限**与主会话独立（默认保守：Codex 为 `never`，Claude Code 为 `dontAsk`），需要允许它们改文件时再按需调整。

### 2. Git Worktree 隔离工作区与自动审查（默认开启）

- **Git Worktree**（`@deepseek-ai/dsh-experimental-worktree`）：需要让助手在独立的 Git 工作树里做实验性改动、不干扰当前分支时使用。可以在 `/settings` → `插件` 中配置归档时是否保留 worktree，不需要时可在 `/plugins` → `插件包` 里禁用。
- **自动审查**（`@deepseek-ai/dsh-experimental-auto-review`）：为 `/permission` 提供 `自动审查`（`Auto review`）模式，在敏感操作前多一道自动审查。不需要时同样可以在 `/plugins` → `插件包` 里禁用。

### 3. Tmux 位置上下文（在 tmux 中默认开启）

如果你在 `tmux` 窗格里运行 omdsh，内置的 **Tmux 位置上下文**插件会自动感应当前 session、window、pane 布局并告诉助手（非 tmux 环境下零开销）。如需关闭或调整刷新间隔，打开 `/settings` → **`插件` → `工具` → `Tmux 位置上下文`**。

## 三、安装、更新与卸载第三方插件

### 方式 1：在 TUI 里用 `/plugins`（推荐）

1. **浏览安装**：打开 `/plugins` → **`发现`**，输入关键词筛选，按 `Enter` 查看兼容性和权限提示后确认安装。
2. **指定包安装**：打开 `/plugins` → **`安装插件包`**，支持以下任意形式：
- npm 包名或指定版本：`@scope/my-plugin` 或 `@scope/my-plugin@1.2.0`
- Git 仓库：`github:owner/repo`
- 本地目录或压缩包：`/abs/path/to/my-plugin` 或 `/abs/path/to/my-plugin.tgz`
3. **查看详情、更新与卸载**：在 `/plugins` → **`插件包`** 中选中已安装的包，可以打开 **`详情`** 阅读其 README，有新版本时直接 **`更新`**，不再需要时选择 **`卸载`**。

### 方式 2：在终端用 `omdsh plugin` 命令行

如果你习惯在脚本里或启动前管理插件，命令行提供完全等价的操作（需要 `PATH` 上有 `pnpm`）：

```sh
omdsh plugin add @scope/my-plugin     # 安装 npm 包、Git 地址或 ./本地路径
omdsh plugin list                     # 查看已安装的插件包
omdsh plugin update @scope/my-plugin  # 更新到兼容的新版本
omdsh plugin remove @scope/my-plugin  # 卸载插件包
```

安装完成后，运行 `omdsh doctor` 或 `omdsh --dump-config` 可以确认插件已经正确挂载且没有版本冲突。

## 常见问题

- **为什么某些随包自带的插件不能卸载？** 内置扩展（如 Codex、Claude Code、Git Worktree、Auto review）随 `omdsh` 本体一起更新，无法单独卸载，但随时可以在 `/plugins` → `插件包` 中**禁用**，禁用后后续升级也会尊重你的选择保持关闭。
- **安装了插件但没出现新命令？** 先运行 `omdsh doctor` 检查插件与当前 DeepSeek Harness 运行时版本是否兼容；如果是从命令行安装的，重启一次 `omdsh` 即可加载。

## 下一步

- 查阅完整的插件兼容性规则与配置细节：[插件与内置集成参考](../plugins.md)。
- 想自己写一个新命令、新工具或团队内部插件：进入[开发者进阶：编写与发布插件](write-a-plugin.md)。
