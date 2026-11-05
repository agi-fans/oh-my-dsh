---
description: Steer a running omdsh turn with the next-turn queue, Plan mode, todos, and /goal.
---

# Guide an active turn

By the end of this walkthrough you can queue follow-up messages, enter Plan mode, and read task progress.

### Queue follow-up messages

You do not need a special command to continue a running task. By default, Enter during `Deep Driving` places an ordinary message in the next-turn queue, shown immediately above the composer. Settings → Terminal → Input → Enter while running can change Enter to Steer. The composer shows the current action; explicit Queue and Steer shortcuts keep their meaning.

To correct a queued message before it runs: with an empty composer, press `Up` to select the newest queued message (press `Up` again for older ones), edit the text, and press `Enter` to return it to the queue. This works without interrupting the current tool call.

To correct the active task instead, type guidance and press `Alt+S`. The Harness receives it before the next model step; it does not interrupt the current tool call. **Steer · next step** remains visible until the message is claimed, while **Queue · next turn** waits for the current Turn to finish. Both delivery modes accept text, images and files, preserving image placement and file order. `Alt+Enter` always queues (Windows also uses `Ctrl+Q`), while `Alt+S` always steers. Delivery is fixed when submitted; changing the preference does not redirect pending messages. A rejected submission returns as an unsent draft without an automatic retry. If the turn ends while attachments are being saved, steering returns to the composer instead of silently starting a new turn. Idle Enter, commands and editing a recalled follow-up keep their existing behavior.

Press `Ctrl+C` once to interrupt an active turn. A second `Ctrl+C` within the exit window leaves omdsh, so pause before pressing it again if you intend to continue the session.

Open `/queue` or press `Alt+Q` to manage individual pending messages. The live list distinguishes **Steer · next step**, **Queue · next turn**, and **Sending · not yet accepted**. The labels and controls follow the UI language; message text stays literal. Type to filter and use arrows or Tab to select; Enter edits text while keeping its images and file references. While a turn is running, `Alt+S` moves the selected accepted Queue message to Steer with the same text, image and file references. Sending entries and messages already in Steer cannot be promoted. A stopped turn leaves the message queued. `Alt+D` withdraws one entry, and `Alt+↑`/`Alt+↓` move it within its group without crossing plugin-owned queue messages. Esc cancels, preserving the composer draft and accepted input.

The pinned Harness release clears pending inbox messages when its Agent handle is disposed. Normal exit and session-switch cleanup therefore do not preserve the queue for resume. An unclaimed inbox can be replayed from a log that has not been cleared, but this is not a guarantee of recovery after normal exit. Composer drafts are saved separately.

A tool question takes priority over the queue page. If it interrupts editing, the changed text returns as an unsent composer draft while the queued entry stays unchanged. If the model takes an entry before its edit can be saved, the edit also returns as a draft instead of automatically creating another message. Steer and Queue changes use the Harness’s durable inbox; Sending submissions remain in memory until dispatched. If a session switch interrupts an edit, the changed text and attachments are saved as a draft in the original session. A brief composer confirmation appears when Harness takes a pending message for processing; this does not claim the model has answered it.

### Plan before changing files

Run `/plan` before a task that needs investigation and an implementation proposal. Plan mode asks the model to inspect without mutating and to present a reviewable plan through the approval flow.

- `/plan <message>` enters Plan mode and sends the initial planning request together.
- `/plan off` leaves Plan mode directly.

Composer images travel with `/plan` and `/goal` when those commands accept them; `/plan off` and other image-less subcommands return the drafts to the composer.

### Follow task progress

When the agent records a Todo list, a compact tree appears above the queue and composer. Completed items, the current item, and pending work use distinct states. The tree is the list; there is no command that prints a second, already stale copy of it.

Todo describes the current turn's work, while `/goal <objective>` controls a longer-running goal. Run `/goal` without arguments to inspect its current state and available actions. Delegated children show up in the roster above the composer, where `↓` selects one and `Enter` opens its transcript; [Subagents and delegation](../subagents.md) covers the transports and how to steer a continuable child.
