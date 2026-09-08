# 上游能力适配差距与落地计划（dsh 0.1.3-alpha.2）

## 目标与范围

本方案处理一次审计的结论：omdsh 的 DeepSeek Harness 依赖队列**没有版本落后**——`refs/deepseek-harness` 与全部 `@deepseek-ai/dsh-*` 都停在 `dsh-v0.1.3-alpha.2`，npm 上 `@deepseek-ai/dsh-agent` 的最新发布同样是 `0.1.3-alpha.2`（2026-09-07）。真正的差距是：**同一个 cohort 里上游已经发布、omdsh 还没有消费的能力与界面语义**。所以本次不升级任何版本，只补适配。

| 项目 | 基线 |
| --- | --- |
| DSH cohort | `0.1.3-alpha.2`（`apps/omdsh` 89 个 dsh 直接依赖 + `packages/tui/omdsh-tui` 31 个，另有 devDependency `dsh-scope`） |
| Harness source tag | `dsh-v0.1.3-alpha.2`（refs 已在该标签，无需改动） |
| 产品源码改动 | `apps/omdsh/config/cordis.yml`、`apps/omdsh/config/agent-presets/*`、`apps/omdsh/package.json`、`pnpm-workspace.yaml`、按批次新增的 TUI 呈现与测试文件 |
| 交付方式 | 三批：P0 正确性与安全 → P1 能力面 → P2 呈现层。每批独立可验证、可回退 |
| 明确非目标 | 其它宿主形态（`dsh-api-*`、`dsh-host-*`、`dsh-client-*`、`dsh-web-app`、`dsh-sdk-*`、`dsh-acp*`、`dsh-headless`、`dsh-e2b`、`dsh-typert-*`）；DeepSeek 服务端字段（`dsh-session-log-deepseek`、`dsh-plugin-package-inventory-deepseek`、`dsh-deepseek-llm-api-extensions`，属隐私与产品决策）；`dsh-session-telemetry-otel`（可选导出）；`cordis-plugin-hmr`（开发期） |

## 判断方法

结论由三条可复现的比对得出，任何后续复核都可以重跑：

```sh
# 1. 产品组合行 vs 上游 base bundle 行
grep -oE "name: *'[^']+'" apps/omdsh/config/cordis.yml | sed "s/name: *'//; s/'//" | sort -u > /tmp/omdsh-rows.txt
grep -oE "name: *'[^']+'" refs/deepseek-harness/packages/bundle/base/cordis.patch.yml | sed "s/name: *'//; s/'//" | sort -u > /tmp/base-rows.txt
comm -13 /tmp/omdsh-rows.txt /tmp/base-rows.txt

# 2. 上游 preset 行 vs 我们的 preset 行（上游 standard/ptc/minimal 是分层组合的参考实现）
for f in refs/deepseek-harness/packages/preset/agent-presets/presets/*/agent.cordis.yml; do
  echo "== $f"; grep -oE "name: *'[^']+'" "$f" | sed "s/name: *'//; s/'//" | tr '\n' ' '; echo
done

# 3. 依赖集合差：上游 258 个包 vs 我们的直接依赖
grep -hoE '"@deepseek-ai/[a-z0-9-]+"' apps/omdsh/package.json packages/tui/omdsh-tui/package.json | tr -d '"' | sort -u
```

"未挂载"不等于"必须适配"：上面第 3 条会给出 181 个包，其中大部分属于非目标宿主形态或纯库依赖。下面的清单只保留**对 TUI coding agent 有用户可见或模型可见影响**的项，并给出证据与动作。

## P0 — 正确性与安全

| 项 | 上游包 | 现状与证据 | 落地动作 | 验证 |
| --- | --- | --- | --- | --- |
| 文件写入未受沙箱约束 | `@deepseek-ai/dsh-fs-sandbox` | `cordis.yml:136-137` 挂的是 `dsh-fs-local`；上游 base `cordis.patch.yml:477-480` 挂 `dsh-fs-sandbox`。`dsh-fs` seam 的 `get sandboxMode() {}` 对裸 backend 返回 `undefined`，而 `dsh-tool-fs` 的 `FsSandboxController` 只在 `sandboxMode !== undefined` 时才广告 `sandbox_permissions` 并走审批——因此 bash 被 `bash-sandbox` 关住，`write`/`edit` 没有 | 把 `fs` 行的 `name` 换成 `@deepseek-ai/dsh-fs-sandbox`（`fs-local` 仍是它的实现依赖，`sandbox-policy` 已在位），`id` 保持 `fs` 以免用户 `cordis.patch.yml` 失效 | 新增组合级回归测试：从 `loadBootPatches()` 读实际行 → 动态 import → 断言 `ctx.fs.sandboxMode` 有值、`workspace-write` 下工作区内写成功且越界写抛 `FS_SANDBOX_DENIED`、`read-only` 下工作区内写与编辑同样被拒 |
| 压缩前不裁剪工具结果 | `@deepseek-ai/dsh-compaction-tool-result-pruner` | 未挂；上游 base 与 standard/ptc/cordis 三个 preset 全挂。默认 `thresholdChars: 8192` / `headChars: 4096` / `tailChars: 1024`，只在压缩触发时裁剪，完整原文仍留在 session log | 在 `token-meter` 之后、`compaction` 之前插入一行（上游要求这个顺序），配置按上游 base 显式钉住 8192/4096/1024 | 现有 `pnpm test` + 一次真实长会话人工确认；TUI 转录读日志，不受裁剪影响 |
| 无重复调用与超时兜底 | `@deepseek-ai/dsh-repeat-tool-reminder`、`@deepseek-ai/dsh-tool-call-timeout-policy` | 两者都在上游 base 默认开启；我们未挂 | 各加一行：timeout 策略零配置（上限取各工具自身配置），reminder 按上游 base 钉住 `thresholds: [3, 5, 8]` 与 `argumentsPreviewChars: 500` | `pnpm test`；模型可见行为写入 CHANGELOG `Added` |
| shell 超时与上游不同 | `@deepseek-ai/dsh-bash-sandbox` | 我们的 `bash` 行无配置，继承 `bash-local` 的 120s 默认；上游 base 显式写 `timeoutMs: 60000` | **不采纳上游值**：60s 会打断常规的 build / test 套件（本仓 `pnpm test` 单个包已 33s）。改为显式钉住 `timeoutMs: 120000` 并注释原因，模型仍可按调用传 `timeoutMs` 或改用后台任务 | 行为与改动前一致，不需要新测试；差异记在决策点 D5 |

`fs-sandbox` 是本次唯一按缺陷处理的项：它把 `/permission` 的 Read only / Workspace write 从"只约束 shell"变成"约束文件工具"，作为 bug fix 记入 CHANGELOG 的 `Fixed`（不需要额外的 `Changed` 条目：修复本身就是行为变化的全部）。

## P1 — 能力面（模型与用户可见）

| 能力 | 上游包 | 现状 | 落地动作 |
| --- | --- | --- | --- |
| 联网抓取（**已落地**） | `dsh-web`、`dsh-web-fetch-http`、`dsh-tool-web` | 未挂；TUI 已有 `web` 卡片渲染器（`chrome/tool-renderers.ts:230`）但没有生产者 | 已挂 seam + 匿名 fetch + `tool-web`（`search: false`）。search 默认不开，理由见 D8 |
| Workflow 与 Ralph | `dsh-workflow`、`dsh-workflow-worker-thread`、`dsh-tool-workflow`、`dsh-tool-ralph` | 未挂；注意 TUI 的 `/workflow` 是"Default/Plan 工作流"选择器，与上游 workflow 工具无关 | 挂 worker-thread 引擎 + 两个工具；`tool-ralph` 需 `subagentProvider` 配置 |
| 子代理 fork（**已落地**） | `dsh-subagent-fork-in-process` + `tool-subagent` 的 `provider: fork` 行 | 只挂了 `spawn` | 已加 provider 行与 `subagent_fork` 工具行（continuable，不设 modelSelectionSettings）；TUI roster 与 `subagent_` 前缀渲染直接可用 |
| 超大工具输出落盘（**已落地**） | `dsh-spill-local`、`dsh-spill-policy` | 未挂；上游 base 默认挂 | 已挂两行；`maxInlineBytes` 必须显式给（省略即 no-op），取 200000 见 D7 |
| Windows 支持 | `dsh-pwsh-local`、`dsh-pwsh-sandbox`、`dsh-tool-pwsh`、`dsh-tool-pwsh-persistent` | 未挂；上游用 `process.platform` 门控，omdsh 在 Windows 上没有 shell 工具 | **待产品决策**，理由见下（需要 CI + Windows PTY smoke 才能算做完） |
| 代码智能 | `dsh-lsp`、`dsh-lsp-stdio`、`dsh-tool-lsp` | 未挂 | 按语言服务器配置挂载；需要用户侧 server 路径配置 |
| Hooks 复用 | `dsh-hook-protocol`、`dsh-hooks-claude-code`、`dsh-hooks-codex` | 未挂 | 先挂 protocol + claude-code bridge，按需扩 codex |
| 定时提醒 | `dsh-schedule` | 未挂；TUI 的 `/loop` 是进程内 prompt 循环，不是持久化提醒 | 挂 schedule 服务；呈现层留到 P2 |
| 反馈 | `dsh-message-feedback`、`dsh-command-feedback` | 未挂；TUI 无 `/feedback` | 挂两行即可让 `/feedback` 走通用命令输出 |
| 模型侧会话检索 | `dsh-tool-session-query` | 未挂；人类有 `/sessions` 与 `@session`，模型不能查历史 | **不做**，理由见下（`openAt: never` 阻塞 + 每请求 5 个 schema 的成本） |
| 时间与 tmux 上下文 | `dsh-time-context`、`dsh-tmux-context` | 未挂 | 两行，opt-in 语义按上游 |
| LLM 会话标题 | `dsh-session-title-first-prompt-llm` | 只挂启发式 `dsh-session-title`（`cordis.yml:37-42`） | 在 title 行旁挂 LLM provider；注意额外一次模型调用 |
| 内置技能 | `dsh-skill-badge` | 未挂 | 一行 |

## P2 — 呈现层（上游已挂载，界面未适配）

| 项 | 证据 | 落地动作 |
| --- | --- | --- |
| Goal 无界面（**已落地**） | `dsh-goal` 已挂载并注册 `goal` 投影，但 `session-controller.ts` 原先只消费 `plan`/`permissions`/`contextPressure`/`tokenUsage`/`contextBreakdown` | 已加 `chrome/goal-bar.ts`，读 `goal` 投影渲染在 composer 上方；`goal` 加入投影变更订阅 |
| 后台任务无界面（**已落地**） | TUI 源码 grep `jobs` 零命中，而 `dsh-jobs-local` + `dsh-tool-jobs` 已挂载 | 已加 `/jobs`、`/jobs kill <id>` 与非 subagent 后台任务的完成通知；输出仍归模型（registry 的 read 游标是消费式） |
| 自动压缩不可见（**已落地**） | `event-views.ts` 原先只在 `command/run` 且 name 为 `compact` 时显示 `compacting`；`compaction/*` 只在 `trajectory.ts` 呈现 | 已消费 `compaction/start`/`summary`/`end`/`prune`：自动压缩与 `/compact` 共用一套状态，结束时记一行 `Context compacted · N events · N tokens condensed`；模型无关的 prune 单独记 `Context trimmed · N results`，同一轮里被后续 summary 取代而不叠加；失败路径报错 |
| PTC 子调用不可见 | `event-views.ts` 只处理 `tool/call`/`tool/result`；`tool/code-dispatch(-start)` 只在 `trajectory.ts:263-277` | **不做**，理由见下 |
| 无插件清单 | TUI 命令集合没有 `/plugins`，但挂了 `dsh-cordis-host-runner` 与 `tool-cordis` | **不做**，理由见下 |
| 次要 | `sandboxMode` 投影未消费；`session/title` 变更不实时反映 | 暂不处理 |

## 依赖与仓库配置变更

每个新挂载的上游包都要同步四处，缺一处 `pnpm install` 就会被 release-age 门或 lockfile 校验拦住：

- `apps/omdsh/package.json`：新增精确版本依赖（`0.1.3-alpha.2`），保持单 cohort。
- `pnpm-workspace.yaml`：`minimumReleaseAgeExclude` 增补同版本条目（现有 109 条 dsh 条目的风格）。
- `pnpm-lock.yaml`：由 `pnpm install` 重新生成，审查 diff 只含新增包。
- 若新包带 install/build 脚本，还需在 `allowBuilds` 里显式放行或拒绝。

## 验证计划

批次 1（P0）在真实 worktree 上按完整验证集执行：

| 步骤 | 期望 |
| --- | --- |
| `pnpm install` | 通过；lockfile 只新增本批次包 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 通过，含新增的文件约束回归测试 |
| `pnpm build` | 通过 |
| `pnpm check:md` | 通过（含本文件与 CHANGELOG） |
| `pnpm smoke:happy` | 通过（`HAPPY_SMOKE_PASS status=0`） |
| `pnpm smoke` | 通过（组合变更影响启动路径） |
| `pnpm check:boundaries` | 通过 |
| `git diff --check` | 无输出 |
| refs 审计三命令（AGENTS.md） | 无 `refs/deepseek-harness` 依赖引用；三个 submodule clean |

批次 2、3 在此基础上按改动面追加：呈现层改动必须带纯渲染测试（`chrome/*.spec.ts` 风格），交互改动另跑 fake-TTY 契约测试。

实施批次 1 时发现 `pnpm check:boundaries` 在 `HEAD` 就已经失败（与本次改动无关）：`apps/omdsh/src/fixtures/dsh-alpha3-sessions/.../session.jsonl` 是捕获的真实会话，内嵌了当时上下文里的 `AGENTS.md` 全文，因此命中 `refs/deepseek-harness`。它是测试数据而不是产品配置，所以 `scripts/check-boundaries.mjs` 与 AGENTS.md 的审计命令都排除了 `apps/omdsh/src/fixtures/**`。这是修边界检查的误报，不是放宽规则：产品源码、组合、lockfile 仍在扫描范围内。

## 决策点

- **D1 · `fs` 行 id 保持不变**：只换 `name`。用户已有的 `cordis.patch.yml` 以 `fs` 为目标，改 id 会静默失效。`fs-sandbox` 的 config 是 `fs-local` 的原样继承，现有配置继续有效。
- **D2 · 继续宿主层统一挂载**：上游把工具行下沉到 preset 分层（`presets/*/agent.cordis.yml`），omdsh 的 preset 只做 persona 与工具收窄，工具目录由宿主统一提供，TUI 再按 preset 映射 PTC 呈现（`session/session-configuration.ts:17`）。本方案不改变这个架构，避免把同一工具在四个 preset 里重复声明。
- **D3 · pruner 挂载顺序固定为 `token-meter` → pruner → `compaction`**：上游明确要求，顺序错误时 `compaction-basic` 读不到 `toolResultPrune`。
- **D4 · guards 与 pruner 显式钉住上游 base 的值**：`repeat-tool-reminder` 写 `thresholds: [3, 5, 8]`、`argumentsPreviewChars: 500`，pruner 写 8192/4096/1024，避免上游改默认值时静默改变 omdsh 行为。`tool-call-timeout-policy` 无可配项。
- **D5 · shell 超时保持 120s 并显式钉住**：上游 base 的 60s 对常规 build / test 太紧，本仓自身的 `pnpm test` 单包已需 33s；改为显式写 `timeoutMs: 120000`，模型仍可按调用传 `timeoutMs` 或走后台任务。这是与上游 base 的有意分歧，不是遗漏。
- **D6 · 本批次不发布**：版本号、tag、npm 发布留待发布决策，与上次 cohort 迁移一致。
- **D7 · spill 上限取 200 KB 而非上游的 50 KB**：spill 的替换发生在 `tools/post-execute`，被替换后的内容就是写进 session log 的 `tool/result`，所以转录里展开卡片看到的也是预览 + 路径，而不是完整输出。50 KB 会让普通的大文件读取也失去可展开的全文；200000 与 `tool-web` 的 `fetchMaxOutputChars` 默认值对齐，普通输出保持可展开，只有病态输出才落盘。
- **D8 · web search 默认关闭**：DeepSeek 原生 search 每次查询要跑一次完整模型 turn（上游文档明说延迟与 token 成本），Exa/Perplexity 需要独立 key 与账单。所以产品只挂匿名 `web_fetch`；要 search 的部署在自己的 overlay 里挂 provider 并把 `tool-web` 的 `search` 打开。

## 风险与回退

- **`fs-sandbox` 的行为变化**：工作区外的文件写入会从"静默成功"变成"结构化拒绝 + 一次经审批的加宽重试"。这是修复而非回归，但必须在 CHANGELOG 说明；`read-only` 模式下所有写入被拒，依赖写文件的自定义 preset 需要复核。
- **读取路径不受影响**：`fs-sandbox` 只拦截 `writeText`/`editText`，`dsh-agent-instructions`、`dsh-skill-filesystem`、`tool-fs-search` 的读取行为不变。
- **attachments 不走 `ctx.fs`**：`dsh-attachment-local` 用自己的 root 直接写文件，不受本次改动影响（已核对实现）。
- **pruner 影响模型可见内容**：裁剪后的工具结果进模型上下文，完整原文仍在 session log，`/trajectory` 与 `/export` 读日志不受影响。
- **回退**：每批次是独立的一组行 + manifest 条目，`git revert` 单个提交即可恢复；refs 指针不在回退范围。

## 实施清单

批次 1（P0）：

- [x] `apps/omdsh/package.json` 新增 `dsh-fs-sandbox`、`dsh-compaction-tool-result-pruner`、`dsh-repeat-tool-reminder`、`dsh-tool-call-timeout-policy`
- [x] `pnpm-workspace.yaml` 增补四条 age-gate 条目
- [x] `cordis.yml`：`fs` 行换 `fs-sandbox`；`token-meter` 后插 pruner；`compaction` 附近插两个 guard；`bash` 行显式钉住 `timeoutMs: 120000`（D5）
- [x] 新增组合级回归测试：`apps/omdsh/src/fs-confinement.spec.ts`（读实际组合行 → 挂载 → 断言拒绝/放行；已用"换回 `fs-local` 即失败"验证非空转）
- [x] `CHANGELOG.md`：`Fixed`（文件写入按 `/permission` 约束）、`Added`（工具结果裁剪与两个 guard）；bash 超时无行为变化，不设 `Changed` 条目
- [x] 完整验证集 + refs 审计（含 `scripts/check-boundaries.mjs` 的 fixture 误报修复）

批次 2（P1）已完成：web fetch、subagent fork、spill。

- [x] `dsh-web` + `dsh-web-fetch-http` + `dsh-tool-web`（`search: false`），并在真实 PTY 里断言 `/tools` 出现 `web_fetch`、不出现 `web_search`
- [x] `dsh-subagent-fork-in-process` provider 行 + `subagent_fork` 工具行（两个 `tool-subagent` 实例用不同 `toolName`）
- [x] `dsh-spill-local` + `dsh-spill-policy`（`maxInlineBytes: 200000`，D7），放在 pruner 之前
- [x] 组合级回归测试：`apps/omdsh/src/composition.spec.ts` 的 `upstream capability adaptation rows`
- [ ] 推迟项（含触发条件）：workflow/ralph、pwsh/Windows、LSP、hooks、schedule、feedback、session-query（受 `openAt: never` 阻塞）、time/tmux context、LLM 标题、skill-badge

批次 3（P2）已完成：

- [x] goal 投影 → composer 上方 GoalBar（`chrome/goal-bar.ts` + 投影映射 + 帧内布局 + 纯渲染测试）
- [x] `/jobs` 与完成通知（`commands/jobs.ts`、`session/job-notice.ts`，含命令、措辞与过滤测试）
- [x] 自动压缩状态与压缩记录（`event-views.ts` 的 `compaction/start`/`summary`/`end`/`prune` 折叠 + 3 条回归测试）

## 明确不做的项与理由

审计里剩下的项不是"还没排到"，而是**在当前证据下不该做**。写在这里，避免下次重新讨论：

- **PTC 子调用折叠**：默认 preset 是 `standard`（native 工具），`code`/PTC 是 opt-in；`/trajectory` 已能看全部派发。触发：把 PTC 设为默认，或出现明确的 PTC 使用诉求。
- **`/plugins` 运行时清单**：`omdsh --dump-config` 已经给出完整组合树，重复一遍没有新信息。触发：需要"当前进程实际激活状态"（而非配置树）的诊断场景。
- **`tool-session-query`**：两条独立理由。① 我们刻意把 `session-query-sqlite` 配成 `openAt: 'never'`，该配置下任何 search 调用在碰 sqlite 之前就抛 `SESSION_QUERY_SEARCH_DISABLED`；要启用就得改 `first-search`，第一次搜索会 import `node:sqlite` 并往 stderr 打 ExperimentalWarning。② 上游文档明说挂载它会给**每个请求**加 5 个工具 schema 和一段 guidance 段，而跨会话检索是小众能力。触发：Node 基线提升到 `node:sqlite` 稳定版本，且确有跨会话检索的诉求。
- **Windows（pwsh）**：这是剩余项里唯一有重大用户影响的一个——omdsh 在 Windows 上完全不可用（没有 shell 工具）。它不是几行配置，而是"平台门控行 + Windows CI + 一条 Windows PTY smoke"的小项目，因此**待产品决策**：若 Windows 在目标平台内就立项，若不在就写进文档明确排除。
