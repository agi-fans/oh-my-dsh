# Install the example plugin

[English](install-plugin.md) | [简体中文](install-plugin.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Extend a project with Skills and MCP](skills-and-mcp.md) · Next: [Write a plugin](write-a-plugin.md)

From an omdsh checkout, install the shipped example bundle into the omdsh Profile. The path is relative to the invoking directory; if it is missing there, omdsh walks parent directories, so the same command still works from `apps/omdsh`.

```sh
omdsh plugin add ./examples/hello
omdsh --dump-config
```

`--dump-config` should list `@agi-fans/omdsh-plugin-hello` after the product layer. Restart omdsh, then run `/hello`. The command also appears in `/help`. It is a `dsh-commands` handler, not a TUI overlay.

Remove it with `omdsh plugin remove @agi-fans/omdsh-plugin-hello` and restart again. To author your own bundle, continue with [Write a plugin](write-a-plugin.md). The compatibility contract is in [User plugins](../plugins.md).

[Tutorials](../tutorials.md) · Previous: [Extend a project with Skills and MCP](skills-and-mcp.md) · Next: [Write a plugin](write-a-plugin.md)
