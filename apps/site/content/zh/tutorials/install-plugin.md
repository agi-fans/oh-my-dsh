---
description: 用 omdsh plugin add 把随仓库提供的 examples/hello bundle 装进 omdsh Profile，用 --dump-config 验证该层，并把它移除。
---

# 安装示例插件

本教程把随仓库提供的 `examples/hello` bundle 安装到 omdsh Profile，验证该层确实生效，然后再移除它。你需要一份 omdsh 仓库 checkout，并且 `PATH` 上有 `pnpm`。

### 先看 bundle 声明了什么

`examples/hello` 是一个完整的 `dsh.bundle` 包：它的 `package.json` 声明了 patch 文件，该文件插入一行 Cordis 插件。

```text
examples/hello/package.json          # dsh.bundle.patch -> ./cordis.patch.yml
examples/hello/cordis.patch.yml      # 为 @agi-fans/omdsh-plugin-hello 插入一行
```

包可以只是普通库依赖被安装，但只有声明 `dsh.bundle.patch` 才会加入 Profile 层列表。

### 安装 bundle

在仓库根目录执行：

```sh
omdsh plugin add ./examples/hello
```

`omdsh plugin` 在首次使用时初始化 `$OMDSH_HOME/profiles/omdsh`，在该目录内运行 `pnpm`、安装软件包，并对照已安装且声明了 bundle patch 的包调和 `dsh.profile.bundles`。路径相对调用时的工作目录；若该处不存在，omdsh 会沿父目录查找同一相对路径，因此在 `apps/omdsh` 里执行 `pnpm --dir apps/omdsh omdsh plugin add ./examples/hello` 同样有效。

### 验证该层

```sh
omdsh --dump-config
```

转储会打印组合后的入口列表，并用注释标出每个条目来自哪一层：先是产品 bundle，然后是来自 Profile 的 `@agi-fans/omdsh-plugin-hello`。重启 omdsh，然后运行 `/hello`；这条命令也会出现在 `/help` 与斜杠补全中。

### 移除 bundle

```sh
omdsh plugin remove @agi-fans/omdsh-plugin-hello
```

下一次转储不再列出该包，`/hello` 会在下一次重启后消失。

### 排障

- `omdsh plugin` 会在 Profile 内运行 `pnpm`，因此 `pnpm` 必须在 `PATH` 上。
- 已列入列表的 bundle 缺少 `dsh.bundle.patch` 声明，或包名无法解析时，会在启动阶段直接失败，而不是静默降级。
- 如果 `/hello` 没有出现，先确认 `--dump-config` 列出了该包，并确认安装后重启过 omdsh。

### 下一步

用[编写插件](write-a-plugin.md)从零编写自己的 bundle。兼容性约定见[用户插件](../plugins.md)，内部贡献面见[插件内部机制](../plugin-internals.md)。
