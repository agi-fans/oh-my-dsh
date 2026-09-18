# DSH 0.1.6-alpha.1 → 0.1.6-alpha.2 升级记录

模式：**Harness cohort migration**。走廊跨 887 个上游 commit、2622 个文件，但绝大多数落在 web/desktop 客户端与 release 提交的版本串替换；对 omdsh 有契约意义的源码变更只有约 25 个包，全部由组合行、公开导出与默认配置解释。上游发布：`dsh-v0.1.6-alpha.2`（2026-09-17，prerelease；npm dist-tag `alpha`，tag `ddefc45fbc` 即上游 master HEAD）。

## 基线与目标

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort | `0.1.6-alpha.1` | `0.1.6-alpha.2` |
| 直接依赖 | `apps/omdsh` 114 项 + `packages/tui/omdsh-tui` 34 项 + 根 devDependency `dsh-llm-mock-server` + `examples/hello` 的 peer `dsh-commands` | 纯版本替换，无包改名 |
| 基础层 | Cordis `4.0.2`、cordis-plugin-loader `1.0.3`、cordis-plugin-timer `1.1.4`、Schemastery `3.18.2` | 全部不变 |
| 解析图规模 | lock 中 1754 条 `0.1.6-alpha.1` | 1807 条 `0.1.6-alpha.2`，`0.1.6-alpha.1` 0 条 |
| 新增传递依赖 | — | `dsh-lazy-require`（`subprocess-local`/`attachment-local` 的原生依赖懒加载，随包自动进入） |
| 产品源码改动 | — | `cordis` preset 人设与描述改只读表述；`at-complete.ts` 会话候选消费 `displayTitle` |

`refs/deepseek-harness` 检出到 `dsh-v0.1.6-alpha.2`（`ddefc45fbc`）。迁移发生在未提交工作区之上：`dsh-0.1.6-adaptation-plan.md` 的 A1/A2/A3/B/C 批次改动先于本批存在于工作区，本批在其上叠加，全部 pin 含该批新增的 4 个依赖。

## 走廊范围

| 上游变更 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- |
| `dsh-tool-subagent` 的 `maxDepth` 不再默认 `3`，未配置时读 host `subagent` 设置（默认 `1`） | spawn/fork 两个 tool 行均未显式设置，委托深度从 3 收紧到 1：子代理默认不能再委托 | **跟随上游**，不钉回 3；需要不同限制的部署改 `subagent` 设置段 |
| `dsh-subagent` 新增 `Config`：`maxActiveSubagents`（默认 8）、`maxDepth`（默认 1） | 持续子代理激活数上限，超限抛 `ACTIVATION_LIMIT_REACHED`，冷 resume 满员时拒绝激活 | 跟随上游默认 8；两项均进 `subagent` 设置段可调 |
| `dsh-tool-cordis` 改为只读 API 发现：`cordis_define`/`cordis_run`/`cordis_stop`/`cordis_undefine` 移除，只剩 `cordis_inspect_list`/`cordis_inspect_query`；动态包管理移交新包 `dsh-plugin-manager` | 自带 `cordis` preset 挂载 `tool-cordis`，人设文案仍承诺"experiment/mutate runtime" | persona 与 preset 描述改为只读检查语义，与上游新 preset 口径一致 |
| 默认 DeepSeek 目录删除 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`，剩 `deepseek-flash`（V41）与 `deepseek-v4-pro` | 产品默认 `deepseek-flash` 不受影响；文档引用过时 | `precise-context.md` 双语移除 vision-exp；CHANGELOG 说明 |
| `session-reference` 候选新增可选 `displayTitle`（subagent 持久创建 label 优先，上游 `remoteExportCandidates` 已按此取标签） | TUI `@` 菜单用 `candidate.label` | `at-complete.ts` 改用 `displayTitle ?? label`，与上游一致 |
| `agent-loop` 的 inbox 投影从 `ReactLoopInbox` 构造期移到 `AgentLoop` 服务级注册 | 冷会话也可读 inbox，纯收益 | 无 |
| `user-questions` 的 approve intent 加可选 `callId`（plan-review 关联工具调用）；`llm` 的 `LlmDiscoveredModel` 加可选 `inputModalities`；`tool-fs` 的 `FsDiffMeta`/`presentationMeta` 加可选 `operation: create\|update` | 全部增量字段 | 无（`operation` 只存在于不透明 meta，typed `DiffResultView` 不含，TUI 无可消费面） |
| `sandbox` 的 `approveEscalation`：重复当前模式免审批直接放行（原报错），更窄仍 fail closed | 模型重试语义微调 | 无，CHANGELOG 说明 |
| `attachment-local`/`subprocess-local`：`sharp`、`node-pty`、`koffi` 经新包 `dsh-lazy-require` 懒加载 | 启动延迟与原生依赖失败处理改善 | 无 |
| `terminal-bash`/`subprocess`：启动清理顺序、shell 活动追踪、Windows 隐藏窗口 | 内部运行时改进 | 无 |
| `llm-pi-ai` 改用 pi-ai 窄入口 | 内部重构 | 无 |
| `app-boot`：`Profile.patchReload`/`ProfilePatchReload`/`DEFAULT_PROFILE_PATCH_RELOAD` 移除，`initProfile` 少第三参，`loadProfile`/`sanitizeProfile`/`inactiveEntries` 签名调整 | 产品用 `initProfile(dir, [BUNDLE])` 两参、`healProfilesModuleFallback`、未读 `patchReload` | 无（`pnpm typecheck` 0 errors 证实） |
| `apps/cli` resolution mode 默认 runtime（`runProfile` 路径） | 产品走 `boot()` + `healProfilesModuleFallback` 链接路径，不经 `runProfile` | 无 |
| `session` 的 `KNOWN_SESSION_EVENT_TYPES` 加 `workspace/changes`；新包 `dsh-workspace-changes` 挂上游 web-app 组合 | web-only，格式仍 v3 | 无 |
| 新包 `dsh-plugin-manager`/`dsh-hmr`（替代 `cordis-plugin-hmr`）/`dsh-hook-protocol`/`dsh-schedule`/`dsh-message-feedback` | 上游 base 新增行但均需 `profileContext`（由 `dsh` launcher 提供）而默认禁用；omdsh 直调 `boot()` 不提供 | 不挂载——上游对我们这类宿主本就禁用；`omdsh plugin` CLI 继续是管理路径 |
| `tool-present` 源码从 `packages/fs/` 搬到 `packages/deliverables/` | 发布名与导出不变 | 无 |
| Web/桌面/API/SSH/experimental 等约 2600 文件 | omdsh 不消费 | 无 |

## 适配清单

| 文件 | 改动 |
| --- | --- |
| `apps/omdsh/package.json` | 114 处 pin → `0.1.6-alpha.2`（含工作区未提交批次新增的 `dsh-agent-tool-presentation`/`dsh-command-feedback`/`dsh-mcp-resources`/`dsh-web-search-deepseek`） |
| `packages/tui/omdsh-tui/package.json` | 34 处 pin → `0.1.6-alpha.2` |
| `package.json`（根） | devDependency `dsh-llm-mock-server` → `0.1.6-alpha.2` |
| `examples/hello/package.json` | peer `dsh-commands` → `0.1.6-alpha.2` |
| `pnpm-workspace.yaml` | `minimumReleaseAgeExclude` 全部换新版本；pnpm 自动补登 `dsh-lazy-require` 等 8 个新传递包条目 |
| `pnpm-lock.yaml` | 重生成，单一 cohort（1807 条 `0.1.6-alpha.2`） |
| `apps/omdsh/config/agent-presets/cordis/agent.cordis.yml` | persona 改为只读检查语义（`cordis_inspect_list`/`cordis_inspect_query`，"tools are read-only"），删除"runtime mutation"承诺 |
| `apps/omdsh/config/agent-presets/cordis/preset.yml` | 描述由"plugin experimentation"改为"read-only runtime inspection" |
| `packages/tui/omdsh-tui/src/views/at-complete.ts` | `SessionMentionCandidate` 加 `displayTitle?: string`；`sessionItems` 的 mention 与标签改用 `displayTitle ?? label`（对齐上游 `remoteExportCandidates`） |
| `apps/omdsh/src/persistence-cross-version.spec.ts` | 注释中的目标 cohort 改为 `0.1.6-alpha.2`（会话格式仍是 v3） |
| `apps/site/content/{en,zh}/tutorials/write-a-plugin.md` | peer 示例版本同步（双语） |
| `apps/site/content/{en,zh}/tutorials/precise-context.md` | 移除已删模型 `deepseek-v4-flash-vision-exp`（双语） |
| `CHANGELOG.md` | `Unreleased` 记录 cohort、委托深度/上限收紧、模型目录收缩、cordis 工具只读、`displayTitle` mention、沙箱重试语义 |
| `refs/deepseek-harness` | 子模块指针 → `dsh-v0.1.6-alpha.2`（`ddefc45fbc`） |

## 验证结果

全部在 `/Users/dy/Workspace/dsh-tui`，基线（脏工作区、`0.1.6-alpha.1`）先验证 `typecheck` 与 4 个关键 spec 全绿后再替换：

| 检查 | 结果 |
| --- | --- |
| `pnpm install` | 19.4 s；lock 中 `0.1.6-alpha.2` 1807 条、`0.1.6-alpha.1` 0 条 |
| `pnpm typecheck` | 通过（tui、apps/omdsh、site 0 errors——走廊内所有公开 API 变化对我们消费的签名均为增量） |
| `pnpm test` | `omdsh-tui` 881/881、`apps/omdsh` 113/113、site 13/13 |
| `pnpm build` | 通过 |
| `pnpm check:boundaries` / `pnpm check:md` | 通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS` |
| `pnpm smoke` | `PTY_SMOKE_PASS exit=0` |
| `pnpm smoke:interrupt` | `STREAM_INTERRUPT_SMOKE_PASS latency=144ms` |
| `git diff --check` | 干净 |
| refs 审计 | `check:boundaries` 绿；三个子模块 status 均干净；无 `link:refs` 依赖引用 |

## 决策记录

- **D16 · 委托深度跟随上游**：两行 `tool-subagent` 不显式设 `maxDepth`，接受 host 默认 1（子代理默认不再委托）。理由：上游把默认值当作产品与安全的共同决策，omdsh 无差异化理由；需要恢复多层委托的部署在自家 overlay 的 `subagent` 设置段调 `maxDepth`。
- **D17 · `plugin-manager`/`dsh-hmr` 不挂载**：上游 base 对无 `profileContext` 的宿主本就禁用这两行；omdsh 的插件管理入口是 `omdsh plugin`（pnpm 转发器 + `dsh.profile.bundles` 对账），语义不同源。
- **D18 · `cordis` preset 收窄为只读检查 preset**：不引入 `plugin-manager` 行也不伪造 mutation 能力；人设只描述 inspect 工具与"改组合文件"的路径，与上游新 preset 口径一致。

## 遗留风险

- 委托深度 3→1 与并发上限 8 是真实行为收紧：依赖多层子代理的会话会碰到 `ACTIVATION_LIMIT_REACHED` 或深度拒绝；已在 CHANGELOG 写明调节路径（`subagent` 设置段）。
- 用户 settings 里保存的被删模型 id（`deepseek-v4-flash` 等）不再出现在 `/model`；目录是建议性的，按 id 请求是否仍可用取决于网关。
- keyless 用例与 smoke 继续 pin `protocol: chat-completions`（mock server 未变），同上一轮遗留一致。
- `dsh-alpha3-sessions` 夹具内嵌 `deepseek-v4-flash` 历史 id：仅为回放数据，`persistence-cross-version.spec.ts` 已验证通过。
