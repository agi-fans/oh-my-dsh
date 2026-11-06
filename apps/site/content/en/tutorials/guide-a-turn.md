---
description: Steer a running omdsh turn with the next-turn queue, Plan mode, todos, and /goal.
---

# Guide an active turn

By the end of this walkthrough you can queue follow-up messages, enter Plan mode, and read task progress.

### Queue or steer a request

While the agent is inspecting your project, try one of these actions. Read the delivery label above the composer to see when your message will be used.

| You want to | Action | Expected result |
|---|---|---|
| Ask a follow-up after this task | Type “Next, summarize the test setup” and press `Alt+Enter`. | **Queue · next turn** appears, waiting for the current turn to finish. |
| Correct the current task | Type “Focus on the startup path first” and press `Alt+S`. | **Steer · next step** appears. Harness delivers it before the next model step, after any current tool call. |
| Revise the latest queued request | With an empty composer, press `Alt+Up`, edit, then submit again. | The message returns to the composer for editing. |
| Manage several pending requests | Open `/queue` or press `Alt+Q`. | Select an entry to edit, withdraw, or reorder it. |

By default, Enter during an active turn also queues a follow-up. **Settings → Terminal → Input → Enter while running** can change that to Steer. Explicit `Alt+Enter` and `Alt+S` keep their meanings, and both accept images and files with the text.

To interrupt the task, press `Esc`, or `Ctrl+C` with an empty composer. A second Ctrl+C within the exit window leaves omdsh. Accepted pending messages remain available while the session stays mounted, but normal exit and session-switch cleanup clear the Harness queue. Local input recovered after restart waits for your review before sending. The complete editing, interruption, and recovery rules are in [Sessions and history](../sessions.md#pending-messages-and-recovery).

### Plan before changing files

Run `/plan` before a task that needs investigation and an implementation proposal. Plan mode asks the model to inspect without mutating and to present a reviewable plan through the approval flow.

- `/plan <message>` enters Plan mode and sends the initial planning request together.
- `/plan off` leaves Plan mode directly.

When the plan review opens, read the proposal and choose **Approve** to continue implementation or **Keep planning** to send feedback. Access controls tool permissions throughout the workflow. The review controls are described in [Commands](../commands.md).

Composer images and files travel with `/plan` and `/goal` requests that accept attachments. `/plan off` and other subcommands that reject attachments restore the complete draft for correction.

### Follow task progress

When the agent records a Todo list, a compact tree appears above the queue and composer. Completed items, the current item, and pending work use distinct states. The tree is the list; there is no command that prints a second, already stale copy of it.

Todo describes the current turn's work, while `/goal <objective>` controls a longer-running goal. Run `/goal` without arguments to inspect its current state and available actions. Delegated children show up in the roster above the composer, where `↓` selects one and `Enter` opens its transcript; [Subagents and delegation](../subagents.md) covers the transports and how to steer a continuable child.

### Next

Next, [recover and manage a long session](long-session.md) to resume work, explore branches, and control context growth.
