# 安装示例插件

[English](install-plugin.md) | 简体中文

[教程](../tutorials.zh-CN.md) · Previous: [使用 Skills 与 MCP 扩展项目](skills-and-mcp.zh-CN.md) · Next: [编写插件](write-a-plugin.zh-CN.md)

在 omdsh 的 checkout 里，把随仓库提供的示例 bundle 装进 omdsh Profile。路径相对调用时的工作目录；若该处不存在，omdsh 会沿父目录查找，因此在 `apps/omdsh` 里执行同一条命令也可以。

```sh
omdsh plugin add ./examples/hello
omdsh --dump-config
```

`--dump-config` 应在产品层之后列出 `@agi-fans/omdsh-plugin-hello`。重启 omdsh，然后运行 `/hello`。这条命令也会出现在 `/help` 里。它是 `dsh-commands` 的处理器，不是 TUI overlay。

用 `omdsh plugin remove @agi-fans/omdsh-plugin-hello` 移除，并再次重启。要自己写 bundle，请继续 [编写插件](write-a-plugin.zh-CN.md)。兼容性约定见 [用户插件](../plugins.zh-CN.md)。

[教程](../tutorials.zh-CN.md) · Previous: [使用 Skills 与 MCP 扩展项目](skills-and-mcp.zh-CN.md) · Next: [编写插件](write-a-plugin.zh-CN.md)
