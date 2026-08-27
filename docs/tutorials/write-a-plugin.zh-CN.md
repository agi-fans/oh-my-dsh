# 编写插件

[English](write-a-plugin.md) | 简体中文

[教程](../tutorials.zh-CN.md) · 上一篇：[安装示例插件](install-plugin.zh-CN.md)

读完本教程，你将从零构建、安装并验证一个添加 `/greet` 命令的小插件，并知道如何修改和发布它。你需要 `PATH` 上有 `pnpm`。

omdsh 插件是一个声明了 `dsh.bundle.patch` 的 npm 软件包，挂载在与随包产品相同的插件树中。它不是 Skill 文件，不是 MCP Server 文档，也不是丢进 extensions 目录的 TypeScript 文件。可以复制 [`examples/hello`](../../examples/hello) 再改名；本教程从零搭建一个小的 `greet-plugin`，让每个文件的职责都看得见。

### 创建软件包

创建一个不属于 omdsh workspace 的目录。不要把它写进 `pnpm-workspace.yaml`，也不要使用 `workspace:` 依赖：

```sh
mkdir greet-plugin
cd greet-plugin
```

这个包需要三个文件：`package.json`、`cordis.patch.yml` 和 `index.js`。

### 声明 bundle

`package.json` 给出包名，指向插件模块，并导出 patch 文件：

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
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-commands": "^0.1.1-rc.2"
  }
}
```

两条规则保证安装安全：

- 把 `@deepseek-ai/*` peer 固定到 omdsh 随包发布的同一 DSH 版本，并保留在 `peerDependencies` 中。把它们写进 `dependencies` 会让 `omdsh plugin` 拒绝安装，因为第二份 Cordis 或 Harness 副本会破坏共享的插件树。
- 让 `dsh.bundle.patch` 指向 patch 文件。没有该字段的包仍能安装，但只作为普通库：omdsh 会打印警告，并且不加层。那种形态留给给其他 bundle import 的辅助库。

### Insert 一行插件

`cordis.patch.yml` 是 Cordis include 补丁组成的 YAML 数组，常见写法是一个 `insert` 列表：

```yaml
- insert:
    - id: greet
      name: greet-plugin
```

行里的 `name` 必须是 npm 包名，这样 Node 才能解析已安装的模块；行 `id` 在组合后的树里必须唯一。之后针对该 id 的 patch 会整份替换 `config` 对象，而不是深合并。patch 点到不存在的 id 时，只在 stderr 给出警告。

### 注册斜杠命令

`index.js` 就是普通的 Cordis 插件：导出 `name`，在 `inject` 中声明所需的宿主服务，并在 `apply` 里注册工作，使其随插件一起销毁：

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

命令名是小写，没有前导斜杠。`rawInput` 是命令名后面的原文。

两条边界保证产品一致性：向人提问只能在 inject 了 `tui` 之后走 `ctx.tui.prompt`，密钥走 `ctx.credentials`。不要接管 TTY、监听原始终端字节、再开一套斜杠命令表，也不要往 `/settings` 加行——那些界面仍由产品拥有。[用户插件](../plugins.zh-CN.md) 列出了完整的兼容性约定。

### 安装并检查

在包含 `greet-plugin` 的目录执行：

```sh
omdsh plugin add ./greet-plugin
omdsh --dump-config
```

`./path` 相对调用时的工作目录；若该路径不存在，omdsh 会沿父目录查找同一相对路径，仍找不到则失败，因此不会装上坏掉的链接。

分两步检查结果：

1. `--dump-config` 会在 `@agi-fans/oh-my-dsh` 之后列出 `greet-plugin`，并出现 `id: greet`。
2. 重启 omdsh——安装或移除 bundle 不会热替换模块——然后运行 `/greet`、`/greet Ada` 和 `/help`。新命令出现在 Agent Commands 下。

### 修改插件

- 通过本地路径或 `link:` 安装时，Profile 已经指向该 checkout：编辑 `index.js` 或 `cordis.patch.yml` 后重启 omdsh 即可加载新模块。
- 通过 registry 安装时，运行 `omdsh plugin update greet-plugin` 或添加新版本，然后重启。

后续版本若增加 `dsh.bundle.patch`，会在下一次成功的 `omdsh plugin` 运行时加入层列表。用 `omdsh plugin remove greet-plugin` 移除时，会同时去掉依赖和对应的层。随包的 `@agi-fans/oh-my-dsh` 层不是 Profile 依赖，永远不会被移除。

### 发布

- npm：发布软件包后，用 `omdsh plugin add greet-plugin` 安装。
- Tarball：用 `pnpm pack` 打出 tarball，再执行 `omdsh plugin add ./greet-plugin-0.1.0.tgz`。
- Git：用 `omdsh plugin add github:<owner>/greet-plugin` 安装。若包在 `prepare` 里构建，而 pnpm 拦截了该脚本，可能需要在 `$OMDSH_HOME/profiles/omdsh/pnpm-workspace.yaml` 里加入 `allowBuilds`。

只导入已发布的软件包导出，不要进入 `refs/`，也不要假定挂载了 Host、HTTP 或 Web UI。[用户插件](../plugins.zh-CN.md) 定义了 bundle 可以依赖的界面。

[教程](../tutorials.zh-CN.md) · 上一篇：[安装示例插件](install-plugin.zh-CN.md)
