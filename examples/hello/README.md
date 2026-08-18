# Example omdsh plugin

[English](README.md) | [简体中文](README.zh-CN.md)

This directory is a complete, installable DeepSeek Harness bundle. It is not an omdsh workspace package: it has no `workspace:` dependencies, is not listed in `pnpm-workspace.yaml`, and resolves from the Profile `node_modules` after `omdsh plugin add`.

The bundle inserts one Cordis row and registers `/hello` through `dsh-commands`. After a restart, the command appears in `/help` and prints a confirmation notice. It does not register a TUI contribution, overlay, theme, or tool.

## Install from this checkout

From the repository root, or from `apps/omdsh` (omdsh walks parent directories when `./examples/hello` is missing):

```sh
omdsh plugin add ./examples/hello
omdsh --dump-config
```

Restart omdsh, then run `/hello`. Remove the bundle with:

```sh
omdsh plugin remove @agi-fans/omdsh-plugin-hello
```

Copy this directory to start a new bundle, or follow [Write a plugin](../../docs/tutorials/write-a-plugin.md). Keep `@deepseek-ai/*` and, if you use the TUI service, `@agi-fans/dsh-tui` as peers of the same release omdsh ships. Do not nest those packages under `dependencies`. See [User plugins](../../docs/plugins.md).
