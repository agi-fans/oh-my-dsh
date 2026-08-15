# oh-my-dsh (omdsh) Architecture

omdsh architecture; the product now boots and runs in both tty and pipe modes. Implementation details live beside the code.

## Objective

omdsh is a TUI coding agent in the style of oh-my-pi (terminal transcript, streaming assistant text, tool-call display, input line, status line), running on the DeepSeek Harness core runtime. The product is one command:

    omdsh [prompt]

It boots an interactive terminal, creates or resumes durable DSH sessions, streams session-log events to the terminal, reads user input, and exits cleanly on Ctrl-D.

## Layers

- Core runtime layer — published `@deepseek-ai/*` npm packages. Package manifests pin the runtime versions; TypeScript and Node resolve them through normal package exports.
- Reference layer — refs/deepseek-harness and refs/oh-my-pi (git submodules). They are read-only API/design references and never participate in dependency resolution, builds, tests, or runtime execution. oh-my-pi's Bun-coupled implementation is not reused; we port the experience onto Node ESM in DSH style.
- Product layer — this repo: packages/tui/omdsh-tui (the TUI capability seam) and apps/omdsh (the omdsh bin). Everything we add is a Cordis plugin or an app over the package tier — no harness package is modified.

## Package layout

    apps/omdsh/                    @oh-my-dsh/dsh-coding-agent — bin omdsh
      src/bin.ts                    argument parsing, env loading
      src/boot.ts                   tree boot over a shipped cordis.yml
      config/cordis.yml             the omdsh composition
    packages/tui/omdsh-tui/        @oh-my-dsh/dsh-tui — composable TUI plugin suite
      src/definition.ts             Service Definition: tui service protocol
      src/provider-local.ts         local terminal provider (tty owner)
      src/renderer.ts               pure ANSI differential renderer
      src/event-views.ts            SessionEvent -> frame mapping (pure)
      src/status-line.ts            projection stats -> editor footer label (pure)
      src/session-runtime.ts        active Agent/session lifecycle plugin
      src/human-interaction.ts      approval and question adapter plugin
      src/tool-presentation.ts      ToolDefinition presentation bridge plugin
      src/command-*.ts              omdsh command contribution plugins
      src/runner.ts                 thin interactive input-loop plugin
      src/index.ts                  local provider plugin entry

## Capability seam (DSH paradigm)

The package exposes several small Cordis entries around one deep terminal provider:

- Service definition — `@oh-my-dsh/dsh-tui/definition` declares the provider-neutral TUI protocol and view vocabulary.
- Local provider — `@oh-my-dsh/dsh-tui`/`provider-local` alone owns raw mode, key decoding, viewport, cursor and atomic differential rendering.
- Session runtime — `@oh-my-dsh/dsh-tui/session-runtime` owns the active Agent, persistence-backed create/resume/switch, model selection, projections and cleanup behind one API.
- Contributions — the command plugins register through `dsh-commands`; `human-interaction` adapts approval and questions; `tool-presentation` resolves each active `ToolDefinition`'s provider-neutral presentation intent.
- Consumer — `@oh-my-dsh/dsh-tui/runner` only reads submitted input, routes slash commands through the session runtime, sends ordinary messages and handles exit.

These entries remain in one npm package because they share a release cadence. Pure width, Markdown, editor, overlay and frame-diff algorithms remain internal modules; a second independently owned adapter or lifecycle is required before creating another runtime seam.

## Runtime composition (apps/omdsh/config/cordis.yml)

Modeled on the harness's own headless profile over dsh-base, plus the agent spine and local executors (the spine bundle is executor-less by design; deployments choose LLM adapter, bash executor, and presentation):

- cordis plugins: loader, timer
- dsh-agent-spine-demo — session, system prompt, tools, skills, jobs, goal domain, agent registry and agent loop
- JSONL persistence, SQLite session query, projection, title and stats
- local bash/fs/subprocess/attachment providers plus sandbox policy
- commands, compaction, todo, plan, approval/questions and subagents
- native skill discovery plus the model-facing skill loader; project/user MCP documents are adapted to one Harness MCP client plugin per server
- @oh-my-dsh/dsh-tui local provider, tool-presentation bridge, session runtime, human-interaction adapter, omdsh command contributions and thin runner

## TUI surface (ported from oh-my-pi)

- Transcript: user/assistant messages; assistant text streams in as assistant/message events update (differential render, no full redraw).
- Tool calls: one block per call — name, collapsed args, status (pending/running/ok/error), truncated output; terminal render intent (dsh-tools presentation mode terminal).
- Input: rounded editor, readline-style editing, durable multiline history, raw clipboard paste, path completion and external `$VISUAL`/`$EDITOR`.
- Composer and status line: the rounded editor keeps only the `🐳` top-cap label; a fixed unframed footer below it uses a model/reasoning plus workspace/Git row and a customizable telemetry row sourced from whole-log session-stats/token-meter projections (turns, steps, timings, TTFT, throughput, cache and token use).
- Scrolling: wheel bursts coalesce into one paint per event-loop turn, while immutable transcript states cache their formatted Markdown/tool rows; moving the viewport slices cached rows instead of reformatting the complete log.
- Keys: Enter submit, first Ctrl-C clears/interrupts and a second within 500ms exits with an `omdsh --resume <session-id>` hint; Ctrl-D quits; up/down history, SIGWINCH reflow.

## Shipped command

`pnpm build` compiles the two omdsh workspace packages against their npm dependencies, after which the built bin runs without tsx:

    node apps/omdsh/lib/bin.js "list files"

Both the source launch and the built artifact pass the pipe and PTY smokes.

## Verification (all keyless, like the harness snapshot policy)

- Rendering, editing, history, settings, command plugins, session runtime and tool presentation are covered by 30 TUI test files (269 tests), including fake-TTY contract tests.
- Pipe-mode e2e (apps/omdsh/src/smoke.spec.ts): boots the full composition, renders a prompt, surfaces the failed turn's error notice (fake API key), exits 0 on stdin EOF.
- Interactive e2e (scripts/pty-smoke.mjs): the same run under a real PTY — raw-mode key input, live frames, Ctrl-D quit, exit 0. Both the source launch and the built artifact pass it.
- Happy-path e2e (scripts/happy-smoke.mjs): omdsh against the published Harness mock LLM package; the transcript renders the prompt and streamed assistant text, then exits 0. This covers the live-success path keylessly; a manual run against the real DeepSeek API uses the same adapter and rendering pipeline.

## Implementation rounds

The three parity rounds are implemented. See [`implementation-rounds.md`](implementation-rounds.md) for the capability matrix, commands, keybindings and deliberate deployment boundary for MCP.

The completed architecture round is recorded in [`plugin-architecture-review.md`](plugin-architecture-review.md), including the ownership rules, implemented plugin seams and deliberately deferred contribution registries.
