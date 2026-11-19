---
description: Practical performance characteristics, built-in safety limits for long sessions and large files, and reproducible local TUI benchmarks.
---

# Performance and limits

omdsh treats terminal responsiveness as an architectural concern: linear session replay, per-block layout caching, coalesced streaming frames, and line-level terminal diffing keep long sessions and large previews responsive.

## 1. Practical limits you will notice in daily use

When content grows huge, omdsh enforces clear guardrails to protect terminal responsiveness and context budgets:

| Scenario | Built-in guardrail and behavior |
|---|---|
| **Long sessions (thousands of turns)** | Linear replay plus cached completed blocks mean typing and scrolling never re-format old turns. Run `/compact` when footer `Ctx` passes 75% to keep model latency low. |
| **Large files & diffs (`/diff`)** | Loads **128 KiB** initially and doubles with `L` (`Load more`) up to **4 MiB**; open larger or binary files externally with `O`. Horizontal panning slices only visible rows on demand. |
| **Very long streaming replies** | Dense deltas coalesce inside an 8 ms frame window and reuse parsed Markdown block layouts; extremely large (~120K char) rich replies still cost ~22 ms per frame. |
| **File recovery snapshots (`Alt+R`)** | Automatically skips capture if a file exceeds **128 MiB**, a snapshot exceeds **1 GiB**, or a workspace exceeds **10,000** entries so normal turns stay fast. |
| **Images & archive exports** | Single image uploads cap at **20 MiB** (oversized resolutions scale automatically); preview decoding caps at 32 MiB / 40 MP; `/export archive` caps at **64 MiB** uncompressed. |
| **tmux / multiplexer resizing** | Coalesces resize bursts before redrawing while preserving host scrollback; press `Alt+L` anytime to repaint the live viewport after reattaching. |

## 2. Why it stays fast

1. **Linear-time session replay:** Reconstructing durable logs uses a linear pass with a `callId → block index` map so tool-heavy histories scale linearly rather than quadratically.
2. **Direct metering projections:** Token counts, context pressure, and stats come straight from Harness projections instead of re-scanning event logs on every streaming token.
3. **Block and streaming caches:** Completed Markdown and tool cards cache formatted rows by identity and width, reused across typing, animations, and scrolling.
4. **Line-level differential output:** Each frame writes only changed visible rows, minimizing terminal work and SSH bandwidth.

## 3. Measured benchmarks (2026-11-06)

Measured locally on **Apple M5 Pro (48 GiB RAM, macOS, Node.js v24.18.0)**. Numbers isolate local TUI CPU work in milliseconds (excluding network, disk I/O, and terminal GPU painting):

| Workload | Before p50 | After p50 | After p95 | Samples |
|---|---:|---:|---:|---:|
| Scroll 109,500-char Markdown preview (160×50) | 21.986 | **0.383** | 0.454 | 20 |
| Pan 10,000-line source preview (45 visible rows) | 52.618 | **0.212** | 0.216 | 10 |
| Replay 10,000 turns with lifecycle events | 453.203 | **2.567** | 5.651 | 7 |
| Replay 20,000 turns with lifecycle events | 2074.193 | **8.442** | 8.699 | 7 |
| 10,000-char rich streaming frame (80×50) | 3.123 | **1.903** | 2.171 | 15 |
| 50,000-char rich streaming frame (80×50) | 16.095 | **9.017** | 11.167 | 15 |
| 120,000-char rich streaming frame (80×50) | 40.064 | **21.973** | 23.522 | 15 |

Real PTY interaction samples on the same machine (built binary, mock LLM): cold start to interactive footer **697.4 ms** median (~310 MiB RSS), keystroke response **1.08 ms**, opening `/help` **4.20 ms**, opening `/tools` **3.32 ms**, and ~0.02 s CPU over 5 idle seconds after a turn.

## 4. Reproduce locally

Run the built-in benchmark suite from the repository root ([`scripts/benchmark-tui.mts`](https://github.com/agi-fans/oh-my-dsh/blob/main/scripts/benchmark-tui.mts)):

```sh
pnpm install
pnpm benchmark:tui
```

The script reports CPU latency alongside terminal write counts and ANSI byte volume so regressions in complexity or output amplification are easy to catch.

## Related

- [Architecture](architecture.md) — differential rendering and terminal guarantees
- [Status and diagnostics](observability.md) — inspecting live latency, cache hits, and slow calls
