---
description: Steer a running omdsh turn with the next-turn queue, Loop, Plan mode, todos, and /goal.
---

# Guide an active turn

By the end of this walkthrough you can queue follow-up messages, repeat a prompt with Loop, enter Plan mode, and read task progress.

### Queue follow-up messages

You do not need a special command to continue a running task. Submit another ordinary message while `Deep Driving` is active and omdsh places it in the next-turn queue, shown immediately above the composer.

To correct a queued message before it runs: with an empty composer, press `Up` to select the newest queued message (press `Up` again for older ones), edit the text, and press `Enter` to return it to the queue. This works without interrupting the current tool call.

Press `Ctrl+C` once to interrupt an active turn. A second `Ctrl+C` within the exit window leaves omdsh, so pause before pressing it again if you intend to continue the session.

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

Todo describes the current turn's work, while `/goal <objective>` controls a longer-running goal. Run `/goal` without arguments to inspect its current state and available actions.
