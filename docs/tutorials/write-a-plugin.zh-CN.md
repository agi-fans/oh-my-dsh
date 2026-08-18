# 编写插件

[English](write-a-plugin.md) | 简体中文

[教程](../tutorials.zh-CN.md) · Previous: [安装示例插件](install-plugin.zh-CN.md)

omdsh 插件是一个声明了 `dsh.bundle.patch` 的 npm 软件包，它 insert 一行或多行 Cordis 插件，并与随包 composition 挂在同一棵树上。它不是 Skill 文件，不是 MCP Server 文档，也不是丢进 extensions 目录的 TypeScript 文件。TUI 不维护第二份命令注册表：bundle 进入树之后，`dsh-commands` 的处理器会出现在 `/help`、自动补全和 Runner 中。

可以复制 [`examples/hello`](../../examples/hello) 再改名。本教程从零搭建一个小的 `greet-plugin`，让每个文件的职责都看得见。

### 创建软件包

创建一个不属于 omdsh workspace 的目录。不要把它写进 `pnpm-workspace.yaml`，也不要使用 `workspace:` 依赖。

```sh
mkdir greet-plugin
cd greet-plugin
```

这个包需要三个文件：`package.json`、`cordis.patch.yml` 和 `index.js`。

### 声明 bundle

`package.json` 给出包名，指向插件模块，并导出 patch 文件。把 `@deepseek-ai/*` peer 固定到 omdsh 随包发布的同一 DSH 版本。不要把这些包写进 `dependencies`，否则 `omdsh plugin` 会拒绝安装，以免再带一份 Cordis 或 Harness。

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
    "@deepseek-ai/dsh-commands": "^0.1.0-rc.7"
  }
}
```

没有 `dsh.bundle.patch` 的包仍能安装，但只作为普通库：omdsh 会打印警告，并且不加层。那种形状留给给其他 bundle import 的辅助库。

### Insert 一行插件

`cordis.patch.yml` 是 Cordis include 补丁组成的 YAML 数组。常见写法是一个 `insert` 列表。行里的 `name` 必须是 npm 包名，这样 Node 才能解析已安装的模块；行 `id` 在组合后的树里必须唯一。

```yaml
- insert:
    - id: greet
      name: greet-plugin
```

之后针对该 id 的 patch 会整份替换 `config` 对象，而不是深合并。patch 点到不存在的 id 时，只在 stderr 给出警告。

### 注册斜杠命令

模块就是普通的 Cordis 插件：导出 `name`，`inject` 所需的宿主服务，并在 `apply` 里注册工作，以便 Cordis 随插件 fiber 一起 dispose。命令名是小写，没有前导斜杠。`rawInput` 是命令名后面的原文。

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

向人提问只能在 inject 了 `tui` 之后走 `ctx.tui.prompt`；密钥走 `ctx.credentials`。不要接管 TTY、监听原始终端字节、再开一套斜杠命令表，也不要往 `/settings` 加行。那些面仍由产品拥有，见 [用户插件](../plugins.zh-CN.md)。

### 安装并检查

在包含 `greet-plugin` 的目录执行，或使用相对调用目录的路径：

```sh
omdsh plugin add ./greet-plugin
omdsh --dump-config
```

`omdsh plugin` 需要 `PATH` 上有 `pnpm`。`./path` 相对调用时的工作目录；若该路径不存在，omdsh 会沿父目录查找同一相对路径，仍找不到则失败，因此不会装上坏掉的链接。

`--dump-config` 应在 `@agi-fans/oh-my-dsh` 之后列出 `greet-plugin`，并出现 `id: greet`。重启 omdsh，然后运行 `/greet`、`/greet Ada` 和 `/help`。新命令出现在 Agent Commands 下。安装或移除 bundle 不会热替换 `node_modules`；每次成功的 `omdsh plugin` 之后都要重启。

### 修改插件

在包目录里编辑 `index.js` 或 `cordis.patch.yml`。如果安装的是本地路径或 `link:`，Profile 已经指向该 checkout，重启 omdsh 即可加载新模块。如果安装的是 registry 版本，运行 `omdsh plugin update greet-plugin` 或添加新版本，然后重启。

后续版本若增加 `dsh.bundle.patch`，会在下一次成功的 `omdsh plugin` 运行时加入层列表。用 `omdsh plugin remove greet-plugin` 移除时，会同时去掉依赖和对应的层。随包的 `@agi-fans/oh-my-dsh` 层不是 Profile 依赖，永远不会被移除。

### 发布

发布到 npm 后，用 `omdsh plugin add greet-plugin` 安装。用 `pnpm pack` 打出 tarball，再执行 `omdsh plugin add ./greet-plugin-0.1.0.tgz`。git checkout 可用 `omdsh plugin add github:<owner>/greet-plugin`；若包在 `prepare` 里构建，而 pnpm 拦截了该脚本，可能需要在 `$OMDSH_HOME/profiles/omdsh/pnpm-workspace.yaml` 里加入 `allowBuilds`。

只导入已发布的软件包导出。不要进入 `refs/`。不要假定挂载了 Host、HTTP 或 Web UI。第一批兼容集合是命令、带 `presentCall` / `presentResult` 的工具、`ctx.llm` 上的 LLM 路由、设置与凭据，以及通过 `ctx.tui.prompt` 提问。自定义 Transcript 块、overlay、主题包和独占 TTY 不在该集合内。

[教程](../tutorials.zh-CN.md) · Previous: [安装示例插件](install-plugin.zh-CN.md)
