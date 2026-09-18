# DSH 0.1.6-alpha.1 适配方案（MCP resources、/feedback、PTC 编排面、预设呈现、DeepSeek 搜索）

> 状态：**方案待实施**。基线是刚完成的 `0.1.6-alpha.1` 迁移（`e4b13ed`）。本文取代 [`upstream-adaptation-plan.md`](./upstream-adaptation-plan.md) 中的两处决策：**D2**（工具行统一挂宿主、由 TUI 映射 PTC 呈现）与 **D8**（web search 默认关闭），并处置该文件 P1 推迟清单里的 `feedback` 项。其余推迟项（hooks、schedule、time/tmux context、skill-badge）不在本批范围。

## 基线与判定方法

判定全部来自当前工作树与 `refs/deepseek-harness`（`dsh-v0.1.6-alpha.1`）的可复现比对：

```sh
# 1. 上游 base bundle 有、omdsh 组合没有的行
grep -oE "name: *'[^']+'" apps/omdsh/config/cordis.yml | sed "s/name: *'//; s/'//" | sort -u > /tmp/omdsh-rows.txt
grep -oE "name: *'[^']+'" refs/deepseek-harness/packages/bundle/base/cordis.patch.yml | sed "s/name: *'//; s/'//" | sort -u > /tmp/base-rows.txt
comm -13 /tmp/omdsh-rows.txt /tmp/base-rows.txt

# 2. 上游 preset 行（ptc 是 PTC 呈现的参考实现）
sed -n '1,40p' refs/deepseek-harness/packages/preset/agent-presets/presets/ptc/agent.cordis.yml
```

第 1 条差集去掉非 TUI 宿主形态后剩 12 项，本方案只取与用户/模型可见行为相关的四项；第 2 条给出预设呈现与编排面的参考语义。

## A 组：低成本对齐

### A1 · MCP resources

| 项 | 内容 |
| --- | --- |
| 上游包 | `@deepseek-ai/dsh-mcp-resources`（依赖只有 `dsh-util-values`，无安装脚本） |
| 现状 | 我们挂了 `dsh-mcp-client` 与 `mcp.json` 配置缝（`apps/omdsh/src/mcp-config.ts`），但模型只能看到 MCP tools，看不到 resources |
| 上游语义 | 三个共享工具：列服务器、list/read 资源；每次调用必须点名服务器，文本进会话历史、二进制只对程序化调用方可用；调用方作用域里配置了服务器时才出现 |
| 落地动作 | `apps/omdsh/package.json` 加精确版本依赖；`cordis.yml` 在 `mcp` 相关行之后插一行（无配置项） |
| 验证 | 组合级断言（行名与顺序）；扩展 `mcp-config.spec.ts` 或新增用例：写一份 `mcp.json` 指向 stdio 假服务器，断言资源工具注册且 `resources/read` 结果进入工具输出 |
| 风险 | 无——工具只在有 MCP 服务器时才有内容；模型侧多三个 schema 的成本与上游 base 一致 |

### A2 · `/feedback`

| 项 | 内容 |
| --- | --- |
| 上游包 | `@deepseek-ai/dsh-command-feedback` |
| 现状 | TUI 没有反馈入口 |
| 上游语义 | `/feedback <text>` 追加一条 `feedback/record` 会话事件：立即生效、不启动模型、模型不可见、不打断运行；命令输出确认会话 id 与匿名用户 id |
| 落地动作 | 加依赖 + `cordis.yml` 一行；命令会经 `dsh-commands` 自动出现在 TUI 命令目录与 `/help` |
| 验证 | 组合级断言 + 命令级用例：真实 boot 后 `commands.list()` 含 `feedback`，执行后会话日志出现 `feedback/record`；转录渲染保持既有 fallback（不新增渲染） |
| 决策 | 记 D12：**不**新增 TUI 侧反馈 UI（分类弹窗、遥测上报），只提供 log-only 命令；上游的面板是 Web Remote 形态，TUI 不适用 |

### A3 · PTC 预设不暴露第二个编排面

| 项 | 内容 |
| --- | --- |
| 上游语义 | `presets/ptc/agent.cordis.yml` 明确 `tool-workflow` `disabled: true`（注释：「不要在 `run_code` 之外再暴露第二个模型编排面」），`workflow-ptc` 引擎随 `tool-ralph` 一起关；`ralph` 默认关 |
| 现状 | omdsh 的 `code` 预设是 PTC 呈现，但宿主挂了 `tool-workflow`（`workflow_run`）与 `workflow-ptc`，模型同时看到 `run_code` 与 `workflow_run` |
| 机制判断 | preset 是 agent-plane 组合，无法把宿主行的 `disabled` 打开（对宿主 id 的 patch 在 preset 作用域里静默跳过）。可行手段是产品自己的 `agent-profile` 行：`ToolRestriction` 有 `allow` 与 `deny`，`packages/tui/omdsh-tui/src/runtime/agent-profile.ts` 已经用它做 minimal 预设的收窄 |
| 落地动作 | `apps/omdsh/config/agent-presets/code/agent.cordis.yml` 增加 `agent-profile` 行，`tools.deny: [workflow_run]`。`ralph` 不能写进 deny：`tools.restrict()` 对未注册的全局工具名直接报错（挂载期失败，实测信息 `tools.restrict() names unknown global tool "ralph"`），而它在本部署里是 disabled；注释记录 overlay 恢复它的取舍 |
| 验证 | 新增 `apps/omdsh/src/presentation-mode.spec.ts`：真实 boot + mock LLM，断言 code 预设的线上工具名含 `run_code`、不含 `workflow_run`/`ralph`，standard 预设相反；`composition.spec.ts` 增加预设文件断言 |
| 风险 | 用户若在 `code` 预设里依赖 `workflow_run`，行为变化需写入 CHANGELOG `Changed`（已写） |

## B · 预设声明取代 TUI 运行时呈现切换

| 项 | 内容 |
| --- | --- |
| 上游包 | `@deepseek-ai/dsh-agent-tool-presentation`（`Config.mode: native \| ptc \| both` 必填，`apply` 调用 `ctx.tools.presentAs(mode)`，PTC/both 在挂载期校验 `ptcRuntime` 存在） |
| 现状 | TUI 在会话挂载时调用 `tools.presentAs(toolPresentationForPreset(preset.id))`（`session/session-controller.ts:99`），切换预设时 `#replaceToolPresentation`（:1334），映射表在 `session/session-configuration.ts:17` |
| 冲突约束 | `dsh-tools` 的 `presentAs` 对同一作用域重复声明会抛错（"one composition selects one presentation"），所以**必须**成对删除 TUI 调用，不能同时保留 |
| 落地动作 | ① `apps/omdsh/package.json` 加依赖；② 只给 `code` 预设加一行 `tool-presentation`（`mode: ptc`）：`standard`/`minimal`/`cordis` 与上游标准预设一致地继承部署默认（宿主 `tools` 行的 `mode: native`）；③ 删除 `session-controller.ts` 的 `presentAs`/`#replaceToolPresentation`/`disposeToolPresentation` 与 `session-configuration.ts` 的 `toolPresentationForPreset`；④ 状态栏不需要新的映射：它展示的是预设标签（`formatAgentPreset` 把 `code` 显示为 `PTC`），不是呈现模式 |
| 验证 | 现有 TUI 881 项测试 + `pnpm smoke:happy`（默认 `code` 预设走真实 PTC 路径）+ `presentation-mode.spec.ts` 的线上工具名断言 + `composition.spec.ts` 的预设文件断言 |
| 风险 | 展示映射与预设行短暂不一致的可能由一致性测试兜底；预设挂载期失败（例如未挂 PTC runtime 时误用 `mode: ptc`）会在 boot 阶段暴露，比现在运行时静默回退更早、更响 |

## C · DeepSeek 搜索开关

| 项 | 内容 |
| --- | --- |
| 上游包 | 提供者 `@deepseek-ai/dsh-web-search-deepseek`（有自己的 settings 段：`apiKey`/`apiKeyEnv`/`baseURL`/`model`/`maxTokens`/`maxUses`），工具开关在 `dsh-tool-web` 的 `Config.search`（默认 true，**无 settings 段**） |
| 现状 | `tool-web` 显式 `search: false`，只提供匿名 `web_fetch`（D8 决策） |
| 现证据变化 | ① 上游 base 与 `ptc` 预设都挂搜索提供者；② DeepSeek 搜索走 Messages 协议，与刚迁移的默认协议一致；③ 提供者的 `model`/`maxUses`/`maxTokens` 可经设置段在线调整 |
| 方案 | **已采纳阶段一**：加依赖 + 挂提供者行（`apiKeyEnv: DEEPSEEK_API_KEY`、显式 `maxUses: 5`）+ `tool-web` 改 `search: true`、`searchTimeoutMs: 60000`（对齐上游 base/ptc 预设）。开关语义 = 关闭走自家 overlay 的 `tool-web` 配置；运行期调整走提供者的设置段（`model`/`maxTokens`/`maxUses`/`baseURL` 可热改，因为它的设置段只在前向投影值、注册时不携带解析结果）。**不做**产品自带的运行时挂载：工具目录在运行期增删会作废 prompt 缓存，与 `agent-tool-presentation` 注释里"工具目录保持请求级稳定"的约束冲突 |
| 验证 | `pnpm smoke:happy` + `web-search.spec.ts`：组合行（提供者行在 `web-fetch-http` 之前、`tool-web` 三个配置项）与线上工具名（`web_search` 与 `web_fetch` 同时出现）。真实搜索调用需要 DeepSeek 凭据，属上游 provider 测试范围 |
| 决策 | 记 D13：取代 D8 —— 搜索默认开启，理由是官方提供者已随 base 发布、协议已对齐；成本控制交给 `maxUses` 与设置段。用户不需要搜索时可通过 overlay 关掉 |
| 风险 | 每次搜索是一次完整模型请求（延迟与 token 成本）；企业网关若未开放搜索端点会在调用时报错，需在 CHANGELOG 说明 |

## 依赖与仓库配置变更

每个新挂载的包都要同步四处（沿用既有约定）：`apps/omdsh/package.json` 精确版本、`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 条目、`pnpm-lock.yaml` 重生成、必要时 `allowBuilds` 放行。本批新增包：`dsh-mcp-resources`、`dsh-command-feedback`、`dsh-agent-tool-presentation`、`dsh-web-search-deepseek`（若采用阶段一）。`packages/tui/omdsh-tui` 若需要读取预设文件做一致性测试则不需新依赖（测试运行在 `apps/omdsh` 侧更合适）。

## 验证计划

按仓库要求执行完整验证集，并为每项追加针对性证据：

| 检查 | 期望 |
| --- | --- |
| `pnpm install` / `typecheck` / `build` | 通过，lock 仍为单一 cohort |
| `pnpm test` | 通过；新增 A1/A2/A3/B 的组合断言、映射一致性测试、`/feedback` 命令用例 |
| `pnpm smoke:happy` | 通过（覆盖默认 `code` 预设的 PTC 路径与新的搜索工具目录） |
| `pnpm smoke` / `pnpm smoke:interrupt` | 通过（组合行变化影响启动路径） |
| `pnpm check:boundaries` / `pnpm check:md` / `git diff --check` | 通过 |
| refs 审计三命令 | 无 `refs/` 依赖引用；三个 submodule clean |

## 决策点

- **D10 · MCP resources 挂宿主层**：与 MCP `mcp.json` 缝同一层，便于「配置了服务器才出现」的上游语义；不放进 preset。
- **D11 · `/feedback` 只做 log-only 命令**：分类与上报是 Web Remote 形态，TUI 不引入第二套反馈面板。
- **D12 · PTC 编排面用 `agent-profile.deny` 收窄**，不改宿主行、不复制上游 preset 的引擎行；若将来做 preset plane 下沉（把工具行移入预设 + `isolate` realm），本项随之重写。
- **D13 · DeepSeek 搜索默认开启**（取代 D8）：官方提供者已随 base 发布、与 Messages 协议同源、按次经凭据服务解析 key；成本用显式 `maxUses: 5` 与 `searchTimeoutMs: 60000` 约束，需要关闭的部署在自家 overlay 里改 `tool-web`。
- **D14 · 呈现切换下沉到预设行**（取代 D2 的 TUI 映射部分）：TUI 既不选择也不展示呈现模式——状态栏用的是预设标签（`code` → `PTC`），呈现只由预设声明的 `tool-presentation` 行决定；`standard`/`minimal`/`cordis` 不声明，继承宿主 `tools` 行的 `native` 默认。
- **D15 · 本批不发布**：版本号、tag、npm 发布留待发布决策，与上一轮一致。

## 风险与回退

- 每项是独立的一组行/文件改动，`git revert` 单个提交即可恢复；`agent-tool-presentation` 与 TUI 切换逻辑必须同一提交内成对删除，否则启动即抛"one composition selects one presentation"。
- 预设的呈现行在挂载期校验：`ptc` 模式需要宿主 PTC runtime，缺失时该预设挂载失败并点名行 id（实现期已用 `ralph` 的 deny 失败验证过这条 fail-loud 路径）。
- A1 的资源工具会随 MCP 服务器数量出现在工具目录里；不做按服务器过滤（上游语义即如此）。真实协议行为由上游包测试覆盖，本仓的假服务器集成用例留作后续。
- `code` 预设不再向模型暴露 `workflow_run`（A3）：依赖它的用户需要改用 `standard` 或在自家预设里去掉 deny，行为变化已写入 CHANGELOG `Changed`。
- 搜索默认开启会改变账单与延迟特征；CHANGELOG 必须写明，并提供 overlay 关闭路径（C 项待定）。

## 实施结果

A 组与 B 已落地，证据如下：

| 项 | 证据 |
| --- | --- |
| A1 MCP resources | `composition.spec.ts` 断言行名与顺序；行挂在 `tool-web` 之后。资源工具的真实协议行为留给上游包测试；本仓未新增假 MCP 服务器用例（列入后续项） |
| A2 `/feedback` | `feedback-command.spec.ts`：真实 boot → `/feedback probe remark` → 退出码 0、输出确认会话与匿名用户、冷读会话日志得到一条 `feedback/record`（`text: probe remark`）且**没有** `request/header`/`turn/start` |
| A3 PTC 编排面 | `presentation-mode.spec.ts`：code 预设的线上工具名含 `run_code`、不含 `workflow_run`；`ralph` 因未注册无法 deny，实测挂载期报错确认了这条约束 |
| B 预设呈现 | `presentation-mode.spec.ts` 的 standard 对照：线上工具名含 `workflow_run`、`bash`，不含 `run_code`；`pnpm smoke:happy` 通过（code 预设真实挂载 `tool-presentation`） |
| C DeepSeek 搜索 | `web-search.spec.ts`：组合行（`web-search-deepseek` 在 `web-fetch-http` 之前、`apiKeyEnv`/`maxUses` 钉值、`tool-web` 的 `search`/`fetch`/`searchTimeoutMs`）与线上工具名（`web_search`、`web_fetch` 同时出现） |
| 回归 | TUI 881/881、`apps/omdsh` 111/111、`site` 13/13；`typecheck` / `build` / `check:boundaries` / `check:md` 通过 |

三个 mock/共享用例（`present-tool.spec.ts`、`happy-smoke`、`stream-interrupt-smoke`）继续在临时设置段 pin `protocol: chat-completions`，与本文件 C 项无关。

## 实施清单

- [x] A1 `dsh-mcp-resources`：依赖 + 行 + 组合断言（假 MCP 服务器集成用例留作后续）
- [x] A2 `dsh-command-feedback`：依赖 + 行 + `feedback-command.spec.ts` + CHANGELOG `Added`
- [x] A3 `code` 预设 `agent-profile.deny: [workflow_run]` + `presentation-mode.spec.ts` + CHANGELOG `Changed`
- [x] B `dsh-agent-tool-presentation`：`code` 预设行 + 删除 TUI `presentAs`/映射 + 线上工具名断言 + CHANGELOG `Changed`
- [x] C `dsh-web-search-deepseek`：依赖 + 提供者行 + `tool-web` `search: true` / `searchTimeoutMs: 60000` + `web-search.spec.ts` + CHANGELOG `Added`/`Changed`（D13 记录取代 D8）
