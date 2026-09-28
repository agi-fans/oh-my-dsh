# DSH 0.1.7-rc.1 → 0.2.0-rc.1 升级记录

模式：**Harness cohort migration**。走廊跨 607 个上游 commit、3838 个文件，主版本位由 `0.1.7` 跳到 `0.2.0`，但绝大多数改动落在 web/desktop 客户端、账号与遥测等 TUI 不消费的面。对 omdsh 有契约意义的改动只有一处，但它是真的破坏性变更：`dsh-llm-deepseek` 不再是插件。上游发布：`dsh-v0.2.0-rc.1`（prerelease；npm dist-tag `next`）。中途还有一步 `dsh-v0.1.7-rc.2`，本批直接取 `0.2.0-rc.1` 单步到位。

## 基线与目标

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort | `0.1.7-rc.1` | `0.2.0-rc.1` |
| 直接依赖 | `apps/omdsh` 115 项 + `packages/tui/omdsh-tui` 34 项 + 根 devDependency `dsh-llm-mock-server` + `examples/hello` 的 peer `dsh-commands` | 纯版本替换，**外加一处包改名**：`dsh-llm-deepseek` → `dsh-llm-deepseek-api-key` |
| 基础层 | Cordis `4.0.4`、cordis-plugin-loader `1.0.5`、cordis-plugin-timer `1.1.6`、Schemastery `3.18.4` | 全部不变（`0.2.0-rc.1` 全部包的 cordis peer 仍是 `~4.0.4`） |
| 解析图规模 | lock 中 1757 条 `0.1.7-rc.1` | 1830 条 `0.2.0-rc.1`，`0.1.7-rc.1` 0 条 |
| 新增传递依赖 | — | `dsh-util-code-language`、`dsh-llm-deepseek-api-key`（后者已是直接依赖） |
| 产品源码改动 | — | 仅 `cordis.yml` 一行 `name` |

`refs/deepseek-harness` 子模块指针同步移到 `dsh-v0.2.0-rc.1`（`4878cdabd8`），与实际消费的 cohort 对齐；子模块内容未被改动，`check:boundaries` 保持绿色。

## 走廊范围

| 上游变更 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- |
| **`dsh-llm-deepseek` 移除 Cordis 插件面**（`name`/`inject`/`apply` 全部删除），改为导出库函数 `registerDeepSeekProvider`（新 `src/host.ts`）；`@deepseek-ai/dsh-deepseek-account` 与 `@deepseek-ai/dsh-credentials` 依赖同时移除 | 组合行 `llm-deepseek` 指向的包不再是插件，loader 无法挂载：启动报 `1 entry did not activate`，随后每个请求以 `NO_ADAPTER: no adapter registered for provider "deepseek-official"` 失败 | **改挂 `@deepseek-ai/dsh-llm-deepseek-api-key`**（新包，拥有同一条 `deepseek-official` 路由）；行 id 保持 `llm-deepseek`，见 D19 |
| 新包 `dsh-llm-deepseek-account`（路由 `deepseek-account`，账号 token 认证） | omdsh 不做账号登录 | 不挂载 |
| 默认目录 `deepseek-flash` 增加 `toolUpdate: 'addition-only'`（原默认 `in-history`） | 工具定义更新改为追加而非历史内改写；`deepseek-v4-pro` 保持 `in-history` | 跟随上游，CHANGELOG 说明 |
| `dsh-session` 导出新增 `ToolCallRecovery` | 纯增量 | 无 |
| `app-boot` 的 config-schema 内部改用 `profile.skippedBundles`（移除 `readProfileManifest(binName, dir)` / `skippedProfileBundles()`） | 内部重构，公开面不变 | 无 |
| `dsh-session-projection` / `dsh-session-stats` / `dsh-token-meter` 的 `src` | **零改动**（仅 `package.json` 版本串），状态栏依赖的投影层完全兼容 | 无 |
| 新包 `dsh-util-code-language`、`telemetry/otel`、`client/{shortcuts,ui-shortcuts,product-analytics,ui-settings-session-log}`、`experimental/schedule-bundle` | `code-language` 随传递依赖进入；其余属 web/desktop/遥测面 | 不挂载 |
| Web/桌面/账号/API 等约 3800 文件 | omdsh 不消费 | 无 |

## 适配清单

| 文件 | 改动 |
| --- | --- |
| `apps/omdsh/config/cordis.yml` | `llm-deepseek` 行的 `name` 改为 `@deepseek-ai/dsh-llm-deepseek-api-key`；**行 id 不动**，注释说明包拆分与命名空间来源 |
| `apps/omdsh/package.json` | 115 处 pin → `0.2.0-rc.1`；`dsh-llm-deepseek` 依赖替换为 `dsh-llm-deepseek-api-key`（前者仍在图中，作为后者的传递依赖） |
| `packages/tui/omdsh-tui/package.json` | 34 处 pin → `0.2.0-rc.1` |
| `package.json`（根） | devDependency `dsh-llm-mock-server` → `0.2.0-rc.1` |
| `examples/hello/package.json` | peer `dsh-commands` → `0.2.0-rc.1` |
| `pnpm-workspace.yaml` | 148 条 `minimumReleaseAgeExclude` 追加 `\|\| 0.2.0-rc.1`（沿用既有累加式写法）；pnpm 自动补登 `dsh-util-code-language`、`dsh-llm-deepseek-api-key` |
| `pnpm-lock.yaml` | 重生成，单一 cohort（1830 条 `0.2.0-rc.1`，`0.1.7-rc.1` 0 条） |
| `apps/site/content/{en,zh}/tutorials/write-a-plugin.md` | peer 示例版本与 cordis 范围同步（双语；原为 `0.1.6-alpha.2` / `^4.0.2`，本批顺带修正） |
| `CHANGELOG.md` | `Unreleased` 记录 cohort、DeepSeek 插件拆包、`deepseek-flash` 工具更新语义 |
| `refs/deepseek-harness` | 子模块指针 `dsh-v0.1.6-alpha.2`（`ddefc45fbc`）→ `dsh-v0.2.0-rc.1`（`4878cdabd8`），仅移动指针，未改动子模块内容 |

产品源码（`src/**`）零改动：破坏性变更只落在组合行的包名上。

## 验证结果

全部在 `/Users/dy/Workspace/dsh-tui`。基线（干净工作区、`0.1.7-rc.1`）先验证 `pnpm install` / `typecheck` / `test` 全绿后再替换依赖：

| 检查 | 结果 |
| --- | --- |
| `pnpm install` | lock 中 `0.2.0-rc.1` 1830 条、`0.1.7-rc.1` 0 条；cordis 仍 `4.0.4`、schemastery 仍 `3.18.4`，无 cohort 混装 |
| `pnpm typecheck` | 通过（先删 `*.tsbuildinfo` 清缓存；tui、apps/omdsh、site 0 errors） |
| `pnpm test` | `omdsh-tui` 886/886、`apps/omdsh` 115/115、site 13/13，退出码 0 |
| `pnpm build` | 通过 |
| `pnpm check:boundaries` / `pnpm check:md` | 通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS status=0` |
| `pnpm smoke` | `PTY_SMOKE_PASS exit=0` |
| `pnpm smoke:interrupt` | `STREAM_INTERRUPT_SMOKE_PASS latency=158ms` |
| `git diff --check` | 干净 |
| 组合真实挂载 | `printf 'ping' \| tsx src/bin.ts` 不再输出 `entry did not activate`；无 API key 时的错误由 `NO_ADAPTER` 变为正确的 `MISSING_CREDENTIAL` |
| refs 审计 | `check:boundaries` 绿；三个子模块 status 均干净；无符号链接指向 `refs/deepseek-harness` |

修复前对照：同一命令下 3 个 spec 文件 / 4 个用例失败（`web-search`、`presentation-mode` ×2、`present-tool` 链），根因均为该插件未挂载导致 `NO_ADAPTER`。

## 决策记录

- **D19 · 保留行 id `llm-deepseek`，只换包名**：`dsh-llm-deepseek-api-key` 用 `ctx.fiber.entry?.options.id ?? name` 决定 settings 命名空间，而 TUI 的 `/auth`（`DEEPSEEK_SETTINGS = 'llm-deepseek'`）与 `/model` 都按该字符串读写用户设置，Profile patch 也按行 id 覆盖。保留原 id 意味着既有 `settings.yaml` 导入段、Profile 补丁与 `/auth` 交互全部零改动继续生效。上游 base bundle 采用同一手法。
- **D20 · 不挂载 `llm-deepseek-account`**：omdsh 没有账号登录路径，`deepseek-account` 路由的认证只走账号 token；`deepseek-official` 的 API key 路径才是本产品的既有契约。
- **D21 · 移除 `dsh-llm-deepseek` 直接依赖**：组合行不再指名该包，它作为 `dsh-llm-deepseek-api-key` 的传递依赖仍在解析图中。保留一个未被组合引用的直接依赖会让"声明即契约"失真。

## 遗留风险

- `0.2.0-rc.1` 是 prerelease，且 npm `latest` 仍指向更早的 `0.1.0-rc.6`；回退只需把三处 pin 换回 `0.1.7-rc.1` 并重装，`llm-deepseek` 行需同时换回包名。
- `deepseek-flash` 的工具更新改为追加语义。若某部署依赖"工具定义变化时重写历史"的行为（例如按历史消息重放校验），需改用 `deepseek-v4-pro`，或在自家 overlay 的 `llm-deepseek` 段显式声明 `toolUpdate`。
- keyless 用例与 smoke 继续依赖 `protocol: chat-completions`（mock server 未实现 Messages），与前几轮一致，未在本走廊变化。

## 补做的契约审计

首轮静态扫描只覆盖了状态栏依赖的三个包的 `src/index.ts` 导出面，漏掉了 `dsh-llm-deepseek` 的插件面移除——那类破坏不在 TypeScript 导入图里，只存在于 YAML 的字符串行名。修复后补做了三类字符串契约审计：

| 审计面 | 方法 | 结果 |
| --- | --- | --- |
| 组合行插件面 | 对 104 行逐个按 loader 的 `unwrapExports` 语义导入已安装产物，检查是否为函数或带 `apply` | 104/104 均为插件面，0 问题（`dsh-llm-deepseek` 正是这样被查出来的） |
| 组合行配置键 | 取每个插件已安装 `Config.dict` 的键名，与我们在 `cordis.yml` / presets 里写的 `config:` 键比对 | 无未知键。`subagent-acp` 的 4 个"未知键"是 `env:` 下的嵌套键，`env` 本身是合法键——扫描器把嵌套键也收了，属误报 |
| 无 schema 导出行 | 逐个回证 | `dsh-plan-mode` 的 `section` 在已安装 `lib/types/index.d.ts:62` 中存在；`@agi-fans/dsh-tui/session-runtime` 与 `agent-profile` 是我们自己的 TS `interface Config`（非 schemastery），`stateDir` 见 `runtime/session-runtime.ts:20`、`tools` 见 `runtime/agent-profile.ts:19` |

服务名契约没有靠运行时探针取证：`ctx.get()` 是惰性的，挂载成功不代表名字存在，而按根 context 探测会读到错误的 cordis scope（连我们自己的 `tui` 都会报缺失）。实际依据是 cordis 的 `inject` 语义——插件的 `inject` 依赖未满足就不会激活，而启动报告 0 条未激活，加上 1001 个用例覆盖 session / approval / tools / commands 等消费面。
