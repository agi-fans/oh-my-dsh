# oh-my-pi 对齐实施结果

本文记录 [`oh-my-pi-feature-gap.md`](oh-my-pi-feature-gap.md) 推荐的三轮能力在 omdsh 中的落点。领域状态仍由 DeepSeek Harness 插件拥有；TUI 只负责终端交互、展示和会话编排。

## 第一轮：插件骨架

| 能力 | 状态 | 实现位置 |
|---|---|---|
| 动态命令 | 已完成 | omdsh 命令由独立 Cordis 插件注册到 `dsh-commands`；`SessionRuntime` 使用唯一 registry 路径发现和执行 agent-scoped command，未知命令不会误发给模型 |
| persistence/query/projection/title | 已完成 | JSONL 会话日志、checkpoint、projection、stats、title，以及延迟打开的 SQLite FTS5 query index |
| create/resume | 已完成 | `/new`、`/resume [session-id]`、CLI `omdsh --resume <session-id>`，切换时重放完整事件日志；双 Ctrl+C 退出后打印恢复命令 |
| Recent sessions | 已完成 | Welcome 从持久化后端读取真实会话和折叠后的标题 |
| approval/user questions | 已完成 | TUI provider 绑定 `userQuestions` 和 `approval/request`，支持选择、多选、自定义回答和取消 |
| workspace context | 已完成 | spine 开启 64 KiB workspace context |

## 第二轮：Coding UX

| 能力 | 状态 | 实现位置 |
|---|---|---|
| Tool presentation bridge | 已完成 | `tool-presentation.ts` 按 active Agent scope 解析 `ToolDefinition.presentCall/presentResult`，展示器缺失或异常时安全回退 |
| Coding tool 展示 | 已完成 | TUI 映射 generic、terminal、diff、search、read、web 等 provider-neutral intent，不再按工具名推断语义 |
| 流式工具调用 | 已完成 | `tool-call-delta` 创建 provisional block，最终调用原位替换；`Ctrl+O` 按调用展开 |
| Model selector | 已完成 | `/model` 选择 provider、model、reasoning effort，并保存默认 selection |
| Usage/context/stats | 已完成 | 输入框下边框使用英文状态标签显示 turns/steps、LLM/tools 耗时、TTFT、解码速率、cache hit 和 input/output token；窄屏按完整分组降级，数据来自 whole-log projections；`/session` 展示详细数据 |
| 工作流命令 | 已完成 | `/compact`、`/goal` 来自 Harness commands；`/todo`、`/retry`、`/steer`、`/queue`、`/dequeue` 由会话控制层提供 |

## 第三轮：高级交互

| 能力 | 状态 | 实现位置 |
|---|---|---|
| 图片与附件 | 已完成 | `Ctrl+V` 智能识别剪贴板图片或图片路径，在 composer 中显示 `[Image #N, WxH]` 草稿并支持图文混合提交；本地 attachment store 在提交边界统一校验和持久化 PNG/JPEG/WebP/GIF，事件重放中显示尺寸与类型占位 |
| 外部编辑器 | 已完成 | `Ctrl+X` 使用 `$VISUAL`/`$EDITOR` 编辑当前多行 prompt，返回后重建终端 frame |
| 可配置 keybindings | 已完成 | `$OMDSH_HOME/omdsh/keybindings.json`；支持外部编辑、retry、智能剪贴板粘贴和复制 prompt/当前行 |
| 持久输入历史 | 已完成 | owner-only JSONL：`$OMDSH_HOME/omdsh/history.jsonl`，保留多行输入 |
| Transcript 搜索/导出 | 已完成 | `/search <query>` 搜当前会话；`/search --all <query>` 搜全部会话；`/export [path]` 导出完整 Markdown 日志 |
| 高级 Markdown | 已完成 | GFM 表格/任务列表/链接、代码语言高亮、HTML 归一化、行内/块公式和 Mermaid 终端文本图 |
| 多主题和可定制状态栏 | 已完成 | dark、light、midnight、solarized、mono；可在 `/settings` 中开关状态栏、选择 compact/full 标签，并分别隐藏或排序 Context、Cache、Tokens、Latency、Time、Activity 指标组 |
| plan/goal/subagent | 已完成 | 组合中挂载 Harness plan mode、goal domain/command/tool、in-process subagent 和控制工具 |
| Skills | 已完成 | spine 提供 registry/filesystem/tool；技能以 `/skill:<name>` 平铺进统一补全，旧 `/skill-name` 继续兼容 Harness 用户调用语义 |
| MCP | 已完成 | 用户级和项目级 `.dsh/mcp.json` 自动适配为每 server 一个 `dsh-mcp-client` 实例；`/mcp` 展示连接后的工具，重连后动态刷新 |

## 新增命令

```text
/new
/resume [session-id]
/session
/model
/retry
/steer <message>
/queue
/dequeue
/todo
/mcp
/search [--all] <query>
/export [path]
```

插件贡献的 `/compact`、`/goal`、`/plan` 等命令会动态出现在 `/help` 和补全列表中。

## Keybindings 文件

文件是 `key-id -> action` 的 JSON 对象；未覆盖的按键保留默认值：

```json
{
  "ctrl+x": "external-editor",
  "alt+r": "retry",
  "ctrl+v": "paste-clipboard",
  "alt+c": "copy-prompt",
  "ctrl+alt+c": "copy-line"
}
```

## 设计边界

- `SessionRuntime` 是 Harness runtime 与 TUI 之间的深模块；创建、恢复、切换、模型、查询、投影和清理不散落在 runner 或命令插件中。
- `TuiService` 是 presentation seam；终端 provider 不拥有 goal、compaction、approval、plan 等业务状态。
- Tool plugin 自己拥有展示意图，TUI 只映射 provider-neutral card；未提供或无法生成 intent 的工具仍有稳定通用展示。
- TTY 与 pipe 模式共用命令和交互语义。pipe 模式省略全屏布局，但不会绕过审批或问题回答。
- MCP server 的进程、URL 和凭据属于部署配置，因此仓库提供 `mcp.json` 到 Harness 插件实例的适配，不虚构默认外部连接。

## 验证基线

当前 `@oh-my-dsh/dsh-tui` 有 30 个测试文件、269 个测试；TUI 与 app typecheck、完整组合 EOF 启动冒烟均通过。esbuild 对仓库既有 `es2024` target 会打印 warning，不影响测试结果。
