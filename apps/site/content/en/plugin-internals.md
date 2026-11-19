---
description: For plugin authors — published extension points, code examples for tool presentation, prompts, settings schemas, and complete personas, plus terminal ownership rules.
---

# Plugin internals

omdsh plugins extend the running Cordis plugin tree through published DeepSeek Harness (DSH) services. For installation and compatibility rules see [Plugins and integrations](plugins.md); for a step-by-step build walkthrough see [Write and publish a plugin](tutorials/write-a-plugin.md).

## 1. Available extension points

| Capability | Service / interface | Terminal behavior |
|---|---|---|
| Slash commands | `commands` (`dsh-commands`) | Enters `/` completion, `/help`, and command execution automatically |
| Model tools | `tools` (optional `presentCall` / `presentResult`) | Rendered as styled cards with padding, wrapping, and generic fallback |
| Models & auth | `llm`, `authorization` | Appears in `/model` and `/login` flows automatically |
| Settings & secrets | `settings`, `credentials` | Live schema fields auto-render under `/settings → Advanced`; secrets stay encrypted |
| User prompts & notices | `tui` (`prompt`, `notice`, `commandOutput`) | Local terminal owns focus, cancellation, keyboard/mouse input, and composer return |
| Session behavior | `agent` / `session` services and durable events | Scoped to your plugin’s Cordis lifecycle |
| Personas & Skills | Agent presets and Skill registry | Chosen via `/agent` (blank sessions) or `/<skill-name>` |

Declare required services in `inject` and register resources via `ctx.effect(...)` inside `apply(ctx)` so unloading disposes cleanly. See the [TUI manifest](https://github.com/agi-fans/oh-my-dsh/blob/main/packages/tui/omdsh-tui/package.json) for published entry points.

## 2. Common plugin patterns

### Register a tool with clean terminal presentation

Supply `presentCall` and `presentResult` to describe intent—never hand-build borders or ANSI escape codes:

```js
export const name = 'metrics-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.tools.register({
      name: 'query_metrics',
      description: 'Query service latency metrics for a time window',
      parameters: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] },
      presentCall: (args) => ({ title: `Metrics · ${args.service}` }),
      presentResult: (result) => ({ summary: `${result.p95} ms p95` }),
      async execute(args) {
        return { p95: 42, service: args.service }
      },
    })
  }, 'metrics-tool')
}
```

### Prompt the user safely through `ctx.tui.prompt`

Never touch `process.stdin` or raw TTY mode directly. Use `ctx.tui.prompt` and forward `signal` so cancellation works cleanly:

```js
const choice = await ctx.tui.prompt({
  title: 'Deploy target',
  question: 'Choose an environment',
  options: [
    { label: 'Staging', value: 'staging' },
    { label: 'Production', value: 'prod' },
  ],
  allowCustom: false,
  signal: invocation.signal,
})
if (choice === null) return { kind: 'success' }
```

### Expose plugin settings via `ctx.settings`

Register a live schema with `ctx.settings` and omdsh automatically renders validated fields (with inherited/override status) under `/settings → Advanced`, persisting edits to the user’s profile patch. Store secret values through `ctx.credentials`.

### Respecting Response language in a `complete: true` persona

omdsh injects the user’s **Response language** preference through a system-prompt section. Because a custom persona with `complete: true` suppresses normal sections, include `{{omdsh_agent_behavior}}` so the preference continues to apply:

```yaml
complete: true
template: |
  You are a focused review assistant.
  {{omdsh_agent_behavior}}
```

See [Agent behavior design](https://github.com/agi-fans/oh-my-dsh/blob/main/docs/design/agent-behavior.md) for snapshot timing details.

## 3. Terminal ownership and boundaries

- **Single terminal owner:** The local TUI provider exclusively owns raw mode, key decoding, cursor placement, viewport layout, and mouse tracking. Approvals take priority over routine browsing and restore the prior view on completion.
- **No speculative UI registries:** Custom widget factories, theme registries, and custom footer segments do not have public APIs until a genuine second independent owner justifies the seam.
- **Durable events and safety:** Persisted events must obey published session schemas (unknown events are skipped only when explicitly marked ignorable); permission decisions always pass through Harness approval and auditing.
- **Reload semantics:** CLI package installs require a restart; live `/plugins` actions report whether changes applied immediately or need a restart, and existing sessions keep their mounted preset revision.

## Related

- [Plugins and integrations](plugins.md) — installation and compatibility contract
- [Write and publish a plugin](tutorials/write-a-plugin.md) — step-by-step build and publish guide
- [Architecture](architecture.md) — package boundaries and data flow
