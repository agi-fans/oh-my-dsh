# oh-my-dsh (omdsh) Architecture

omdsh architecture; the product now boots and runs in both tty and pipe modes. Implementation details live beside the code.

## Objective

omdsh is a TUI coding agent in the style of oh-my-pi (terminal transcript, streaming assistant text, tool-call display, input line, status line), running on the DeepSeek Harness core runtime. The product is one command:

    omdsh [prompt]

It boots an interactive terminal, creates or resumes durable DSH sessions, streams session-log events to the terminal, reads user input, and exits cleanly on Ctrl-D.

## Layers

- Core runtime layer — refs/deepseek-harness (git submodule). omdsh consumes its package tier exactly as an in-repo app would: our pnpm-workspace.yaml adds refs/deepseek-harness/packages/*/* and refs/deepseek-harness/vendor/* as workspace members, so every workspace:^ specifier inside the harness resolves against one coherent HEAD. We never edit the submodule.
- Reference layer — refs/oh-my-pi (git submodule). Read-only design reference for the TUI experience (differential rendering, transcript layout, input ergonomics). Its Bun-coupled implementation is not reused; we port the experience onto Node ESM in DSH style.
- Product layer — this repo: packages/tui/omdsh-tui (the TUI capability seam) and apps/omdsh (the omdsh bin). Everything we add is a Cordis plugin or an app over the package tier — no harness package is modified.

## Package layout

    apps/omdsh/                    @omdsh/app — bin omdsh
      src/bin.ts                    argument parsing, env loading
      src/boot.ts                   tree boot over a shipped cordis.yml
      config/cordis.yml             the omdsh composition
    packages/tui/omdsh-tui/        @omdsh/tui — the TUI capability seam
      src/definition.ts             Service Definition: tui service protocol
      src/provider-local.ts         local terminal provider (tty owner)
      src/renderer.ts               pure ANSI differential renderer
      src/event-views.ts            SessionEvent -> frame mapping (pure)
      src/status-line.ts            projection stats -> editor footer label (pure)
      src/session-controller.ts     create/resume/commands/model/query control plane
      src/tool-renderers.ts         extensible coding-tool presentation registry
      src/runner.ts                 interactive driver plugin
      src/index.ts                  plugin entry (apply)

## Capability seam (DSH paradigm)

One seam, three roles, complete:

- Service Definition — @omdsh/tui defines the tui context service: render(event), setStatus(status), prompt() (bounded async input), notice(text), close(). Events and statuses use the same vocabulary the SDK wire carries (session.event, session.status), so a future remote or multiplexed UI can reuse the definition unchanged.
- Service Provider — local terminal provider: owns the tty (raw mode), key decoding (arrows, history, bracketed paste, double Ctrl-C/Ctrl-D), SIGWINCH reflow, and the differential renderer. Rendering is pure: an event maps to a frame; the provider diffs frames and emits only changed cells.
- Consumer — the interactive runner and `SessionController`: keeps a readline loop active while an agent runs, routes ordinary input as follow-up, supports explicit steering, creates/resumes sessions, dispatches dynamic commands, and stops on Ctrl-D.

The seam is complete in one package because the three roles do not evolve independently yet; splitting happens when a second provider (e.g. web or remote transport) or a second consumer (e.g. non-interactive replay) lands.

## Runtime composition (apps/omdsh/config/cordis.yml)

Modeled on the harness's own headless profile over dsh-base, plus the agent spine and local executors (the spine bundle is executor-less by design; deployments choose LLM adapter, bash executor, and presentation):

- cordis plugins: loader, timer
- dsh-agent-spine-demo — session, system prompt, tools, skills, jobs, goal domain, agent registry and agent loop
- JSONL persistence, SQLite session query, projection, title and stats
- local bash/fs/subprocess/attachment providers plus sandbox policy
- commands, compaction, todo, plan, approval/questions and subagents
- native skill discovery plus the model-facing skill loader; project/user MCP documents are adapted to one Harness MCP client plugin per server
- @omdsh/tui (provider) and its runner (consumer)

## TUI surface (ported from oh-my-pi)

- Transcript: user/assistant messages; assistant text streams in as assistant/message events update (differential render, no full redraw).
- Tool calls: one block per call — name, collapsed args, status (pending/running/ok/error), truncated output; terminal render intent (dsh-tools presentation mode terminal).
- Input: rounded editor, readline-style editing, durable multiline history, raw clipboard paste, path completion and external `$VISUAL`/`$EDITOR`.
- Composer: `🐳` top cap with model/session/path state; the bottom border embeds selectable telemetry sourced from whole-log session-stats/token-meter projections (turns, steps, timings, TTFT, throughput, cache and token use).
- Scrolling: wheel bursts coalesce into one paint per event-loop turn, while immutable transcript states cache their formatted Markdown/tool rows; moving the viewport slices cached rows instead of reformatting the complete log.
- Keys: Enter submit, first Ctrl-C clears/interrupts and a second within 500ms exits with an `omdsh --resume <session-id>` hint; Ctrl-D quits; up/down history, SIGWINCH reflow.

## Shipped command

pnpm run build:runtime produces the harness runtime closure (tsc emissions over every vendor/packages project + the harness's own tsdown host pass), after which the built bin runs without tsx:

    node apps/omdsh/lib/bin.js "list files"

Both the source launch and the built artifact pass the pipe and PTY smokes.

## Verification (all keyless, like the harness snapshot policy)

- Rendering, editing, history, commands and session helpers are covered by 27 TUI test files (245 tests), including fake-TTY contract tests.
- Pipe-mode e2e (apps/omdsh/src/smoke.spec.ts): boots the full composition, renders a prompt, surfaces the failed turn's error notice (fake API key), exits 0 on stdin EOF.
- Interactive e2e (scripts/pty-smoke.mjs): the same run under a real PTY — raw-mode key input, live frames, Ctrl-D quit, exit 0. Both the source launch and the built artifact pass it.
- Happy-path e2e (scripts/happy-smoke.mjs): omdsh against the harness's own mock LLM server — the first request is refused (exercising the mounted provider retry), the second streams a success; the transcript renders the prompt and the streamed assistant text, then exits 0. This covers the live-success path keylessly; a manual run against the real DeepSeek API uses the same adapter and rendering pipeline.

## Implementation rounds

The three parity rounds are implemented. See [`implementation-rounds.md`](implementation-rounds.md) for the capability matrix, commands, keybindings and deliberate deployment boundary for MCP.
