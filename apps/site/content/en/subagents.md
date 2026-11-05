---
description: "How omdsh delegates work: the three subagent transports, reading a child's transcript, steering child agents, Workflow and Ralph orchestration, and background jobs."
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

Codex and Claude Code bundles ship disabled with omdsh and can be enabled and configured in `/settings → Plugins` or `/plugins → Bundles`. They use their own pinned runtimes and native login/settings, expose global `subagent_codex` and `subagent_claude_code` tools to every preset, and run fresh text-only tasks without continuation. Model and Permissions edits their native policies, independently of the parent’s Access. Installation status reports registration only; successful authentication and payload startup require a real delegation. See [Plugins](plugins.md).

While children run, a roster sits above the queue and composer with task names and lifecycle states. Ready means a continuable child can receive another message; Stopped is separate from Failed. On an empty composer, press `↓` to select a row, `↑`/`↓` to move, and `Enter` to open that child's live transcript. Selection stays with the same child when the roster reorders. Historical one-shot transcripts remain read-only; external executions have no local transcript and return their results to the parent.

In a continuable child, Enter follows the same Queue or Steer preference as the parent while a turn runs. `Alt+Enter` always queues for the next turn and `Alt+S` steers the next step; idle Enter sends another turn. Text, images and files use the same delivery path. Accepted child messages appear above its composer. In the child view, `Alt+Q` or `/queue` opens its own queue for editing, withdrawal, reordering and Queue-to-Steer transfer. `Alt+Up` recalls its latest next-turn message into the composer; Enter resubmits recalled messages as Queue, even when the running-input preference is Steer. Queue controls require a locally loaded child: send a message to continue an unloaded child first. Parent and child drafts stay separate, and a submission cancelled before acceptance or rejected during delivery returns to its original child draft, including when you have already returned to the parent.

With an empty composer, `Ctrl+C` stops the inspected child and preserves its accepted inbox; it does not stop the parent turn or the parent's Shell command. `Esc` clears a child draft first, then returns to the parent. A second `Ctrl+C` exits the application. Local child approval requests identify the requesting child and mark it as needing approval until the request settles. Harness rejects direct user questions from delegated children: unresolved questions must return in their result to the parent. See [Keyboard and keys](keyboard.md) for the complete overlay keys.

Recorded Workflow runs share the roster with agents, within the same bounded preview. Select a workflow with `↓` and `Enter` to browse its phases and members; `←`/`→` folds groups, and typing filters the list. Names and membership come from the session log, and status updates preserve the current selection. Enter opens a member only while both the member and its owned local child are running; completed, unavailable and external members remain visible without a cold-session opener. Esc closes the workflow list and restores the previous view and draft.

A normal turn ending does not stop a background workflow. An unfinished run is shown as Interrupted only when its originating turn was closed after a crash or at a fork boundary. This changes the display, not the tool result. Only top-level `workflow_run` calls produce these records; the complete event history remains available through `/trajectory`.

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
- [Commands](commands.md) — `/jobs` and the rest of the catalog
- [Guide an active turn](tutorials/guide-a-turn.md) — queueing, Plan mode, and task progress
