---
description: "How omdsh delegates work: the three subagent transports, the Agent Hub, steering child agents, Workflow and Ralph orchestration, and background jobs."
---

# Subagents and delegation

omdsh runs delegation on the Harness subagent services rather than a product-private task runner. The model decides when to delegate; you follow the children from the keyboard, open local child transcripts in place, and steer the runs that support it.

## Transports

Three transports coexist and are chosen per delegation rather than configured globally. The shipped persona routes heavyweight or parallel self-contained work to the isolated transport and keeps in-process children for work that may need steering or continuation.

| Transport | Runs | Inherits the parent conversation | Steerable after dispatch | Use it for |
|---|---|---|---|---|
| `subagent` | In-process, on the TUI event loop | No | Yes | Work you may need to guide or follow up |
| `subagent_fork` | In-process, on the TUI event loop | Yes — completed parent turns seed the child so the inherited prefix stays cache-eligible | Yes | Work that benefits from the parent's context |
| `subagent_isolated` | A separate process over ACP | No | No | Heavy or parallel self-contained work that should not share the render loop |

The isolated transport trades features for isolation: it accepts no model, persona, or tool filter, carries no parent-enforced recursion cap, and cannot be steered or followed up after dispatch. It boots its own Harness profile from an isolated home, so it needs a `dsh` on `PATH` that can serve the `acp` profile; `OMDSH_ACP_COMMAND` and `OMDSH_ACP_ARGS` override the launcher.

The host `subagent` settings section defaults `maxDepth` to 1 for tools that inherit it: a direct child cannot delegate further through those tools. An explicit tool depth, including `provider-managed`, takes precedence. `maxActiveSubagents` defaults to 8 and caps live or materializing local and external children in the same activation tree; the root parent consumes no slot. Waiting, pending input and stopping children remain counted until cleanup releases their slots. Raising the setting admits more children; lowering it keeps resident children and refuses further admissions until usage drops. Admission is refused rather than queued.

Every delegation returns an activation id while the Harness runtime owns execution, settlement and result delivery. Local children can accept follow-ups; ACP and other external executions have no local Session transcript. Their results return to the parent conversation. In pipe mode, EOF waits for progressing children and the parent’s resulting work before exiting. Session teardown drains managed descendants before releasing their parent.

## Follow and steer

Codex and Claude Code bundles ship disabled with omdsh and can be enabled and configured in `/settings → Integrations` or `/plugins → Bundles`. They use their own pinned runtimes and native login/settings, expose global `subagent_codex` and `subagent_claude_code` tools to every preset, and run fresh text-only tasks without continuation. Model and Permissions edits their native policies, independently of the parent’s Access. Installation status reports registration only; successful authentication and payload startup require a real delegation. See [Plugins](plugins.md).

While children run, a roster sits above the queue and composer with task names and lifecycle states; running, waiting, and finished children are counted separately. Press `Down` on an empty composer to focus it and `Enter` to open the selected child, or press `Alt+A` directly.

The Agent Hub is the full-screen view: the roster plus an inspector pane. `Enter` opens a child's transcript in place, `Tab` and the arrow keys switch panes, `PgUp`/`PgDn` scroll, and `T` toggles the tree. A child transcript stays live while the child runs, and a continuable child accepts your next composer message or `/steer <message>`, so you can redirect running work without cancelling it. Historical one-shot transcripts remain read-only. External executions show lifecycle state in Agent Hub; attempting to open their transcript explains that their results are in the parent session. See [Keyboard and keys](keyboard.md) for the complete overlay keys.

Agent Hub also shows the three most recent recorded Workflow runs, their result and latest recorded phase. Each available child’s inspector shows its Workflow, phase and member outcome separately from its live lifecycle state. Records are replayed after resume; Enter still opens the child transcript for detailed errors. The complete event history remains available through `/trajectory`; this view does not provide a topology editor or worker script logs.

## Independent advice

Enable the shipped Codex or Claude Code integration in `/settings → Integrations`, then use `/advisor` to choose an advisor, enter a question and optionally paste selected code, a diff, or an analysis. `/advisor codex <question>` and `/advisor claude <question>` consult directly without additional context. Interactive consultations ask for confirmation; a line-input command is an explicit request. Native model charges apply. Cancel with Esc or the Cancel action; cancellation waits for process cleanup.

The primary model can use `consult_advisor` with `provider` (`codex` or `claude`), `question`, and optional `context` when you request an external second opinion. `/settings → Integrations → Advisor model calls → Model consultations` disables model calls while retaining `/advisor`. Native and PTC tool presentations share the same structured result: provider, question, opinion and truncation flag. The primary model evaluates the opinion independently; manual command results remain a human-facing document and are not automatically submitted to it.

Each advisor gets a fresh private working directory, the explicit question and context, and the configured native provider model/environment. No conversation history or workspace files are automatically copied. Questions are limited to 8,000 characters and context to 48,000; oversized input is rejected. Opinions are limited to 48,000 characters with an explicit truncation marker. Advisors appear as external children in Agent Hub and share the Harness activation capacity; they have no continuation or local transcript.

Advisors use a separate permission binding. Codex disables shell, web, hooks, apps and native delegation, uses a read-only native sandbox, and receives a temporary private home containing only an opaque copy of native `auth.json`. Native utility tools may remain visible, but the outer sandbox denies workspace writes. Configure its model or explicit credentials in the native provider's profile settings; custom native configuration and home-dependent keychain credentials are not imported into that private home. Claude uses native authentication with safe mode, no built-in tools or MCP, hooks disabled and plan permissions. The outer Harness sandbox permits writes only to private state and platform temporary areas, regardless of the ordinary subagent's permissions. Authentication refreshes requiring writes outside those areas can fail. The private Codex authentication copy is never written back. This is a filesystem write boundary, not a network or read-access sandbox.

Consultations fail rather than falling back to a writable run if full confinement is unavailable, including the current Windows backend's partial enforcement. Workspaces within platform temporary areas are refused because those areas are writable under this policy. Ordinary `subagent_codex` and `subagent_claude_code` keep their existing native permissions and settings.

## Orchestration tools

The mounted Harness composition adds two orchestration tools on top of plain delegation:

- `workflow_run` takes a JavaScript script that fans work out across delegated children with phases and structured results. The script runs on a worker thread rather than the host event loop, so a large fan-out does not stall the interface.
- `ralph` iterates fresh agents toward one objective until a worker reports completion or a blocker. It ships disabled, matching the upstream base bundle: its tool description already restricts it to runs you asked for explicitly, and completion is a worker self-report rather than an independent evaluation. A home overlay restores it with `disabled: false` on its row.

The `code` (PTC) preset denies `workflow_run`, because PTC presents the registry as a generated SDK over `run_code` and would otherwise expose a second model-authored orchestration surface.

Use `/plan` to enter planning and `/plan off` to return to direct work. Plan mode is independent of workflow orchestration. See [Commands](commands.md).

## Background jobs

Long-running work that continues after a turn shows up in `/jobs` with status and elapsed time; `/jobs kill <id>` stops one. A finished background job posts a single completion notice in the session. Jobs are session-scoped and do not survive switching or resuming a session.

## Related

- [Architecture](architecture.md) — subagent ownership and lifecycle boundaries
- [Commands](commands.md) — `/steer`, `/jobs`, and the rest of the catalog
- [Guide an active turn](tutorials/guide-a-turn.md) — queueing, Loop, and task progress
