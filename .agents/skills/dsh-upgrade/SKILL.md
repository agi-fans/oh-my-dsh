---
name: dsh-upgrade
description: Assess or perform upgrades of DeepSeek Harness plugins, host applications, and plugin compositions. Use for plugin version changes, Harness cohort migrations, multi-cohort compatibility work, and upgrade failures involving Cordis services, events, configuration, lifecycle, package contracts, or host mounting. Do not use merely to publish an already-prepared release.
---

# Upgrade DSH integrations

Preserve the user's requested outcome, repository instructions, dirty-worktree changes, and existing compatibility promises. Treat installed or distributable artifacts and observable host behavior as the effective contract. Use upstream source to explain or verify that contract, not as an implicit runtime dependency.

## Select the mode

Identify one primary mode before editing:

- **plugin release upgrade:** change plugin packages while keeping the selected host contract stable;
- **Harness cohort migration:** move the host-facing DSH graph to another coherent release;
- **multi-cohort compatibility:** intentionally support more than one host cohort;
- **assessment only:** report impact without changing files.

Record the baseline, target, supported host range, package source, repository shape, and intended distribution or deployment path. If the target or compatibility outcome cannot be discovered safely, ask before choosing one. Do not infer permission for unpublished source builds, dependency patches, compatibility shims, package-version changes, publication, or other external mutations.

## Load only relevant references

- Read [repository discovery](references/repository-discovery.md) when the repository is multi-package, its owning manifests or host entry are unclear, or the package source must be selected.
- Read [contract surfaces](references/contract-surfaces.md) for every Harness cohort migration and whenever services, events, projections, Profile composition, defaults, or runtime lifecycle may have changed.
- Read [compatibility strategies](references/compatibility-strategies.md) only for multi-cohort support, unpublished targets, external patches, or a proposed change to the minimum host version.
- Read [validation](references/validation.md) before implementing an upgrade or claiming that an assessment or migration is verified.
- Read [evidence cards](references/evidence-cards.md) when recording a reusable finding, writing a version card, or preparing an upstream report.
- Read the [0.1.1 to 0.1.2 prerelease card](references/dsh-0.1.1-to-0.1.2-prerelease.md) when the selected corridor crosses from the `0.1.1` line into a `0.1.2` prerelease. Re-verify every prerelease fact against the selected artifact.
- Read the [0.1.5-rc.1 prerelease card](references/dsh-0.1.5-rc.1-prerelease.md) when the corridor crosses a `0.1.5` prerelease boundary, when a prerelease range may absorb a newer cohort, or when a product-owned composition must re-state a changed upstream default. Re-verify every prerelease fact against the selected artifact.

## Establish the contract graph

Inventory the DSH and Cordis packages that participate in the selected operation, product-owned packages between the host and plugin, plugin configuration, Profile or host composition, public exports, peer or host requirements, and packaged entry points. Determine whether the target artifacts exist in the selected source and whether the graph can resolve without an accidental cohort mix.

Map relevant code by owner and role rather than raw token count. Classify each candidate as a confirmed public contract, confirmed internal coupling, unresolved candidate, or irrelevant match. An empty text scan reduces expected source edits but does not prove dependency resolution, configuration precedence, host mounting, runtime behavior, or artifact correctness.

## Preserve a baseline

Before mutation, capture the worktree state and run the smallest repository-native checks that distinguish existing failures from migration failures. After replacing dependency artifacts, invalidate applicable dependency, compiler, generator, or bundler caches before accepting static checks. Use the repository's own package manager and toolchain.

## Adapt public contracts

Change only the authorized package or host corridor and the product-owned code required to support it. For every changed seam, verify ownership, lifecycle order, scoping, cancellation, error semantics, persistence, and defaults when applicable. Prefer supported package exports and composition APIs; do not hide mismatches with broad casts, copied upstream internals, or undocumented source paths.

After an upgrade is authorized, mechanical adaptations to the selected public contract may proceed. Pause when alternatives would change supported hosts, user-visible behavior, permissions or security, persistent data, package identity, package-source policy, or external state.

## Validate and report

Select evidence by mode and affected surface. Produce dependency-resolution and changed-contract evidence for every mode; an assessment may use read-only metadata or a dry run, while an implemented migration should exercise the resolved graph. Add static, behavioral, composition, runtime, compatibility, and distribution checks only when those surfaces exist, changed, or are part of the compatibility claim.

For distributed packages, inspect the candidate artifact rather than only the workspace build. When related packages ship together, verify the dependency graph encoded by their candidate manifests in an isolated consumer. For source-only or private integrations, exercise the actual deployment or host-loading path instead.

Report the selected mode and corridor, confirmed changes, exact checks and results, skipped evidence, unresolved upstream defects, compatibility decisions, and remaining risks. Separate target-induced failures from pre-existing failures. Do not publish, push, tag, remove compatibility support, or patch external source without authorization.
