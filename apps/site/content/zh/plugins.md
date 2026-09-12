---
description: 使用 omdsh plugin、Profile 层和 dsh.bundle.patch 约定，为 omdsh 安装并编写 DeepSeek Harness 插件。
---

# 用户插件

omdsh 通过 DeepSeek Harness 插件扩展，这些插件与产品自带的 composition 挂在同一棵 Cordis 树上。用户安装的能力是一个声明了 `dsh.bundle.patch` 的 npm 软件包，它加入 omdsh 的 Profile 层列表，并随其余插件一同启动。

启动会把随包发布的 [`apps/omdsh/config/cordis.yml`](https://github.com/agi-fans/oh-my-dsh/blob/main/apps/omdsh/config/cordis.yml) 当作 `@agi-fans/oh-my-dsh` 产品 bundle，再叠加 `$OMDSH_HOME/profiles/omdsh` 里的用户 bundle、Profile 的 `cordis.patch.yml`、`$OMDSH_HOME/cordis.patch.yml`，以及 MCP 的 insert patch。`omdsh plugin add` 和 `omdsh plugin remove` 负责安装这些用户 bundle。`omdsh --dump-config` 会打印组合后的树。

Skills 与 MCP 仍是独立的部署面，见 [Skills 与 MCP](skills-and-mcp.md)。TUI 的丰富度来自安装层之上的 Cordis 贡献服务，而不是某个 TypeScript extensions 目录。主题、Overlay 和按键注册表在出现第二个拥有独立所有权的贡献者之前保持关闭，见 [架构](architecture.md) 和 [插件内部机制](plugin-internals.md)。

## 插件挂上之后已经可用的能力

TUI 不维护第二份命令、工具或模型注册表。插件进入树之后，这些 Harness 缝已经能到达终端：

| 能力 | 插件使用的缝 | TUI 的行为 |
|---|---|---|
| 斜杠命令 | `dsh-commands` 的元数据与处理器 | 出现在 `/help`、自动补全和 Runner 中 |
| 工具 | `ToolDefinition`，包括 `presentCall` / `presentResult` | 渲染为卡片，否则使用通用回退 |
| 模型提供方 | `ctx.llm` 的路由与设置 | 出现在 `/model`；`/login` 可以保存目录密钥、运行已注册的授权流程，或添加自定义 profile |
| 凭据与设置 | `ctx.credentials` 和 `ctx.settings` | 与树中其余部分已经读取的 `$DSH_HOME` 文档共用 |
| 人机提问 | `ctx.tui.prompt`、审批和提问 | 由终端选择器收集答案 |
| Skill | Harness Skill Registry | 出现在 `/skill:` 下 |
| MCP Server | 每个 Server 对应一行 `dsh-mcp-client` | 出现在 `/mcp` 和 `/tools` 中 |

只需要这些缝的插件，不必再写 TUI 展示适配器。

## 当前启动

`apps/omdsh/src/boot.ts` 会在 `$OMDSH_HOME/profiles/omdsh` 缺失时初始化该 Profile，修复安装目录的模块回退，并挂载一个空的 Profile 根。补丁按「产品 → 用户 bundles → Profile patch → home patch → MCP → 随包 agent-preset overlay」的顺序应用。补丁文件存在但为空、或不是 YAML 列表时，启动失败并大声报错。启动、`omdsh plugin` 和 `omdsh --dump-config` 会先共用一次 `loadLayeredEnv` 快照，因此项目级和用户级 `.env` 对 home 路径以及 MCP 变量展开的影响在每条路径上相同。`--dump-config` 打印这棵组合树，但不启动 TUI。

列入 `dsh.profile.bundles` 的软件包必须声明 `dsh.bundle.patch`，并能从 omdsh 安装位置或 Profile 的 `node_modules` 解析。只在 `settings.yaml` 里写入提供方 profile，仍然无法激活 composition 从未挂载的 adapter。

`/login` 已经能通过随包、默认休眠的 `@deepseek-ai/dsh-llm-pi-ai` adapter 接入目录提供方和手写自定义路由。当该 adapter 或其他已挂载插件注册了 Harness 授权流程时，`/login` 会列出流程和方法，TUI 只渲染通用通知和提问。adapter 不在随包树中的提供方，仍然需要用户挂载插件。

## 组合

omdsh 保留产品自己拥有的 composition。它不会把官方 `@deepseek-ai/dsh-base` 当作第一层启动，也不会变成官方 `web` 或 `headless` Profile 上的一层皮。那些层会挂上 TUI composition 明确排除的 Host、HTTP 和 Web UI 行。

第一层是当前的 omdsh composition，通过 `dsh.bundle.patch` 清单字段发布为 `@agi-fans/oh-my-dsh` bundle。用户 bundle 追加在这层产品层之后。

```text
$OMDSH_HOME/profiles/omdsh/
  package.json          # dsh.profile.bundles 以及用户依赖
  cordis.yml            # 空根 []；只给 Loader 当 baseUrl
  cordis.patch.yml      # 可选的用户行级补丁
  node_modules/         # 用户 bundle，由 pnpm 管理
```

Profile 目录使用 omdsh 已经用于会话、设置、凭据和 MCP 的同一主目录：`$OMDSH_HOME`，否则 `$DSH_HOME`，再否则 `~/.dsh`。Profile 名称是 `omdsh`，因此不会与可能共用 `$DSH_HOME` 的官方 `web` 或 `headless` Profile 冲突。

启动按以下顺序应用补丁：

1. 随包发布的 `@agi-fans/oh-my-dsh` bundle（产品 `cordis.yml`，改写成对空根的 insert）。
2. `dsh.profile.bundles` 中的其余名称，按列表顺序。
3. `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`。
4. `$OMDSH_HOME/cordis.patch.yml`（作用于每个 omdsh Profile 的机器级覆盖）。
5. 现有的、来自用户级和项目级 `mcp.json` 的 MCP insert patch。

后一层按行 id 覆盖前一层。针对 id 的补丁会整份替换 `config` 对象，不做深层合并。补丁点名了一个不存在的 id 时，启动时会被静默跳过（TUI 宿主未将加载器日志接到 stderr），而不是报错。

模块解析保持双锚点，并使用已发布的 `dsh-app-boot` 辅助函数。`@deepseek-ai/*` 和 `@agi-fans/dsh-tui` 通过 `healProfilesModuleFallback` 优先从 omdsh 安装位置解析。用户 bundle 从 Profile 的 `node_modules` 解析。insert 了一个 Node 无法解析的软件包时，启动失败并大声报错。

omdsh 基于同一套已发布 API 实现 `omdsh plugin`。它不要求安装官方 `dsh` CLI，也不重新实现安装目录、版本求解或分层顺序。

omdsh 不会从某个 extensions 目录加载 TypeScript 文件。那是另一套产品模型，等于在 Cordis 旁边再造一个插件管理器。

## 兼容边界

无需额外 TUI 工作即可支持：

- 通过 `dsh-commands` 注册的命令。
- 工具，包括与 Provider 无关的 `presentCall` / `presentResult` 卡片。
- 在 `ctx.llm` 上注册路由的 LLM adapter。
- 使用随包 Store 的设置与凭据插件。
- 通过 `ctx.tui.prompt`、notice 或命令输出收集密钥或选项的 Auth 插件。
- Skills 与 MCP Server，它们继续走现有发现路径。
- 观察持久化 Session Event，或通过 Harness 注册 Agent preset 的反应型插件。

不承诺：

- 官方 `dsh-client-ui-*` Web UI 插件。omdsh 没有 web Profile。
- 抢占 TTY、监听原始终端字节，或假定已经挂上 Host / HTTP 面的插件。
- Pi 的 extensions 目录加载器、`pi` 包清单，以及对散落 TypeScript 文件的 `/reload`。
- Pi 或 oh-my-pi 的品牌。产品保持 DeepSeek 身份。
- Pi 的「不要 MCP」立场。omdsh 已经通过 Harness 挂载 MCP Server。
- 自定义持久化 Session Event 类型或 Transcript 条目。持久化层会拒绝读取器不认识的事件，除非该事件带有 `ignorable: true` 且可以安全跳过；omdsh 不提供供下游注册私有事件或将其渲染进 Transcript 的接口。
- 主题包或 Overlay 组件。这些在出现第二个拥有独立所有权的贡献者之前保持关闭。
- 第二套工具调用拦截总线。权限门留在 Harness 审批插件里，避免架空审计。
- 替换 Composer、按键映射，或任何其他由 TTY 拥有的表面。
- 第二套斜杠命令注册表，或无限的 `/settings` 行列表。
- 把宿主 TUI 实例、原始终端字节，或插件拥有的 assistant transcript 渲染器交给插件。瘦身 `custom()` Component 缝如果落地，在真实外部 bundle 用过之前只能是 experimental。

版本不匹配、已列入列表的 bundle 缺少 `dsh.bundle` 声明，或软件包名称无法解析时，沿用现有的 `boot()` / `assertEntriesActivated` 路径在启动阶段失败。剩下最大的风险是用户 bundle 再带一份 Cordis，或带上不兼容的 DSH 版本：service token 会分裂，插件看起来已激活，却无法注入或正确 dispose。核心 `@deepseek-ai/*` 和 `@agi-fans/dsh-tui` 保持为随包发布版本的 peer；`omdsh plugin` 在安装时拒绝不兼容的版本范围，若解析出两份拷贝，启动失败并大声报错。

安装或移除 bundle 后需要重启；对 `node_modules` 做热替换不在范围内。监视 `cordis.patch.yml` 尚未提供。

## 用户流程

```sh
omdsh plugin add ./examples/hello
omdsh plugin remove @agi-fans/omdsh-plugin-hello
omdsh --dump-config
```

在 omdsh 的 checkout 里，[`examples/hello`](https://github.com/agi-fans/oh-my-dsh/tree/main/examples/hello) 是一个完整的 bundle，会注册 `/hello`。`./examples/hello` 相对调用时的工作目录；若该路径不存在，omdsh 会沿父目录查找同一相对路径，仍找不到则失败。因此 `pnpm --dir apps/omdsh omdsh plugin add ./examples/hello` 仍会装到仓库里的示例。成功添加后重启 omdsh 并运行 `/hello`；`--dump-config` 应在产品层之后列出 `@agi-fans/omdsh-plugin-hello`。已发布的包用同样的命令，只是把本地路径换成 npm 或 git spec。

`omdsh plugin` 在首次使用时初始化 `$OMDSH_HOME/profiles/omdsh`，在该目录运行 `pnpm`，并对照已安装且声明了 `dsh.bundle.patch` 的软件包，调和 `dsh.profile.bundles`。不属于 Profile 依赖的模板 / 产品 bundle 留在列表中。普通库依赖会被安装，但不会成为一层；后续版本若增加 `dsh.bundle.patch`，会在下一次成功的 `omdsh plugin` 运行时加入列表。

`--dump-config` 通过 `renderConfigDump` 打印组合后的入口列表，并用注释标出每一层的来源。该转储是查看实际 composition 的受支持方式。

成功添加后，重启 omdsh。新的 LLM 路由出现在 `/model`。新命令出现在 `/help`。需要浏览器或 device-code 步骤的 Auth 由插件自己拥有该生命周期，并使用 `ctx.tui.prompt` 提出任何终端问题。

## 编写 bundle

按 [编写插件](tutorials/write-a-plugin.md) 从零编写并安装 bundle，或复制 [`examples/hello`](https://github.com/agi-fans/oh-my-dsh/tree/main/examples/hello)。bundle 是一个 npm 软件包，其 `package.json` 包含：

```json
{
  "name": "@scope/dsh-example",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

`cordis.patch.yml` 是 Cordis include 补丁组成的 YAML 数组。常见写法是一个 `insert` 列表，列出插件行：

```yaml
- insert:
    - id: example-provider
      name: '@scope/dsh-example'
```

将 `@deepseek-ai/*` 和 `@agi-fans/dsh-tui` 作为 peer，固定到 omdsh 随包发布的同一 DSH 版本。不要在 bundle 自己的 dependencies 里再嵌一份 `cordis` 或 `dsh-*`。只导入已发布的软件包导出。不要进入 `refs/`。不要假定存在 Host、HTTP 或 Web UI。

优先使用现有缝：

- 在 `dsh-commands` 上注册命令；
- 在工具定义上注册带展示意图的工具；
- 在 `ctx.llm` 上注册 LLM 路由；
- 通过 `ctx.credentials` 存储密钥；
- 通过 `ctx.tui.prompt` 向用户提问。

需要自定义 Transcript 块、overlay、主题包或独占 TTY 的插件，不在第一批兼容集合内。`ctx.tui.contributions` 发布后，只有 `presentCall` / `presentResult` 表达不了卡片时才注册带类型的卡片 presenter，status segment 发布的是 projection id，而不是本地计数器。

## 相关文档

- [架构](architecture.md) — 产品 composition 与 TUI 所有权
- [插件内部机制](plugin-internals.md) — `ctx.tui` 表面与规划中的贡献层
- [Skills 与 MCP](skills-and-mcp.md) — 文件系统 Skills 与 MCP Server 文档
- [编写插件](tutorials/write-a-plugin.md) — 编写、安装并发布 bundle
