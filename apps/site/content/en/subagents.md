---
description: "How omdsh delegates work: the three subagent transports, the Agent Hub, steering child agents, Workflow and Ralph orchestration, and background jobs."
---

# Subagents and delegation

omdsh runs delegation on the Harness subagent services rather than a product-private task runner. The model decides when to delegate; you follow the children from the keyboard, open any child transcript in place, and steer the runs that support it.

## Transports

Three transports coexist and are chosen per delegation rather than configured globally. The shipped persona routes heavyweight or parallel self-contained work to the isolated transport and keeps in-process children for work that may need steering or continuation.

| Transport | Runs | Inherits the parent conversation | Steerable after dispatch | Use it for |
|---|---|---|---|---|
| `subagent` | In-process, on the TUI event loop | No | Yes | Work you may need to guide or follow up |
| `subagent_fork` | In-process, on the TUI event loop | Yes — completed parent turns seed the child so the inherited prefix stays cache-eligible | Yes | Work that benefits from the parent's context |
| `subagent_isolated` | A separate process over ACP | No | No | Heavy or parallel self-contained work that should not share the render loop |

The isolated transport trades features for isolation: it accepts no model, persona, or tool filter, carries no parent-enforced recursion cap, and cannot be steered or followed up after dispatch. It boots its own Harness profile from an isolated home, so it needs a `dsh` on `PATH` that can serve the `acp` profile; `OMDSH_ACP_COMMAND` and `OMDSH_ACP_ARGS` override the launcher.

## Follow and steer

While children run, a roster sits above the queue and composer with task names and lifecycle states; running, waiting, and finished children are counted separately. Press `Down` on an empty composer to focus it and `Enter` to open the selected child, or press `Alt+A` directly.

The Agent Hub is the full-screen view: the roster plus an inspector pane. `Enter` opens a child's transcript in place, `Tab` and the arrow keys switch panes, `PgUp`/`PgDn` scroll, and `T` toggles the tree. A child transcript stays live while the child runs, and a continuable child accepts your next composer message or `/steer <message>`, so you can redirect running work without cancelling it. One-shot and isolated runs are read-only views. See [Keyboard and keys](keyboard.md) for the complete overlay keys.

## Orchestration tools

The mounted Harness composition gives the model two orchestration tools on top of plain delegation:

- `workflow_run` takes a JavaScript script that fans work out across delegated children with phases and structured results. The script runs on a worker thread rather than the host event loop, so a large fan-out does not stall the interface.
- `ralph` iterates fresh agents toward one objective until a worker reports completion or a blocker.

The `/workflow` slash command is a different control: it chooses the session's Default or Plan workflow. See [Commands](commands.md).

## Background jobs

Long-running work that continues after a turn shows up in `/jobs` with status and elapsed time; `/jobs kill <id>` stops one. A finished background job posts a single completion notice in the session. Jobs are session-scoped and do not survive switching or resuming a session.

## Related

- [Architecture](architecture.md) — subagent ownership and lifecycle boundaries
- [Commands](commands.md) — `/steer`, `/jobs`, and the rest of the catalog
- [Guide an active turn](tutorials/guide-a-turn.md) — queueing, Loop, and task progress
