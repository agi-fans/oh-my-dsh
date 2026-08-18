# Guide an active turn

[English](guide-a-turn.md) | [简体中文](guide-a-turn.zh-CN.md)

[Tutorials](../tutorials.md) · Previous: [Give the agent precise context](precise-context.md) · Next: [Recover and manage a long session](long-session.md)

### Queue follow-up messages

You do not need a special command to continue a running task. Submit another ordinary message while `Deep Driving` is active and omdsh places it in the next-turn queue. The queue appears immediately above the composer, so you can confirm what will run after the current turn.

With an empty composer, press `Up` to retrieve the newest queued message for editing. Press `Up` repeatedly to walk toward older queued messages, edit the selected text, and press `Enter` to return it to the queue. This is useful for correcting a follow-up without interrupting the current tool call.

Press `Ctrl+C` once to interrupt an active turn. A second `Ctrl+C` within the exit window leaves omdsh, so pause before pressing it again if you intend to continue the session.

### Repeat a prompt with Loop

Use `/loop` for work that should run again after every completed turn. `/loop 5 check the tests and fix the next failure` sends the prompt now and repeats it five more times. Durations accept compact expressions such as `/loop 10m inspect the latest result` or `/loop 1h30m keep improving the implementation`.

Run `/loop 5` without an inline prompt when you want the next ordinary composer message to become the repeated prompt. While Loop is active, any later ordinary message replaces that prompt after it enters the normal next-turn queue. The fixed footer shows whether Loop is waiting, running, paused, or briefly completed; count limits use explicit repeat progress, while duration limits count down without adding control messages to the transcript.

Run `/loop` again to disable it. Pressing `Ctrl+C` during an iteration interrupts the active turn and pauses Loop; sending another ordinary message resumes it with the new prompt. Loop is process-local by design, so it does not silently restart after switching, resuming, or reopening a session.

### Plan before changing files

Run `/plan` before a task that needs investigation and an implementation proposal. Plan mode asks the model to inspect without mutating and to present a reviewable plan through the Harness approval flow. Run `/plan off` to leave it directly. You can also use `/plan <message>` to enter Plan mode and send the initial planning request together.

### Follow task progress

When the agent records a Todo list, a compact tree appears above the queue and composer. Completed items, the current item, and pending work use distinct states; `/todo` prints the latest list into the transcript when you need a durable snapshot. Todo describes the current turn's work, while `/goal <objective>` controls a longer-running Harness goal; run `/goal` without arguments to inspect its current state and available actions.

[Tutorials](../tutorials.md) · Previous: [Give the agent precise context](precise-context.md) · Next: [Recover and manage a long session](long-session.md)
