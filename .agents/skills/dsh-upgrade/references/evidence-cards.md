# Evidence cards

Use evidence cards to preserve facts from a migration without turning one repository's workaround into a universal instruction.

## Card schema

| Field | Required content |
| --- | --- |
| Applies when | Repository shape, package source, feature, platform, and version corridor for which the finding matters |
| Stage | First boundary that exposed the difference: resolution, static, behavioral, composition, runtime, compatibility, or distribution |
| Symptom | Exact diagnostic or observable behavior before causal interpretation |
| Old assumption | Contract used by the baseline consumer |
| Target contract | Contract exposed by the selected target artifact |
| Source | Installed or packed metadata, official tagged source, release note, or deterministic runtime event |
| Adaptation | Smallest compatible product-owned response and materially different alternatives rejected |
| Regression | Evidence that distinguishes the old and target contracts |
| Remaining risk | Unverified environment, provider, platform, package source, or compatibility claim |
| Reusable rule | Decision guidance that remains after repository names and commands are removed |

## Promote findings carefully

A migration note becomes a version card only when its applicability and target contract are supported by an authoritative artifact or deterministic runtime observation. A release-note item that the consumer never touches may remain an indexed note rather than an active card.

Keep package-manager, compiler, bundler, platform, and repository-specific behavior behind explicit applicability conditions. For example, a stale incremental TypeScript graph supports the general rule to invalidate applicable build caches after dependency replacement; it does not require every DSH plugin to run a TypeScript clean command.

When a later release restores or supersedes a contract, cross-reference the earlier card and state the new applicability range. Do not silently rewrite history or keep an obsolete migration recipe active.

## Migration report shape

Summarize:

- selected mode, baseline, target, host promise, and package source;
- confirmed contract changes grouped by owner or contract surface;
- adaptations made and decisions intentionally deferred;
- validations run, failures, skipped checks, and remaining risks;
- upstream defects with a minimal reproduction and artifact evidence;
- new or amended version cards.

Keep the full investigation in a case study when it is useful. Version cards should contain only the facts another migration needs to recognize and act on the same contract.
