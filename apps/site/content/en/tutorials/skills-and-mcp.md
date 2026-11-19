---
description: Know when to pick Skills, MCP, LSP, or plugins, create a project Skill, and add MCP servers live in /mcp with safe credential references.
---

# Extend projects with Skills and MCP

Two needs come up quickly in real projects: teaching the agent your team’s repeatable workflows (review checklists, release steps), and connecting it to external tools or data (docs, databases, issue trackers).

Before configuring anything, pick the lightest tool that solves the job—**most projects never need a custom plugin**.

## 1. Choose the right extension mechanism

| Mechanism | What it is | Setup effort | Best for |
|---|---|---|---|
| **Skill (`SKILL.md`)** | A reusable Markdown instruction playbook for the model | **Lowest** (one Markdown file) | Code review checklists, commit conventions, debugging runbooks, output templates. |
| **MCP server** | A standard protocol exposing **external tools and resources** | **Low** (add a command or URL in `/mcp`) | Internal docs, databases, ticket trackers, custom HTTP APIs. |
| **Language server (LSP)** | Accurate **code intelligence** (definitions, references, diagnostics) | **Low** (install server + `lsp.json`) | Large TypeScript, Go, Rust, or Python repos where plain grep is noisy. |
| **Plugin package** | Adds new slash commands, built-in tools, or model providers | **Medium** (install a package or author one) | Custom `/commands`, new provider protocols, or deep local integrations. |

This tutorial walks through the first two: **a project Skill** and **a live MCP server in `/mcp`**. For installing plugins see [Install plugins and built-in integrations](install-plugin.md); for LSP see [Language servers](../language-servers.md).

## 2. Create a project Skill

A Skill is simply a `SKILL.md` file placed in a standard directory:

- **Project-scoped (shared via Git):** `.dsh/skills/<skill-name>/SKILL.md`
- **User-scoped (available in every project):** `$OMDSH_HOME/skills/<skill-name>/SKILL.md` (defaults to `~/.dsh/skills/`)

### Write your first Skill

Create `.dsh/skills/code-review/SKILL.md` in your repository:

```markdown
---
name: code-review
description: Review changes for correctness, edge cases, and regression test coverage using team standards
---

When reviewing changes, structure the response in this order:

1. List high-risk logic bugs, concurrency or boundary issues, and missing error handling with exact file paths and lines.
2. Check whether matching unit or regression tests exist; if not, suggest concrete test cases.
3. End with a summary of at most 3 lines without repeating unchanged code.
```

### How to invoke it

Restart omdsh (or start a new session) and use it in either of two ways:

- **Explicit command:** Type `/` to see `/code-review` in completion, then run `/code-review Check the recent changes in src/auth`.
- **Automatic selection:** When your request matches the `description` (“Review this PR against team standards”), the model can load the Skill automatically.
- If a Skill should only run when you explicitly invoke `/name`—never automatically—add `user-invocable: true` to its YAML frontmatter.

## 3. Add an MCP server live in `/mcp` (no restart required)

MCP (Model Context Protocol) connects the agent to external tools and resources. omdsh includes a live MCP manager so you can **add, probe, restart, or disable servers directly inside `/mcp` without editing JSON or restarting**.

### Add a server interactively

Run `/mcp`, choose **`Add server…`**, and follow the prompts:

1. **Name:** A short label such as `docs` or `memory`.
2. **Transport:**
- **`stdio` (local command):** Enter the executable and arguments, e.g. `npx -y @modelcontextprotocol/server-memory`.
- **`streamable-http` (remote HTTP endpoint):** Enter the URL, e.g. `https://mcp.example.com/mcp`.
3. **Secrets (when a token is required):**
- Avoid pasting raw secrets into config files. Use **`${credential:SECRET_NAME}`** in environment variables or headers (for example `Authorization: Bearer ${credential:DOCS_MCP_TOKEN}`). omdsh stores the secret in the local credentials store and keeps only the reference in config.

### Verify with Probe and live status

Select your new server inside `/mcp`:

- **Live status:** Healthy servers show `connected` and their tool count. `waiting for credentials` means a `${credential:...}` reference has not been stored yet; `failed` lets you inspect the connection error.
- **`Probe`:** Tests connectivity and tool discovery without tearing down an active connection.
- **`Restart` / `Disable`:** Reload after permission changes or turn off a server you are not currently using.
- Open **`Available tools`** or **`Recent calls in this session`** in `/mcp` to inspect tool schemas and recent call outcomes.

### When to use `.dsh/mcp.json` instead

| Approach | Best for | Restart needed? |
|---|---|---|
| **Live `/mcp` manager (recommended)** | Personal setup, testing new servers, remote servers with private credentials | **No—applies immediately** |
| **Project `.dsh/mcp.json`** | Checking a shared server setup into Git for the whole team | Yes, after editing the file |

Example project-level `.dsh/mcp.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

## Practical pitfalls

- **Too many connected tools slow turns down:** Every active MCP server adds its tool schemas to context (visible under `Tool schemas` in `/context`). Disable servers you are not using in `/mcp` and re-enable them when needed.
- **`stdio` server fails to start:** Run `!which npx` or test the command directly with `!command --help` from the input box to verify it is on `PATH`.

## Next steps

- Ready to install plugins or enable built-in Codex, Claude Code, and Git Worktree integrations? Continue to [Install plugins and built-in integrations](install-plugin.md).
- For every `SKILL.md` field, all 7 MCP states, and advanced options, see [Skills and MCP](../skills-and-mcp.md).
