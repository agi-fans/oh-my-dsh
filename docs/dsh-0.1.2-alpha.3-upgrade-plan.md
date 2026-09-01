# DSH 0.1.2-alpha.2 → alpha.3 升级方案（spine 拆除）

## 目标与范围

把 omdsh 的 DeepSeek Harness 依赖队列从已适配的 `0.1.2-alpha.2` 升级到最新 `0.1.2-alpha.3`。模式：**Harness cohort migration**。本次升级的唯一实质障碍是上游在 alpha.3 中无别名删除了 `@deepseek-ai/dsh-agent-spine-demo`（连同整个 `packages/examples` 组），omdsh 当前依赖该包提供核心 agent 组合，必须先把它展开为显式插件行。

| 项目 | 基线 | 目标 |
| --- | --- | --- |
| DSH cohort（apps/omdsh 直接依赖） | `0.1.2-alpha.2`（59 个） | `0.1.2-alpha.3`（74 个 = 59 − 1 + 16） |
| 跨仓库唯一 DSH 包名 | 67 个（apps/omdsh 59 + TUI 29 + 根 1 去重） | 78 个（67 − 1 spine + 12 新名字） |
| Harness source tag | `dsh-v0.1.2-alpha.2` | `dsh-v0.1.2-alpha.3` |
| 组合来源 | `@deepseek-ai/dsh-agent-spine-demo`（id: `spine`） | `apps/omdsh/config/cordis.yml` 内显式展开（20 行） |

## alpha.2 → alpha.3 契约差异（omdsh 相关）

| 上游变更 | 对 omdsh 的影响 | 处理 |
| --- | --- | --- |
| #3128 移除 `dsh-agent-spine-demo` | 直接依赖缺失，`spine` 行无法解析 | 本文档主体：展开组合（见下） |
| #3339 session 持久化收窄为 JSONL-only | 无：omdsh 只使用 `dsh-session-persistence-jsonl`；`dsh-session-query-sqlite` 保留 | 无改动 |
| #3277 `read_image` 支持无扩展名 + 签名嗅探 | 纯增强，工具描述随包自带 | 无代码改动 |
| #3208 等 attachment/subagent prompt admission 调整 | 运行时行为变化：图片随 steer/follow-up 消息投递、prompt admission 与 echo 归属调整 | 聚焦检查 subagent 图片投递路径（见验证计划） |
| `dsh-session-projection` identity-gated change feed | 运行时行为变化：raw view 按 `Object.is` 对比、视图按状态身份 memoize（约 10 个 commit） | 聚焦检查 projection/resume（见验证计划） |
| #3208 subagent 错误码 `attachment-unsupported` → `attachment-invalid` | 无：产品代码未引用旧错误码 | 无改动 |
| 其余（web/CI/测试侧） | 无运行时影响 | 无改动 |

## spine 展开方案

### 现状

`apps/omdsh/config/cordis.yml` 中 `id: spine` 挂载 `@deepseek-ai/dsh-agent-spine-demo`，配置：

```yaml
- id: spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    workspaceContext:
      maxBytes: 65536
    dshHome: !!js process.env.OMDSH_HOME || undefined
    skills:
      enabled: true
    goals:
      domain: {}
      tool: {}
    tools:
      mode: native
```

spine 包的 `apply()`（alpha.2 源码）按此配置转发并逐个挂载 **26 次子插件调用**。omdsh 已在根配置显式挂载其中 **6 项**，其余 **20 项**依赖 spine 隐式提供。

> **重要**：6 个现有项（timer/llm/session/session-projection/session-title/agent）**本来就在根级**，展开不会移动它们——被移除的是 spine 嵌套挂载产生的 6 个**嵌套副本**；20 个原 spine 拥有的插件调用则重新表达为根级兄弟行。组合变化 = 移除 6 个嵌套副本 + 在根级重新表达 20 个嵌套插件。这不是纯机械替换——实例身份与 fiber/生命周期归属随之变化，需要真实挂载证据（`--dump-config` + 运行时 smoke）确认行为不变。

### 挂载映射

| spine `apply()` 调用 | omdsh 现状 | 展开处理 |
| --- | --- | --- |
| `Timer` | ✅ `timer`（cordis.yml:10） | 保留根级一份（消除双重挂载） |
| `LlmRuntime` | ✅ `llm`（:13） | 同上 |
| `SessionStore` | ✅ `session`（:23） | 同上 |
| `SessionProjectionRegistry` | ✅ `session-projection`（:34） | 同上 |
| `SessionTitleService` | ✅ `session-title`（:37，8/80/120） | 同上；不再有 spine 示例值（5/40/80）覆盖风险 |
| `SystemPrompt` | ❌ | 新增 `dsh-system-prompt` 行（默认值与 spine 一致：`includeHarnessIdentity: true`、`includeRuntimeContext: true`、`persona: ''`） |
| `ToolRuntime` | ❌ | 新增 `dsh-tools` 行（`mode: native`，即该包默认值，显式写出以对齐原配置） |
| `SkillRegistry` | ❌ | 新增 `dsh-skill` 行 |
| `SkillFileSystem` | ❌ | 新增 `dsh-skill-filesystem` 行（`dshHome` 同 spine） |
| `AgentRegistry` | ✅ `agent`（:96） | 保留根级一份 |
| `llmRetry` | ❌ | 新增 `dsh-llm-retry` 行 |
| `GoalService` | ❌ | 新增 `dsh-goal` 行（默认配置） |
| `toolGoal` | ❌ | 新增 `dsh-tool-goal` 行（默认配置） |
| `goalSession` | ❌ | 新增 `dsh-goal-round-driver` 行 |
| `LocalJobRegistry` | ❌ | 新增 `dsh-jobs-local` 行 |
| `toolJobs` | ❌ | 新增 `dsh-tool-jobs` 行 |
| `InvariantRegistry` | ❌ | 新增 `dsh-invariants` 行 |
| `sessionInvariant` | ❌ | 新增 `dsh-session/invariant` 行 |
| `agentInvariant` | ❌ | 新增 `dsh-agent/invariant` 行 |
| `scopeInvariant` | ❌ | 新增 `dsh-scope/invariant` 行 |
| `agentLoopInvariant` | ❌ | 新增 `dsh-agent-loop/invariant` 行 |
| `bashEnv` + `toolBash` | ❌ | 新增 `dsh-shell-env`（`dshHome`）+ `dsh-tool-bash` 行（见决策点 D1） |
| `workspaceContext` | ❌ | 新增 `dsh-agent-instructions` 行（`maxBytes: 65536`） |
| `toolSkill` | ❌ | 新增 `dsh-tool-skill` 行 |
| `AgentLoop` | ❌ | 新增 `dsh-agent-loop` 行（`agents: []`，与 spine 默认一致） |

**顺序约束**：spine 源码注明 workspace instructions 与 skill catalog 都以 session 前缀消息注入，注册顺序即渲染顺序——`dsh-agent-instructions` 行必须排在 `dsh-tool-skill` 行之前。

### 展开后的精确 YAML（插入原 `spine` 行位置，`permission` 与 `code-runtime` 之间）

```yaml
  # — spine 展开块（替代已删除的 @deepseek-ai/dsh-agent-spine-demo）—
  # 顺序遵循上游 spine apply() 的挂载顺序；agent-instructions 必须先于
  # tool-skill 注册（两者都以 session 前缀消息注入，注册顺序即渲染顺序）。
  - id: system-prompt
    name: '@deepseek-ai/dsh-system-prompt'

  - id: tools
    name: '@deepseek-ai/dsh-tools'
    config:
      mode: native

  - id: skill
    name: '@deepseek-ai/dsh-skill'

  - id: skill-filesystem
    name: '@deepseek-ai/dsh-skill-filesystem'
    config:
      dshHome: !!js process.env.OMDSH_HOME || undefined

  - id: llm-retry
    name: '@deepseek-ai/dsh-llm-retry'

  - id: goal
    name: '@deepseek-ai/dsh-goal'

  - id: tool-goal
    name: '@deepseek-ai/dsh-tool-goal'

  - id: goal-round-driver
    name: '@deepseek-ai/dsh-goal-round-driver'

  - id: jobs
    name: '@deepseek-ai/dsh-jobs-local'

  - id: invariants
    name: '@deepseek-ai/dsh-invariants'

  - id: session-invariant
    name: '@deepseek-ai/dsh-session/invariant'

  - id: agent-invariant
    name: '@deepseek-ai/dsh-agent/invariant'

  - id: scope-invariant
    name: '@deepseek-ai/dsh-scope/invariant'

  - id: agent-loop-invariant
    name: '@deepseek-ai/dsh-agent-loop/invariant'

  - id: shell-env
    name: '@deepseek-ai/dsh-shell-env'
    config:
      dshHome: !!js process.env.OMDSH_HOME || undefined

  - id: tool-bash
    name: '@deepseek-ai/dsh-tool-bash'

  - id: agent-instructions
    name: '@deepseek-ai/dsh-agent-instructions'
    config:
      maxBytes: 65536

  - id: tool-skill
    name: '@deepseek-ai/dsh-tool-skill'

  - id: tool-jobs
    name: '@deepseek-ai/dsh-tool-jobs'

  - id: agent-loop
    name: '@deepseek-ai/dsh-agent-loop'
    config:
      agents: []
```

**不要**用 `dsh-base` 替代：上游明确说明它是完整产品组合，会引入 settings/credentials/subagent 等 omdsh 已按需选配的行。

### 依赖变更

`apps/omdsh/package.json`：

- 删除：`@deepseek-ai/dsh-agent-spine-demo`
- 新增直接依赖（16 个，全部精确版本 `0.1.2-alpha.3`，npm `alpha` dist-tag 已确认存在）：`@deepseek-ai/dsh-tools`、`dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill`、`dsh-llm-retry`、`dsh-goal`、`dsh-tool-goal`、`dsh-goal-round-driver`、`dsh-jobs-local`、`dsh-tool-jobs`、`dsh-invariants`、`dsh-scope`（挂 `dsh-scope/invariant` 子路径所需）、`dsh-shell-env`、`dsh-tool-bash`、`dsh-agent-instructions`、`dsh-agent-loop`
- `@deepseek-ai/dsh-system-prompt` **已是直接依赖**（package.json:121），本次仅 bump，不新增
- 其余全部直接依赖 `0.1.2-alpha.2` → `0.1.2-alpha.3`

`packages/tui/omdsh-tui/package.json`：28 个 `dsh-*` 直接依赖（:123-150）+ devDependencies 中的 `@deepseek-ai/dsh-scope`（:159），共 29 个 alpha.2 条目，全部 bump 到 `0.1.2-alpha.3`。

根 `package.json`：`@deepseek-ai/dsh-llm-mock-server`（:37）bump 到 `0.1.2-alpha.3`。

### 组合改动（`apps/omdsh/config/cordis.yml`）

删除 `spine` 行，在原位置插入上述展开块（20 行）。

### 公共 patch 兼容性（`spine` 是已发布行 id）

site 文档（`apps/site/content/en/plugins.md:47,53-63` 及中文版）描述 patch 层规则：后层按行 id 覆盖、id 定向 patch **整对象替换 config 不深合并**、**命名缺失 id 的 patch 产生 stderr 警告而非静默忽略**。**实测（alpha.3 + `dsh-app-boot@0.1.2-alpha.3`）修正最后一条**：缺失 id patch 的警告走 Cordis loader logger，omdsh 的 boot 流程未将其接到 stderr，用户可见行为是**静默跳过、boot 不崩溃**（已加入回归断言）。用户 Profile/机器级 `cordis.patch.yml` 中可能已有 `{ id: spine, ... }` 行。

**决策**：本次为 prerelease 队列迁移，**不提供 `spine` 行别名**（上游同样无别名删除）。兼容性结论写进 CHANGELOG：针对 `spine` 的用户 patch 必须迁移到展开后的行 id。旋钮映射：

| spine 配置旋钮 | 迁移目标行（配置对象） | false / 禁用语义 |
| --- | --- | --- |
| `workspaceContext`（`maxBytes` 等） | `agent-instructions` | `false` → 不挂 `agent-instructions` |
| `tools`（`mode`） | `tools` | 无 false 形态 |
| `dshHome` | `skill-filesystem`、`shell-env` | 无 false 形态 |
| `skills.enabled` / `skills.registry` / `skills.filesystem` / `skills.tool` | `skill`、`skill-filesystem`、`tool-skill` | `enabled: false` → 三行都不挂 |
| `goals.domain` / `goals.tool` | `goal`、`tool-goal`（驱动 `goal-round-driver` 无配置旋钮） | `goals: false` → 三行都不挂 |
| `toolBash` | `tool-bash`（`toolBash` 配置对象仅属于该行）；`shell-env` 仅接收 `dshHome`，共享同一启用/禁用门 | `false` → 两行都不挂（spine 中同一条件跳过 shell-env 与 tool-bash） |
| `toolJobs` | `tool-jobs` | `false` → 不挂 `tool-jobs` |
| `jobs` | `jobs` | 无 false 形态 |
| `invariants` | `invariants` | 无 false 形态 |
| `agents` / `maxParallelToolCalls` | `agent-loop` | 无 false 形态 |
| `includeHarnessIdentity` / `includeRuntimeContext` / `persona` / `toolOrder` | `system-prompt` | 无 false 形态 |
| `sessionTitle` | `session-title` | 无 false 形态 |

**聚焦回归**：新增组合测试断言——携带 `{ id: spine, ... }` 的 patch 在展开后的组合上被**静默跳过**（boot exit 0、不崩溃、无 spine 字样），并验证旋钮映射到新行后 patch 生效。

### 仓库配置改动（`pnpm-workspace.yaml`）

- `minimumReleaseAgeExclude`：删除 `@deepseek-ai/dsh-agent-spine-demo@0.1.1-rc.2 || 0.1.2-alpha.2` 条目；所有 `0.1.1-rc.2 || 0.1.2-alpha.2` 条目更新为 `0.1.2-alpha.3`。参照升级 lab 的 LAB-003：`pnpm install` 可能自动重写该列表，实施时必须审查 diff，禁止顺带放宽无关包。
- `pnpm-lock.yaml`：由 `pnpm install` 重新生成。

### 无需改动的面

- `apps/omdsh/src`：无 spine 代码引用（已全仓搜索确认）。
- `apps/site/content`：无 spine 引用。
- `docs/dsh-0.1.2-upgrade-lab.md`：历史记录，不改。
- `refs/`：**保持指针不动**。方案只使用 registry 元数据与只读 `git show`/tag 检查；不把 refs 指针更新或回退纳入本迁移（superproject 中 refs 子模块指针的当前修改状态是此前独立操作的结果，是否提交由用户单独决定，交接前保持现状）。

## 验证计划

按升级 lab 的分层边界执行，每层失败先定位再前进：

0. **变更前基线**：捕获 `git status`（含已知 dirty：refs 子模块指针的当前修改状态）；在**未改动任何依赖前**运行最小的当前 alpha.2 检查——冷 typecheck、聚焦测试（`apps/omdsh/src`）、`pnpm smoke:happy`——记录结果，用于区分迁移失败与既有失败。
1. **队列解析**：确认 78 个唯一包名在 npm 上都有 `0.1.2-alpha.3`（含 4 个 invariant 子路径导出）；`pnpm install`；`pnpm peers check` 零问题；审查 `pnpm-workspace.yaml` 的 age-gate diff（LAB-003）。
2. **静态契约**：`pnpm -r run clean && pnpm typecheck`（冷构建，LAB-005），保留完整诊断集。
3. **行为契约**：`pnpm test` 全量；重点看工具注册、session、subagent、todo 相关测试。
4. **组合回归**：更新 `apps/omdsh/src/composition.spec.ts`，新增断言——`spine` 行缺失、20 个展开行齐全、`agent-instructions` 先于 `tool-skill`、展开行的配置值保留（`mode: native`、`maxBytes: 65536`、`agents: []`）、`{ id: spine, ... }` patch 被静默跳过且 boot 不崩溃、根 `bash` 工具与 Minimal preset 的 `persistent-bash` 按 scoped shadowing 共存（见 D1）；`--dump-config` 对比展开前后。
5. **运行时聚焦检查**：projection/resume（identity-gated change feed 下 resume 会话行为）、subagent 图片投递路径、read_image 无扩展名路径。
6. **运行时 smoke**：`pnpm smoke:happy`、`pnpm smoke`（PTY）；有凭据时跑一次真实模型 turn，确认技能、目标、bash、read_image 工具按现状工作。
7. **仓库完整验证集**（AGENTS.md 要求）：`pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm check:md`、`pnpm check:boundaries`、`pnpm smoke:happy`、`git diff --check`，外加三条 refs 审计命令（`rg` refs 引用、符号链接扫描、三个子模块 clean）与 `pnpm peers check`。
8. **分发**：本次**不发布**（见 D3）；若未来发布，按 LAB-011 的约束执行（alpha 分支保持未发布状态，协调预发布版本，空消费者安装候选 tarball）。

## 决策点

- **D1 · 模型侧 bash 工具**：展开后根配置挂 `dsh-tool-bash`（与 spine 现状一致，Standard preset 行为不变）。`dsh-tool-bash-persistent` 并非未挂载——Minimal preset（`apps/omdsh/config/agent-presets/minimal/agent.cordis.yml:16-33`）在 `cordis:group` 中挂载它。**隔离机制不是 `isolate: { terminals: true }`**（它只隔离 terminal 服务，不隔离工具注册）：正确机制是 agent-presets 把 preset 挂载在 standing agent scope 下（`refs/deepseek-harness/packages/preset/agent-presets/src/index.ts:1-14`），而 `dsh-tools` 的 scoped 注册**遮蔽全局工具**（`packages/core/tools/src/index.ts:1022-1052`，"Scoped tools shadow globals"）。因此 Minimal 会话里的 `persistent-bash` 在 agent scope 遮蔽根 `bash`，与 Standard 会话的根 `bash` 按 preset 作用域共存。Standard/Minimal 组合测试必须证明 global tool vs scoped shadowing 这一机制，而不是终端隔离。不要删除 preset 中的 persistent-bash。
- **D2 · skills/goals 保留**：展开后默认保持启用（与 spine 配置一致）。如产品想精简可改为不挂，但那是独立的产品决策，不应混入本次迁移。
- **D3 · 发布范围**：本次升级**仅迁移、不发布**——不 bump 产品版本、不打 tag、不推 npm。发布另行授权，并遵守 LAB-011 的协调预发布约束。

## 风险与回退

- **fiber/lifecycle 变化**：移除 6 个嵌套副本 + 在根级重新表达 20 个嵌套插件，实例身份与 fiber 归属变化——需要 `--dump-config` 与运行时 smoke 的真实挂载证据，不能仅凭静态对比。
- **行为漂移**：展开行配置与 spine 转发值不一致（已逐项核对；`mode: native` 是 `dsh-tools` 默认值，`agents: []` 是 spine 默认，`system-prompt` 三个字段均为 spine 默认）。
- **工具冲突**：根 `bash`（`dsh-tool-bash`）与 Minimal preset 的 `persistent-bash` 依赖 scoped shadowing 共存——组合回归测试必须覆盖两个 preset 并验证遮蔽机制本身。
- **age-gate 顺带放宽**：install 重写 `pnpm-workspace.yaml` 时审查 diff。
- **peer 地板**：新包 peer 要求（Cordis `^4.0.2`、loader `^1.0.3`、Schemastery `^3.18.2`）与现有基线一致，`pnpm peers check` 兜底。
- **回退**：改动集中在 `apps/omdsh/package.json`、`apps/omdsh/config/cordis.yml`、`packages/tui/omdsh-tui/package.json`、根 `package.json`、`pnpm-workspace.yaml` + lockfile，外加计划的 `apps/omdsh/src/composition.spec.ts`、强制 `CHANGELOG.md` 与本方案文档——单个 revert（或逐文件还原）即可恢复 alpha.2 状态。refs 指针不在回退范围内（保持不动）。

## 实施清单

- [ ] **变更前基线**：`git status` 快照 + 当前 alpha.2 的最小冷 typecheck / 聚焦测试 / smoke:happy，记录基线结果
- [ ] `apps/omdsh/package.json`：删 spine、加 16 个依赖、整体 bump 到 `0.1.2-alpha.3`
- [ ] `packages/tui/omdsh-tui/package.json`：28 个直接依赖 + `dsh-scope` devDependency bump
- [ ] 根 `package.json`：`dsh-llm-mock-server` bump
- [ ] `apps/omdsh/config/cordis.yml`：删 `spine` 行，插入 20 行展开块（顺序约束：`agent-instructions` 先于 `tool-skill`）
- [ ] `pnpm-workspace.yaml`：age-gate 列表更新（删 spine 条目、版本串改为 `0.1.2-alpha.3`）
- [ ] `pnpm install` + 审查 lockfile 与 workspace diff + `pnpm peers check`
- [ ] 更新 `apps/omdsh/src/composition.spec.ts`（spine 缺失、行齐全、顺序、配置保留、`{ id: spine }` patch 的缺失 id 警告、preset bash 的 scoped shadowing）
- [ ] `CHANGELOG.md`：Unreleased 增加条目（参照现有 alpha.2 条目风格，说明 cohort 升级到 `0.1.2-alpha.3`、spine 展开，以及 `spine` 定向 patch 的迁移映射）
- [ ] 仓库完整验证集（含 `check:md`、`check:boundaries`、refs 审计、`git diff --check`）
