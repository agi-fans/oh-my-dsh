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

`web_fetch` retrieves public pages. Web search stays disabled because DeepSeek's native search spends a whole model turn per query.

## Code intelligence

The read-only `lsp` tool answers definitions, references, implementations, and hover for configured language servers. No `lsp` tool appears until an `lsp.json` registers a server; see [Language servers](language-servers.md).

## Task and session

`todo_write` tracks implementation items, `ask_user_question` asks you when inspection cannot decide a user-owned choice, `present` records finished deliverables so they stay findable after the turn, and `skill` loads a matching `SKILL.md` on demand.

## Delegation

`subagent`, `subagent_fork`, and `subagent_isolated` delegate to child agents; `workflow_run` fans work out across children from a script; `ralph` iterates fresh agents toward one objective. See [Subagents and delegation](subagents.md).

## Related

- [Commands](commands.md) — `/tools` and the rest of the catalog
- [Permissions and access](permissions.md) — what the sandbox gates
- [Skills and MCP](skills-and-mcp.md) — extending the catalog with Skills and MCP tools
