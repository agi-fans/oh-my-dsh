# 内部设计与集成记录

本目录保留维护 omdsh 时需要的设计约束、兼容决策和调查证据。用户使用说明以[中文站点文档](../apps/site/content/zh/)和[英文站点文档](../apps/site/content/en/)为准；发布变化见 [CHANGELOG](../CHANGELOG.md)，开发与验证规则见 [AGENTS.md](../AGENTS.md)。

当前工作区的产品版本为 `0.22.0`，直接 DSH 依赖固定为 `0.2.2-rc.1`。设计文档描述当前实现，具体依赖以 manifest、lockfile 和组合配置为准；历史记录保留各自的验证日期与范围。

## 当前设计

| 文档 | 内容 |
| --- | --- |
| [设计哲学](design/philosophy.md) | omdsh 该做什么、不该做什么，以及判断问题归属的依据；其它设计文档是它在一个具体领域的展开 |
| [TUI 渲染与浏览](design/tui-rendering.md) | 回合折叠、工具详情、滚动控件、原生历史、resize 与渲染边界 |
| [会话收尾与子 Agent](design/session-lifecycle.md) | 截断工具预览、未知执行结果、后台流式更新与性能调查边界 |
| [Agent 行为设置](design/agent-behavior.md) | 回复语言、跟随界面、Profile 配置、turn 快照与 complete persona 兼容 |
| [DeepSeek Harness 集成](integrations/deepseek-harness.md) | 当前依赖基线、问答兼容、组合决策与后续接入条件 |
| [上游功能支持盘点](integrations/upstream-feature-support.md) | 核心缺口、可选扩展、独立宿主及逐项补齐条件 |
| [Harness 体验对齐](design/harness-alignment.md) | 命令、账户、插件、会话与交互的产品边界 |
| [DSH 能力覆盖](design/dsh-coverage.md) | 上游入口映射和刻意保留的差异 |
| [终端体验](design/terminal-experience.md) | 终端协议、输入、滚动与外部编辑器 |
| [Harness Inbox 生命周期](integrations/harness-inbox-lifecycle.md) | Queue、Steer、清理和恢复约定 |
| [Herdr 集成](integrations/herdr.md) | 已实现的 lifecycle reporter、传输限制与尚未验证的集成面 |

## 历史证据

以下记录保留升级时的原始实验结果，供版本走廊与兼容性调查引用。其中的版本、分支、配置和验证数量只描述当时的实验。

| 文档 | 保留原因 |
| --- | --- |
| [DSH 0.1.2 升级实验](history/dsh-0.1.2-upgrade-lab.md) | 公开 API 迁移、preset 优先级与打包依赖图的案例证据 |
| [DSH 0.1.5-rc.1 升级记录](history/dsh-0.1.5-rc.1-upgrade.md) | npm 预发布 peer 混装导致重复注册的案例证据 |
| [DSH 0.2.1-rc.2 升级记录](history/dsh-0.2.1-rc.2-upgrade.md) | 稳定 Cordis 线、插件兼容评估与持久化入口适配 |
| [DSH 0.2.2-rc.1 升级记录](history/dsh-0.2.2-rc.1-upgrade.md) | 持久模型选择、执行器插件与定时提醒接口迁移 |

## 维护方式

- 当前约束直接更新对应设计文档，不再逐批追加实施日志。用户可见行为同时更新站点文档和 Changelog。
- 未实施的工作放在所属文档的后续条件中，写明缺口、启动条件和验证要求；已落地的计划不继续充当待办。
- 升级操作使用仓库的 [dsh-upgrade 技能](../.agents/skills/dsh-upgrade/SKILL.md)，可复用的失败模式进入其证据卡；只有仍需引用的原始实验才留在 `history/`。
- 已删除的逐版本报告和实施过程可从 Git 历史查询。例如 `git log --all -- docs/tui-transcript-folding-plan.md`；无需在当前目录复制一套归档。
