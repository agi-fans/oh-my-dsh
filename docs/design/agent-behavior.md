# Agent 行为设置

当前实现包含独立的界面语言与回复语言偏好。用户操作见[设置](../../apps/site/content/zh/settings.md)。

## 所有权与配置

[产品插件](../../apps/omdsh/src/agent-behavior.ts)拥有 Response language schema、prompt fragment 和 turn 快照，通过公开的 Harness settings、system-prompt 与 Loader 配置接口生效。TUI 只通过 `get`、`update`、`watch` binding 展示和提交设置，不读取配置文件，也不反向依赖产品包。

| 显示值 | 存储值 | 语义 |
| --- | --- | --- |
| Auto | `auto` | 不增加语言指令，schema 继承默认值 |
| Follow UI | `follow-ui` | 下一回合读取界面语言，新 Profile 默认值 |
| Simplified Chinese | `zh-CN` | 主要使用简体中文进行面向用户的沟通 |
| English | `en` | 主要使用英文进行面向用户的沟通 |

Response language 是 Profile 中 `agent-behavior` 行的 volatile config。设置通过 `settings.mutate` 更新该行，而非旧版 `omdsh-agent` namespace：

```yaml
- id: agent-behavior
  config:
    language: zh-CN
```

用户设置保存在当前 Profile 的 Cordis 补丁中，通常为 `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`；home 回退顺序见[设置文档](../../apps/site/content/zh/settings.md)。旧 `settings.yaml` 的一次性导入由启动迁移负责，不能把它继续写成当前配置入口。

TUI 绑定存在时，`/settings` 的 General 分类提供 Response language，UI language 由 TUI 自己管理。新 Profile 初始化 `follow-ui`，已有 Profile 保留已保存值，未设置或恢复继承时使用 `auto`。无 TUI 的 composition 仍可生成语言指令，Follow UI 此时通过环境语言解析。写入失败后 TUI 回滚显示并报告错误，prompt 只读取已提交的值。

## 生效边界

第一次 `agent/pre-step` 解析 Follow UI，并为每个 Agent 的当前 turn 冻结最终语言值，同一 turn 的后续 model step 复用该值。`agent/status: idle` 和 Agent dispose 清除快照。设置从下一 turn 生效，不取消或重写正在运行的请求。

偏好不写入 session event，也不随会话保存旧设置；恢复会话和继承产品 composition 的进程内子 Agent 使用当前配置。历史回复与新回复因此可以使用不同语言。

语言 fragment 遵循项目和用户当前任务的明确语言要求，并保留代码、标识符、命令、工具参数、日志、引用、文件内容和惯用术语的准确写法。它表达面向用户沟通的偏好，内部推理语言由模型决定。界面语言由 TUI 的本地化层独立实现，状态栏标签固定为英文。

## Prompt 与缓存

普通 persona 使用 `omdsh:agent-behavior` 全局 section，order 为 30。`auto` 返回空 fragment；非默认值生成固定内容，完整字符串由[源码和测试](../../apps/omdsh/src/agent-behavior.spec.ts)维护，文档不另存一份副本。

Harness 的 `complete: true` persona 会抑制其他 section。[Minimal preset](../../apps/omdsh/config/presets/minimal.patch.yml)因此直接在 persona 末尾追加 `{{omdsh_agent_behavior}}`：Auto 时变量返回空字符串，选择具体语言或 Follow UI 时增加两个换行和 fragment。Auto 下的 system prompt 保持原有字节与缓存前缀。

自定义 complete persona 只有显式引用该变量才支持 Response language；产品不强行改写用户 persona。若 composition 使用了变量却未挂载产品插件，严格插值会失败，这是组合错误。普通 persona 不再引用变量，避免重复注入。非默认设置会增加 prompt 内容；改变语言可能降低后续请求的 KV cache reuse。

## 设计取舍与回归要求

- 行为设置由产品插件拥有，不放入终端外观的 `tui` 配置，也不通过隐藏用户消息或回复后处理实现。否则会污染 history、compaction、export 和 resume，或使显示内容偏离 durable event。
- `/settings` 保持产品自有界面，不为单一设置域开放通用第三方 row registry。用户插件可使用自己的 command、settings 和 prompt 接口。
- 未提供 Reply detail、Progress updates、Clarification style 或 Verification 档位。新增行为项前必须有固定 prompt、可观察的档位差异和不越过现有规则的边界。
- 回归必须覆盖 Follow UI 的语言解析及 turn 冻结、新旧 Profile 默认值、Auto 空输出、Minimal 在 Auto 下的字节不变、普通 persona 单次注入、complete persona 兼容、turn 快照、写入失败回滚，以及新建、恢复和进程内子 Agent 的配置读取。
