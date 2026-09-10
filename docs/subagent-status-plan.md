# 子 Agent 状态展示与刷新修复方案

日期：2026-09-10。

状态：已实现并完成聚焦回归、构建应用 PTY 验证和提交前暂存版本的独立验证。

## 目标

主界面的子 Agent 列表只展示任务名称和 Starting、Running、Waiting、Done、Failed 状态，区分等待与完成。后台 thinking、文本和工具参数流不驱动列表重绘；工具详情保留在 Agent Hub 和会话 inspector。保留官方 Harness subagent 实现、消息与取消语义、持久记录和恢复行为。

## 实现

1. 流式帧继续经过连续性校验和进行中前缀缓冲。只有当前可见会话消费流式输出；后台增量不更新 roster。打开 inspector 后补回已缓冲前缀，之后继续实时显示。
2. roster 从持久事件增量维护名称、状态和 Agent Hub 所需的有限活动记录，仅首次加载或恢复时回放历史。无变化时保留对象及 snapshot 身份，避免无效排序和复制。
3. 本地 TUI 比较列表可见字段，仅名称、顺序、状态等变化请求列表刷新；活动变化只在 Agent Hub 打开时刷新。复用已有显示调度器合并连续状态更新。审批与用户问题继续通过现有交互路径及时展示。
4. 主界面显示明确的状态文本，删除 thinking、当前命令和工具参数后缀，保持窄终端截断、键盘选择和 inspector 入口。

## 验证

- 回归测试先确认后台 120 个 chunk 不再发布 roster 或可见 transcript 更新；打开 inspector 后前缀完整，实时增量可见，退出后后台流停止驱动画面。
- 确认创建、名称、运行、等待、完成、失败和恢复状态；确认重复事件不重放全历史，Agent Hub 的持久工具活动仍正确。
- fake-TTY 验证后台活动不进入 render，连续状态更新合并，输入与现有审批覆盖保持通过；渲染测试覆盖颜色、CJK、窄宽及 waiting/done 计数。
- 运行聚焦测试，再执行仓库要求的安装、类型检查、完整测试、构建、Markdown 检查、happy smoke、TTY smoke 和 diff 检查。只修改本任务相关内容，保留工作区既有修改；按用户后续指示单独提交，不发布。

## 范围

本方案处理已采样确认的后台事件到 TUI 的放大路径。不迁移执行进程，不更换官方 subagent 包，不改变并发上限，不重写整个 transcript 缓存；仍需分别评估 runtime 同步计算和长 pending 历史的其他开销。

## 验证结果

- 先运行回归测试，确认 3 个后台 Agent 的 120 个 chunk 导致 120 次 roster 发布。修复后发布次数为 0；打开 inspector 会重放 40 个已缓冲增量，继续接收实时工具参数，关闭后停止显示后台增量。
- fake-TTY 测试验证：120 次只改变 activity 的更新不会调用 render；Agent Hub 打开后仍展示持久工具活动；连续 Starting → Running → Waiting 更新只在一个显示 tick 绘制一次，键盘输入无需等待该 tick。
- 提交前将暂存版本导出到独立 Git 目录，复用已安装的 npm 依赖；完整 TUI 测试 69 个文件、776 个测试全部通过，TUI 类型检查通过，未包含隔壁会话的其他修改。
- 聚焦的 248 个测试通过。完整 TUI 测试为 796 通过、2 失败；站点 13 个测试通过，应用 103 个测试通过。两条失败分别是 `status-line.spec.ts` 的低优先级组断言和 `hotkeys.spec.ts` 的 8/9 条帮助项断言。在 HEAD 的隔离副本中仅加入调查前已有的状态栏和 hotkeys 修改、排除本修复后，两条失败仍然复现；未调整这些既有修改或放宽其断言。
- `pnpm install`、`pnpm typecheck`、`pnpm build`、`pnpm smoke:happy`、`pnpm smoke`、`pnpm smoke:interrupt` 和 `pnpm check:boundaries` 通过。流式中断 smoke 测得 Ctrl-C 到 interrupted 为 8ms，属于本机单次测量。
- 构建后的 `apps/omdsh/lib/bin.js` 在私有 home/workspace 和 120×38 PTY 中运行，通过本地模拟 SSE 驱动 3 个真实官方 continuable 子 Agent。主界面无子 Agent thinking/正文泄露，输入约 31ms 内回显，Agent Hub、inspector 前缀及实时输出、返回父界面和退出均通过。没有调用真实模型；录制来自未提交工作区，不能当作某个已发布版本的证明。回放检查确认状态行、composer 和两行 footer 的布局。
- 临时本机产物为 `/tmp/omdsh-status-demo.cast`、`/tmp/omdsh-status-demo.log`、`/tmp/omdsh-status-demo-result.log`。录制脚本是 `/tmp/omdsh-status-demo.mjs`，私有运行目录已清理；这些产物不提交到仓库。
- 直接设置 `OMDSH_RUN_MODE=built` 运行现有 `pnpm smoke` 时，源码目录的 bundle 查找在启动前失败。上述独立 built PTY 验证在私有 profile 中注册当前产品包，使用相同构建产物完成验证；没有更改包解析或启动实现。

验证还暴露了纯文本截断无条件附加 ANSI reset 的既有问题。新增纯文本/CJK 截断回归后修复，仅在已写出样式序列时追加 reset，相关无颜色测试通过。失败状态随后被 idle 通知覆盖的问题也已补回归并修复。
