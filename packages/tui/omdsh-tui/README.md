<!-- npm-package-role: library -->

# @agi-fans/dsh-tui

Reusable terminal UI plugins for applications built on the DeepSeek Harness runtime.

**This is a library package. It does not install the `omdsh` command and is not intended to be run directly.**

If you want the complete oh-my-dsh application, install the CLI package instead:

```sh
npm install --global @agi-fans/oh-my-dsh
omdsh
```

See the [oh-my-dsh project overview](https://github.com/agi-fans/oh-my-dsh#readme) for screenshots, tutorials, configuration, and end-user features.

## Library purpose

`@agi-fans/dsh-tui` supplies the terminal presentation and interaction layer used by `@agi-fans/oh-my-dsh`. It is useful to developers composing a custom Harness application that needs local terminal input, transcript rendering, interactive prompts, and TUI-owned command surfaces.

The package contains three main roles:

- **Service definition:** the transport-neutral `tui` context service and its event, status, model, input, interrupt, rewind, and disposal contracts.
- **Local provider:** exclusive ownership of raw terminal input, editing, history, completion, scrolling, image paste, resize handling, and differential rendering.
- **Interactive runner:** creation of an Agent through the Harness registry and coordination of session events with the input loop.

The rendering pipeline is pure and exported for testing and alternative providers. Additional exports expose session integration, human-interaction adapters, tool presentation, startup notices, and the command plugins used by omdsh.

## Integration

Install the library only when building your own Harness composition:

```sh
npm install @agi-fans/dsh-tui @deepseek-ai/cordis
```

Mount the exports you need as ordinary Cordis plugins. The working application composition is available in [`apps/omdsh/config/cordis.yml`](https://github.com/agi-fans/oh-my-dsh/blob/main/apps/omdsh/config/cordis.yml); application boot, model providers, persistence, tools, and the executable remain the responsibility of the host application.

## Documentation

- [Architecture](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/architecture.md)
- [Skills and MCP](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/skills-and-mcp.md)
- [Performance](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/performance.md)
- [Changelog](https://github.com/agi-fans/oh-my-dsh/blob/main/CHANGELOG.md)

## License

MIT
