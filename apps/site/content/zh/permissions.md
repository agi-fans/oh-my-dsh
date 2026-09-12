---
description: "omdsh 的 Access preset、沙箱与审批行为、升级授权、shell 限制，以及 Plan 模式如何让改动待在评审之后。"
---

# 权限与 Access

每个会话都以一个明确的 Access preset 开始。它决定模型运行所在的文件系统与 shell 沙箱，以及沙箱之外的操作是否需要你的审批。按会话用 `/permission` 选择；部署默认值来自 `OMDSH_PERMISSION_MODE`。

## Preset

| Preset | 沙箱模式 | 审批 | 模型可以做什么 |
|---|---|---|---|
| Read only | `read-only` | 越界时询问 | 只检查工作区、不写入；升级权限需要审批。 |
| Workspace write | `workspace-write` | 越界时询问 | 可在工作区内写入；更宽的范围需要审批。 |
| Full access | `danger-full-access` | 从不询问 | 完整文件系统访问，无审批提示。 |

默认是 Workspace write。preset 同时作用于文件系统 seam 与 shell：工作区之外的写操作会返回共享的沙箱拒绝，而不是逐个工具失败；模型可以在获得审批后以更宽模式重试一次。composer 的 Access 徽标始终显示实际生效的模式，因此获批的扩权是可见的。

## 审批提示

操作需要审批时，提示会先展示会话已经流式输出过的工具卡片——待批准调用的命令、路径或 diff 摘要——再跟上提问方自己的理由。人类提示会顶掉已打开的浮层（例如 `/trajectory` 或 Agent Hub），并在落定后恢复它，因此确认不会被在过期界面上接受。

## Shell 限制

每个宿主只挂载一套受限 shell——POSIX 上是 `bash`，Windows 上是 `pwsh`——每次调用带有固定的 120 秒超时。模型可以按调用提高限制，或改为在后台运行；之后 `/jobs` 会列出它。

## Plan 模式

`/plan` 要求模型只检查、不改动，并提交一份可评审的计划。工具目录为请求缓存稳定性保持不变，plan 模式的规则会覆盖其中的改动类指引；只有在计划获批后才开始实现。

## 相关

- [命令](commands.md) —— `/permission` 与 `/plan`
- [工具](tools.md) —— preset 实际限制的是什么
- [命令行](cli.md) —— `OMDSH_PERMISSION_MODE`
