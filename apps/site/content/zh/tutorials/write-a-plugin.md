---
description: 面向开发者：使用 /agent creator 或从零编写一个包含斜杠命令、模型工具与设置项的 omdsh 插件包，在本地调试并发布。
---

# 开发者进阶：编写与发布插件

当你需要的能力超出 `SKILL.md` 和 MCP 的范围——例如想新增一个交互式斜杠命令、注册一个新的内置模型工具、或者接入一套自定义运行时服务——就需要编写一个 omdsh 插件包（本质是一个带 `dsh.bundle.patch` 声明的 npm 包，基于 DeepSeek Harness 的 Cordis 插件架构）。

开始前请确认 `PATH` 上已安装 `pnpm`。

## 捷径：直接用内置的 `/agent creator` 辅助编写

omdsh 内置了专门用于编写和调试插件的 **Creator** 预设（自带 `dsh-doc` 权威开发指南与运行时只读检查工具）：

1. 在新目录启动 `omdsh` 后运行 **`/agent creator`**（或在 `/plugins` 里选择 **`让代理创建插件`**）。该操作不会修改你的全局默认预设。
2. 直接描述你想做的插件功能，Creator 会参考当前运行时的真实接口帮你生成代码、补丁文件和测试。

如果你想完全手工掌握每个文件的职责，按下面步骤从零写一个 `greet-plugin` 只需 5 分钟（也可以参考仓库里的最小示例 [`examples/hello`](https://github.com/agi-fans/oh-my-dsh/tree/main/examples/hello)）。

## 第一步：查清当前 omdsh 对应的运行时版本

插件包必须把 `@deepseek-ai/*` 声明在 `peerDependencies` 中，并与本机安装的 `omdsh` 保持同一套 DeepSeek Harness（DSH）版本，否则安装器会拒绝安装（避免进程里出现两份冲突的 Cordis/Harness 运行时）。

先用一行命令查出你本机 `omdsh` 使用的精确版本：

```sh
omdsh --dump-config | head -n 20
```

也可以查看已安装 `@agi-fans/oh-my-dsh` 的 `package.json` 中 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-commands` 的版本号，填到下面的 `peerDependencies` 里。

## 第二步：创建插件目录与 3 个核心文件

在任意独立目录创建插件（**不要**放进 omdsh 仓库的 workspace，也不要使用 `workspace:` 依赖）：

```sh
mkdir greet-plugin
cd greet-plugin
```

一个最小插件包包含 3 个文件：`package.json`、`cordis.patch.yml`、`index.js`。

### 1. `package.json`：声明插件包入口与补丁

```json
{
  "name": "greet-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.2.0-alpha.1",
    "@deepseek-ai/dsh-commands": "<与当前 omdsh 一致的 DSH 版本>"
  }
}
```

两条安全硬规则：

- `@deepseek-ai/*` 必须放在 `peerDependencies`，绝不放进 `dependencies`；
- `dsh.bundle.patch` 必须指向补丁文件。如果漏写它，插件只会被当作普通依赖库安装，不会自动挂载到 omdsh 里（那种形态仅用于给其他插件包 `import` 的纯工具库）。

### 2. `cordis.patch.yml`：告诉运行时要挂载哪一行

```yaml
- insert:
    - id: greet
      name: greet-plugin
```

- `name` 必须是 npm 包名，Node 据此解析模块；
- `id` 在整棵插件树里必须唯一。如果后续补丁针对同一个 `id` 写入 `config`，会整块替换原配置而不是深度合并；如果补丁指向不存在的 `id`，启动时会静默跳过。

### 3. `index.js`：编写 Cordis 插件逻辑

下面是一个同时示范 **注册斜杠命令** 和 **暴露配置项** 的清晰例子：

```js
export const name = 'greet-plugin'
export const inject = ['commands']

export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'greet',
      description: 'Print a greeting from this plugin',
      input: { hint: '[name]' },
      handler(invocation) {
        const who = invocation.rawInput.trim() || 'omdsh'
        return { kind: 'success', text: `Hello, ${who}.` }
      },
    })
  }, 'greet-plugin')
}
```

编写插件时牢记 4 条实用边界：

- **命令名**：全小写、不带前导 `/`，`invocation.rawInput` 是命令名后面的原始参数字符串。
- **向用户提问**：需要弹出选择框、输入框或文档阅读器时，先在 `inject` 里声明 `'tui'`，再调用 `ctx.tui.prompt(...)`；**不要**直接接管 TTY 或监听底层终端字节。
- **保存密钥**：通过 `ctx.credentials` 读写敏感凭据，不要明文写进配置文件。
- **提供用户设置**：通过 `ctx.settings` 声明 schema 配置项即可——omdsh 会自动把你的插件设置呈现在 `/settings → 高级` 中供用户编辑和校验，不需要（也不应）自行侵入 `/settings` 界面。

## 第三步：本地安装、验证与迭代调试

回到 `greet-plugin` 的上一级目录执行安装与检查：

```sh
omdsh plugin add ./greet-plugin
omdsh --dump-config
```

按以下两步验收：

1. 在 `omdsh --dump-config` 的输出中，确认 `greet-plugin` 出现在 `@agi-fans/oh-my-dsh` 之后，且包含 `id: greet`。
2. 重新启动 `omdsh`，分别运行 `/greet`、`/greet Ada` 和 `/help`：
- 交互模式下，`/help` 的搜索列表里能直接搜到 `/greet`；
- 非交互纯文本模式下，插件注册的命令会归在 **`扩展`（`Extensions`）** 分类下。

### 修改代码如何生效

- 通过本地路径（`./greet-plugin`）安装时，用户配置目录已链接到你的本地目录：修改 `index.js` 或 `cordis.patch.yml` 后**重启 `omdsh`** 即可看到变化。
- 调试完毕想卸载测试插件时，运行 `omdsh plugin remove greet-plugin` 即可同时清理依赖与配置行。

## 第四步：分发与发布

准备分享给团队或社区时，支持三种分发渠道：

- **npm 仓库**：发布后用户可通过 `/plugins` 或 `omdsh plugin add greet-plugin` 安装；
- **本地压缩包（Tarball）**：运行 `pnpm pack` 生成 `.tgz`，用户执行 `omdsh plugin add ./greet-plugin-0.1.0.tgz`；
- **Git 仓库**：用户执行 `omdsh plugin add github:<owner>/greet-plugin`（如果仓库在 `prepare` 阶段需要编译，用户可能需在 `$OMDSH_HOME/profiles/omdsh/pnpm-workspace.yaml` 的 `allowBuilds` 里放行构建脚本）。

发布前请确认：仅导入各包公开导出的接口，不依赖 Web UI 或 HTTP 服务（TUI 宿主不挂载它们）。

## 下一步

- 查阅完整的工具展示、交互提示与设置 schema 代码示例：[插件开发内部机制](../plugin-internals.md)。
- 查阅插件兼容性契约与宿主能力边界：[插件与内置集成参考](../plugins.md) 和 [架构概览](../architecture.md)。
