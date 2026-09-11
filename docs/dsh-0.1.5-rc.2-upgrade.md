# DSH 0.1.5-rc.1 → 0.1.5-rc.2 升级记录

模式：**Harness cohort migration**。走廊只有一个 prerelease 宽，对 omdsh 是纯版本替换；但基线失败与上一轮同源，说明 prerelease 区间只要存在，下一个 prerelease 发布就会让它复发。上游发布：`dsh-v0.1.5-rc.2`（2026-09-10T14:51Z，prerelease）。

## 基线与目标

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort | `0.1.5-rc.1` | `0.1.5-rc.2` |
| 直接依赖 | `apps/omdsh` 103 项 + `packages/tui/omdsh-tui` 32 项 + 根 devDependency `dsh-llm-mock-server` + `examples/hello` 的 peer `dsh-commands` | 同名同数量，纯版本替换 |
| 基础层 | Cordis `4.0.2`、cordis-plugin-loader `1.0.3`、cordis-plugin-timer `1.1.4`、Schemastery `3.18.2` | 全部不变（这 4 个包不在 `0.1.5` 线上，registry 上也没有 rc.2，属预期） |
| 解析图规模 | lock 中 142 个 `@deepseek-ai/*` | 同一集合，全部落在单一 `0.1.5-rc.2` |
| 产品源码改动 | — | 无。本轮没有任何 API 或行为适配 |

## 走廊范围

`dsh-v0.1.5-rc.1...dsh-v0.1.5-rc.2` 共 4 个 commit。与上一轮一样，绝大多数改动是 release 提交对各 `package.json` 的 2 行版本串替换；真正改动源码的文件只落在**上游 web 客户端**：

| 上游变更 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- |
| `packages/client/ui-message-feedback/*`：点赞/点踩改为弹窗确认后提交，失败保留已填内容 | Web 客户端专用，omdsh 不消费（也不依赖 `dsh-message-feedback`） | 无 |
| `packages/client/ui-deliverables/*`、`ui-chat/*`、`ui-primitives/*`：交付卡片排版、对话间距、代码文件图标与 artwork | 同上 | 无 |
| `packages/feedback/message-feedback/src/types.ts`：仅一行注释（"a negative judgment" → "the judgment"） | 无语义变化 | 无 |

判定依据是上游 compare 的完整文件清单：除 `packages/client/**` 与上述一行注释外，其余改动全是 `package.json`、`.agents/notes/**`、`docs/**` 与各包测试。omdsh 的依赖图里没有任何 `packages/client/*` 包，因此这条走廊对它是 version-only。

## 适配清单

| 文件 | 改动 |
| --- | --- |
| `apps/omdsh/package.json` | 103 处 pin → `0.1.5-rc.2` |
| `packages/tui/omdsh-tui/package.json` | 32 处 pin → `0.1.5-rc.2` |
| `package.json`（根） | devDependency `dsh-llm-mock-server` → `0.1.5-rc.2`（第一次替换漏掉了它，见下） |
| `examples/hello/package.json` | peer `dsh-commands` → `0.1.5-rc.2`（同上） |
| `pnpm-workspace.yaml` | `minimumReleaseAgeExclude` 的 133 个 `0.1.5-rc.1` 条目换成 `0.1.5-rc.2` |
| `pnpm-lock.yaml` | 重生成，132 个包换入换出 |
| `CHANGELOG.md` | `Unreleased/Fixed` 记录混装复发与本次同步 |

两处漏改是被验证抓出来的，不是靠肉眼看清单：第一次替换只覆盖了「主要 manifest」，`pnpm install` 之后 lock 里仍留着 4 条 `0.1.5-rc.1`（`dsh-llm-mock-server` 与 `examples/hello` 的 peer）。**全局搜索必须包含根 manifest 与 `examples/` 下的 fixture**，它们不在 workspace 成员里，但会通过打包安装路径进入消费者。

## 基线失败与根因

迁移前基线（clean worktree，`0.1.5-rc.1`）：`omdsh-tui` 830 项与 site 13 项全绿，`apps/omdsh` 有一项稳定失败：

```
examples/hello bundle > boots a Profile-installed command from the packed application
omdsh: agent-presets: preset "standard" failed to mount: failed to apply loader entry persona
(@deepseek-ai/dsh-persona): prompt section "deployment:persona-prefix" is already registered
```

这与 `0.1.5-rc.1` 升级时记录的那次失败**逐字相同**，根因也相同：`^0.1.5-rc.1` 在 semver 上被 `0.1.5-rc.2` 满足，所以凡是只通过 peer 或依赖区间到达的包都会解析到该 tuple 里最新的预发布版。两份 `dsh-system-prompt` 就是两份 prompt section 注册表，persona 前缀因此在第二次注册时报错。

判定方法与上一轮一致：把本轮的渲染器改动 `git stash` 之后该测试**仍然失败**，据此把它与手上工作分离，确认是依赖层面而非产品代码。

这轮复发值得记下的结论是：**rc.1 升级里"把每个 pin 都钉到同一个 prerelease"只把问题推后了一次**。只要图上还有任何 `<0.1.5` 的 prerelease 区间，上游发布下一个 prerelease 就会重新混装。技能卡片 `V015RC-01` 已经预言了这条路径；`apps/omdsh/src/hello-plugin.spec.ts` 的打包安装用例是唯一能捕获它的门，workspace 内带 lockfile 的安装不会复现。

## 验证结果

全部在 `/Users/dy/Workspace/dsh-tui`，依赖替换后先失效构建缓存（删除两个 `tsconfig.tsbuildinfo`）再执行：

| 检查 | 结果 |
| --- | --- |
| `pnpm install` | 132 包换入换出；lock 中 `0.1.5-rc.2` 3677 条、`0.1.5-rc.1` 0 条 |
| 供应链策略 | 过渡期同时保留 rc.1 与 rc.2 条目通过校验；移除 rc.1 后再次执行**不带任何 flag** 的 `pnpm install` 仍通过（1073 entries） |
| `pnpm typecheck` | 通过（tui、apps/omdsh、site 0 errors） |
| `pnpm test` | `omdsh-tui` 830/830、`apps/omdsh` 103/103、site 13/13 全绿（基线失败项已修） |
| `pnpm build` | 通过 |
| `pnpm check:md` | 通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS` |
| `pnpm smoke` | `PTY_SMOKE_PASS exit=0` |
| `git diff --check` | 干净 |
| 打包安装（distribution 证据） | `apps/omdsh/src/hello-plugin.spec.ts` 5/5，含 34 s 的「boots a Profile-installed command from the packed application」 |

供应链策略注意：pnpm 11 的 `minimumReleaseAge` 在解析前先校验**旧 lockfile**，而 rc.2 发布仅 12 小时（默认窗口 24 小时），因此本次按技能卡片 `V015RC-04` 的第二个选项过渡：先把 rc.2 条目**追加**到 `minimumReleaseAgeExclude` 并保留 rc.1，install 成功后再移除 rc.1 条目，最后用一次普通 install 确认策略接受新 lock。放宽窗口或删除 lock 重解析都不是必需的。

## 遗留风险

- 本次只验证了「打包安装能启动」。rc.2 的两项改进都在上游 web 客户端，omdsh 不消费，因此没有对应的 TUI 行为可验，也没有为此新增测试。
- 混合 cohort 的复发条件没有消除，只是再次被钉住。下一次上游发布 prerelease（rc.3 或正式版）时，同一测试会再次失败——这是**预期的把关行为**，不是回归；处理方式是同步全部 pin，包括根 manifest 与 `examples/` fixture。
- 上游 release notes 对 rc.2 只列了两条体验改进，与实际改动范围一致；本轮没有再逐包解包 diff，因为 compare 的文件清单已经显示除 web 客户端外没有源码变化。
