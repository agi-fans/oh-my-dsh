---
description: Complete omdsh slash-command reference with arguments for sessions, configuration, turn control, observability, clipboard output, and Skills.
---

# Commands

Type `/` in the composer to browse the live catalog with inline argument hints, or run `/help` for the command list plus the essential shortcuts (`/help full` adds the complete keyboard catalog). The catalog is assembled from the active plugins, so commands contributed by Skills and user bundles appear beside the built-ins. `/help` groups what the TUI handles as terminal commands and what the mounted Harness composition provides as agent commands.

`[brackets]` mark optional arguments and `|` separates alternatives. A command with a picker runs without arguments.

## Sessions

| Command | What it does |
|---|---|
| `/new` | Start a new session. |
| `/sessions [query]` | Without an argument, open the Session Library; with a query, search durable session content through the full-text index and resume the chosen hit. In the library, `p` pins a session and `r` renames it. |
| `/resume [session-id]` | Resume a durable session. Without an id, choose from the recent-session list. |
| `/session` | Show the current session's details. |
| `/retry` | Run the most recent human prompt again. |
| `/todo` | Print the current session todo list into the transcript. |
| `/clear` | Clear the visible transcript. The running turn, status, todos, and queued follow-ups keep their state. |

## Session configuration

| Command | What it does |
|---|---|
| `/agent` | Choose the Agent preset: Standard, PTC, Minimal, or Cordis. Available on blank sessions; the preset decides which tools the model sees. |
| `/workflow` | Choose the Default or Plan workflow. |
| `/permission` | Choose the session Access level: Read only, Workspace write, or Full access. |
| `/login` | Sign in to a provider: a catalog entry, an API key, or a custom provider with its own id, base URL, protocol, and model ids. |
| `/logout` | Remove an omdsh-managed provider choice. |
| `/settings` | Open the settings overlay. Alias: `/set`. |

### `/model`

| Form | Effect |
|---|---|
| `/model` | Open the provider, model, and reasoning-effort picker. |
| `/model <query>` | Resolve a `provider/model` or fuzzy model name; an exact match switches immediately and an ambiguous match opens the picker. |
| `/model --session <query>` | Switch the active session without writing the saved default. Does not combine with a subcommand. |
| `/model next` / `/model previous` | Cycle to the next or previous favorite model. |
| `/model reasoning` | Cycle the current model's reasoning effort. |
| `/model favorite` / `/model unfavorite` | Add or remove the current model from the local favorites list, stored in `$OMDSH_HOME/omdsh/model-favorites.json`. |
| `/model favorites` | List the favorite models. |

## Turn control

| Command | What it does |
|---|---|
| `/steer <message>` | Guide the active turn before its next model step. |
| `/loop [count\|duration] [prompt]` | Repeat a prompt after every completed turn: a count or a duration repeats a fixed number of times or until the time elapses, and a bare count makes the next composer message the repeated prompt. Run `/loop` again to disable it. See [Guide an active turn](tutorials/guide-a-turn.md). |
| `/plan [off\|<message>]` | Enter Plan mode and optionally send the first planning request, or leave it with `off`. Composer images travel with the planning request. |
| `/goal [<objective>\|clear\|edit <objective>\|pause\|resume]` | Set or inspect a long-running goal for the session. |
| `/compact` | Compact older conversation history. |
| `/jobs [kill <id>]` | List background jobs, or stop one by id. |

## Observability

| Command | What it does |
|---|---|
| `/context` | Print an inline, projection-backed breakdown of context usage that stays in the transcript. |
| `/trajectory` | Open the event ledger: Turn and Step grouping, live following, search, folding, timings, token usage, and tool payloads. Requires an interactive terminal. |
| `/diff [path]` | Summarize workspace changes as a per-file table, or print one file's patch. It only reads git state and never stages or commits. |
| `/tools` | List the tools visible to the agent. |
| `/mcp` | Show connected MCP servers and their tools. |

## Clipboard and output

| Command | What it does |
|---|---|
| `/copy [text\|code\|cmd]` | Copy the last assistant reply, the last fenced code block, or the last bash command; without an argument, open the copy picker. `command` is accepted for `cmd`. |
| `/export [html\|markdown] [path]` | Export the complete transcript as Markdown or standalone HTML. |
| `/changelog [full]` | Show recent release notes, or the complete packaged release history with `full`. |

## Skills

Every user-invocable Skill appears as `/skill:<name>`, with the description from its `SKILL.md`. Type `/skill:` to filter the list and press Enter to invoke one. The older `/code-review` form of a Skill command is still accepted for compatibility but is no longer advertised. See [Skills and MCP](skills-and-mcp.md).

## Application

| Command | What it does |
|---|---|
| `/help [full]` | Show commands and essential shortcuts; `full` adds the complete keyboard catalog. Aliases: `/h`, `/?`. |
| `/quit` | Quit the application. Aliases: `/q`, `/exit`. |

## Related

- [Keyboard and keys](keyboard.md) — editing keys, overlays, and `keybindings.json`
- [Tutorials](tutorials.md) — task-based walkthroughs for these commands
- [Skills and MCP](skills-and-mcp.md) — Skills discovery and MCP configuration
