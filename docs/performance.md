# TUI Performance Report

[English](performance.md) | [简体中文](performance.zh-CN.md)

oh-my-dsh treats responsiveness as part of the terminal architecture rather than a final polish pass. The TUI keeps live state updates immutable, replays durable logs through a private linear-time builder, consumes Harness projections instead of repeatedly deriving aggregate state, caches formatted transcript blocks, and writes only changed terminal rows.

## Highlights

The current implementation was measured on a 10,000-turn synthetic conversation, a 10,000-tool-call transcript, and a 5,000-turn cached render surface.

| Workload | Diagnostic baseline | Current median | Improvement |
| --- | ---: | ---: | ---: |
| Resume 10,000 conversation turns | 323.6 ms | 2.15 ms | 150.5× |
| Resume 10,000 tool calls | 307.6 ms | 21.21 ms | 14.5× |
| Apply 10,000 projected statistics updates | 81.5 ms | 0.44 ms | 185.2× |
| Render 200 cached frames over 5,000 turns | — | 48.00 ms total | 0.24 ms/frame |

The diagnostic baseline was captured before the linear replay and projection fast paths were introduced, using equivalent synthetic workloads. Results are microbenchmarks of TUI-owned CPU work; they do not include model inference, network latency, filesystem latency, or physical terminal throughput.

## Test environment

| Component | Value |
| --- | --- |
| Date | 2026-08-16 |
| Hardware | Apple M5 Pro, arm64 |
| Operating system | macOS 26.5.2 |
| Node.js | 24.18.0 |
| pnpm | 11.20.0 |
| Repository baseline | `a71fe2a` before the measured optimization changes |
| Render viewport | 160 columns × 50 rows |
| Sampling | Median of 7 measured runs after one warm-up run |

## Why it is fast

### Linear-time durable-session replay

Live events continue through the immutable `applyEvent` state transition, which keeps updates predictable and cache-friendly. Session restoration uses a private replay builder whose mutable block array never escapes before replay completes. This removes repeated copying of a growing transcript, changing large-session reconstruction from quadratic to linear growth.

The replay builder also maintains a private `callId → block index` map. Tool-heavy sessions therefore resolve partial calls, completed calls, and results without scanning the transcript for every event.

### Harness projection fast path

DeepSeek Harness already owns durable session statistics, token usage, and context pressure. When those projections are present, the TUI reads them directly and touches only the first and last event for elapsed time. A complete-log fold remains available when the corresponding plugins are absent, preserving the “everything is a plugin” composition model without making the default composition pay an unnecessary history scan on every streamed event.

### Cached transcript layout

Settled transcript blocks cache their formatted Markdown and tool rows by block identity and render options. Stable transcript bodies are cached by the immutable block array. Composer edits, status updates, animation ticks, and scrolling can therefore reuse settled content instead of reformatting the complete conversation.

### Differential terminal output

Every frame is compared by visible row against the previous frame. The terminal writer rewrites only changed rows, clears only stale rows, and preserves the requested cursor position. Wheel scrolling is coalesced, and all width calculations use terminal display cells so ANSI styling, CJK text, emoji, and combining characters do not trigger corrective repaints caused by broken layout.

## Reproduce the benchmark

Install dependencies and run the repository benchmark from the project root:

```sh
pnpm install
pnpm benchmark:tui
```

Example output from the environment above:

```text
oh-my-dsh TUI microbenchmarks
Node v24.18.0 · darwin/arm64 · median of 7 measured runs

Resume 10,000 conversation turns                2.15 ms
Resume 10,000 tool calls                       21.21 ms
Apply 10,000 projected stats updates            0.44 ms
Render 200 cached 5,000-turn frames            48.00 ms
```

The benchmark intentionally imports the source implementation and avoids terminal I/O. This makes it useful for detecting algorithmic regressions, but absolute numbers will vary with hardware, Node.js versions, background activity, and runtime warm-up.

## Current limits and next steps

The remaining measurable growth is formatting the currently streaming assistant block: the active Markdown block must be reconsidered as text arrives because later syntax can change earlier presentation. In the same environment, an update to a 2,500-character response took about 0.19 ms, a 5,000-character response about 0.29 ms, and an extreme 25,000-character response about 1.30 ms. These values remain below the current frame budget, so omdsh preserves immediate streaming instead of adding visible batching latency.

If real-world profiling shows pressure beyond those ranges, the next candidates are frame-rate-limited coalescing for streamed deltas and incremental parsing of syntactically stable Markdown prefixes. Those changes should be driven by terminal traces rather than microbenchmark numbers alone.

## Regression coverage

The optimized replay path is checked against the immutable live fold across user messages, reasoning and text deltas, settled assistant messages, partial and completed tool calls, tool results, queued messages, and turn completion. A separate contract test verifies that complete Harness projections read only event-log boundaries instead of traversing history. The normal unit, typecheck, build, Markdown, happy-path smoke, and PTY smoke suites remain the release gates.
