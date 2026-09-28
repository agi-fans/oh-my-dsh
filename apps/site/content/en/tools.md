---
description: "The tools the model can use in omdsh, grouped by capability, and how Access, LSP configuration, and result spill affect them."
---

# Tools

The mounted tools come from published Harness plugins and from the session's Agent preset; omdsh adds the terminal presentation layer, not a second tool registry. `/tools` lists exactly what the active session exposes, and the list follows the preset you chose with `/agent`. Access still gates what each mutating tool may touch.

## Shell

| Tool | Behavior |
|---|---|
| `bash` / `pwsh` | One-shot commands in the confined shell for the host. Calls carry a 120-second timeout that the model can raise per call or avoid by running the command in the background. |
| `terminal_open`, `terminal_send`, `terminal_read`, `terminal_signal`, `terminal_close`, `terminal_list` | Persistent terminal sessions that retain cwd, environment, and interactive children across calls. |

## Files and search

`read`, `write`, `edit`, and `str_replace_editor` cover file content, while `grep` and `glob` search the workspace. Mutating tools honor the session Access preset, and a mutation outside the sandbox returns the shared denial described in [Permissions and access](permissions.md). Results over the context budget spill to a private file with a bounded preview in the transcript; the original stays readable with `read` or `grep`.

## Web

`web_fetch` retrieves public pages. `web_search` answers through DeepSeek's hosted search with the same credential as the conversation route; a search is a complete auxiliary model request, bounded to five server-tool uses per request by default, and the provider's endpoint, model, and token cap are tunable in its `web-search-deepseek` settings section. A deployment that wants no search turns off `search` on the `tool-web` row in its own overlay.

## Code intelligence

The read-only `lsp` tool answers definitions, references, implementations, and hover for configured language servers. No `lsp` tool appears until an `lsp.json` registers a server; see [Language servers](language-servers.md).

## Task and session

`todo_write` tracks implementation items, `ask_user_question` asks you when inspection cannot decide a user-owned choice, `present` records finished deliverables so they stay findable after the turn, and `skill` loads a matching `SKILL.md` on demand.

Five read-only tools let the agent reach work it did in an earlier session: `session_search` and `session_event_search` find it, `session_trace` and `session_event_trace` follow lineage and relationships, and `session_event_read` returns exact event data. Without them a model that already solved something can only be told again, because `/sessions` and `/resume` are yours to reach and not the agent's.

They are workspace-scoped: cross-session reads are authorized only when the target session's working directory exactly matches the caller's, and a session with no working directory can inspect only itself. Turning the row off in a home overlay with `disabled: true` removes all five tools and their guidance.

## Runtime inspection

The `cordis` preset adds read-only runtime inspection on top of the native catalog: `cordis_inspect_list` discovers providers, and `cordis_inspect_query` reads exact Service, Event, and Tool APIs. Changing the runtime means editing composition files, not calling a tool.

## Delegation

`subagent`, `subagent_fork`, and `subagent_isolated` delegate to child agents, and `workflow_run` fans work out across children from a script. `ralph` iterates fresh agents toward one objective but ships disabled, matching the upstream base bundle; a home overlay restores it with `disabled: false` on its row. The `code` preset denies `workflow_run`, so a PTC session authors its orchestration through `run_code` alone. See [Subagents and delegation](subagents.md).

## Related

- [Commands](commands.md) — `/tools` and the rest of the catalog
- [Permissions and access](permissions.md) — what the sandbox gates
- [Skills and MCP](skills-and-mcp.md) — extending the catalog with Skills and MCP tools
