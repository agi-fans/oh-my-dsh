---
description: Steer a running omdsh turn with the next-turn queue, Loop, Plan mode, todos, and /goal.
---

# Guide an active turn

By the end of this walkthrough you can queue follow-up messages, repeat a prompt with Loop, enter Plan mode, and read task progress.

### Queue follow-up messages

You do not need a special command to continue a running task. Submit another ordinary message while `Deep Driving` is active and omdsh places it in the next-turn queue, shown immediately above the composer.

To correct a queued message before it runs: with an empty composer, press `Up` to select the newest queued message (press `Up` again for older ones), edit the text, and press `Enter` to return it to the queue. This works without interrupting the current tool call.

To correct the active task instead, type guidance and press `Alt+S`, or use `/steer <message>`. The Harness receives it before the next model step; it does not interrupt the current tool call. **Guidance · next step** remains visible until the message is claimed, while **Queued · next turn** waits for the current Turn to finish. Enter keeps its next-turn behavior. The shortcut accepts text only; use Enter to queue attachments. Rejected guidance stays in the composer.

Press `Ctrl+C` once to interrupt an active turn. A second `Ctrl+C` within the exit window leaves omdsh, so pause before pressing it again if you intend to continue the session.

Open `/queue` or press `Alt+Q` to manage individual pending messages. The live list separates current-turn **Guidance**, **Next turn** follow-ups, and **Waiting** submissions that have not reached the Agent yet. Type to filter and use arrows or Tab to select; Enter edits text while keeping its images and file references. `Alt+D` deletes one entry, and `Alt+↑`/`Alt+↓` move it within its group without crossing plugin-owned queue messages. Esc cancels, preserving the composer draft and accepted input.

A tool question takes priority over the queue page. If it interrupts editing, the changed text returns as an unsent composer draft while the queued entry stays unchanged. If the model takes an entry before its edit can be saved, the edit also returns as a draft instead of automatically creating another message. Guidance and follow-up changes use the Harness’s durable inbox; Waiting submissions remain in memory until dispatched.

### Repeat a prompt with Loop

Use `/loop` for work that should run again after every completed turn:

- `/loop 5 check the tests and fix the next failure` sends the prompt now and repeats it five more times.
- `/loop 10m inspect the latest result` and `/loop 1h30m keep improving the implementation` repeat for a duration instead.
- `/loop 5` without an inline prompt makes the next ordinary composer message the repeated prompt.

While Loop is active, a later ordinary message first joins the normal next-turn queue and then replaces the repeated prompt. The fixed footer shows whether Loop is waiting, running, paused, or briefly completed: count limits show explicit repeat progress, and duration limits count down. Loop adds no control messages to the transcript.

Run `/loop` again to disable it. Pressing `Ctrl+C` during an iteration interrupts the active turn and pauses Loop; sending another ordinary message resumes it with the new prompt. Loop is process-local by design, so it does not restart after switching, resuming, or reopening a session.

### Plan before changing files

Run `/plan` before a task that needs investigation and an implementation proposal. Plan mode asks the model to inspect without mutating and to present a reviewable plan through the approval flow.

- `/plan <message>` enters Plan mode and sends the initial planning request together.
- `/plan off` leaves Plan mode directly.

Composer images travel with `/plan` and `/goal` when those commands accept them; `/plan off` and other image-less subcommands return the drafts to the composer.

### Follow task progress

When the agent records a Todo list, a compact tree appears above the queue and composer. Completed items, the current item, and pending work use distinct states. `/todo` prints the latest list into the transcript when you need a durable snapshot.

Todo describes the current turn's work, while `/goal <objective>` controls a longer-running goal. Run `/goal` without arguments to inspect its current state and available actions. Delegated children show up in the roster above the composer and in the Agent Hub; [Subagents and delegation](../subagents.md) covers the transports and how to steer a continuable child.
