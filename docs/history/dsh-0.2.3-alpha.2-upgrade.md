# DSH 0.2.2-rc.5 → 0.2.3-alpha.2 升级记录

状态：2026-11-23 在 macOS arm64（Node.js `v24.22.3`，pnpm `11.20.0`）上完成。模式是 **Harness cohort migration**：产品直接与传递 DSH 依赖整体迁到 `0.2.3-alpha.2`，Cordis 一族同步升级到 `4.2.0-alpha.1`，Node.js 引擎要求升级到 `^24.22.3 || >=26.13.1`。产品版本保留 `0.29.4`，用户可见变更写入 `CHANGELOG.md` 的 `Unreleased`。

## 走廊

| 层 | 源 | 目标 |
| --- | --- | --- |
| DSH | `0.2.2-rc.5`（tag `dsh-v0.2.2-rc.5` / `9c2670d3bc`） | `0.2.3-alpha.2`（tag `dsh-v0.2.3-alpha.2` / `4b399c39a6`） |
| Cordis / Loader / Group / Include / Timer | `4.1.0` / `1.1.0` / `1.1.0` / `1.1.0` / `1.2.0` | `4.2.0-alpha.1` / `1.2.0-alpha.1` / `1.2.0-alpha.1` / `1.2.0-alpha.1` / `1.3.0-alpha.1` |
| Cosmokit / Schemastery | `1.9.0` / `3.19.0` | `1.10.0-alpha.1` / `3.20.0-alpha.1` |
| `node-addon-require-builtin` | `^0.1.9` | `^0.1.10` |
| Node.js `engines.node` / CI / `omdsh doctor` | `^22.19 \|\| >=24`（CI `22`） | `^24.22.3 \|\| >=26.13.1`（CI `^24.22.3`） |
| 锁文件唯一 DSH 包 | 191 个（`0.2.2-rc.5`） | 192 个（全部 `0.2.3-alpha.2`，0 重复、0 旧版残留） |

`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 为本次新发布的 `0.2.3-alpha.2`、Cordis `4.2.0-alpha.1` 一族及 `node-addon-require-builtin@0.1.10` 补充白名单，并加入 `@deepseek-ai/dsh-deepseek-auth@0.2.3-alpha.2` 与 `@deepseek-ai/dsh-util-text-search@0.2.3-alpha.2`。`examples/hello/package.json` 的 peer 同步到 `@deepseek-ai/cordis@~4.2.0-alpha.1` 与 `@deepseek-ai/dsh-commands@0.2.3-alpha.2`。

## 确认的契约变化与适配

| 变化 | 证据 | 适配 |
| --- | --- | --- |
| Node.js 最低版本收紧至 `^24.22.3 \|\| >=26.13.1` | 上游根 manifest 与已发布包 `engines.node` | 更新根、`apps/omdsh`、`packages/tui/omdsh-tui` 的 `engines.node`，CI workflow 升至 `^24.22.3`，`doctor.ts` 改为严格 SemVer 2.0.0 判定（忽略构建元数据、拒绝预发布与非法四段版本）并在 `doctor.spec.ts` 补齐边界用例，文档与 README 同步 |
| `dsh-deepseek-auth` 成为 DeepSeek 模型路由与网页服务的共享鉴权依赖 | `dsh-llm-deepseek-api-key`、`dsh-llm-deepseek-account`、`dsh-web-deepseek-api` 的 peer 与组合要求 | `apps/omdsh/package.json` 新增 `@deepseek-ai/dsh-deepseek-auth@0.2.3-alpha.2`，`config/cordis.yml` 在 `deepseek-account` 后挂载 `deepseek-auth` 行 |
| `@deepseek-ai/dsh-tool-working-directory` 移除；实时会话目录事件改为 `workspace-root/change`；`subagent` 移除 `cwd` 参数 | 上游 `dsh-working-directory` 事件契约与 `2026-11-13-workspace-root-change.md` | 移除 `dsh-tool-working-directory` 依赖与行；`session-controller.ts` 实时目录遵循 `workspace-root/change`（旧 worktree 会话恢复回原项目、含新事件日志旧版拒读），`tool-presentation.ts` 历史工具卡路径回放同时兼容 `workspace-root/change` 与旧 `working-directory/change`；`presentation-mode.spec.ts` 断言 `working_directory` 与 `subagent.cwd` 不存在 |
| `dsh-experimental-tool-worktree` 将 `create_worktree` 替换为 `enter_worktree` / `exit_worktree` | 发布包工具注册与 `dsh-experimental-tool-worktree` 类型 | 更新 `worktree.spec.ts`、`presentation-mode.spec.ts` 与文档对齐 `enter_worktree` / `exit_worktree` |
| `ProfileContext.overlays` 替换为 `ProfileContext.overlayPaths`（文件路径数组） | `dsh-app-boot` `profile-context.d.ts` 与 `readProfilePatches()` | `apps/omdsh/src/boot.ts` 将非空运行期叠加补丁写入临时目录中的 `launch-overlays.yml`，创建与写入纳入同一异常清理边界、删除成功后再清路径、正常 `dispose` 清理带有限重试并在耗尽时同步写入 `omdsh.log`（交互模式）或 stderr（exec 模式）防止信号退出丢失、清理失败不掩盖原始启动错误；`first-run.spec.ts` 覆盖写入/清理失败、有限重试、同步落盘告警与真实互动模式 HMR 重载 |
| Node PTC 默认执行模式切换为 `persistent-in-memory` scoped REPL（跨调用保留内存状态，拒绝顶层 `return`） | `dsh-ptc-runtime-node` 默认配置与执行契约 | `config/cordis.yml` 的 `ptc-runtime` 不覆写 `executionMode` 以跟随上游默认；更新 `timed-question.spec.ts` 与 `plan-mode.spec.ts` 移除顶层 `return`，并在 `presentation-mode.spec.ts` 按第二次调用 `tool_use_id` 精准断言成功 `tool_result` 的变量状态保留，同步更新双语 `tools.md` 说明 |
| `dsh-tool-cordis` 将 `cordis_inspect_list` / `cordis_inspect_query` 合并为 `cordis_inspect`，Host 首方检查提供方由 `@deepseek-ai/dsh-tool-cordis/host`（`./lib/types/host.js`）注册 | `dsh-tool-cordis/package.json` 与发布产物 `lib/types/host.js` | `config/cordis.yml` 在 `cordis-host-runner` 后挂载 `cordis-inspect-providers`（`@deepseek-ai/dsh-tool-cordis/host`），`config/presets/cordis.patch.yml` 与双语 `tools.md` 切换为 `cordis_inspect`；`presentation-mode.spec.ts` 真实调用 `cordis_inspect` 并按 `tool_use_id` 验证 5 个 Host provider（`Service` / `Event` / `Config` / `Runtime` / `Tool`）与 `Runtime.getVersion` |
| `@deepseek-ai/dsh-mcp-client` 根导出移除 `SERVER_NAME_PATTERN`、`assertTemplateSyntax`、`connectionStatusOf`，新增 `waiting-authorization` 状态与 `dsh-mcp-manager` OAuth 生命周期方法 | `dsh-mcp-client` 与 `dsh-mcp-manager` `lib/types/` | `mcp-settings.ts` 本地保留命名/模板校验，为 `waiting-authorization` / OAuth 托管服务器接入从 `starting` 起即订阅 `watch()` 并在流异常/提前结束时无缝降级轮询的 `startAuthorization`、`cancelAuthorization`（如实反馈取消错误与已提交竞态）与 `signOut`；`open-external.ts` 仅放行 `http:`/`https:` 且 Windows 侧改由 PowerShell 经环境变量调用 `Start-Process` 杜绝 `cmd.exe` 命令注入；`integrations.ts` 将静态活跃行标示为“插件已挂载 · 连接状态未知”并在挂载 `mcp-manager` 时保留健康声明 |
| `@deepseek-ai/dsh-llm/brand` 子路径移除，品牌类型合并回根导出 | `dsh-llm/package.json` exports | `schedule.spec.ts` 改为从 `@deepseek-ai/dsh-llm` 导入 |
| `dsh-llm-deepseek` 用 `imageTargetBytes`（上限 32 MiB）替代 `imageMaxBytes` 并拒绝旧键；`dsh-llm-pi-ai` 目录模型支持 `reasoningEfforts` | `dsh-llm-deepseek/src/config.ts` 与 `dsh-llm-pi-ai` schema | `deepseek-config-migration.ts` 使用保留注释、标量引号与 `!!js` 标签的 YAML AST 原子迁移可写补丁（Profile 迁移共用 `ConfigEditor` 的 `package.json` 文件锁并在锁内复核权限与二次解析防重复键，合并清理 `imageTargetBytes: null`、保留显式新键、超限/非法旧键与字段级 `!!js` 原样保留），运行期通过 `internal/config` 钩子以非破坏拷贝在最终生效层兼容只读补丁、HMR 重载与 `!!js` 表达式而不压过更高层设置，`doctor.ts` 校验最终生效的 `imageMaxBytes`/`imageTargetBytes` 上限与字段/块级 `!!js` 提示；`model-catalog-editor.ts` 同步清理新旧键；`model-settings.ts` 以有效列表为空识别继承目录（兼容真实 `pi-ai` schema 投射出的 `models: []`），单模型编辑写入 `modelOverrides`，模型发现与增删改序共用 `modelOverrides` 清理逻辑（部署层含基线 `modelOverrides` 时显式写入 `{}` 覆盖） |
| `dsh-tool-subagent/model-selection-settings` 将 `current()` 改为实时 `allowedRoutes()` | `dsh-tool-subagent/lib/model-selection-settings.js` | `plugin-management.spec.ts` 改为断言 `allowedRoutes()`；`subagent-settings.ts` 与 `zh.ts` 更新文案说明修改即时作用于所有会话的下一次委派 |
| `cordis-plugin-loader@1.2.0-alpha.1` 要求 `node-addon-require-builtin@^0.1.10` | `cordis-plugin-loader` `package.json` | 升级 `apps/omdsh/package.json` 依赖并同步 `hello-plugin.spec.ts` 断言 |

## 核对后无需改动

- 自动化导入扫描核对了仓库中 460 个文件的 686 处 `@deepseek-ai/*` 导入，除上表 4 处显式变更外均在 `0.2.3-alpha.2` 中保持兼容。
- Cordis `4.2.0-alpha.1` 移除 `ctx.root` 并重命名 `Service.config` / `resolveConfig`：产品代码中无任何调用。
- `dsh-host-webserver` 新增默认路由鉴权策略，但 `dsh-deepseek-account` 通过 `webserver/request` 在路由鉴权前拦截 `/oauth/callback`，本地 loopback 登录回调不受影响。
- `dsh-session-query` 移除 `inspectSession()`：产品未调用。
- `dsh-system-prompt` 新增对 `dsh-session` / `dsh-session-projection` 的 peer 依赖，两者在 `config/cordis.yml` 中均已先于 `system-prompt` 挂载。
- `dsh-plan-mode` 与 `dsh-system-prompt` 的增量 section 提示在既有 `plan-mode.spec.ts` 回归中全部通过；`AgentHandle.dispose()` 仍无保留 inbox 选项；`dsh-subagent-codex` 仍固定 `@openai/codex@0.153.4`。

## 验证

macOS arm64，Node.js `v24.22.3`，pnpm `11.20.0`，测试统一使用 `LANG=C LC_ALL=C`。

| 检查 | 结果 |
| --- | --- |
| 锁文件队列一致性检查 | 192 个唯一 `@deepseek-ai/dsh-*` 包全部为 `0.2.3-alpha.2`，0 重复、0 非目标版本；Cordis 一族全部为 `4.2.0-alpha.1` 线 |
| `CI=true pnpm install --frozen-lockfile` | 通过 |
| 清理 `tsconfig.tsbuildinfo` 后 `pnpm typecheck` | 通过（含 `apps/site` `astro check`） |
| `LANG=C LC_ALL=C pnpm test` | 站点 3 文件 16 条、TUI 179 文件 3,281 条、CLI 47 文件 268 条，合计 229 文件 3,565 条全部通过 |
| `pnpm build` | 通过（含文档站构建与 Pagefind 索引） |
| `pnpm check:md` / `pnpm check:boundaries` / `git diff --check` | 全部通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS status=0` |
| `pnpm smoke` | `PTY_SMOKE_PASS`、`PTY_MODES_SMOKE_PASS`、`PTY_INSPECT_SMOKE_PASS` 全部通过 |
| `pnpm smoke:interrupt` | `STREAM_INTERRUPT_SMOKE_PASS latency=147ms` |
| `refs/` 与符号链接边界审计 | 零业务源码/配置指向 `refs/deepseek-harness` 或 `link:refs`，零符号链接指向 `refs/`，三个 `refs/*` 子模块工作区全部干净 |
| 独立打包消费者验证 | `@agi-fans/dsh-tui` 67 个 export 目标与 `@agi-fans/oh-my-dsh` 10 个 export/bin 目标全部存在；隔离 npm 安装解析 191 个 `@deepseek-ai/dsh-*` 运行时包（全为 `0.2.3-alpha.2`、0 重复）；消费者 `omdsh --version`、`--dump-config`（含 `deepseek-auth` 与 `cordis-inspect-providers`、不含 `tool-working-directory`）、`doctor` 均通过 |

## 残余风险

- 本次所有测试、冒烟与隔离打包验证均在 macOS arm64（Node.js `v24.22.3`）上执行，尚未在 Windows 实机验证 PowerShell 栈、`node-pty` 行为及 `pwsh` 路径，也未在 Node.js `26.x` 实机验证原生依赖组合。
- 本次使用 mock LLM 服务验证，未用真实付费 DeepSeek 账户/API Key、真实 OAuth MCP 服务器或第三方 `pi-ai` 凭据做线上端到端请求验收。
