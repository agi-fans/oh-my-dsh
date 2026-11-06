---
description: Measured omdsh TUI performance for session replay, tool-call resume, projection updates, and cached frame rendering.
---

# TUI Performance Report

oh-my-dsh treats responsiveness as part of the terminal architecture rather than a final polish pass. The TUI keeps live state updates immutable, replays durable logs through a private linear-time builder, consumes Harness projections instead of repeatedly deriving aggregate state, caches formatted transcript blocks, and writes only changed terminal rows.

## Highlights · 2026-11-06

Matched synthetic workloads on the same machine cover Markdown previews, horizontal source panning, complete turn-event replay, and rich streaming replies. Times are in milliseconds. String lengths count JavaScript UTF-16 code units.

| Workload | Before p50 | After p50 | After p95 | Samples |
| --- | ---: | ---: | ---: | ---: |
| Scroll a 109,500-character Markdown preview | 21.986 | 0.383 | 0.454 | 20 |
| Pan 10,000 source lines and read 45 visible rows | 52.618 | 0.212 | 0.216 | 10 |
| Replay 10,000 turns with start and end events | 453.203 | 2.567 | 5.651 | 7 |
| Replay 20,000 turns with start and end events | 2074.193 | 8.442 | 8.699 | 7 |
| Render a 10,000-character rich streaming frame | 3.123 | 1.903 | 2.171 | 15 |
| Render a 50,000-character rich streaming frame | 16.095 | 9.017 | 11.167 | 15 |
| Render a 120,000-character rich streaming frame | 40.064 | 21.973 | 23.522 | 15 |

These values measure TUI CPU work. Replay timing covers the in-memory event fold, and rendering timing ends when the function returns. Disk reads, Harness initialization, networking, and terminal emulator/GPU refresh require separate measurement. The panning retest reads and formats 45 visible rows. The earlier whole-file layout already included that work.

A separate paired check ran the same original script sequentially against a pre-optimization source copy and the optimized source, using the same dependency installation. Over 5,000 turns, 200 cached frames changed from 635.25 ms to 560.84 ms, and 200 streaming frames from 1000.93 ms to 894.91 ms. Both versions emitted 200 writes and 78.07 KiB for streaming. This paired check supports stable performance on the existing paths, with background load and CPU-frequency variation requiring more samples to assess.

## Test environment

| Component | Value |
| --- | --- |
| Date | 2026-11-06 |
| Hardware | Apple M5 Pro, 48 GiB RAM, arm64 |
| Operating system | macOS 27.0.1 |
| Node.js / pnpm | 24.18.0 / 11.20.0 |
| Repository baseline | `83390cbb7dcbc4a6905e94a2b2ce3cc14f95b573` plus the working-tree changes at measurement time |
| Before diff SHA-256 | `c39e4ce09301083d8fcbe75057eff33aa5de865aca4c7d042cedc40d36844be6` |
| After diff SHA-256 | `590df0e318a4af3d6e94c9802710b309a0f2b6e57dfe5c147f39c9aad1a127cb` |
| Extended measurement viewports | Markdown preview 160 × 50, streaming reply 80 × 50, source panning 80 columns wide |
| Extended sampling | Three warm-ups, sample counts in the table, empirical p95 |
| Built-in benchmark | Median of seven runs after one warm-up |

The diff fingerprints identify the source state at the performance retest. Heavy workloads ran sequentially with normal operating-system management of file caches, CPU temperature, and background processes. With fewer than 20 samples, empirical p95 often equals the maximum and serves to describe variation within this run.

## Startup, interaction, and memory

The following PTY measurements were recorded on 2026-11-06 before optimization. They use the built entry point, isolated configuration, an empty workspace, and a local Harness mock model. Startup timing runs from a new process launch until the footer appears and input works. Interaction timing runs from writing a key to receiving matching output through the pseudo-terminal.

| Measurement | Recorded result |
| --- | --- |
| Startup, four fresh and four existing configurations | Median 697.4 ms, range 690.5–723.6 ms, 8/8 clean exits |
| RSS after startup | Median 310.0 MiB |
| Type text | Median 1.08 ms, eight samples |
| Open settings / repeatedly open settings | Median 103.15 ms / 51.67 ms, eight / 60 samples |
| Open Help / Tools | Median 4.20 ms / 3.32 ms, eight samples each |
| 240 settings cycles with forced GC every 40 cycles | Live heap from 76.68 MiB to 75.28 MiB |
| Five idle seconds after a completed reply | About 0.02 seconds of CPU time and 404 output bytes |

Settings latency includes input coalescing, command handling, configuration reads, and output scheduling. This PTY sample uses local workspace dependency resolution and measures execution from built artifacts. Public model services, packaged installs, Windows/Linux, and lower-spec machines require separate validation. The 240-cycle run describes short-term memory trends. Sessions lasting hours require longer stress tests.

After optimization, a separate 12-cycle large-document and session workload recorded live heap after forced GC of 62.11, 64.71, and 64.96 MiB at cycles four, eight, and twelve, with 64.96 MiB after release. That process had already performed heavy rendering, so these values describe the extended benchmark's cache and allocation trends. Streaming block and padded-row caches both bound entry counts and retained text size.

## Why it is fast

### Linear-time durable-session replay

Live events continue through the immutable `applyEvent` state transition, which keeps updates predictable and cache-friendly. Session restoration uses a private replay builder whose mutable block array never escapes before replay completes. This removes repeated copying of a growing transcript, changing large-session reconstruction from quadratic to linear growth.

The replay builder also maintains a private `callId → block index` map. Tool-heavy sessions therefore resolve partial calls, completed calls, and results without scanning the transcript for every event. The live path keeps the same property: tool-result presentation resolves its matching call through a streamed index instead of rescanning the session log, so per-event cost stays flat as a session grows.

Replay tracks running tools in an index set, so turn completion settles only pending tools. Its private state updates turn spans in place, and durable assistant messages skip the scan for temporary streaming blocks. Once replay returns its state, subsequent live events continue with immutable updates.

### Harness projection fast path

DeepSeek Harness already owns durable session statistics, token usage, and context pressure. When those projections are present, the TUI reads them directly and touches only the first and last event for elapsed time. A complete-log fold remains available when the corresponding plugins are absent, preserving the “everything is a plugin” composition model without making the default composition pay an unnecessary history scan on every streamed event.

### Cached transcript layout

Settled transcript blocks cache their formatted Markdown and tool rows by block identity and render options. Stable transcript bodies are cached by the immutable block array. Composer edits, status updates, animation ticks, and scrolling can therefore reuse settled content instead of reformatting the complete conversation. Dense assistant deltas arriving within an 8 ms frame window are folded into state immediately but share one terminal render; user interaction, tool transitions, and turn settlement still flush synchronously. Settlements share that timer too: step, tool, and assistant settlements from parallel calls or in-process children cost one frame per interval instead of one frame per event, while control events such as command lifecycle and inbox splices still paint immediately.

### Document preview and streaming Markdown caches

Markdown previews reuse layouts by source identity, full theme key, and width. Content refreshes, theme changes, link-display policy changes, and width changes trigger layout again. Unwrapped source documents retain highlighted lines and source-position indexes, slicing visible rows on demand during horizontal panning. Each layout retains at most 256 rows.

Streaming Markdown parses the complete input on every frame, then reuses block layouts by resolved token, theme, width, and style. Later reference definitions, tables, and code fences can therefore update earlier content correctly. The block cache retains at most 4,096 entries and 2 Mi UTF-16 code units of keys and row text. The streaming padded-row cache retains at most 4,096 entries and 1 Mi UTF-16 code units. Settled replies use the existing block cache. Text without math delimiters uses the same base GFM grammar, reducing math-extension scans.

### Native scrollback and differential terminal output

In follow mode the `MainScreenRenderer` appends finalized rows and uses row-level diffs for the mutable viewport. A physical boundary prevents finalized rows from being replayed during a stable geometry epoch. A running turn remains mutable until it settles, so its process can fold without rewriting native history. Native scrollback remains an append-only frozen visual record during ordinary updates. Production startup emits one initial session frame. Idle replacement performs a complete replay, while running replacement keeps the active turn mutable until settlement. Native scrollback is never erased on any profile, so a transcript replacement appends rather than purges; alternate-screen overlays are limited to direct terminals, and multiplexer resize bursts are coalesced before repaint. Large resumed transcripts are replayed completely rather than truncated. At a stable width, finalized rows also form a prepared prefix: frame fitting validates only the mutable suffix instead of measuring the complete transcript again for streaming, status, or composer updates.

Every frame is compared by visible row against the previous frame. The terminal writer rewrites only changed rows, clears only stale rows, and preserves the requested cursor position. All width calculations use terminal display cells so ANSI styling, CJK text, emoji, and combining characters do not trigger corrective repaints caused by broken layout.

## Reproduce the benchmark

Install dependencies and run the repository benchmark from the project root:

```sh
pnpm install
pnpm benchmark:tui
```

The following excerpt records the built-in benchmark on 2026-11-06. Batch timings include every frame in the batch. Their fixtures and warm-up schedule are recorded separately from the per-operation extended measurements above.

```text
oh-my-dsh TUI microbenchmarks
Node v24.18.0 · darwin/arm64 · median of 7 measured runs
Resume 10,000 conversation turns                2.63 ms
Resume 10,000 tool calls                        3.26 ms
Apply 10,000 projected stats updates            1.13 ms
Render 200 cached 5,000-turn frames           544.06 ms
Render 200 streaming 5,000-turn frames        844.42 ms
Terminal output for 200 streaming frames      200 writes · 78.07 KiB
Pan 10,000 source lines (200 viewports)        54.28 ms
Render 20 rich streaming answer appends       547.33 ms
Rich streaming fixture: 119,700 characters
Scroll rich Markdown preview (200 frames)      38.66 ms
Resume 10,000 turns with lifecycle events       3.17 ms
```

The benchmark intentionally imports the source implementation and avoids physical terminal I/O. In addition to CPU timings, it runs the real differential renderer against an in-memory sink and reports terminal write count and ANSI byte volume for the streaming workload. This makes it useful for detecting algorithmic and output-amplification regressions, but absolute numbers will vary with hardware, Node.js versions, background activity, and runtime warm-up.

## Measured limits and next steps

The first read of 10,000 source lines still highlights the complete document, and resizing a wrapped document recalculates line layouts. Stress samples took about 100 ms and 50 ms respectively. This fixture exceeds the default 128 KiB read limit and approaches that size after loading more content.

A 120,000-character rich streaming frame still takes about 22 ms. Complete syntax parsing and frame assembly retain costs that grow with content, while the 8 ms coalescing window reduces repeated work during dense events. Further profiling should track very long reply parsing, long-session row copying, and resize layouts, with real terminal interaction supplementing CPU microbenchmarks.

The built-in benchmark covers lifecycle replay, 200 source panning viewports, 20 rich-text appends, and 200 Markdown preview frames. Trajectory's `200 moves` measures navigation-state updates, and `Count 20 appends` measures reveal-unit counting. Rendering scenarios measure the corresponding complete draw paths. The built-in script reports batch medians, while the extended table samples individual operations and reports p95. The executable entry point is the [benchmark script](https://github.com/agi-fans/oh-my-dsh/blob/main/scripts/benchmark-tui.mts).

## Regression coverage

The optimized replay path is checked against the immutable live fold across user messages, reasoning and text deltas, settled assistant messages, partial and completed tool calls, tool results, queued messages, and turn completion. A separate contract test verifies that complete Harness projections read only event-log boundaries instead of traversing history. The normal unit, typecheck, build, Markdown, happy-path smoke, and PTY smoke suites remain the release gates.

The 2026-11-06 optimization retest passed 3,193 tests, typechecking, builds, Markdown checks, dependency-boundary checks, happy-path smoke, and all PTY smoke tests. Added regression coverage compares every character prefix of streaming output with complete rendering and exercises late link definitions, theme and width changes, lazy visible-row reads, reused tool IDs, missing or late results, and state isolation when live updates continue after replay.

## Historical baseline · 2026-08-20

The measurements below were recorded on 2026-08-20 using a 10,000-turn synthetic conversation, a 10,000-tool-call transcript, and a 5,000-turn cached render surface. They preserve the optimization baseline from that date. The presentation and fixtures have since changed, so comparisons across dates require matched workloads.

| Workload | Diagnostic baseline | Recorded median | Improvement |
| --- | ---: | ---: | ---: |
| Resume 10,000 conversation turns | 323.6 ms | 2.62 ms | 123.5× |
| Resume 10,000 tool calls | 307.6 ms | 22.71 ms | 13.5× |
| Apply 10,000 projected statistics updates | 81.5 ms | 0.43 ms | 189.5× |
| Render 200 cached frames over 5,000 turns | — | 69.66 ms total | 0.35 ms/frame |
| Render 200 streaming frames over 5,000 turns | — | 142.73 ms total | 0.71 ms/frame |
| Emit 200 differential streaming frames | — | 200 writes / 43.00 KiB | — |

The diagnostic baseline was captured before the linear replay and projection fast paths were introduced, using equivalent synthetic workloads. Results are microbenchmarks of TUI-owned CPU work; they do not include model inference, network latency, filesystem latency, or physical terminal throughput.

### Historical test environment

| Component | Value |
| --- | --- |
| Date | 2026-08-20 |
| Hardware | Apple M5 Pro, arm64 |
| Operating system | macOS 26.5.2 |
| Node.js | 24.18.0 |
| pnpm | 11.20.0 |
| Repository baseline | `a71fe2a` before the measured optimization changes |
| Render viewport | 160 columns × 50 rows |
| Sampling | Median of 7 measured runs after one warm-up run |
