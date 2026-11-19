---
description: 面向插件开发者：已发布的扩展接口、工具展示/交互提问/设置 schema 的代码示例、终端所有权边界与完整 Persona 集成。
---

# 插件开发内部机制

omdsh 插件通过已发布的 DeepSeek Harness（DSH）服务扩展运行中的 Cordis 插件树。安装与兼容性规则见[插件与内置集成](plugins.md)，从零起步的教程见[编写与发布插件](tutorials/write-a-plugin.md)。

## 一、可用扩展接口一览

| 你想扩展什么 | 注入的服务 / 接口 | 在终端中的表现 |
|---|---|---|
| 斜杠命令 | `commands`（`dsh-commands`） | 自动进入 `/` 补全、`/help` 与执行入口 |
| 模型工具 | `tools`（含可选 `presentCall` / `presentResult`） | TUI 渲染卡片、留白与换行，缺失时自动走通用回退 |
| 模型与登录授权 | `llm`、`authorization` | 自动进入 `/model` 选择器与 `/login` 引导流程 |
| 设置与凭据 | `settings`、`credentials` | 声明的 live schema 字段自动出现在 `/settings → 高级`；密钥加密存储 |
| 向用户提问或通知 | `tui`（`prompt`、`notice`、`commandOutput`） | 本地终端负责焦点、取消、键盘鼠标交互及返回输入框 |
| 会话生命周期 | `agent` / `session` 服务与持久事件 | 在插件自身 Cordis 作用域内监听或扩展行为 |
| Persona 与技能 | Agent 预设与 Skill 注册表 | `/agent` 选择预设，`/<skill-name>` 调用技能 |

在插件的 `inject` 中声明依赖服务，并在 `apply(ctx)` 里使用 `ctx.effect(...)` 注册资源，确保插件卸载或重载时自动清理。已发布的导出入口见 [TUI manifest](https://github.com/agi-fans/oh-my-dsh/blob/main/packages/tui/omdsh-tui/package.json)。

## 二、常见扩展代码模式

### 1. 注册一个带友好终端展示的工具

通过 `presentCall` 与 `presentResult` 告诉 TUI 如何以人类可读方式展示你的工具卡片，而不需要自己拼边框或 ANSI 颜色：

```js
export const name = 'metrics-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.tools.register({
      name: 'query_metrics',
      description: 'Query service latency metrics for a time window',
      parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] },
      presentCall: (args) => ({ title: `Metrics · ${args.service}` }),
      presentResult: (result) => ({ summary: `${result.p95} ms p95` }),
      async execute(args) {
        return { p95: 42, service: args.service }
      },
    })
  }, 'metrics-tool')
}
```

### 2. 通过 `ctx.tui.prompt` 安全地向用户提问

不要直接读写 `process.stdin` 或接管 TTY；始终通过 `ctx.tui.prompt` 发起选择、输入或文档阅读，并传递 `signal` 正确响应取消：

```js
const choice = await ctx.tui.prompt({
  title: 'Deploy target',
  question: 'Choose an environment',
  options: [
    { label: 'Staging', value: 'staging' },
    { label: 'Production', value: 'prod' },
  ],
  allowCustom: false,
  signal: invocation.signal,
})
if (choice === null) return { kind: 'success' }
```

### 3. 声明配置项（自动进入 `/settings → 高级`）

只需通过 `ctx.settings` 声明 schema 字段，omdsh 就会自动在 `/settings → 高级` 中生成校验表单、展示继承/覆盖状态并持久化到用户配置补丁；涉及密钥的字段应通过 `ctx.credentials` 保存引用。

### 4. 在 `complete: true` 的完整 Persona 中接入回复语言

omdsh 的**回复语言（Response language）**设置通过 system-prompt section 注入。如果你的自定义 persona 声明了 `complete: true`（会抑制普通 section），请在模板中保留 `{{omdsh_agent_behavior}}` 占位符，以便用户的回复语言偏好继续生效：

```yaml
complete: true
template: |
  You are a focused review assistant.
  {{omdsh_agent_behavior}}
```

更多细节见 [Agent 行为设计](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/design/agent-behavior.md)。

## 三、终端所有权与兼容性约束

- **单一终端所有者**：本地 TUI Provider 独占 raw mode、按键解码、光标、视口与鼠标事件；审批和人类提问优先于普通浏览，结束后恢复原界面。
- **尚未开放的 UI 注册表**：自定义组件工厂、主题包注册与自定义状态栏 segment 尚无公开 API；仅在出现真实且拥有独立所有权的第二个贡献者时才开放对应边界。
- **持久事件与安全**：写入会话日志的事件必须符合已发布 schema（未知事件仅在显式标为 ignorable 时才可被读取器跳过）；权限决定必须经过 Harness 审批服务，不可绕过沙箱。
- **运行时重载边界**：通过 CLI 安装/升级插件包后需要重启 `omdsh`；运行中通过 `/plugins` 执行的改动会明确报告是否已即时生效或需要重启，且已有会话的 Agent 预设组合保留其原修订版本。

## 相关

- [插件与内置集成](plugins.md) —— 安装与兼容性契约
- [开发者进阶：编写与发布插件](tutorials/write-a-plugin.md) —— 完整开发与发布教程
- [架构概览](architecture.md) —— 软件包边界与数据流
