# 全新 coding agent 接入 Herdr 调研：自定义 lifecycle 集成契约与 omdsh 落地

状态：调研完成（网络一手资料 + 本机 Herdr 0.9.0 只读实测 + 已安装集成源码），未改动产品代码。

日期：2026-09-12

调研环境：当前进程运行在 Herdr pane 内（`HERDR_ENV=1`、`HERDR_PANE_ID=w1B:p2`、`HERDR_WORKSPACE_ID=w1B`）。所有 `herdr` 调用均为只读检查（help、status、list、read、explain、schema、manifest 查询），未创建、关闭、聚焦或移动 pane，未向任何 agent 发送输入，未修改 Herdr 配置或状态。

## 摘要：一个全新 agent 今天该怎么接

Herdr 官方把 agent 集成分成三种能力：**自动检测**（foreground 进程 + screen manifest 判定 `idle`/`working`/`blocked`）、**lifecycle authority**（hook/plugin 直接上报语义状态）、**session identity**（上报可恢复的原生会话引用）。官方内置集成覆盖 17 个 agent（通过 `herdr integration install <target>` 安装），但对一个 Herdr 二进制不认识的全新 agent，官方文档明确给出了自助路径，标题就叫 “Integrate your own agent”：**agent 在运行于 Herdr pane 内时，通过 CLI `pane report-agent` 或 socket API `pane.report_agent` 自行上报生命周期状态，退出时用 `pane release-agent` 释放权威。**

这条路径不需要 Herdr 发版，不需要 agent 被 Herdr 的进程检测识别，也不需要 `herdr integration install` 支持该 agent。官方原话是 “Custom integrations can also report state that is not visible in the native terminal UI. They do not need to be built into Herdr or use a recognized agent executable.” 上报立刻换取：sidebar 状态与 workspace/tab rollup、`herdr agent wait --until`、attention 与通知、`herdr agent explain` 中显示的状态权威，以及被其他 agent 通过 `herdr agent prompt` 当作 target 驱动（最后一点官方没有给出可复现说明，见“未验证”）。

无法自助、依赖 Herdr 上游二进制更新的有两块：`herdr agent start --kind` 的固定 kind 列表（0.9.0 为 23 项，无 omdsh/dsh），以及 Herdr 服务重启后的 native session restore（Herdr 必须知道如何启动并 `--resume` 该 agent，官方版本表只列内置集成）。上报 `agent_session_id`/`agent_session_path` 已被本机 0.9.0 实测为“接受但不暴露、不恢复”，保留上报仅作前向兼容。

真实案例有两个：Prime Agent 在自身仓库内置了 Herdr reporter（官方文档点名的 “real-world example”），Herdr 为 Pi/OMP/Kimi/OpenCode/Kilo 等安装的 lifecycle 集成则是同一套 socket 协议的 file-based 实现。两者使用完全相同的 `pane.report_agent` 协议。本报告已解剖其完整工程细节（seq、队列、release 时序、retry hold、blocked 引用计数等），并据此在 omdsh 落地了 P0 reporter（见“建议实现方案”，附本机真实 socket E2E 证据）。

## Herdr 的 agent 模型与状态权威

Herdr 是 multiplexer：后台 server 拥有真实终端进程，client attach 渲染。它在每个 pane 检测 foreground 进程；检测到 agent 后，该 pane 有且只有一个状态权威（status authority）。状态取值：

- `working`：agent 正在工作。
- `idle`：就绪可输入；`done` 是服务端推导的“idle 且尚未被查看”，seen 由聚焦/UI 行为更新，CLI 读取不更新。
- `blocked`：需要用户决策（审批/问题/权限 UI）。screen 检测刻意保守：未匹配已知 UI 时退回 `idle`，并在 explain 中标记 `default_known_agent_idle_fallback`。
- `unknown`：存在 agent 但无法自信分类。

状态权威有两种来源。**Screen manifest**：Herdr 读取 pane 底部活动缓冲快照（不是滚动的 viewport），用 TOML 规则判定状态；内置 manifest 在二进制里，`herdr.dev` 会做远程增补，本地可覆盖 `~/.config/herdr/agent-detection/<agent>.toml`。**Lifecycle 集成**：hook/plugin 直接上报语义状态；官方语义是“集成安装且正在为该 pane 上报时，`idle`/`working`/`blocked` 与 session identity 以集成为准，Herdr 不再对同一 authority 跑 screen 回退”，避免两个真相来源。

对全新 agent 的关键限制：远程 manifest 只能 patch Herdr 已认识的 agent 的检测规则；“Adding a completely new agent still requires a Herdr binary update for process detection, labels, and integration behavior”。因此不要走“写一个本地 manifest”的路线；自定义上报是官方为此准备的另一条腿。

如果只是想让 Herdr 把包装器进程当成某个已认识的 agent，官方还有两个检测层提示：foreground 包装命令上设置 `HERDR_AGENT=<agent>`（例如 VM/沙箱 wrapper，只在被包装进程上生效），以及服务端级 `HERDR_PROCESS_DETECTION=child-groups`（受限 Linux 环境没有 foreground 进程组时使用，重启 server 生效，best effort）。这两者都只是“借用已知 agent 的检测”，不解决新 agent 的 kind 与恢复问题。

## 三条集成路径与选择

| 路径 | 机制 | 谁来做 | 全新 agent 可用性 |
| --- | --- | --- | --- |
| A. 原生检测 | Herdr 内置 process detection + screen manifest | Herdr 上游发版 | 不可自助，需上游 |
| B. 官方集成 | `herdr integration install <target>` 往 agent 配置目录写 hook/plugin | Herdr 二进制内置 target 列表 | 不可自助，target 固定 |
| C. 自定义 lifecycle 集成 | agent 自己用 `pane report-agent` / socket API 上报 | agent 自身（在树内实现并分发） | 可用，官方明确支持 |

结论：全新 agent 选择路径 C，把 reporter 内置于 agent 自身——这也正是 Prime Agent 的选择。

## 自定义 lifecycle 集成契约

### 环境契约

agent 运行在 Herdr pane 内时继承（socket-api 与 integrations 文档一致）：

```text
HERDR_ENV=1
HERDR_PANE_ID=w1:p1
HERDR_BIN_PATH=/path/to/herdr
HERDR_SOCKET_PATH=/path/to/herdr.sock
```

本机实测还注入 `HERDR_WORKSPACE_ID`、`HERDR_TAB_ID`。官方要求“只在 `HERDR_ENV=1` 且所需变量齐全时上报，让集成在 Herdr 之外是 no-op”。管理变量由 Herdr 注入且权威，process-launching API 的 `--env` 不能覆盖它们。`pane move` 后进程保留启动时的 ID；跨 workspace 移动后的新公开 ID 以 move 结果为准。

推荐的检测谓词（Prime Agent 与 OMP 官方实现完全一致）：`HERDR_ENV === "1" && Boolean(HERDR_SOCKET_PATH) && Boolean(HERDR_PANE_ID)`。客户端作用域变量（`HERDR_SOCKET_PATH`、`HERDR_BIN_PATH`、`HERDR_SESSION` 等）可以在 Herdr 之外被设置，光有它们不能证明“在 pane 内”；oh-my-pi 的注释也记录了同样的教训。

### 状态上报：CLI 形式

官方示例（integrations.mdx）：

```bash
"$HERDR_BIN_PATH" pane report-agent "$HERDR_PANE_ID" \
  --source custom:my-agent \
  --agent my-agent \
  --state working
```

退出时释放：

```bash
"$HERDR_BIN_PATH" pane release-agent "$HERDR_PANE_ID" \
  --source custom:my-agent \
  --agent my-agent
```

本机 `herdr pane report-agent --help` 实测的完整参数面：

```text
Usage: herdr pane report-agent [OPTIONS] --source <ID> --agent <LABEL> --state <STATUS> <PANE_ID>
  --state <STATUS>   [possible values: idle, working, blocked, unknown]
  --message <TEXT>
  --seq <N>
  --agent-session-id <ID>
  --agent-session-path <PATH>
```

契约要点：

- `--source` 稳定且唯一，自定义集成用 `custom:<name>` 命名；官方要求 “Keep `--source` stable and unique to the integration”。同一 source 即同一权威，两个集成不能共用。
- `--state` 只有 `idle|working|blocked|unknown`，没有 `done`（`done` 由服务端从 idle+unseen 推导）。
- `--message` 描述阻塞原因（例如“等待审批：rm -rf build/”）。
- 乱序场景带严格递增的 `--seq`：同一 source 的序号不大于已接受值的上报会被 API 接受但不反映到 pane 状态。
- 上报会取得该 pane 的状态权威；退出务必 `release-agent`，否则 pane 停留在最后上报的状态。
- 对用户 hook 与纯展示需求，官方明确建议改用 `pane report-metadata`，不要跟真正的 lifecycle authority 抢 `--state`。

### 状态上报：Socket 形式

不需要频繁 spawn 进程、或需要更低开销时，直接走本地 socket：newline-delimited JSON，Unix domain socket（Windows 命名管道）。CLI 与 socket 是同一控制面，`herdr api schema` 可打印完整协议 schema。方法名：

- `pane.report_agent`
- `pane.report_agent_session`
- `pane.release_agent`

请求形状（socket-api 文档原文示例）：

```json
{
  "id": "req_1",
  "method": "pane.report_agent",
  "params": {
    "pane_id": "w1:p1",
    "source": "custom:docs",
    "agent": "docs-bot",
    "state": "working",
    "message": "building docs"
  }
}
```

`seq` 语义同上。`pane.report_agent_session` 用于“会话身份变化与状态变化彼此独立”的场景。

### 会话身份上报

`--agent-session-id` / `--agent-session-path` 可以跟随 `report-agent` 一起发，也可以单独发 `report-agent-session`（socket 方法 `pane.report_agent_session`）。对内置集成，Herdr 会存储引用，并在 `pane.get`/`pane.list`/`agent.get`/`agent.list` 中以只读 `agent_session` 字段暴露：

```json
{
  "agent_session": {
    "source": "herdr:codex",
    "agent": "codex",
    "kind": "id",
    "value": "..."
  }
}
```

本机 0.9.0 实测（独立 headless session + 真实 socket 上报）：**custom source 携带 `agent_session_id` 被服务端接受且不报错，但 `pane get` 不会返回 `agent_session`**（自定义 source 不在 Herdr 的恢复知识表内），因此当前版本没有可观察效果。官方 caveat 是：**自动 session restore 还要求 Herdr 知道如何启动并恢复该 agent**。稳定版列出的可恢复原生会话集成只有内置那批（Claude、Codex、Pi、OMP 等），没有第三方自定义 kind。结论：保留会话引用上报作为前向兼容（字段合法、上游版本演进后可能生效），但不要依赖当前版本暴露它；“Herdr 服务重启后自动 `--resume` 本 agent”要等上游支持。`[session] resume_agents_on_restore = false` 可全局关闭恢复。

### 展示元数据（不要用它抢状态权威）

`pane report-metadata` 是 display-only 通道：

```bash
herdr pane report-metadata "$HERDR_PANE_ID" \
  --source user:omdsh-title \
  --agent omdsh \
  --title "Refactor auth middleware" \
  --display-agent "omdsh: auth" \
  --token summary="refactor auth" \
  --state-label working="refactoring auth" \
  --ttl-ms 3600000
```

- `state` 决定 waits、通知与 rollup；metadata 只改变呈现：`--title`、`--display-agent`、`--state-label STATUS=TEXT`、`--token NAME=VALUE`、`--ttl-ms`（1..86400000 ms），并有 `--clear-*` 变体。
- `--agent` 与 `--applies-to-source` 是展示字段的 guard，防止用户 hook 覆盖权威集成的呈现；token patch 不受 guard 影响，由 reporter 自己负责清理或 TTL 刷新。
- 文本归一化：去控制字符、80 字符上限；token 名 1–32 位 ASCII 字母/数字/`_`/`-`，单 pane/workspace 最多 32 个 token。

### 工程细节：官方参考实现怎么写的

Prime Agent 内置 reporter 与 Herdr 安装的 OMP extension 是同一套模式，以下约束都来自其源码，建议自研 reporter 全部满足：

1. **单调 seq 跨实例**：`reportSeq` 用 `Date.now() * 1000` 起步，`nextReportSeq()` 保证严格递增。Herdr 丢弃同一 source 的低序号上报；若 reload/新 session 后序号回退，后续 `idle` 会被静默丢弃，pane 卡在 `working`。
2. **单飞行队列**：状态先写 `queuedState`（覆盖式，天然去抖），一次只 drain 一个请求，避免乱序与并发写 socket。
3. **release 时序**：release 前停止新上报、清空队列、await 在飞请求，然后才发 `pane.release_agent`；release 后置 `released=true` 拒绝迟到上报（迟到的 report 会重新认领 pane，留下一个已经退出的 agent）。
4. **只在真退出时 release**：Prime Agent 的 `session_shutdown` 区分 `reason === "quit"`——session 切换/new/resume 时接任实例会立刻重新上报，此时 release 会和新上报竞争并可能把 pane 清空；非 quit 只静默本实例。
5. **超时与失败**：socket 500ms 超时；OMP 版失败后重试一次 1500ms；timer `unref()`；请求 id 用日期加随机串。
6. **状态去重**：只在与上一状态或 message 不同时才上报（对比 `lastState`/`lastMessage`），但 session 启动时强制发一次。
7. **blocked 引用计数**：审批、ask 等多个来源的阻塞用计数管理，最后一个解除才回到非 blocked。
8. **retry grace**：provider error 结束后先保持 `working` 一段时间（默认 2500ms）；期间自动重试开始则继续 working，否则落到 `blocked` 并带错误 message。idle 落定前有一次 debounce（默认 250ms），避免“排队消息立刻开始下一轮”时 done→working 闪烁。
9. **root session 门控**：OMP 用 `ctx.hasUI === true` 只让交互主会话驱动 pane 状态；Prime Agent 用 sessionManager 绑定第一个（父）会话，忽略 subagent/子会话事件，避免子任务翻转父 pane。
10. **Windows**：`\\\\.\\pipe\\` 命名管道映射（Prime Agent 有 `herdrSocketTarget()`；OMP 内联同样转换）。
11. **会话引用优先级**：先绝对路径 `agent_session_path`，再 `agent_session_id`。

## 参考实现解剖

### Prime Agent 内置 Herdr reporter

源码：https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/src/core/extensions/builtin/herdr-agent-state.ts

它是 `herdr integration install pi` 所写 file-based extension 的“in-tree 等价物”，内置加载即可让 Prime Agent 在 Herdr 里开箱可用，无需手装。值得注意的设计：

- 注释说明它故意与 file-based 版共用 `herdr:pi` source，并在检测到 file-based extension 实际被加载时让位（`hasFileBasedHerdrIntegration` 检查 loaded paths 而非磁盘存在性），避免两个 reporter 在同一 pane 上用同一 source 竞争。
- factory 在每次 session load 时被调用，处于 daemon 的 client-env 窗口内，因此 env（pane 身份）逐 session 捕获，而不是进程启动时固化——对 daemon/多会话架构很关键。
- 事件映射：`session_start` 捕获 session ref、按 `isIdle()` 播种状态并强发；`agent_start` → `working`；`agent_end` 有排队消息则 debounce 后 idle，否则立即 idle；provider error → retry grace hold；扩展事件总线上的 `herdr:blocked`（审批 UI 等）→ `blocked` 加 message，计数解除。
- `session_shutdown` 只有 `reason === "quit"` 才 `releaseAgent()`。

### Herdr 安装的 OMP extension（官方 lifecycle authority 样例）

本机文件：`~/.omp/agent/extensions/herdr-omp-agent-state.ts`（头部注释 `installed by herdr`、`HERDR_INTEGRATION_VERSION=9`）。要点：

- guard：`HERDR_ENV === "1" && HERDR_SOCKET_PATH && HERDR_PANE_ID`；source `herdr:omp`、agent label `omp`。
- 状态映射：`agent_start` → working；`agent_end`（跳过 `willContinue`）→ 可重试错误 hold，否则 250ms debounce 后 idle；`tool_approval_requested/resolved`、`ask` 工具 start/end → blocked 计数；`session_switch` 重新上报 session ref。
- `pane.report_agent_session` 携带 `session_start_source`（startup/resume/...）。
- 请求串行队列加 500/1500ms 两次尝试；`rootSession` 门控 `ctx.hasUI === true`。

两者证明：**内置 agent 与第三方自定义集成使用完全相同的协议**——区别只在 source 命名空间（官方 `herdr:<name>` vs 自定义 `custom:<name>`）以及 Herdr 二进制对它们的启动/恢复知识。

## 控制面：被 Herdr 与其他 agent 驱动

接入后 agent 会暴露在 Herdr 控制面上（语义来自 agent-automation.mdx 与本机 help）：

- `herdr agent prompt <target> <text>`：读取 pane 当前的 bracketed-paste 模式，把文本与“编码后的 Enter”一次有序提交。`blocked` 的 agent 被直接拒绝（`agent_blocked`），不发输入。`--wait` 是状态等待：从非 working 提交后 5 秒内必须观察到状态变化（否则 `agent_prompt_stalled`），随后等待第一个 settled `idle`/`done`/`blocked`。
- `--until` 可重复（如 `--until idle --until done`）；`done` 表示已完成且未查看。
- `herdr agent send-keys`：逻辑按键序列（`esc`、`enter`、`ctrl+c` 等），先整体校验再写字节。
- `herdr pane run` / `send-text`：普通终端输入，文本加 Enter 原子提交，不经过 agent 语义。
- `herdr agent read`：对 alternate-screen 的 agent 有自动翻页读取，但只在 idle 且被识别时；非 idle 用 `--lines` 会返回 `agent_not_idle`。
- 等待：`herdr agent wait <target> --until working|idle|blocked|done|unknown`。

对自定义 TUI agent 的输入侧要求：必须正确解析 bracketed paste（`\x1b[200~`/`\x1b[201~`），paste-end 后的 Enter 走提交路径；否则 `agent prompt` 只会把文本打进缓冲区。还要注意当界面处于审批/搜索/settings overlay 时，注入的 paste 会落进对应组件而不是 composer——Herdr 无法替你判断当前界面。

`[herdr-msg reply-to:… task:…]` 头是本机 herdr skill 的轻量约定（不是 Herdr 0.9.0 内置 skill 内容，传输仍靠 `pane run`），属于技能层协议；要实现 agent 间对话语义，agent 需在提交前识别该 header。

## 官方 integration 机制（路径 B 的参照）

`herdr integration install <target>` 的动作是往目标 agent 的配置目录写 hook/plugin 文件并做最小配置修改（integrations.mdx 各节）：

- OMP：写 `~/.omp/agent/extensions/herdr-omp-agent-state.ts`（本机 v9）。
- Pi：写 `~/.pi/agent/extensions/herdr-agent-state.ts`（本机 v8）。
- OpenCode：写 `~/.config/opencode/plugins/herdr-agent-state.js`（本机 v11）。
- Claude Code：写 `hooks/herdr-agent-state.sh` 并更新 `settings.json`。
- Codex：写 hook、更新 `hooks.json`，确保 `[features] hooks = true`。
- 其余 target 各有自己的文件与配置位置；uninstall 只删除 Herdr 自己的文件或条目。

0.9.0 的 `herdr agent start --kind` 与 `herdr integration install` target 列表都是二进制固定的（本机实测 kind：`pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode, opencode, copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, qwen, maki, muse`），所以“新 agent 加入官方列表”必须上游发版。Prime Agent 的做法——把等价 reporter 直接内置在 agent 仓库、随 agent 分发——是自定义 agent 的标准分发方式，omdsh 应照此办理。

## 双向：agent 控制 Herdr 是另一件事

以上都是“agent 被 Herdr 管理/观测”。反向能力（agent 操作 Herdr：split pane、跑命令、读输出、等兄弟 agent）由 Herdr 的 agent skill 提供：`herdr --skill` 打印与二进制版本匹配的 skill 文件，`npx skills add herdrdev/herdr --skill herdr -g` 可安装；skill 开头守卫要求 `HERDR_ENV=1` 才允许控制。该方向与 lifecycle 上报正交，可后置（omdsh 作为 orchestrator 驱动兄弟 agent 时才需要）。

## omdsh 现状与差距

Agent 层（本报告核心）：

| 接入面 | Herdr 契约 | omdsh 现状 | 证据 | 结论 |
| --- | --- | --- | --- | --- |
| 自定义 lifecycle 上报 | `pane report-agent` / `pane.report_agent` | 已实现 | runtime/herdr-agent.ts | 完成（P0） |
| 环境检测 | `HERDR_ENV=1` + pane id/socket | 已实现 | runtime/herdr-agent.ts `herdrEnvironment()` | 完成（P0） |
| release 时序 | 退出 `pane release-agent` | 已实现（dispose） | runtime/provider-local.ts `dispose()` | 完成（P0） |
| 会话身份 | `agent_session_id/path` | 已上报；0.9.0 接受但不暴露 | runtime/herdr-agent.ts `setSession()` | 前向兼容（P1） |
| 展示元数据 | `report-metadata` | 无 | 同上 | 可选（P2） |
| 注入提交 | bracketed paste + Enter | 已实现 paste 解析与提交 | provider-local.ts:512、1379-1395、1927-1929 | 基本可用，overlay 场景需测试 |
| 状态事件源 | `agent/status` + 人工 prompt | 已接入 `setStatus()`、`prompt()`、`#finishPrompt()` | provider-local.ts setStatus/prompt/#finishPrompt | 完成（P0） |
| 终端标题 | OSC 0/2 | 已写 OSC 2 会话标题 | provider-local.ts:807-811 | 可复用 |
| `agent start` / 自动 resume | 二进制内置 kind 与恢复知识 | 不适用 | `herdr agent start --help` | 上游依赖 |

终端层（完整证据与规则见下节与来源清单）：

| 接入面 | Herdr 契约 | omdsh 现状 | 结论 |
| --- | --- | --- | --- |
| profile 归类 | multiplexer 语义（保 scrollback、resize 合并） | Herdr 被误判为 `direct` | 缺失（P1） |
| ED3 scrollback | mux 内谨慎；顺序应 ED2→ED3 | Herdr 内开启且顺序 ED3→ED2 | 风险（P1） |
| DEC 2026 | Herdr 默认开启；DECRQM status 0 需豁免 | 无条件开启，无探测 | 已实现（加探测需豁免） |
| 内联图像 | Herdr 内不自动启用图像协议 | 无图像协议 | 无缺口（写策略即可） |
| 通知通道 | `herdr notification show`（OSC 9/99 被吞） | 仅 in-band OSC 9 | 缺失（P1） |

## 建议实现方案

### P0：Herdr lifecycle reporter（已实现）

目标：让 Herdr 把 omdsh 识别为状态可等待的一等 agent，走官方路径 C。本仓库已在 `Unreleased` 落地：

- `packages/tui/omdsh-tui/src/runtime/herdr-agent.ts`：`HerdrAgentStatusController`（纯投影，可单测）+ `HerdrAgentReporter`（`source: custom:omdsh`、`agent: omdsh`、seq、session 引用、release、raw socket 传输）+ `herdrEnvironment()`（`HERDR_ENV === '1'` 且 pane id 与 socket path 齐备才激活）+ `herdrSocketTarget()`（Windows 命名管道映射）。
- 状态信号选择：不复用 turn 事件，而是 `LocalTui.setStatus()`（DSH `agent/status` 的 running/idle；关闭 subagent inspector 时 session-controller 会用 root 状态重新同步一次）+ `prompt()` / `#finishPrompt()`（`blocked` 覆盖 `working`，message 用 prompt title）。`#inspected !== undefined` 期间忽略状态上报，避免被检查的子会话驱动 pane；关闭 inspector 后的重同步由 session-controller 的 `setStatus(root)` 调用完成（provider-local.spec 有对应契约测试）。
- 传输与容错：raw socket、newline JSON、500ms 超时、`unref()`、失败静默；`LocalTui` 默认注入 `env: {}` 的 inert reporter，只有插件入口 `apply()` 注入环境感知实例，因此任何测试或直接实例化都不会在 Herdr pane 内误报。
- release：`dispose()` 在 `#finishPrompt(null)` 之后发送 `pane.release_agent`，`released` 标志丢弃迟到上报；seq 用 `Date.now() * 1000` 起步并严格递增，跨 reporter 实例不回退。
- 测试：`herdr-agent.spec.ts`（检测边界、状态投影、去重、blocked 计数、seq、session、release、reload 单调）；`provider-local.spec.ts` 契约（status/prompt/session/dispose 的请求形状、inspector 隔离、无 Herdr 环境时完全 inert）。
- 真实 E2E（本机 0.9.0，独立 headless session + 真实 socket）：上报后 `herdr agent list` 出现 `"agent":"omdsh","agent_status":"blocked"`（审批打开时，含消息），`pane get` 显示 `agent:"omdsh"`；`release` 后该记录消失。
- CHANGELOG 已有对应 `Added` 条目。

风险与已知边界：`blocked` 判定保守（只有真实 prompt 才上报）；`agent_session_id` 在 0.9.0 被接受但不暴露、不恢复（见“会话身份上报”）；Herdr 内已有其他被识别 agent 的 pane 上，自定义上报不会覆盖该 agent 的身份（实测），omdsh 应在自己的 shell pane 中运行；崩溃路径的 release 依赖 `dispose()`，强杀进程仍可能遗留状态。

### P1：终端层完整性（首次调研结论，保留）

- `detectTerminalProfile()`（provider-local.ts）加入 Herdr：新增纯函数 `isInsideHerdr(env)`（`HERDR_ENV === '1'` 或任一 pane 身份变量）与 `isInsideTerminalMultiplexer(env)`（TMUX/STY/ZELLIJ + Herdr + TERM 前缀）。
- 通知路由：`#emitNotification()`（provider-local.ts）在 Herdr 内改走 `herdr notification show <title> --body <body> --sound <request|done|none>`；title 精确匹配 `help`/`--help`/`-h` 时替换为安全标题（避免位置参数触发用法输出）；`HERDR_PANE_ID` 用 `/^[0-9A-Za-z:_-]{1,64}$/u` 校验；spawn 失败或不在 Herdr 时回退现有 OSC 9；sound 映射：等待人工输入与错误 → `request`，正常完成 → `done`，其余 `none`。
- 渲染：Herdr 按 multiplexer profile 处理（resize debounce 合并、scrollback 保护）；ED3 若保留清除则改为 ED2→ED3 顺序，或直接关闭 `clearScrollback`；DEC 2026 若引入 DECRQM 探测必须实现 Herdr 豁免（status 0 保持开启，status 4 或无 status 关闭）；图像协议在 Herdr 内保持不自动启用。

终端层关键依据（oh-my-pi 只读参考）：Herdr 被归入 `isInsideTerminalMultiplexer()` 以保住原生 scrollback（terminal-multiplexer.ts:14-24）；Herdr pane 的 Ghostty VTE 实际支持 DEC 2026，DECRQM 报“未识别（status 0）”时必须保持开启，否则出现顶部冻结、底部刷新的撕裂（tui.ts:1105-1122）；Herdr 吞裸 OSC 9/99 且 bell 不标记后台 tab，通知必须走 `herdr notification show`，并在 pane id 缺失或 binary 不可用时回退（terminal-capabilities.ts:87-127）；Herdr 内不自动启用 Kitty 图像与 placeholder（terminal-capabilities.ts:573-578、kitty-graphics.ts:62-86）。

### P2：展示元数据与入站消息

- 把会话标题投到 `report-metadata --title`，可选 `summary` token（仅展示，不参与 waits/通知）。
- 识别 `[herdr-msg reply-to:… task:…]` header：投影为 notice 或结构化上下文，避免模型把协议头当普通指令；回复通过 `reply-to` pane 注入。
- 若上游未来支持新 kind：跟进 `agent start --kind` 与 native restore。

### 明确非目标

不修改 Herdr 配置或状态；不调用 `herdr integration install`（omdsh 不在 target 列表）；不为等待上游而阻塞 reporter（自带 reporter 是官方支持的路径）；不引入对 `refs/oh-my-pi` 的任何运行时或构建依赖；不为本调研新增服务层。

## 未验证与待确认

- 自定义 reporter 创建的 agent label 是否能立即被 `herdr agent prompt <label>` / `agent wait <label>` 解析。E2E 已确认 `agent list` 会创建并列出 `omdsh`，但没有实测对它执行 prompt/wait；建议用临时命名 session 验证。
- 自定义 authority 上报后，Herdr 是否对该 pane 完全停用 screen 检测回退（“不再回退”的表述在文档中针对已安装的内置 lifecycle 集成）。E2E 观察到已有被识别 agent 的 pane 不会被自定义上报覆盖身份，说明权威选择有额外规则。
- 自定义 source/label 不被 native restore 支持：0.9.0 接受 `agent_session_id` 但不暴露 `agent_session`、不恢复（官方版本表只有内置集成）。
- `ui.toast.delivery = off`（0.9.0 默认）下状态变化有多少用户可见信号（sidebar/attention 属 UI 内行为，需要真实 attached client 验证）。
- `notification show --sound` 与 `[ui.sound].enabled` 的交互。
- Herdr pane VTE 对 ED3 的确切语义与顺序敏感性（oh-my-pi 规则来自 tmux/终端族经验，未在 Herdr 内实测）。
- Prime Agent 用 `herdr:pi` 作为内置 reporter 的 source 是它自身的“让位”机制，不代表自定义集成应借用官方 source；新集成应使用 `custom:<name>`。

## 来源清单

网络一手资料：

- https://herdr.dev/llms.txt（Herdr stable 0.9.0 文档索引）
- https://herdr.dev/agent-guide.md（Herdr agent guide）
- https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/integrations.mdx（“Integrate your own agent”、官方集成逐项说明、custom status labels）
- https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/agents.mdx（状态权威、检测 manifest、HERDR_AGENT、blocked 语义）
- https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/socket-api.mdx（raw 方法、agent state reporting、seq、metadata、事件、socket 传输）
- https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/agent-automation.mdx（agent prompt/start/wait 语义）
- https://raw.githubusercontent.com/herdrdev/herdr/v0.9.0/docs/next/website/src/content/docs/cli-reference.mdx（CLI 与环境变量）
- https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/src/core/extensions/builtin/herdr-agent-state.ts（官方点名的真实案例，实现细节引自 raw 源码）
- https://github.com/herdrdev/herdr/blob/master/skills/herdr/SKILL.md（skill 文件，agent 控制 Herdr 方向）

本机 Herdr 0.9.0 实测（默认 session 只读检查；E2E 使用自建的独立命名 headless session，完成后已停止并清理）：

- `env | grep '^HERDR'`（环境契约）
- `herdr pane report-agent --help`、`herdr pane release-agent --help`、`herdr pane report-metadata --help`
- `herdr agent start --help`（kind 固定列表）、`herdr integration status`（各集成安装路径与版本）
- `herdr --help`、`herdr integration --help`、`herdr notification --help`
- E2E：`herdr --session omdsh-probe server` + `workspace create` + 用 `herdr-agent.ts` 的默认 socket 传输上报 `working`/`blocked`/`release`，随后 `agent list` / `pane get` 验证：出现 `"agent":"omdsh"`、`agent_status:"blocked"`，release 后记录消失；`agent_session_id` 被接受但 `agent_session` 不暴露。

Herdr 安装到本机 agent 的集成实现（只读参考）：

- `~/.omp/agent/extensions/herdr-omp-agent-state.ts`（v9，官方 lifecycle authority 样例）
- `~/.pi/agent/extensions/herdr-agent-state.ts`（v8）
- `~/.config/opencode/plugins/herdr-agent-state.js`（v11）

omdsh 当前工作树与 oh-my-pi 只读参考（行号以实现落地时的 revision 为准；终端层证据沿用首次调研）：

- packages/tui/omdsh-tui/src/runtime/herdr-agent.ts、herdr-agent.spec.ts（P0 reporter 与契约测试）
- packages/tui/omdsh-tui/src/runtime/provider-local.ts（status/prompt/session/dispose 接线与 profile 检测）
- packages/tui/omdsh-tui/src/runtime/terminal-notifications.ts
- packages/tui/omdsh-tui/src/chrome/main-screen-renderer.ts
- packages/tui/omdsh-tui/src/session/session-controller.ts
- refs/oh-my-pi/packages/tui/src/terminal-multiplexer.ts:1-24；terminal-capabilities.ts:79-127、342-396、550-580；tui.ts:1105-1122；CHANGELOG.md:9、36、43、298；test/herdr-sync-output.test.ts:38-117
