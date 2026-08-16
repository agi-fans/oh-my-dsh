---
name: check-oh-my-dsh-change
description: Select and run the smallest credible validation set for an oh-my-dsh change. Use before committing, pushing, opening a PR, or claiming a change is verified; when asked to test or validate current work; and after changes to TUI rendering, raw terminal input, Cordis composition, package boundaries, documentation, or release metadata.
---

# Check an oh-my-dsh Change

Validate the behavior the change can affect without turning every edit into a release rehearsal. Repository rules remain authoritative; this skill selects evidence but never weakens a required gate.

## Establish the change scope

1. Read [`AGENTS.md`](../../../AGENTS.md).
2. Inspect `git status --short --branch`, the intended diff, and any applicable package scripts. Preserve unrelated user changes.
3. Use the user-supplied base when one exists. Otherwise compare dirty work against `HEAD`; do not guess a PR base or fetch remote state unless the task requires it.
4. Classify every touched surface before choosing commands.

## Select evidence

- **Markdown only:** run `pnpm check:md` and `git diff --check`. Read changed links and commands for correctness; formatting alone does not validate claims.
- **Pure TUI formatting or state:** run the owning `*.spec.ts`, the owning package typecheck, and `git diff --check`. Include width tests for ANSI, CJK, emoji, combining marks, borders, padding, or truncation changes.
- **Shared renderer, event mapping, editor, overlay, or status behavior:** run the complete `@agi-fans/dsh-tui` test suite and typecheck. Exercise both color and no-color behavior when presentation state otherwise depends on color.
- **Raw mode, paste, keys, cursor, scrolling, viewport, signals, startup, or exit:** add `pnpm smoke` to focused tests. Verify terminal restoration after success, interruption, and error paths.
- **Session lifecycle, durable replay, queueing, compaction, tools, skills, MCP, or commands:** run the owning runtime and command tests plus `pnpm smoke:happy`. Include replay or resume coverage when durable events or projections change.
- **Package manifests, exports, dependencies, Cordis configuration, build scripts, or bins:** run `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm smoke:happy`, and the dependency-boundary audits in `AGENTS.md`.
- **Release preparation:** defer to [`publish-oh-my-dsh`](../publish-oh-my-dsh/SKILL.md), which owns package packing and release-state verification.
- **Cross-cutting or uncertain impact:** run the full verification set required by `AGENTS.md`.

Prefer an exact Vitest file when the behavior is local:

```sh
pnpm --filter @agi-fans/dsh-tui exec vitest run src/<owner>.spec.ts
```

Do not use `--passWithNoTests`, lower thresholds, or replace a real-entry smoke with a hand-mounted plugin test.

## Protect repository boundaries

For dependency, build, export, or composition changes, run all `refs/` and symlink audits from `AGENTS.md`. Require both reference submodules to stay clean. Never repair a failing check by importing or linking reference source.

## Handle results

- Stop before a commit or push when relevant evidence fails. Diagnose the failure instead of assuming CI will differ.
- Do not repeat a passing command solely because a commit follows.
- Do not commit, push, tag, or publish unless the user authorized that external or repository mutation.
- Report the inspected scope, exact commands, pass/fail state, skipped credential-dependent evidence, and any residual risk.
