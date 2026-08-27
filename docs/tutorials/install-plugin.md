# Install the example plugin

[English](install-plugin.md) | [简体中文](install-plugin.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Extend a project with Skills and MCP](skills-and-mcp.md) · Next: [Write a plugin](write-a-plugin.md)

This walkthrough installs the shipped example bundle into the omdsh Profile and confirms it works. You need an omdsh checkout and `pnpm` on `PATH`.

```sh
omdsh plugin add ./examples/hello
omdsh --dump-config
```

The path is relative to the invoking directory; if it is missing there, omdsh walks parent directories for the same relative path, so the command also works from `apps/omdsh`.

Check the result in two steps:

1. `--dump-config` lists `@agi-fans/omdsh-plugin-hello` after the product layer.
2. Restart omdsh and run `/hello`. The command also appears in `/help`.

Remove the bundle with `omdsh plugin remove @agi-fans/omdsh-plugin-hello` and restart again.

To author your own bundle, continue with [Write a plugin](write-a-plugin.md). The compatibility contract is in [User plugins](../plugins.md).

[Tutorials](../tutorials.md) · Previous: [Extend a project with Skills and MCP](skills-and-mcp.md) · Next: [Write a plugin](write-a-plugin.md)
