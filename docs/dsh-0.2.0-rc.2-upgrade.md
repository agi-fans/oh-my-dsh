# DSH 0.2.0-rc.1 → 0.2.0-rc.2 升级记录

模式：**Harness cohort migration**。2026-10-02 将 omdsh 的 DSH 运行时统一升级到 npm 发布的 `0.2.0-rc.2`，保持现有阻塞式问答。此前的[只读评估](dsh-0.2.0-rc.2-assessment.md)保留为调查记录；本文件记录实际实施与验证。

## 依赖与配置

| 项目 | 实施结果 |
| --- | --- |
| 直接版本 | 根 manifest 1 项、CLI 117 项、TUI 35 项、`examples/hello` peer 1 项，共 154 处统一为 `0.2.0-rc.2` |
| lockfile | 152 个 DSH 包统一解析到 `0.2.0-rc.2`，无旧 DSH cohort 混装 |
| 基础层 | Cordis `4.0.4`、loader `1.0.5`、timer `1.1.6`、Schemastery `3.18.4` 保持不变 |
| pi-ai | `0.85.1` → `0.87.1`；lockfile 同时更新其 SDK、代理与 TypeBox 传递依赖 |
| 发布龄规则 | 为现有 DSH 条目追加精确的 `0.2.0-rc.2` 例外，保留旧 lockfile 校验所需的已有例外；普通 `pnpm install` 通过 |
| 问答模式 | `apps/omdsh/config/cordis.yml` 显式设置 `tool-ask-user.config.mode: legacy` |
| 文档 | 双语插件教程的 peer 示例更新到 rc.2；工具文档说明问答限制，Changelog 记录模型目录与 PowerShell 行为变化 |

产品版本保持 `0.18.0`，本次依赖升级不创建发布、tag 或 npm 写入。`examples/hello` 仍是非 workspace 的插件示例。

## 兼容判断与适配

`dsh-user-questions` 在 rc.2 中改为 `TypertRemoteService` 并新增会话投影，但现有 `user-questions/request` 问答接口继续可用。TUI 的实际 Service 挂载与回答测试通过，未引入额外 Web/API 宿主。组合测试固定产品的 `legacy` 选择，避免升级时改变问答行为。

实验性的 `timed` 模式尚未接入：TUI 没有 `attachWait` 倒计时订阅、超时后补答入口，也没有针对 `user-question-reply` 的转录呈现。用户 Profile 应保持 `legacy`；异步问答需要单独实现与验证。

pi-ai 的目录和兼容适配随上游更新，使用被移除模型 ID 的用户可能需要重新选择模型。持久 PowerShell 的完成标记解析修复随依赖升级生效；Bash 与 PowerShell 的工具引导增加删除或移动前核对真实路径的要求。上游 base bundle 的组合文件在本走廊没有变化。

同批界面调整只移除了固定用户消息前的 `›`，保留主题、内边距、截断和视口定位；中英文、窄宽度及有色/无色回归覆盖了这一变化。

## 验证

升级前的基线为 `26176fe`，完整测试 1,391 条通过。升级后先用 `tsc -b apps/omdsh/tsconfig.json --clean` 清理增量构建，再运行类型检查与构建。

| 检查 | 结果 |
| --- | --- |
| `pnpm install` | 通过；lockfile 中仅有 DSH rc.2 |
| 固定消息与问答聚焦测试 | 20 条通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | TUI 1,257、CLI 122、站点 13，共 1,392 条通过 |
| 独立安装测试 | CLI 与 TUI 打包产物共同安装到临时目录，Profile 插件安装及实际命令启动通过 |
| `pnpm build` | 通过 |
| `pnpm smoke` / `pnpm smoke:happy` | `PTY_SMOKE_PASS` / `HAPPY_SMOKE_PASS` |
| `pnpm check:md` / `pnpm check:boundaries` / `git diff --check` | 通过 |
| 正式打包检查 | 两个 `pnpm pack` 产物的导出、CLI bin、DSH 版本和运行时路径均通过；CLI 的 TUI 依赖正确改写为 `^0.18.0`，无 `workspace:` 或 reference 路径 |

验证环境为 macOS；没有执行 Windows 主机测试或真实付费模型请求。PowerShell 修复由发布产物与上游差异确认，Windows 行为仍需由 Windows CI 验证。参考子模块保持只读，依赖和产物不使用 `refs/`。
