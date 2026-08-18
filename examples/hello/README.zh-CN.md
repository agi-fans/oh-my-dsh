# omdsh 插件示例

[English](README.md) | 简体中文

这个目录是一个完整、可安装的 DeepSeek Harness bundle。它不是 omdsh 的 workspace 包：没有 `workspace:` 依赖，不在 `pnpm-workspace.yaml` 里，`omdsh plugin add` 之后从 Profile 的 `node_modules` 解析。

该 bundle 会 insert 一行 Cordis 插件，并通过 `dsh-commands` 注册 `/hello`。重启后，这条命令出现在 `/help` 里，并打印一条确认 notice。它不注册 TUI 贡献、overlay、主题或工具。

## 从本仓库安装

在仓库根目录执行，或在 `apps/omdsh` 里执行（`./examples/hello` 不存在时，omdsh 会沿父目录查找）：

```sh
omdsh plugin add ./examples/hello
omdsh --dump-config
```

重启 omdsh，然后运行 `/hello`。移除：

```sh
omdsh plugin remove @agi-fans/omdsh-plugin-hello
```

复制这个目录即可开始写新的 bundle，或按 [编写插件](../../docs/tutorials/write-a-plugin.zh-CN.md) 从零编写。把 `@deepseek-ai/*`，以及用到 TUI 服务时的 `@agi-fans/dsh-tui`，固定为 omdsh 随包发布的同一版本的 peer。不要把这些包放进 `dependencies`。见 [用户插件](../../docs/plugins.zh-CN.md)。
