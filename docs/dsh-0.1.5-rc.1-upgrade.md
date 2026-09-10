# DSH 0.1.5-alpha.2 → 0.1.5-rc.1 升级记录

模式：**Harness cohort migration**。走廊极窄，但暴露出一个真实的发布缺陷，本记录把证据和判定一起留档。上游发布：`dsh-v0.1.5-rc.1`（2026-09-10，npm `latest`/`next` 均指向它）；基线 `dsh-v0.1.5-alpha.2`（2026-09-09）恰是它的前一个 alpha。

## 基线与目标

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort | `0.1.5-alpha.2` | `0.1.5-rc.1` |
| 直接依赖 | `apps/omdsh` 98 项 + `packages/tui/omdsh-tui` 32 项（去重 103 个包）+ 根 devDependency `dsh-llm-mock-server` | 同名同数量，纯版本替换 |
| 基础层 | Cordis `4.0.2`、cordis-plugin-loader `1.0.3`、cordis-plugin-timer `1.1.4`、Schemastery `3.18.2`、cosmokit `1.8.3` | 全部不变；rc.1 的 peer 仍只要求 `@deepseek-ai/cordis@^4.0.2` |
| Harness source tag | `dsh-v0.1.5-alpha.2` | `dsh-v0.1.5-rc.1` |
| 解析图规模 | lock 中 142 个 `@deepseek-ai/*`（129 个走 DSH 版本线，13 个 cordis/native 线独立版本） | 同一集合，全部落在单一 `0.1.5-rc.1` |
| 产品源码改动 | — | `config/cordis.yml` 2 处默认模型、`src/args.ts` 帮助文案、2 个 smoke 断言、双语教程 1 句、1 处测试注释；无 API 适配 |

## 走廊范围

`dsh-v0.1.5-alpha.2...dsh-v0.1.5-rc.1` 共 17 个 commit、300 个文件，其中 297 个是 release 提交对各 `package.json` 的版本串与依赖区间重定向。真正改动源码的只有三个文件：

| 上游变更 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- |
| `bc5fd3b8d` / `441385fe3` / `0729dbec6` `dsh-llm-deepseek/src/index.ts`：`DEFAULT_MODELS` 新增 `deepseek-flash`（`DeepSeek-V41-Flash`，text+image，`systemPromptUpdate: in-history`） | `/model` 多一条路由；`deepseek-official` 连接层对 catalog 内所有模型统一发放 `off\|low\|high\|max` 阶梯，新条目不缺推理档位 | 采纳为新默认模型 |
| `release(dsh)`：`packages/bundle/base/cordis.patch.yml` 把 `dsh-agent-default-model` 默认从 `deepseek-v4-flash` 改为 `deepseek-flash`（对应 npm 包 `@deepseek-ai/dsh-base`，不在 omdsh 依赖图内） | 不自动继承：omdsh 自带 cordis patch，两处显式写死默认模型 | 跟随上游，显式改为 `deepseek-flash` |
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | Web 客户端专用，omdsh 不消费 | 无改动 |

发布产物层面的判定比源码 diff 更强：把 lock 图里 129 个双版本包的两侧 tarball 全量解包做 `diff -rq`，**除 `package.json` 版本串外，唯一有内容差异的包是 `@deepseek-ai/dsh-llm-deepseek`**（`lib/index.js` +9 行 catalog 条目、`lib/types/index.d.ts` 仅注释、两份 README）。其余 128 个包 dist 字节相同。上游 release notes 是**自 `0.1.2-rc.1` 起聚合**的，其中 Session 生命周期、Inbox API、`ctx.agent` 移除、V3 日志格式等已在前两轮 alpha 升级中消化，不属于本走廊。

## 适配清单

机械替换（128 处 workspace 白名单 + 131 处 manifest + lock 重生成）之外：

| 文件 | 改动 |
| --- | --- |
| `apps/omdsh/config/cordis.yml` | `agent-default-model` 与 `tui` 两处 `OMDSH_MODEL` 回退值 → `deepseek-flash` |
| `apps/omdsh/src/args.ts` | `--model` 帮助文案默认值同步 |
| `scripts/pty-smoke.mjs` | 状态栏断言与推理档位正则改匹配 `deepseek-flash` |
| `scripts/stream-interrupt-smoke.mjs` | 提交时机探测串同步 |
| `apps/site/content/{en,zh}/tutorials/precise-context.md` | 默认 catalog 现在有两个 image-capable 条目（`deepseek-flash` 与 `deepseek-v4-flash-vision-exp`） |
| `apps/omdsh/src/persistence-cross-version.spec.ts` | fixture 说明中的目标 cohort 更名 |
| `pnpm-workspace.yaml` | `minimumReleaseAgeExclude` 全部指向 `0.1.5-rc.1`，并移除已无引用的 `0.1.2-rc.1` 备用区间 |
| `package.json`（根）、两个包 manifest、`pnpm-lock.yaml` | 版本 pin 与重生成 |
| `CHANGELOG.md` | `Unreleased/Changed` 记录 cohort 迁移与新默认模型；`Unreleased/Fixed` 记录 npm 混装缺陷 |

`pnpm-lock.yaml` 的变更已归一化验证：改动前后各有 501 个不同的 `name@version` 条目，**新增 0、删除 0**，diff 只是 DSH 版本串与由此变化的 peer 哈希后缀，非 DSH 传递依赖零漂移。

## 基线失败与根因

迁移前基线（clean worktree，`0.1.5-alpha.2`）：typecheck 绿、`omdsh-tui` 725 项与 site 13 项测试全绿，但 `apps/omdsh` 有一项稳定失败（两次运行均复现）：

```
examples/hello bundle > boots a Profile-installed command from the packed application
omdsh: agent-presets: preset "standard" failed to mount: failed to apply loader entry persona
(@deepseek-ai/dsh-persona): prompt section "deployment:persona-prefix" is already registered
```

根因是**混合 cohort**，与本次升级要修的问题同一件事，已在隔离消费者中复现并留证：

| 消费者安装 | 结果 |
| --- | --- |
| 用 alpha.2 pin 打包的 0.14.0 artifacts（`npm install` 到空目录） | 97 × `0.1.5-alpha.2` + **29 × `0.1.5-rc.1`**；8 个包出现两份副本（`dsh-system-prompt`、`dsh-scope`、`dsh-invariants`、`dsh-llm`、`dsh-timeout`、`dsh-http-proxy`、`dsh-output-retention`、`dsh-sandbox-policy`），例如 `node_modules/@agi-fans/oh-my-dsh/node_modules/@deepseek-ai/dsh-system-prompt@0.1.5-alpha.2` 与 `node_modules/@deepseek-ai/dsh-system-prompt@0.1.5-rc.1` 并存 |
| 用 rc.1 pin 打包的同一对 artifacts（同样方式） | 127 × `0.1.5-rc.1`，**零重复副本** |

`^0.1.5-alpha.2` 在 semver 上被 `0.1.5-rc.1` 满足，所以凡是只通过 peer 区间到达的包都会被解析到该 tuple 里最新的预发布版。两份 `dsh-system-prompt` 就是两份 prompt section 注册表，persona 前缀因此在第二次注册时报错。pnpm + lockfile 不会复现（单一 cohort），npm 消费者会——也就是说 0.14.0 在 rc.1 发布的那一刻对 npm 安装方式变成了不可启动；本次 pin 同步即修复。迁移后 `apps/omdsh` 93/93 全绿。

## 验证结果

全部在 `/Users/dy/Workspace/dsh-tui`、依赖替换后先失效构建缓存（删除两个 `tsconfig.tsbuildinfo`）再执行：

| 检查 | 结果 |
| --- | --- |
| `pnpm install` | 128 包换入换出；随后不带 `--trust-lockfile` 再跑一次通过供应链策略校验 |
| `pnpm typecheck` | 通过（tui、apps/omdsh、site 0 errors 0 warnings） |
| `pnpm test` | `omdsh-tui` 725/725、`apps/omdsh` 93/93、site 13/13 全绿（基线失败项已修） |
| `pnpm build` | 通过 |
| `pnpm check:md` | 通过 |
| `pnpm check:boundaries` | 通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS` |
| `pnpm smoke` | `PTY_SMOKE_PASS exit=0`，真实 TTY 启动后状态栏显示 `deepseek-flash · <effort>` |
| `pnpm smoke:interrupt` | `STREAM_INTERRUPT_SMOKE_PASS latency=9ms` |
| `git diff --check` | 干净 |
| 边界审计 | `rg 'refs/deepseek-harness\|link:refs'` 在配置与源码中零命中（仅审计脚本自身持有该模式）；无指向 `refs/` 的符号链接；三个参考子模块工作区全干净 |

供应链策略注意：pnpm 11 的 `minimumReleaseAge` 在解析前先校验**旧 lockfile**，因此把白名单从 `0.1.5-alpha.2` 换成 `0.1.5-rc.1` 之后，第一次 `pnpm install` 会因旧 lock 中的 alpha.2 条目被拒；本次用一次 `pnpm install --trust-lockfile` 完成过渡（新 lock 生成后再跑普通 `pnpm install` 已通过）。放宽白名单或删除 lock 重解析都不是必需的。

## 遗留风险

- `deepseek-flash` 由 adapter 预注册、不探测网关可用性；若网关尚未开放该 ID，请求会以 `INVALID_REQUEST` 失败。上游 README 明示此点，本地无 API key 无法验证网关状态，也未做真机 turn。
- `refs/deepseek-harness` 已 checkout 到 `dsh-v0.1.5-rc.1` 但父仓库 gitlink 尚未提交（`git submodule status` 显示 `+`）。
