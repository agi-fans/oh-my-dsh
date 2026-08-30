# DSH 0.1.1 to 0.1.2 prerelease evidence

## Applicability

These cards were observed while moving a host composition from published `0.1.1-rc.2` packages to published `0.1.2-alpha.2` packages. They are prerelease evidence, not a promise about the final `0.1.2` RC. Re-read the selected package metadata, exports, declarations, official release notes, and tagged source before applying a card to a later prerelease.

Primary evidence: [DSH 0.1.2-alpha.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2) and the [oh-my-dsh migration lab](../../../../docs/dsh-0.1.2-upgrade-lab.md).

## V012-PRE-01 · Resolve the package and foundation graph together

- **Applies when:** the consumer upgrades multiple DSH packages or owns the host composition.
- **Stage:** resolution.
- **Symptom:** dependency installation succeeded, but complete peer validation found a higher foundation requirement in a transitive DSH package.
- **Old assumption:** changing the shared DSH version string is sufficient.
- **Target contract:** the observed alpha.2 graph required Cordis `^4.0.2`, Cordis Loader `^1.0.3`, Schemastery `^3.18.2`, and a transitive timer peer of `^1.1.4`.
- **Source:** published alpha.2 package metadata and the linked migration lab.
- **Adaptation:** select a mutually compatible published graph, regenerate resolution state, and validate the complete installed peer closure.
- **Regression:** a clean resolution and peer check must not contain an accidental rc.2/alpha.2 mix.
- **Remaining risk:** foundation requirements may change before the final RC.
- **Reusable rule:** validate the complete resolved graph; representative package sampling does not prove peer closure.

## V012-PRE-02 · Settings namespaces are plain strings

- **Applies when:** code imports or calls `settingsNamespace` from `@deepseek-ai/dsh-settings`.
- **Stage:** static contract and module evaluation.
- **Symptom:** the imported helper is absent at runtime after the target packages replace rc.2.
- **Old assumption:** namespace values must be constructed through the exported helper.
- **Target contract:** alpha.2 settings registration, reads, and mutation accept validated namespace strings directly; the helper is no longer a runtime export.
- **Source:** installed alpha.2 declarations and runtime namespace captured in the linked migration lab.
- **Adaptation:** pass the existing namespace string to the public settings service and retain any required type-only module augmentation import.
- **Regression:** cold static checks and module evaluation must both pass; warm incremental output is insufficient evidence after replacing packages.
- **Remaining risk:** re-check the public export in the selected RC.
- **Reusable rule:** compare declarations and runtime value exports after a cohort replacement.

## V012-PRE-03 · LLM identifiers and delta helpers changed

- **Applies when:** code constructs tool-call IDs or imports the removed token-delta classifier.
- **Stage:** static contract and module evaluation.
- **Symptom:** the old constructor and classifier are missing or undefined in the alpha.2 runtime namespace.
- **Old assumption:** `CallId` and `isTokenDelta` are public runtime exports.
- **Target contract:** alpha.2 exposes `ToolCallId`; the previous classifier is absent from the observed public LLM exports.
- **Source:** installed alpha.2 exports and declarations captured in the linked migration lab.
- **Adaptation:** use `ToolCallId`. If the product needs the old first-visible-output predicate, keep only the required semantics in a small product-owned pure function rather than importing an internal path.
- **Regression:** cover text, reasoning, tool-name, tool-argument, and empty deltas relevant to the consumer.
- **Remaining risk:** the final RC may restore or replace the classifier.
- **Reusable rule:** reimplement a removed convenience predicate only when the consumer can state and test the semantics it actually needs.

## V012-PRE-04 · Domain event augmentation may require the owning package

- **Applies when:** a consumer narrows `SessionEvent` to `todo/write` or another tool-owned event.
- **Stage:** static contract.
- **Symptom:** exhaustive event handling narrows the previously known tool event to `never`.
- **Old assumption:** importing the core session package declares every composed domain event.
- **Target contract:** the observed `todo/write` augmentation is owned by `@deepseek-ai/dsh-tool-todo`.
- **Adaptation:** declare the owning package as a dependency and load its supported type augmentation. Alpha.2's published package exposes the necessary root types, while the source-documented `./types` outlet is absent from the published export map.
- **Source:** [`dsh-tool-todo` package metadata](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/todo/tool-todo/package.json).
- **Regression:** cold static checks and the Todo event projection or rendering path must pass.
- **Remaining risk:** re-check whether the missing subpath export is corrected in the selected RC.
- **Reusable rule:** when a domain event leaves a core union, find and depend on its owning domain package before considering internal imports.

## V012-PRE-05 · Interaction seams changed ownership or argument shape

- **Applies when:** code provides user questions, discovers models, selects permission presets, chooses programmatic tool presentation, or restores agent presets.
- **Stage:** static and behavioral contracts.
- **Symptom:** call sites fail against unrelated-looking method signatures, or a compiling replacement loses active-agent, cancellation, or resume behavior.
- **Old assumption:** rc.2 provider methods and argument objects remain current.
- **Target contract:** observed alpha.2 behavior uses the scoped `user-questions/request` waterfall, passes model-discovery cancellation separately, selects a permission preset from a `Session`, names programmatic tool presentation `ptc`, and reads the resumed preset through the `agentPreset` session projection.
- **Source:** tagged [user-question service](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/interaction/user-questions/src/index.ts) and [agent-preset projection](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/preset/agent-presets/src/session.ts).
- **Adaptation:** move each consumer to the owning public seam and preserve active-agent scoping, cancellation, waterfall continuation, and resume semantics.
- **Regression:** test each affected owner independently and exercise the real host composition.
- **Remaining risk:** re-check each independent seam against the selected RC rather than treating this cluster as one atomic change.
- **Reusable rule:** group diagnostics by service owner and verify behavioral semantics in addition to matching the new signature.

## V012-PRE-06 · Profile module fallback healing is asynchronous and Profile-aware

- **Applies when:** a host calls `healProfilesModuleFallback` during startup.
- **Stage:** composition and runtime startup.
- **Symptom:** the old call shape fails static checks, or an unawaited adaptation boots before Profile-provided modules become resolvable.
- **Old assumption:** fallback healing is synchronous and needs only an install anchor and home path.
- **Target contract:** observed alpha.2 startup loads the Profile, awaits fallback healing with that resolved Profile, then boots the Loader tree.
- **Source:** official tagged [Profile boot sequence](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/apps/cli/src/profile-boot.ts).
- **Adaptation:** preserve that lifecycle order and do not fire-and-forget the healing promise.
- **Regression:** mount a real Profile-provided plugin or command through the packaged host path.
- **Remaining risk:** the final RC may change the helper or move ownership again.
- **Reusable rule:** when a lifecycle helper becomes asynchronous and consumes resolved state, preserve the upstream load → await → boot order.

## V012-PRE-07 · Shipped preset roots can change composition precedence

- **Applies when:** a product supplies its own preset roots or reuses IDs such as `standard`, `code`, or `minimal`.
- **Stage:** composition and runtime health.
- **Symptom:** a product-owned preset unexpectedly mounts a shipped definition and reports dependencies the product never selected.
- **Old assumption:** configured product roots win or shipped roots are absent unless enabled.
- **Target contract:** observed alpha.2 `AgentPresets.Config` defaults `includeShippedRoot` to true and prepends the shipped root, so duplicate shipped IDs can shadow product presets.
- **Source:** official tagged [`AgentPresets.Config`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/preset/agent-presets/src/preset.ts).
- **Adaptation:** choose the intended root policy explicitly. Do not add dependencies merely to satisfy a shadowing preset that the product did not select.
- **Regression:** inspect resolved composition and mount every product-owned default preset used at startup.
- **Remaining risk:** shipped IDs, precedence, or the default may change before the final RC.
- **Reusable rule:** inspect precedence and duplicate IDs whenever an upgrade adds built-in roots or defaults.

## Case-study-only findings

The migration lab also observed pnpm supply-chain-policy edits, a stale TypeScript project-reference cache, and a workspace tarball resolving an older registry sibling. These support the general cache-invalidation, resolution, and artifact-validation rules, but they are not DSH 0.1.2 contracts and should load only when the repository uses the relevant toolchain or distribution shape.
