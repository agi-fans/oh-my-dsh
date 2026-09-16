# DSH 0.1.5-rc.2 → 0.1.6-alpha.1 升级记录

模式：**Harness cohort migration**。走廊跨 800 个上游 commit，是该仓库第一次跨宽走廊迁移；公开契约的变化仍可枚举，并被 `pnpm typecheck` 与真实 boot 用例完整覆盖。上游发布：`dsh-v0.1.6-alpha.1`（2026-09-15T04:57Z，prerelease；npm dist-tag `alpha`）。

## 基线与目标

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort | `0.1.5-rc.2` | `0.1.6-alpha.1` |
| 直接依赖 | `apps/omdsh` 103 项 + `packages/tui/omdsh-tui` 33 项 + 根 devDependency `dsh-llm-mock-server` + `examples/hello` 的 peer `dsh-commands` | 版本替换，另加 `dsh-compaction-image-offload` 一行 |
| 包改名 | `dsh-code-runtime-worker-thread`、`dsh-workflow-worker-thread` | `dsh-ptc-runtime-node`、`dsh-workflow-ptc` |
| 基础层 | Cordis `4.0.2`、cordis-plugin-loader `1.0.3`、cordis-plugin-timer `1.1.4`、Schemastery `3.18.2` | 全部不变（这 4 个包不在 DSH 发布线上） |
| 解析图规模 | lock 中 0 条 `0.1.6-alpha.1` | 1754 条 `0.1.6-alpha.1`，`0.1.5-rc.2` 0 条 |
| 产品源码改动 | — | 1 处类型改名、2 处组合行改名、2 处新增/关闭行、3 处 keyless 用例的协议设置段 |

`refs/deepseek-harness` 检出到 `dsh-v0.1.6-alpha.1`（`0a15e36e7f`）。该 tag 是 master 的祖先，落后 5 个未发布的 perf commit（`0d1f50007f` 等）；npm 上没有任何更新的发布，因此 refs 停在 tag 与 npm cohort 完全一致。

## 走廊范围

release notes 中影响 omdsh 的条目与处理：

| 上游变更 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- |
| PTC 包名与服务名统一为 `ptc-runtime` 系列，旧名不再兼容 | 组合里的 `code-runtime` 行失效 | 改名 `ptc-runtime` → `dsh-ptc-runtime-node` |
| 工作流执行器改为 `workflow-ptc`，暂不支持 Python PTC | `dsh-workflow-worker-thread` 不再发布 | 改名 `workflow-ptc` → `dsh-workflow-ptc`，保留 `provider: spawn` |
| DeepSeek 默认改用 Messages 协议，图片经 Files API 复用；自定义 API 地址需显式声明协议 | 官方根默认变为 `https://api.deepseek.com/anthropic`；keyless 用例的 mock server 只实现 chat-completions | 产品保持上游默认；`present-tool.spec.ts`、`happy-smoke.mjs`、`stream-interrupt-smoke.mjs` 在临时 `settings.yaml` 里设置 `llm-deepseek.protocol: chat-completions` |
| Ralph 默认不再启用 | omdsh 原先显式启用 | 跟随上游，`tool-ralph` 加 `disabled: true`，注释给出 overlay 恢复方式 |
| 新增 image offload 会话事件与 `dsh-compaction-image-offload` | 图片超预算的请求原先直接失败 | 挂载 `image-offload` 行，与上游 base 一致 |
| `agent/session-start` 改为异步串行的 `agent/created` | omdsh 不监听该事件 | 无 |
| 移除内置 E2B 执行后端 | 仓库内无 E2B 引用 | 无 |
| MCP 升级到官方 SDK v2 | `dsh-mcp-client` 的 `Config` 键逐项比对未变 | 无 |
| Web/桌面客户端功能（侧边栏终端、归档会话、Browser/Computer Use、Auto review 等） | omdsh 不依赖任何 `packages/client/*` 包 | 无 |

契约面的判定依据是"公开导出"而不是 commit 数量：`pnpm typecheck` 在替换依赖后只报一处类型改名，其余 800 个 commit 的产品面变化都可以用组合行与依赖图解释。

## 适配清单

| 文件 | 改动 |
| --- | --- |
| `apps/omdsh/package.json` | 103 处 pin → `0.1.6-alpha.1`；两处包改名；新增 `dsh-compaction-image-offload` |
| `packages/tui/omdsh-tui/package.json` | 33 处 pin → `0.1.6-alpha.1` |
| `package.json`（根） | devDependency `dsh-llm-mock-server` → `0.1.6-alpha.1` |
| `examples/hello/package.json` | peer `dsh-commands` → `0.1.6-alpha.1` |
| `apps/omdsh/config/cordis.yml` | `code-runtime` → `ptc-runtime`；`workflow-worker-thread` → `workflow-ptc`；新增 `image-offload`；`tool-ralph` 加 `disabled: true` 与注释 |
| `apps/omdsh/src/subagent-isolation.spec.ts` | 行 id 与包名断言同步；Ralph 断言改为 `disabled === true` |
| `packages/tui/omdsh-tui/src/session/session-controller.ts` | `PermissionSelect` → `PermissionSelection`（`dsh-permission-presets/types`） |
| `apps/omdsh/src/present-tool.spec.ts`、`scripts/happy-smoke.mjs`、`scripts/stream-interrupt-smoke.mjs` | 临时设置段 pin `protocol: chat-completions` |
| `apps/omdsh/src/persistence-cross-version.spec.ts` | 注释中的目标 cohort 改为 `0.1.6-alpha.1`（会话格式仍是 v3） |
| `apps/site/content/{en,zh}/tutorials/write-a-plugin.md` | peer 示例版本同步（双语） |
| `pnpm-workspace.yaml` | `minimumReleaseAgeExclude` 换新版本；`dsh-code-runtime` → `dsh-ptc-runtime`；新增 `dsh-compaction-image-offload` |
| `pnpm-lock.yaml` | 重生成，单一 cohort |
| `CHANGELOG.md` | `Unreleased` 记录 cohort、协议默认、图片降级与 Ralph 默认 |

## 基线失败与根因

基线（替换前的 `0.1.5-rc.2`）在干净 worktree 全绿：`apps/omdsh` 105/105、`omdsh-tui` 882/882、site 13/13。替换依赖后出现两处失败，都在预期之内：

- `examples/hello bundle` 与 `omdsh plugin` 的打包安装用例以 `peer @deepseek-ai/dsh-commands@0.1.5-rc.2 is incompatible with shipped 0.1.6-alpha.1` 失败。上一轮记录的混装把关用例仍然有效：**任何 pin 漏改都会在这里被抓住**，包括不在 workspace 成员里的 `examples/` fixture。
- `present-tool.spec.ts` 以 `HTTP_404: DeepSeek Messages request failed (404)` 失败。上游 `dsh-llm-mock-server` 只把 `*/chat/completions` 当作请求入口，而 `dsh-llm-deepseek` 现在默认 Messages；用例在设置段显式选择 chat-completions 即可，产品默认不动。

`PermissionSelect` → `PermissionSelection` 是唯一由 `tsc` 直接给出的不兼容项，语义未变。

## 验证结果

全部在 `/Users/dy/Workspace/dsh-tui`，替换依赖前删除两个 `tsconfig.tsbuildinfo` 使构建缓存失效：

| 检查 | 结果 |
| --- | --- |
| `pnpm install` | 12.3 s；lock 中 `0.1.6-alpha.1` 1754 条、`0.1.5-rc.2` 0 条 |
| `pnpm typecheck` | 通过（tui、apps/omdsh、site 0 errors） |
| `pnpm test` | `omdsh-tui` 882/882、`apps/omdsh` 105/105、site 13/13 |
| `pnpm build` | 通过 |
| `pnpm check:boundaries` / `pnpm check:md` | 通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS`（默认 `code` 预设，覆盖 `tools.presentAs('ptc')` 路径） |
| `pnpm smoke` | `PTY_SMOKE_PASS exit=0` |
| `pnpm smoke:interrupt` | `STREAM_INTERRUPT_SMOKE_PASS latency=153ms` |
| `git diff --check` | 干净 |

## 遗留风险

- keyless 用例与 smoke 依赖设置段里的 `protocol: chat-completions`；上游 mock server 支持 Messages 之后应当移除该绕过，让默认协议本身进入回归范围。
- 混合 cohort 的复发条件没有消除，只是被重新钉住；下一次上游 prerelease 发布时 `examples/hello` 的打包安装用例会再次失败——这是预期的把关行为，处理方式是同步全部 pin（含根 manifest 与 `examples/` fixture）与 `minimumReleaseAgeExclude`。
- `maxTokens: 384000` 仍是显式覆盖（上游默认 256000，V4.1 目录带自己的上限）；保留现状，下一次调整上下文预算时再复核。
- 会话格式保持 v3，`dsh-session-format-*` 迁移链与 alpha.3 夹具用例不受影响；image offload 是新增的事件类型而非格式版本变更。
