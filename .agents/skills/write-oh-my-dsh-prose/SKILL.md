---
name: write-oh-my-dsh-prose
description: Write, edit, or review oh-my-dsh prose across Markdown, JSDoc, comments, prompts, command descriptions, settings text, diagnostics, notices, and terminal UI labels. Use when changing product copy or documentation, auditing awkward or duplicated prose, fixing hard-wrapped Markdown, or removing development-session narration from repository text.
---

# Write oh-my-dsh Prose

Preserve the complete behavior or contract, then remove repetition, decoration, and authoring-session narration. Visible wording is product behavior.

## Establish scope

Read [`AGENTS.md`](../../../AGENTS.md) and the owning implementation before judging text. Respect review-only requests; edit only when authorized. Exclude both reference repositories from edits.

## Preserve complete propositions

Before rewriting, identify the actor, action, conditions, ordering, modality, failure mode, negative guarantees, exceptions, ownership, and consequence. Keep every relevant clause. A shorter sentence is not better if it becomes less precise.

## Match the surface

- **README and product docs:** explain supported configuration, behavior, limitations, extension points, and the real installation or execution path. Link detailed architecture to its one owner.
- **JSDoc:** document caller-visible results, errors, side effects, ownership, timing, cancellation, and durability only when types and names do not already make them clear.
- **Internal comments:** preserve non-obvious invariants, race ordering, terminal ownership, and surprising failure behavior. Delete code walkthroughs and restatements.
- **Commands and settings:** use concise English labels until language support exists. State the action and effect; do not expose implementation vocabulary the user does not need.
- **Diagnostics:** identify the failing subject, violated requirement, and concrete correction. Do not narrate internal control flow.
- **Ordinary notices:** use plain text unless a box communicates a real component or interaction boundary.
- **Tips:** describe capabilities that exist, use portable key names, and keep each hint independently understandable.
- **Changelog:** describe user-visible outcomes under standard Keep a Changelog headings, not commits, tests, or implementation history.

## Remove transcript leakage

Rewrite prose that depends on an absent design session, review, or draft:

- Replace “this change/PR/cut”, “used to”, or “the reviewer said” with present behavior or a current counterfactual.
- Replace dead decision numbers and draft-section references with a committed path or remove them.
- Delete test walkthroughs and control-flow narration unless they establish a non-obvious invariant.
- Turn genuine deferred work into a concrete issue or actionable `TODO`; remove hedges such as “probably fine for now”.

Do not erase useful rationale, compatibility promises, measured bounds, issue references, or current runtime old/new states.

## Format Markdown

Keep each prose paragraph on one physical source line. Start a new line only for semantic boundaries such as headings, paragraphs, list items, table rows, quotes, or code fences. Preserve blank lines required by CommonMark. Never manually wrap paragraphs to a column.

## Finish

Read changed UI text in its rendered context and update focused tests when wording is asserted or behaviorally significant. For Markdown, run `pnpm check:md` and `git diff --check`. When a paired document changes, continue with [`sync-oh-my-dsh-docs`](../sync-oh-my-dsh-docs/SKILL.md).
