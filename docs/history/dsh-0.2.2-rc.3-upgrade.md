# DSH 0.2.2-rc.1 → 0.2.2-rc.3 升级记录

状态：2026-11-14 在 macOS arm64 上完成。模式是 **Harness cohort migration**：产品依赖整体从 `0.2.2-rc.1` 迁到 `0.2.2-rc.3`，Cordis 一族维持在 `4.1.0` / `1.1.0` / `1.2.0` / `3.19.0`。产品版本随之发布为 `0.27.0`。

## 走廊

| 层 | 源 | 目标 |
| --- | --- | --- |
| DSH | `0.2.2-rc.1`（2026-11-04） | `0.2.2-rc.3`（2026-11-13） |
| Cordis / Loader / Group / Include / Timer | `4.1.0` / `1.1.0` / `1.1.0` / `1.1.0` / `1.2.0` | 不变 |
| Schemastery | `3.19.0` | 不变 |
| 直接 DSH 包 | 146 个 | 全部 `0.2.2-rc.3` |

上游 `rc.1..rc.3` 有 1,574 个提交，`rc.2`/`rc.3` 没有单独的 upgrade guide。契约以安装产物的 `lib/types` 为准，`dsh-v0.2.2-rc.3` 标签源码只用于解释行为。`dsh-doc` 的迁移说明放在 `docs/upgrade-guide/v0.2.2-rc.1/` 下，但只在 rc.2 之后出现。

`@deepseek-ai/dsh-deepseek-account-platform` 在 rc.2 的账户统一提交（`d51d623bfc`）中被删除，不再有 rc.3 发布。其余 145 个直接 DSH 包都有 rc.3；npm 上这些包的 `latest` 仍是旧的 `0.1.0-rc.6` 线，只能用 `next` 或精确版本。

`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 给每个白名单条目追加了 `|| 0.2.2-rc.3`，并把 `deepseek-account-platform` 条目换成统一的 `deepseek-account`。`pnpm install --no-frozen-lockfile` 后 lockfile 中 rc.1 与 rc.2 残留均为 0，187 个唯一 DSH 包全部解析到 rc.3。

## 确认的契约变化与适配

| 变化 | 证据 | 适配 |
| --- | --- | --- |
| DeepSeek 账户与浏览器 PKCE 登录合并进 `dsh-deepseek-account`，`dsh-deepseek-account-platform` 移除；凭据键 scope 仍是 `deepseek-account-platform` | 上游删除提交、两个包的 manifest 与 `dsh-deepseek-account/src/index.ts` 的 `credentialKey('deepseek-account-platform', …)` | 组合行改为挂载 `@deepseek-ai/dsh-deepseek-account`，app 依赖同步替换；既有账户 grant 因 scope 未变继续可读 |
| `account.watch()` 从 `AsyncIterable<AccountView>` 改为 `AsyncIterable<AccountUpdate>`，状态在 `.state`，并带 `snapshot` / `credentials-changed` 类型 | 安装产物 `dsh-deepseek-account/lib/types/types.d.ts` | `/login` 的完成监听、设置页订阅和过期通知全部读取 `update.state`；测试 fixture 同步包装 |
| `AgentRegistry` 移除 `roots()`、`isOwnedBy()` 和 factory 的 owner 参数；live lineage 由 `SubagentRuntime` 拥有 | `docs/upgrade-guide/v0.2.1-rc.3/subagent-runtime-ownership/guide.md`，`dsh-agent` 与 `dsh-subagent` 的 rc.3 d.ts | 文件恢复只记录 `session.header.origin !== 'subagent'` 的顶层 Agent；共享审批用 `subagents.rootOf(agent) === root` 且拒绝 root 自身；`omdsh exec` 按 `session.header.parentSession` 跟踪本次运行的子会话 |
| `listChildren()` 变为 `listDescendants(rootSessionId, signal?)`，返回带 `parentId` / `depth` / 诊断行的递归目录；`waitForChildren()` 变为 `waitForTreeWork(root)` | `dsh-subagent` 的 `list-children.d.ts` 与 `SubagentRuntime` | TUI roster 只取 `kind: 'child'` 且 `depth === 1` 的行；EOF 与 exec 的等待改为 `waitForTreeWork` |
| `@deepseek-ai/dsh-subagent/internal` 不再发布；host prompt 改由公开 `SubagentRuntime.prompt(request, signal)` 承接，图片由 Host admission，请求需要 `SubagentPromptRequestId` | 包 exports、`control-types.d.ts`、`prompt()` 实现 | 被查看子代理的追问改为构造 `PromptContentPart[]`（文本 + base64 图片），用随机 request id 和 `queue`/`steer` 投递；不再要求父 Agent 存活，冷 continuable 子代理可以直接恢复 |
| 子代理 host prompt 只接受 `text` 与 `image`，没有 `file` 类型 | `PromptContentPart` 定义与上游 Web client 的同路径拒绝逻辑 | 含文件的追问在本地直接拒绝并恢复输入，提示 `Subagent follow-up does not accept files.` |
| Creator 的四个 skill 合并为一个 `dsh-doc`，旧 skill 名不再出现在目录中 | `dsh-agent-preset` rc.3 的 `skills/dsh-doc/SKILL.md` 与迁移 guide | `presentation-mode` 回归改查 `dsh-doc`，并确认旧名不再出现 |
| `dsh-app-boot` 新增 `dsh-native-command` 直接依赖 | rc.3 manifest | 传递安装即可，产品组合不新增挂载行；启动冒烟验证必需条目仍成功 |
| `WebRuntime` 发布 `listProviders()` 与 `web/providers-changed` | `dsh-web` 的 `index.d.ts` | 产品适配层保留，但职责收窄为补充 `available()` 快照；注册、目录、重复 ID 拒绝和事件维持上游实现 |
| Session 格式仍为 v4；`AgentHandle.dispose()` 仍不接受 inbox 保留选项 | `dsh-session` 的 `SESSION_FORMAT_VERSION`、`dsh-agent` 的 `dispose()` | 无需迁移；inbox 释放后清空的结论对 rc.3 仍成立 |

## 核对后无需改动

- `dsh-agent` 的模型选择持久投影、native/PTC 执行器、`schedule.edit`、子模型选择和发现接口未再变化。
- `dsh-tools` 的 executor 配置、`dsh-session-projection`、`dsh-credentials`、`dsh-authorization` 的公开形状未命中产品用法。
- `dsh-subagent-codex` 的 `lib/index.js` 在 rc.1 与 rc.3 逐字节相同（SHA-256 `68dfa5d6…`），仍钉 `@openai/codex 0.153.4`。
- `dsh-host-webserver`、`dsh-terminal`、`dsh-llm-deepseek-*` 的 peer 与行为变化由现有组合和回归覆盖，未改产品代码。

## 验证

macOS arm64，Node 24.18.0，pnpm 11.20.0。测试统一用 `LANG=C LC_ALL=C` 运行；本机默认 `zh_CN.UTF-8` 会让既有英文断言失败，与本次升级无关。

| 检查 | 结果 |
| --- | --- |
| `CI=true pnpm install --no-frozen-lockfile` | 通过；rc.1 / rc.2 残留 0，rc.3 覆盖 187 个唯一 DSH 包 |
| `pnpm typecheck`（删除两个 `tsconfig.tsbuildinfo` 后） | 通过，含站点 `astro check` |
| `pnpm test` | TUI 3,135、CLI 234、站点 14，全部通过 |
| `pnpm build` | 通过 |
| `pnpm check:md` / `pnpm check:boundaries` / `git diff --check` | 通过 |
| `pnpm smoke:happy` | `HAPPY_SMOKE_PASS status=0` |
| `pnpm smoke` | `PTY_SMOKE_PASS`、`PTY_MODES_SMOKE_PASS`、`PTY_INSPECT_SMOKE_PASS` 全部通过 |
| `pnpm smoke:interrupt` | `STREAM_INTERRUPT_SMOKE_PASS latency=72ms` |
| 参考子模块 | 三个 `refs/*` 工作区干净；无符号链接指向 `refs/` |

## 残余风险与后续工作

- 统一账户包新增了通知列表/内容/事件 API，TUI 目前只消费登录、profile、balance 和过期事件，尚未展示通知；这是可后续接入的产品功能，不是本次回归。
- 子代理追问不再接受文件，这是上游 host prompt 契约的限制；含文件的草稿会原样恢复到 composer。
- `dsh-native-command` 只作为 app-boot 的传递依赖安装，未在 Windows 实机验证；Windows CI 覆盖完整测试集。
- rc.1 记录中的 HMR 首次刷新卸载循环仍未在本轮复现或排除，属于上游遗留问题。

## 回滚

`git revert` 本次发布准备提交即可回到 rc.1；`pnpm-workspace.yaml` 保留历史白名单，回滚后可直接 `pnpm install --no-frozen-lockfile` 重建旧 cohort。Session 格式未变；账户凭据 scope 未变，rc.1 仍能读取 rc.3 写入的 grant。
