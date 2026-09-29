# DSH 0.2.0-rc.1 → 0.2.0-rc.2 适配评估（未实施）

模式：**assessment only**。本文件是一次只读评估的记录：基线是工作树当前的 `0.2.0-rc.1`，目标是 npm 上 2026-09-29 17:44（+08）发布的 `0.2.0-rc.2`。评估期间没有改动依赖、组合、源码或 lockfile，下面的「改动清单」是实施时需要动的文件与计数，不是已完成的记录。体例与验证口径对照 [`dsh-0.2.0-rc.1-upgrade.md`](./dsh-0.2.0-rc.1-upgrade.md)。

## 基线与目标

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort | `0.2.0-rc.1`（2026-09-28 发布，次日 21:42 迁入） | `0.2.0-rc.2`（2026-09-29 09:44Z 发布）。npm 的 `latest` 与 `next` 都已指向它，任何不钉版本的安装都会拿到它；`alpha` 仍停在 `0.1.7-alpha.2` |
| 上游 tag | `dsh-v0.2.0-rc.1`（`4878cdabd8`） | `dsh-v0.2.0-rc.2` |
| 直接 pin | `apps/omdsh` 117 个 `dsh-*`，`omdsh-tui` 33 个依赖 + 2 个 `devDependencies`，根 `dsh-llm-mock-server`，`examples/hello` 的 peer `dsh-commands` | 共 154 处换成 `0.2.0-rc.2` |
| 基础层 | Cordis `4.0.4`、cordis-plugin-loader `1.0.5`、cordis-plugin-timer `1.1.6`、Schemastery `3.18.4` | 全部不变，rc.2 每个包的 cordis peer 仍是 `~4.0.4` |
| 解析图 | lock 中 164 个 `@deepseek-ai` 包、1865 处 `0.2.0-rc.1` | 期望仍是单 cohort，`0.2.0-rc.1` 归零 |

## 走廊规模

上游 `dsh-v0.2.0-rc.1` → `dsh-v0.2.0-rc.2` 是 187 个 commit、913 个改动文件、106 个新增、6 个删除，但绝大多数落在 web 与桌面客户端。按本仓 lockfile 解析出的包名过滤后，真正落在消费面上的只有 **8 个包的 16 个源文件**（13 改 3 增），另有 `dsh-sandbox-windows-acl` 的技能资产与 `dsh-agent-preset` 的一份技能参考文档。

这次走廊比 rc.1 干净：没有新增包、没有包改名、没有删除包，上游 base bundle 的组合文件 `packages/bundle/base/cordis.patch.yml` 逐字节未变（该目录唯一的改动是 `package.json` 的版本串）。上游唯一删除的文件是 `patches/@earendil-works__pi-ai@0.85.1.patch`，补丁内容已被 pi-ai 自身吸收；本仓没有 `patches/` 目录，也没有 `patchedDependencies`，不受影响。

## 影响面

| 项目 | 上游改动 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- | --- |
| 定时问答 | `dsh-tool-ask-user` 新增 `Config { mode: 'legacy' \| 'timed', timeout: 120 }`；`dsh-user-questions` 改为 `TypertRemoteService`，新增 `userQuestions` 会话投影、`@Remote answer()`、`@Remote({ mode: 'stream' }) attachWait()`、`askTimed()`，并新增消息源 `user-question-reply` | 默认仍是 `legacy`，现有问答路径不变。开启 `timed` 后 TUI 不参与该协议：没有倒计时，超时后没有补答入口，迟到的答复批次也不进转录 | 需要产品决策，见下节 |
| pi-ai 目录 | `@earendil-works/pi-ai` `0.85.1` → `0.87.1`：新增 `mistral-conversations` compat gate 与 `pi-messages` 协议，compat 字段成组替换（`deferredToolsMode` / `supportsToolReferences` 等改为 `supportsMidConvo*`），模型目录 1393 → 1536 条（删 68、增 211，含 `deepseek :: deepseek-v4-flash` 被 `deepseek-flash` 取代） | `llm-pi-ai` 是休眠的多 provider 孪生，`/auth` 与 `/model` 都按目录动态发现，产品代码零改动；风险是用户保存过的 pi-ai 模型 ID 可能已不存在 | CHANGELOG 记一行 |
| shell 工具描述 | `tool-bash` 与 `tool-pwsh` 增加「删除或移动前核对解析后的绝对路径」「不要给 `$HOME` 这类自动变量赋值」 | 模型可见的 prompt 文本变化，无代码面 | CHANGELOG 记一行 |
| 持久 pwsh | 状态行带尾随空格时不再丢失退出码、不再泄露内部标记 | Windows 行为修复 | 跟随上游 |
| Windows ACL 沙箱 | 诊断技能改为经一次授权完成诊断与修复，保留修改前备份与恢复命令 | 只在启用该沙箱的 Windows 部署上可见 | 跟随上游 |
| cordis inspect | `cordis-host-runner` 新增 `clientInspectTimeoutMs`（默认 10 000 ms），client 查询改为无连接即 fail-fast、超时上报并保留首个失败诊断 | TUI 不使用 client inspect，无行为变化 | 可选：在 `cordis` 行显式钉住该值 |

## 需要决策的项：定时问答

这一项是本次走廊唯一可能的破坏面，因为它同时触及组合契约与呈现层。

- **默认不开启**：`tool-ask-user` 的 `mode` 默认 `legacy`，与 rc.1 的阻塞式问答逐字一致，所以只做版本迁移不需要任何适配。要开启必须在 Profile patch 里显式写 `mode: timed`。
- **组合面不需要新行**：`TypertRemoteService` 是自包含的，构造函数只做 `bindTypertRemote(this, this.name, options)`，其中只读取 `ctx.root.reflect.props` 与 `ctx.root.accessor`。这两者在 Cordis `4.0.4` 上都存在（已实测），因此不需要补挂 `dsh-typert-loader` / `dsh-typert-registry` / `dsh-api-gateway`。`dsh-user-questions@0.2.0-rc.2` 新增的 peer（`dsh-typert-protocol`、`dsh-session`、`dsh-session-projection`）与新依赖 `zod@^4.4.3` 本来就在解析图里。
- **呈现面确有缺口**：TUI 的 answerer 只是一个 `user-questions/request` 监听器（[`interaction-adapter.ts`](../packages/tui/omdsh-tui/src/session/interaction-adapter.ts#L109) 的 `bindHumanInteraction`），既不 `attachWait` 拿剩余时间，也不实现 `answer()` 投递迟到答复；而且转录只把 `source.kind === 'user'` 的用户消息当人类输入（[`event-views.ts`](../packages/tui/omdsh-tui/src/views/event-views.ts#L389)、[`commands/session.ts`](../packages/tui/omdsh-tui/src/commands/session.ts#L27)），`user-question-reply` 会被静默丢弃。
- **两条路线**：其一，保持不开启，并在文档里说明 `timed` 不受支持；其二，补齐 TUI 参与——倒计时行、`attachWait` 订阅、超时后的补答入口，以及转录把 `user-question-reply` 渲染成一条「迟到的答复」。第二条会同时改动 `chrome/` 呈现、`session/` 交互与 `views/` 事件映射，值得单独一次改动。

## 若实施迁移：改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/omdsh/package.json` | 117 个 `dsh-*` pin → `0.2.0-rc.2`（`cordis-plugin-loader`、`cordis-plugin-timer`、`schemastery` 不动） |
| `packages/tui/omdsh-tui/package.json` | 33 个依赖 + 2 个 `devDependencies` pin → `0.2.0-rc.2` |
| `package.json`（根） | devDependency `dsh-llm-mock-server` → `0.2.0-rc.2` |
| `examples/hello/package.json` | peer `dsh-commands` → `0.2.0-rc.2` |
| `pnpm-workspace.yaml` | 155 条 age-gate 条目追加 `\|\| 0.2.0-rc.2`（沿用既有累加式写法）。`@earendil-works/pi-ai@0.87.1` 发布于 2026-09-22，与 `0.85.1` 当初处境相同（那条也没有单独新增条目）；若安装时发布龄门拒绝，再补一行 |
| `pnpm-lock.yaml` | 重生成，审查 diff 只含 cohort 版本变化 |
| `CHANGELOG.md` | `Unreleased` 记 cohort、pi-ai 目录变化、shell 工具描述变化；定时问答按上节决策记录 |
| `refs/deepseek-harness` | 子模块指针移到 `dsh-v0.2.0-rc.2`，只移动指针 |

产品源码预计零改动，理由与 rc.1 走廊同源：本次没有包名或行名变化，唯一的组合面风险（`user-questions` 的基类换了）已按上文核对为自包含。

## 与 rc.2 无关的旧账

[`upstream-adaptation-plan.md`](./upstream-adaptation-plan.md) 里带触发条件的四项今天核对仍是 0 命中：hooks（`dsh-hook-protocol` 与 claude-code/codex 桥）、`dsh-schedule`、`dsh-time-context` / `dsh-tmux-context`、`dsh-skill-badge`（上游 base 一直挂着它）。该文件里明确「不做」的 PTC 子调用折叠与 `/plugins` 运行时清单，结论未变。

## 证据与复现

```sh
# 1. 上游是否又前进了一步
npm view @deepseek-ai/dsh dist-tags --json

# 2. 走廊规模与逐文件差异（compare API 的 files 上限 300，用 tree 对比取全量）
curl -s "https://api.github.com/repos/deepseek-ai/deepseek-harness/compare/dsh-v0.2.0-rc.1...dsh-v0.2.0-rc.2"
curl -s "https://api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/dsh-v0.2.0-rc.2?recursive=1"

# 3. 本仓解析图的包名，用来过滤上游改动
grep -oE "^  '@deepseek-ai/[a-z0-9.-]+@" pnpm-lock.yaml | sed "s/^  '//; s/@$//" | sort -u

# 4. 组合行差：上游 base 挂了、我们没挂
grep -oE "name: *'[^']+'" apps/omdsh/config/cordis.yml | sed "s/name: *'//; s/'//" | sort -u > /tmp/omdsh-rows.txt
grep -oE "name: *'[^']+'" refs/deepseek-harness/packages/bundle/base/cordis.patch.yml | sed "s/name: *'//; s/'//" | sort -u > /tmp/base-rows.txt
comm -13 /tmp/omdsh-rows.txt /tmp/base-rows.txt

# 5. pi-ai 目录差：两个版本各 npm pack 一次，比对 dist/providers/data/*.json 的模型 id
npm pack @earendil-works/pi-ai@0.85.1 && npm pack @earendil-works/pi-ai@0.87.1

# 6. TUI 侧的三个缺口证据
rg -n "user-questions/request" packages/tui/omdsh-tui/src/session/interaction-adapter.ts
rg -n "source.kind !== 'user'" packages/tui/omdsh-tui/src
```

## 验证状态与风险

- 本次只取得只读证据：每个包在 rc.2 是否已发布（164 个包中除 Cordis 与原生 addon 等基础层外全部有 rc.2）、上游源码逐文件差异、新 peer 与依赖是否已在图中、`user-questions` 新基类的构造路径、以及 TUI 侧缺口的位置。
- **没有**执行 `pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm smoke`。所以「迁移可行」是推断而非实测；实施时必须以 [`AGENTS.md`](../AGENTS.md) 的完整验证集确认，重点观察 `user-questions` 在真实组合里是否照常激活（本文件的判断依据是其构造路径，而不是运行时探针）。
- 事实有效期很短：`0.2.0-rc.2` 是 prerelease，上游随时可能推进到 rc.3 或 `0.2.0` 正式版，npm 的 `latest` 也会跟着移动。复核时重跑上面第 1、2 条命令，不要采信本文件的结论。
