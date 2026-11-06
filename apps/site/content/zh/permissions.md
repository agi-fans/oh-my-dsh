---
description: "omdsh 的 Access preset、沙箱与审批行为、升级授权、shell 限制，以及 Plan 模式如何让改动待在评审之后。"
---

# 权限与 Access

每个会话都以一个明确的 Access preset 开始。它决定模型运行所在的文件系统与 shell 沙箱，以及沙箱之外的操作是否需要你的审批。通过 `/permission` 选择当前会话的权限，**Settings → General → Default access** 保存未来会话的默认偏好。恢复继承后使用部署默认值，可由 `OMDSH_PERMISSION_MODE` 指定。

## Preset

| Preset | 沙箱模式 | 审批 | 模型可以做什么 |
|---|---|---|---|
| Read only | `read-only` | 越界时询问 | 只检查工作区、不写入；升级权限需要审批。 |
| Workspace write | `workspace-write` | 越界时询问 | 可在工作区内写入；更宽的范围需要审批。 |
| Full access | `danger-full-access` | 从不询问 | 完整文件系统访问，无审批提示。 |

默认是 Workspace write。preset 同时作用于文件系统 seam 与 shell：工作区之外的写操作会返回共享的沙箱拒绝，而不是逐个工具失败；模型可以在获得审批后以更宽模式重试一次。重试时若请求的正是当前已生效的模式，则不再弹出审批；目标更窄时仍然会在任何执行之前失败。composer 的 Access 徽标始终显示实际生效的模式，因此获批的扩权是可见的。

## 审批提示

操作需要审批时，提示会先展示会话已经流式输出过的工具卡片——待批准调用的命令、路径或 diff 摘要——再跟上提问方自己的理由。人类提示会顶掉已打开的浮层（例如 `/trajectory` 或设置），并在落定后恢复它，因此确认不会被在过期界面上接受。

问题与审批归属于发起它们的会话。切换当前会话会取消该会话已显示和排队中的提示，包括其本地子代理的审批。取消后的提示不会再批准操作、发送拒绝说明或保存审批规则。多个子代理同时请求审批时，会按顺序逐个展示，并标明请求来自哪个子代理。

### 记住审批决定

请求关联到正在执行的工具调用时，**Remember allow** 和 **Remember reject** 会打开精确调用预览。选择 **This session** 或 **This workspace**；Cancel 不保存规则，并撤回本次请求。会话规则在恢复后保留，不传给 fork 或子会话。工作区规则适用于原始工作区边界相同的会话，包括使用该边界的子会话。通过 `/permission` → **Approval rules** 查看并撤销决定。撤销影响后续请求，不会停止已经获批的操作。

匹配要求工具、完整 JSON 参数、工作目录、原始工作区、当前 Access 模式和审批理由全部相同。对象键顺序不影响匹配；Shell 字符串精确比较，不解释命令前缀或通配符。命令、参数、理由、目录或 Access 变化后需要重新决定。精确调用匹配不会冻结文件内容、环境变量或其他外部状态。

自动决定仍经过 Harness 审批服务及其会话审计。规则不能覆盖 `never` 审批策略、工具 guard 或沙箱执行约束，也不会永久扩大 Access。记住的拒绝针对匹配的审批请求；无需审批的操作仍由现有工具和沙箱策略约束。无法关联到执行中的调用时，只提供单次决定。规则保存在 `OMDSH_HOME/omdsh/approval-rules`，每次匹配前重新读取，私有文件中包含参数和理由。记录无法读取或无效时会拒绝请求，不会授予权限。最多支持 500 条规则；调用参数或理由超过 64 KiB 时不能记住。

## Shell 限制

每个宿主挂载一套受限 Shell，POSIX 使用 Bash，Windows 使用 PowerShell。随包默认超时为 120 秒。**Settings → Plugins → Shell** 配置新命令的默认和最大超时、输出限制及关闭宽限时间。调用显式指定的超时受最大值约束，后台命令可通过 `/jobs` 查看。

## Plan 模式

`/plan` 指导模型检查并提交可评审的计划。Approve 退出 Plan 模式并继续执行，Keep planning 允许补充反馈。Access 继续负责执行权限边界，评审与取消行为见 [Plan 模式](commands.md#plan-模式)。

## 相关

- [命令](commands.md) —— `/permission` 与 `/plan`
- [工具](tools.md) —— preset 实际限制的是什么
- [命令行](cli.md) —— `OMDSH_PERMISSION_MODE`
