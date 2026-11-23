---
description: Compare the four Agent presets (Standard, PTC, Minimal, Creator) and browse every built-in tool category available to the model.
---

# Tools and presets

Run `/tools` anytime to search every tool visible to the model and read its full description. The active toolset is determined by your session’s **Agent preset** plus enabled built-in features, MCP servers, and language servers.

## Comparing the four Agent presets

Switch presets on a blank session with `/agent`, or set the default for new sessions under `/settings` → **`Agent presets`**:

| Preset | Focus | Tools included | Best for |
|---|---|---|---|
| **`Standard`** (default) | Full everyday coding agent | File read/write/search, sandboxed shell, persistent terminal, web search/fetch, Todo, goal/jobs/schedule, Plan mode, subagents, session history, Agent Teams (when `/team on` is active) | **95% of everyday coding, debugging, and refactors** |
| **`PTC`** (`code`) | Programmatic tool orchestration | Exposes the tool registry as a generated SDK inside **`run_code`** (hides `workflow_run`); runs in a session-scoped persistent in-memory REPL that keeps variables across calls and does not accept top-level `return` | Batching dozens of reads, filters, or checks in one script with fewer model round-trips |
| **`Minimal`** | Lean two-tool setup | Minimal file and shell pair only | Tight context budgets or minimal baseline comparisons |
| **`Creator`** (`cordis`) | Plugin authoring | Standard catalog plus the bundled `dsh-doc` authoring skill and read-only runtime inspection (`cordis_inspect`) | Building or debugging omdsh plugins via `/agent creator` (without changing your default preset) |

> Once the first message is sent, a session’s preset is locked to keep tool history consistent. Run `/agent inspect` anytime to inspect what is mounted.

## Built-in tool categories

### 1. Files and code intelligence
- **Filesystem & search** (`read`, `write`, `edit`, `glob`, `grep`, etc.): Governed by `/permission`; oversized outputs keep a bounded preview in context so huge files never blow out your window.
- **Code intelligence (`lsp`):** Mounted only when `lsp.json` configures a language server, providing `goToDefinition`, `findReferences`, `goToImplementation`, and `hover`. See [Language servers](language-servers.md).

### 2. Shell and persistent terminals
- **Sandboxed shell (`bash` / `pwsh`):** Platform-native shell (`bash` on macOS/Linux, `pwsh` on Windows) for tests and one-shot commands; 120s default timeout, tunable under `/settings` → **`Plugins` → `Shell`**.
- **Persistent terminals (`terminal_*`):** Interactive sessions that retain state across steps.
- **Background jobs (`jobs`):** Tracks commands that keep running after a turn; inspecting them in `/jobs` never interferes with the agent’s own reads.

### 3. Web search and fetch
- **`web_search` and `web_fetch`:** Default to hosted DeepSeek APIs (`deepseek-search-api` / `deepseek-fetch-api`), avoiding local proxy/DNS issues.
- To fetch `localhost` or internal corporate URLs, switch fetch to **`Direct fetch`** (`http`) under `/settings` → **`Plugins` → `Integrations` → `Web search and fetch`**.

### 4. Planning, long goals, and schedules
- **Todos and Plan mode (`exit_plan_mode`):** Tracks multi-step checklists and submits plans for review under `/plan`.
- **Long goals (`goal`):** Pairs with `/goal` and `Alt+G` for multi-turn objectives.
- **Scheduled reminders (`schedule_*`):** Creates and updates time-based reminders managed via `/schedule`.

### 5. Subagents, teams, and external extensions
- **Subagents & teams:** Built-in `subagent`, `subagent_fork`, `subagent_isolated`, `workflow_run` (`Standard` preset; hidden in `PTC`), `team_task_*` when `/team on` is enabled, plus `subagent_codex` / `subagent_claude_code` when enabled. See [Subagents and Agent Teams](subagents.md).
- **Session history (`session_*`):** Lets the model search and trace past sessions; disable under `/settings` → **`Plugins` → `Optional features`** if you want to save context.
- **MCP tools and resources (`mcp__*`, `mcp-resources`):** Appear automatically when MCP servers connect via `/mcp` or `mcp.json`.

## Turning optional tools on or off

Most toggles live directly in `/settings` → **`Plugins`** (no manual file editing required):
- Toggle **Record file changes**, **Session history tools**, **Ralph loop**, and **Repeat tool reminder** under Optional features.
- Only advanced overrides (such as disabling `search` inside `tool-web` while keeping `fetch`, or enabling `interrupt_agent`) require editing `$OMDSH_HOME/profiles/omdsh/cordis.patch.yml`.

## Related

- [Permissions and safety](permissions.md) — how access levels constrain files and shell
- [Subagents and Agent Teams](subagents.md) — delegation and `/team` task boards
- [Skills and MCP](skills-and-mcp.md) — connecting external MCP tools
- [Language servers](language-servers.md) — configuring read-only `lsp` code navigation
