---
name: review-oh-my-dsh
description: Review oh-my-dsh changes for correctness, plugin ownership, terminal UX, lifecycle safety, package boundaries, and compliance with the requested behavior. Use for PR reviews, branch or working-tree reviews, pre-release audits, and requests to inspect whether an implementation fits the DeepSeek Harness architecture or oh-my-pi-inspired interaction rules.
---

# Review oh-my-dsh

Report substantiated defects before suggestions. Review requests are read-only unless the user also asks for fixes.

## Orient to the repository

1. Read [`AGENTS.md`](../../../AGENTS.md), [`docs/architecture.md`](../../../docs/architecture.md), and [`docs/plugin-architecture-review.md`](../../../docs/plugin-architecture-review.md).
2. Establish the exact review scope from the user-specified base, commit, branch, or dirty worktree. Include surrounding code and both sides of changed interfaces.
3. Treat `refs/deepseek-harness` as API and architecture evidence and `refs/oh-my-pi` as UX evidence only. Never modify or depend on them.
4. Read the originating request or specification. Separate compliance with repository standards from compliance with the requested behavior.

## Review the architecture

- Require independently owned lifecycle, configuration, dependencies, or replacement points before adding a plugin seam.
- Keep raw mode, key decoding, cursor state, viewport, and atomic terminal writes under the single local terminal provider.
- Keep display width, Markdown formatting, editor movement, frame diffing, and other pure algorithms internal unless a real second owner exists.
- Require commands to register through `dsh-commands`, statistics to come from Harness projections, and tool semantics to come from `ToolDefinition` presentation intents rather than exact-name TUI branches.
- Trace Cordis registration, scope, disposal, listener removal, interrupted setup, and session replacement. A successful happy path does not prove lifecycle safety.
- Challenge public exports, service methods, configuration knobs, or compatibility paths with no production consumer.

## Review terminal behavior

- Measure layout in display cells, not JavaScript string length. Probe ANSI, CJK, emoji, combining characters, narrow widths, and long unbroken input.
- Check borders, padding, labeled separators, cursor targets, overlays, composer placement, footer anchoring, and no-color distinguishability.
- Check incremental rendering for stale rows, duplicate status blocks, unnecessary full-frame work, and scroll jitter.
- Verify ordinary notices are not boxed without a component or interaction boundary.
- Verify modal lists own input, hide the normal cursor, support keyboard selection, and restore the composer after cancel or selection.
- Check first Ctrl-C clear/interrupt, second Ctrl-C exit, Ctrl-D exit, and the resume hint without displacing the status footer.

## Review sessions and model-facing behavior

- Replay durable events and compare the reconstructed transcript with the live result.
- Check queue, todo, compaction, resume, retry, permission, model, skills, MCP, and tool cards through the shipped plugin path.
- Treat prompts, command descriptions, diagnostics, tool schemas, and visible strings as behavior. Require focused snapshots or behavior tests for meaningful wording changes.
- Confirm tool cards preserve useful input after settlement, distinguish Input from Output, bound retained content, and expose expansion consistently.

## Review delivery boundaries

- Confirm runtime dependencies resolve from published npm packages and package exports, never `refs/` or local links.
- Check package exports and packed contents when public surfaces change.
- Require a concise `CHANGELOG.md` entry for user-visible or release-operational changes.
- Use [`check-oh-my-dsh-change`](../check-oh-my-dsh-change/SKILL.md) to select missing verification evidence when the review scope needs execution.

## Report findings

Order findings by severity. For each finding, give the file and tightest useful line, the violated behavior, user or maintenance impact, and concrete evidence. Keep unproven concerns as questions or residual risks. If no findings remain, say so and name the reviewed scope and any untested risks.
