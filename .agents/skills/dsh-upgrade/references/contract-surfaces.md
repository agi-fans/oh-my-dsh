# DSH contract surfaces

Use these surfaces to organize evidence. Text searches discover candidates; imported ownership, artifact metadata, lifecycle, and runtime behavior determine whether a candidate is a migration obligation.

| Surface | Examples | Questions |
| --- | --- | --- |
| Package graph | Dependencies, peers, engines, optional packages, exports, bins, artifact contents | Can the selected source resolve a mutually compatible graph without a stale cohort or source fallback? |
| Cordis composition | Plugin entries, injects, providers, consumers, waterfalls, effects | Did ownership, readiness, scope, ordering, disposal, or listener return semantics change? |
| Events and projections | Durable events, module augmentation, session projections | Which package owns the event or state, and do replay and resume preserve behavior? |
| Configuration and defaults | Schemas, renamed keys, built-in roots, precedence | Can a new default shadow, merge with, or silently replace product configuration? |
| Lifecycle and environment | Profile loading, module fallback, startup order, filesystem roots | Must work move earlier, later, or become awaited, and which resolved object owns it? |
| Runtime interaction | Cancellation, retries, permissions, commands, UI contributions | Does the adapted seam preserve observable behavior and error handling? |
| Distribution or deployment | Tarballs, bundles, source installs, plugin directories, containers | Does the deployed artifact encode the graph and entry points that were tested? |
| Internal coupling | Monkey patches, undocumented source imports, reflection over host state | Can it move to a public seam, or does it require an explicit compatibility exception? |

## Classify every candidate

- **Confirmed public contract:** an owned and supported seam; migrate it when the target contract differs and add regression evidence.
- **Confirmed internal coupling:** an undocumented or source-layout dependency; replace it with a public seam or surface the compatibility decision.
- **Unresolved candidate:** ownership or applicability is unclear; inspect declarations, runtime exports, package metadata, and call context before editing.
- **Irrelevant match:** the token belongs to unrelated platform code or a public seam unaffected by the corridor; retain enough context to explain the exclusion.

Do not estimate migration effort from raw match count. A repository with no matching source tokens can still fail through package resolution, changed defaults, composition precedence, or distribution metadata.

## Evidence precedence

Prefer evidence in this order when sources disagree:

1. the exact installed or candidate artifact selected by the migration;
2. deterministic behavior from the real host or a faithful public-contract test;
3. official tagged source and generated declarations for that artifact;
4. official release notes or migration documentation;
5. examples, comments, and source layout not present in the artifact.

An installed package may expose less than its source tree. Never import an omitted subpath merely because it exists upstream.

## Preserve semantics, not signatures alone

When adapting a changed method, event, or lifecycle hook, inspect more than its parameter types:

- service readiness and injection requirements;
- agent, session, workspace, or Profile scope;
- cancellation and retry propagation;
- waterfall continuation and listener ordering;
- error classes and business error codes;
- persistence, replay, and resume behavior;
- defaults and merge precedence;
- disposal and ownership of asynchronous work.

A compiling adapter is incomplete if it changes one of these behaviors unintentionally.
