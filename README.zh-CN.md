# oh-my-dsh

[English](README.md) | 简体中文

**omdsh** 是一个构建于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 之上的插件优先终端编程智能体，其交互设计受到 [oh-my-pi](https://github.com/can1357/oh-my-pi) 启发。

![oh-my-dsh 终端界面](docs/resources/screenshot.png)

## 为什么做 oh-my-dsh

DeepSeek Harness 提供了能力完整的智能体运行时，也带来了一条很重要的架构原则：一切皆插件。oh-my-dsh 希望为这套运行时提供专注、键盘友好的终端体验，同时不再创造第二套智能体核心，也不使用另一层抽象将 Harness 隐藏起来。

TUI 被刻意限定为表现层与交互层。会话、工具、权限、模型、Skills、MCP 服务、命令和遥测数据仍然来自 Harness 的服务与插件；omdsh 负责把它们组合为终端应用，并补充舒适使用这些能力所需的界面行为。

## 设计原则

- **原生融入 Harness。** 使用正式发布的 DeepSeek Harness 软件包，并将其作为智能体行为、状态与生命周期的唯一事实来源。
- **始终坚持一切皆插件。** 新能力应当进入 Cordis 插件、服务、Provider、Consumer 或应用组合，而不是不断膨胀的 TUI 单体。
- **每项职责只有一个所有者。** `@agi-fans/dsh-tui` 负责终端表现与交互，`@agi-fans/oh-my-dsh` 负责启动和运行时插件组合。
- **终端优先。** 固定输入区、增量渲染、正确计算终端显示宽度，并让常用工作流都可以通过键盘完成。
- **渐进式呈现。** 默认界面保持安静和简洁，同时让工具输出、遥测、设置及会话详情可以按需展开和发现。
- **参考项目只用于参考。** `refs/` 下的项目仅用于 API 与交互研究；omdsh 运行时代码只依赖正式发布的软件包和自身 workspace 软件包。

## 当前能力

- 支持流式对话以及持久化会话、恢复、轮次回退、重试、压缩和 Markdown 导出
- 支持插件提供的斜杠命令、交互式设置、模型与推理强度选择，以及访问模式
- 支持工具调用、审批与提问流程、可折叠输出和实时会话遥测
- 支持项目内 `@` 文件搜索、剪贴板图片粘贴、输入历史，以及可见、可取回编辑的后续消息队列
- 从项目与用户配置中发现 Harness Skills 和 MCP 服务
- 支持自适应终端布局、主题、会话记录滚动和非 TTY 降级模式

## 架构

```text
DeepSeek Harness 插件与服务
             │
             ▼
 @agi-fans/dsh-tui — 终端能力边界
             │
             ▼
 @agi-fans/oh-my-dsh — 启动与插件组合
```

TUI 软件包在内部拆分为服务定义、本地终端 Provider 和交互式 Runner。这让终端所有权与事件投影、渲染相互隔离，也让未来的其他 Provider 或 Consumer 无需依赖本地 TTY 实现。更多细节请阅读[架构概览](docs/architecture.md)与[插件架构复盘](docs/plugin-architecture-review.md)。

## 性能

性能是 TUI 架构本身的一部分：持久化会话按线性时间回放，Harness Projection 避免重复扫描历史，已完成的对话区块会保留格式化布局，终端写入器则只输出行级差异。在报告所用的 Apple M5 Pro 环境中，恢复 10,000 轮对话的中位耗时为 2.15 ms，恢复 10,000 次工具调用为 21.21 ms，在 5,000 轮对话界面上进行缓存更新的平均耗时为每帧 0.24 ms。完整方法与限制请参阅可复现的 [TUI 性能报告](docs/performance.zh-CN.md)，也可以在本地运行 `pnpm benchmark:tui`。

## 安装

运行环境需要 Node.js 22.19 或更高版本（同时支持 Node.js 24），进行真实模型对话时还需要 DeepSeek API Key。

```sh
npm install --global @agi-fans/oh-my-dsh
omdsh
```

进入 omdsh 后运行 `/login`，程序会打开 DeepSeek API Key 管理页，并通过遮罩输入框接收和验证 Key，再将其保存到 Harness 凭据存储中。用户主动选择的 Key 会从下一次模型请求开始优先于继承的 `DEEPSEEK_API_KEY`，重启后仍然有效。使用 `/logout` 可以删除这份由 omdsh 管理的配置，并在存在 `DEEPSEEK_API_KEY` 时回退到环境变量；CI 或外部托管环境仍可直接使用环境变量而无需运行 `/login`。

也可以不进行全局安装，直接临时运行：

```sh
npx @agi-fans/oh-my-dsh
```

模型配置也可以来自 `$DSH_HOME/settings.yaml`，凭据则遵循 DeepSeek Harness 的解析流程。Skills 与 MCP 的配置方式请参阅 [Skills 与 MCP](docs/skills-and-mcp.md)。

## 开发

以下 pnpm 命令仅用于源码开发和调试：

```sh
pnpm install
pnpm omdsh "list files"  # 从源码运行
pnpm typecheck           # 检查 TypeScript
pnpm test                # 单元测试与管道模式测试
pnpm build               # 构建全部 workspace 软件包
pnpm smoke               # 交互式 PTY 冒烟测试
pnpm smoke:happy         # 使用模拟 LLM 验证正常流程
```

`refs/deepseek-harness` 与 `refs/oh-my-pi` 中的代码是只读参考项目。开发 omdsh 时不要将它们用作运行时依赖，也不要修改其内容。

## 变更日志

面向用户的变更与版本发布记录统一维护在 [CHANGELOG.md](CHANGELOG.md) 中。

## 致谢

oh-my-dsh 的诞生离不开两个项目：

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供了运行时基础、插件架构，以及智能体能力应当通过组合而非内嵌于单一应用中的设计信念。
- [oh-my-pi](https://github.com/can1357/oh-my-pi) 展示了细致的终端交互、紧凑的信息设计和精心设计的键盘工作流，如何让智能体既快速又易于使用。

感谢这两个项目及其所有贡献者。omdsh 是一个独立的社区项目：它构建于 DeepSeek Harness 之上并从 OMP 学习，但不是其中任何一个项目的官方发行版本。

## 许可证

oh-my-dsh 使用 [MIT License](LICENSE) 发布。
