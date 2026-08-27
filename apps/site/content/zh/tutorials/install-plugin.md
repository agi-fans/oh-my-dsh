---
description: 用 omdsh plugin add 把随仓库提供的 examples/hello bundle 装进 omdsh Profile，并在 --dump-config 中确认。
---

# 安装示例插件

本教程把随仓库提供的示例 bundle 安装到 omdsh Profile 并验证它生效。你需要一份 omdsh 仓库 checkout，并且 `PATH` 上有 `pnpm`。

```sh
omdsh plugin add ./examples/hello
omdsh --dump-config
```

路径相对调用时的工作目录；若该处不存在，omdsh 会沿父目录查找同一相对路径，因此在 `apps/omdsh` 里执行同一条命令也可以。

分两步检查结果：

1. `--dump-config` 会在产品层之后列出 `@agi-fans/omdsh-plugin-hello`。
2. 重启 omdsh，然后运行 `/hello`。这条命令也会出现在 `/help` 里。

用 `omdsh plugin remove @agi-fans/omdsh-plugin-hello` 移除该 bundle，并再次重启。

要自己编写 bundle，请继续 [编写插件](write-a-plugin.md)。兼容性约定见 [用户插件](../plugins.md)。
