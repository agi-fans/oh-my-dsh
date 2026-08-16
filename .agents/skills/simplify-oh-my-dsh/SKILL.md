---
name: simplify-oh-my-dsh
description: Find and evaluate evidence-backed simplifications in oh-my-dsh. Use when asked to remove unnecessary slash commands, collapse duplicated UI or session state, reduce speculative plugin seams, narrow public APIs, replace hand-rolled infrastructure, or audit the project for dead, redundant, over-built, or confusing behavior.
---

# Simplify oh-my-dsh

Prefer a few proven reductions over a long list of guesses. A simplification must remove real conceptual, runtime, maintenance, or user-facing cost.

## Establish intent and constraints

1. Read [`AGENTS.md`](../../../AGENTS.md), [`docs/architecture.md`](../../../docs/architecture.md), and [`docs/plugin-architecture-review.md`](../../../docs/plugin-architecture-review.md).
2. Identify whether the user requested a report, a proposal, or implementation. Do not edit during a review-only audit.
3. Preserve the single terminal owner, published DSH dependency boundary, durable session semantics, and real plugin ownership seams.

## Survey strong candidates

Look for:

- slash commands duplicated by default composer behavior, settings, hotkeys, or another command;
- state copied between Harness projections, session runtime, TUI provider, overlays, and status rendering;
- exact tool-name, command-name, or event-name branches that duplicate provider-owned semantics;
- public exports or service methods with no production consumer;
- independently mounted plugins with no independent lifecycle, configuration, dependency set, or replacement point;
- settings that expose unsupported generality or reorder themselves unexpectedly;
- framed components that do not represent a component or interaction boundary;
- renderer caches or redraw paths that repeat work for immutable transcript state;
- hand-written parsing, width, diff, glob, retry, or persistence machinery already supplied by a healthy dependency or the Node engine floor.

Start with `rg` for exact symbols, command names, config keys, events, and exports, then read every real call site. Tests, docs, snapshots, and reference repositories are evidence of intent, not production consumers.

## Prove each candidate

For every candidate, record:

1. Current owner and behavior.
2. Production consumers, non-production consumers, and dynamic registration paths.
3. User capability or compatibility that would be lost.
4. Exact surface removed or folded.
5. Tests, docs, Changelog entries, exports, and configuration that must change together.

Reject a candidate when it merely moves complexity, breaks a documented capability without an explicit product decision, fights an implemented architecture rationale, or creates a shallow abstraction to reduce line count.

## Apply the plugin test

“Everything is a plugin” means independent ownership, not one plugin per source file. Keep a plugin when it has a meaningful lifecycle, contribution contract, scope, or replacement point. Fold it into a deeper owner when it only forwards calls or mirrors state. Keep pure rendering and editing algorithms internal unless a second real adapter appears.

## Recommend and implement

Rank surviving candidates by user clarity, defect risk, deleted surface, and migration cost. For a report, give evidence and a recommended order. For authorized implementation, make one coherent reduction at a time, add regression coverage for the resulting behavior, update user-facing docs and `CHANGELOG.md`, and validate through [`check-oh-my-dsh-change`](../check-oh-my-dsh-change/SKILL.md).
