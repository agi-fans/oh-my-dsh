# DeepSeek Harness 0.1.2 upgrade lab

## Purpose

This document records the evidence produced while moving oh-my-dsh from the published DeepSeek Harness `0.1.1-rc.2` cohort to `0.1.2-alpha.2`. The immediate goal is a correct migration on the `alpha` branch. The reusable goal is to identify decisions, checks, and failure patterns that belong in a DSH plugin-upgrade skill rather than preserving a one-off implementation diary.

The work responds to [DeepSeek Harness Discussion #5120](https://github.com/deepseek-ai/deepseek-harness/discussions/5120). It forward-tests the community [plugin-upgrade skill](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/blob/main/skills/plugin-upgrade/SKILL.md) against a product that consumes a large set of published Harness packages through public package exports.

## Migration corridor

| Item | Baseline | Target |
| --- | --- | --- |
| oh-my-dsh branch | `v0.13.0` / `alpha` | `alpha` |
| DSH cohort | `0.1.1-rc.2` | `0.1.2-alpha.2` |
| Harness source tag | `dsh-v0.1.1-rc.2` | [`dsh-v0.1.2-alpha.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2) |
| Cordis peer | `4.0.1` | `4.0.2` |
| Cordis loader | `1.0.2` | `1.0.3` |
| Schemastery | `3.18.1` | `3.18.2` |

Registry inspection confirmed that all 67 directly declared `@deepseek-ai/dsh-*` packages used by oh-my-dsh publish `0.1.2-alpha.2` and expose that version through the `alpha` dist-tag. The target therefore uses normal npm resolution; it does not build packages from the reference checkout or add local tarball overrides.

## Constraints

- Runtime and build dependencies must resolve from published npm packages. `refs/deepseek-harness` remains read-only research material and does not enter dependency resolution, TypeScript paths, build inputs, or generated links.
- All directly consumed DSH packages move as one exact cohort. Cordis, loader, and Schemastery versions move when the target cohort's published peer graph requires them.
- Migration changes remain separate from unrelated product work. A breaking user-visible behavior change requires an explicit product decision; a mechanical public-API adaptation does not require a separate confirmation after the upgrade has been authorized.
- Evidence from installed package exports, declarations, composition, runtime events, and packed artifacts takes precedence over assumptions inferred from source layout or release-note wording.

## Experiment stages

Run the migration in layers so that each failure has one meaningful boundary:

1. **Cohort resolution:** verify every target package exists, inspect dist-tags and the complete peer closure, then update manifests and the lockfile.
2. **Static contract:** remove incremental compiler metadata after installation, run typecheck before editing source, and retain the original diagnostic set.
3. **Behavioral contract:** run focused tests for each repaired API seam, followed by the complete test suites.
4. **Composition:** build the product, inspect `--dump-config`, and confirm every configured plugin resolves from its published package.
5. **Runtime:** run happy and PTY smoke tests, then exercise a real model turn when credentials are available.
6. **Distribution:** pack both public packages and inspect names, versions, exports, binaries, dependency ranges, source maps, symlinks, and forbidden local paths.

## Evidence record

Each migration finding must preserve the following propositions:

| Field | Required evidence |
| --- | --- |
| Stage | The first boundary that failed: install, typecheck, test, composition, runtime, or pack |
| Symptom | Exact diagnostic or observable behavior, without inferring a cause |
| Old assumption | The contract the `0.1.1-rc.2` consumer relied on |
| New contract | The contract exposed by the installed `0.1.2-alpha.2` package |
| Source | Published declaration/export, official release note, source tag, or durable runtime event |
| Fix | Smallest product-owned compatibility change |
| Regression | Test or audit that fails if the old assumption returns |
| Skill rule | A decision rule that applies to another plugin without naming oh-my-dsh internals |

Do not promote a release-note observation into a migration rule until the consumer either hits the affected surface or a deterministic check proves that it does not.

## Pre-flight evaluation

The existing skill scans six categories: source patches, internal events, service probes, host-directory access, UI or command registration, and subprocess or stdout integration. Applying those patterns to oh-my-dsh before the version change produced useful but noisy results.

| Existing category | oh-my-dsh result | Interpretation |
| --- | --- | --- |
| Source patch | Matches `cordis.patch.yml` Profile composition | False positive: this is a public Cordis configuration surface, not a source or monkey patch |
| Internal events | Many `SessionEvent` and `ctx.on()` uses | Mixed: durable Harness events are real migration surfaces, while Node stream and process events are unrelated |
| Service probes | Many `ctx.get()` calls | High-value surface, but the scan must distinguish declared Cordis services from reflection over undocumented services |
| Host-directory access | Profile and home resolution matches | Real behavior surface owned by omdsh's Profile composition |
| UI or command registration | Product command contributions | Real public plugin surface rather than evidence of internal UI coupling |
| Subprocess or stdout | Clipboard, editor, Git, plugin-manager, and smoke helpers | Mostly false positives unless the subprocess is a DSH host whose output is parsed |

The six categories do not expose the first material risk in this migration: 67 direct DSH packages must form one published cohort, and their foundation peers change together. A reusable skill needs a preceding **cohort and package-contract** category that checks registry availability, exact-version convergence, peer floors, removed packages, export maps, and packed contents.

The pre-flight patterns should also classify matches by imported owner and call context. A raw match is a candidate for inspection, not proof of an internal dependency. “No matches” may reduce the migration surface, but it never removes the need for a clean install, typecheck, composition boot, runtime smoke, and package audit.

## Findings

### LAB-001 · Resolve the complete published cohort before editing manifests

- **Stage:** cohort resolution.
- **Symptom:** none; this is a fail-fast precondition.
- **Old assumption:** replacing the shared DSH version string is sufficient.
- **New contract:** DSH `0.1.2-alpha.2` packages require Cordis `^4.0.2`; relevant published packages also require Cordis loader `^1.0.3` and Schemastery `^3.18.2`.
- **Source:** npm packuments and peer dependency metadata for all directly consumed packages.
- **Fix:** update the exact DSH cohort and its foundation peer floors together, then let pnpm regenerate the lockfile.
- **Regression:** reject missing target packages, mixed direct DSH versions, and unsatisfied foundation peer floors before installation.
- **Skill rule:** treat a DSH release as a dependency cohort, not a single package version. Resolve availability and peer closure before changing source code.

### LAB-002 · Touchpoint scans need ownership-aware classification

- **Stage:** pre-flight.
- **Symptom:** broad patterns classify public Cordis patches, Node event emitters, and operating-system subprocesses as Harness internals.
- **Old assumption:** a textual match identifies a migration obligation.
- **New contract:** the same token can represent a public Harness seam, an internal dependency, or unrelated platform code.
- **Source:** pre-upgrade scan of `apps/`, `packages/`, and `scripts/`.
- **Fix:** retain file and line evidence, then classify each match by package owner, imported symbol, and whether the target is the DSH host.
- **Regression:** a pre-flight report must separate confirmed migration surfaces from false positives and unresolved candidates.
- **Skill rule:** use regex scans for discovery, never as the final compatibility decision.

### LAB-003 · Installation policy is part of the target-version corridor

- **Stage:** cohort resolution.
- **Symptom:** the first successful `pnpm install` rewrote `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml` so the newly published alpha cohort could pass the repository's supply-chain age gate.
- **Old assumption:** an install that exits zero changes only the lockfile and `node_modules`.
- **New contract:** a repository-level package-age policy may reject or explicitly exempt a fresh prerelease; pnpm can materialize those exemptions in tracked workspace configuration.
- **Source:** the post-install diff of `pnpm-workspace.yaml` and pnpm's supply-chain-policy output.
- **Fix:** review and retain explicit exact-version exemptions for the authorized target cohort rather than disabling the age policy globally.
- **Regression:** inspect the workspace-policy diff after every install and fail if unrelated packages or open ranges were exempted.
- **Skill rule:** snapshot the worktree before installation and treat package-manager policy files as migration outputs, not incidental noise.

### LAB-004 · Sampled peers do not prove peer closure

- **Stage:** cohort resolution.
- **Symptom:** installation completed, but `pnpm peers check` reported that `@deepseek-ai/dsh-agent-spine-demo@0.1.2-alpha.2` requires `@deepseek-ai/cordis-plugin-timer@^1.1.4` while the product still declared `1.1.3`.
- **Old assumption:** inspecting representative DSH packages and direct foundation peers is enough.
- **New contract:** a transitive package inside the cohort can raise a foundation peer floor that none of the sampled packages exposes.
- **Source:** installed peer metadata and `pnpm peers check`.
- **Fix:** move the timer to `1.1.4`, reinstall, and require a zero-issue peer-closure check.
- **Regression:** `pnpm peers check` must pass after lockfile convergence.
- **Skill rule:** registry availability is a precondition, not peer proof. Validate the installed dependency graph after resolution.

### LAB-005 · Warm incremental typecheck can be falsely green after a dependency swap

- **Stage:** static contract.
- **Symptom:** the first `pnpm typecheck` exited zero, while the following test run failed at module evaluation because removed runtime exports were `undefined`. Removing `tsconfig.tsbuildinfo` exposed the full compile-time diagnostic set.
- **Old assumption:** TypeScript project references automatically invalidate all cached modules when installed package contents change without source timestamps changing.
- **New contract:** a dependency-cohort replacement can leave a warm `tsc -b` graph apparently current even though imported declarations changed.
- **Source:** paired warm and clean typecheck results over the same source and installed dependencies.
- **Fix:** run every workspace package's clean script, then typecheck from a cold build graph before making compatibility edits.
- **Regression:** the migration validation begins with `pnpm -r run clean && pnpm typecheck`.
- **Skill rule:** never accept a warm incremental typecheck as evidence after changing package versions.

### LAB-006 · Verify value exports, not only type names

- **Stage:** static and behavioral contracts.
- **Symptom:** module evaluation reported `settingsNamespace is not a function`, `CallId is not a function`, and `isTokenDelta is not a function`.
- **Old assumption:** the rc.2 root and subpath exports remain available as runtime values.
- **New contract:** settings methods accept namespace strings directly; the branded constructor is `ToolCallId`; the LLM message package no longer exports the token-delta classifier.
- **Source:** installed `package.json` export maps, declarations, and runtime namespace inspection for `@deepseek-ai/dsh-settings` and `@deepseek-ai/dsh-llm`.
- **Fix:** pass validated string namespaces, migrate `CallId` to `ToolCallId`, and keep the removed first-visible-delta predicate as a small product-owned pure function with the rc.2 semantics.
- **Regression:** cold typecheck plus tests that evaluate every affected module and construct a tool-call ID.
- **Skill rule:** compare the installed runtime namespace and the declaration surface. A type-only compatibility scan cannot detect a removed value export safely when incremental metadata is stale.

### LAB-007 · Domain event augmentation may move out of the core package

- **Stage:** static contract.
- **Symptom:** `SessionEvent` no longer admitted `todo/write`, so exhaustive branches narrowed the event to `never`.
- **Old assumption:** importing `@deepseek-ai/dsh-session` declares every event used by a composed tool.
- **New contract:** `todo/write` and `TodoItem` are owned by `@deepseek-ai/dsh-tool-todo`; consumers must load that package's type augmentation. The alpha.2 npm package documents a Host `./types` outlet, but its export map omits `./types`.
- **Source:** the published `dsh-session` and `dsh-tool-todo` declarations and the [`dsh-tool-todo` package export map](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/todo/tool-todo/package.json).
- **Fix:** add `dsh-tool-todo` as a direct TUI dependency and use a root-package type-only import, which re-exports the domain types without adding a runtime import.
- **Regression:** cold typecheck and Todo transcript/command tests; separately report the missing `./types` export upstream.
- **Skill rule:** when an event disappears from a core union, first find its new owning domain package. Audit the packed export map before following source comments or source-only subpaths.

### LAB-008 · Public seams can change ownership and argument shape together

- **Stage:** static and behavioral contracts.
- **Symptom:** the clean diagnostic set exposed five unrelated-looking call-site failures.
- **Old assumption:** rc.2 convenience methods and argument objects remain the public interaction surface.
- **New contract:** user questions are answered through the scoped `user-questions/request` Cordis waterfall; model-discovery cancellation is the third argument; permission preset selection consumes a `Session`; the programmatic tool-presentation value is `ptc`; and resumed preset selection is read through the `agentPreset` session projection.
- **Source:** installed declarations plus the tagged implementations for [user questions](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/interaction/user-questions/src/index.ts) and [agent-preset projection](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/preset/agent-presets/src/session.ts).
- **Fix:** adapt each call to the new public seam, preserve cancellation and active-agent filtering, and add a waterfall regression test rather than casting across the mismatch.
- **Regression:** focused tests for question answering, model discovery, permission selection, PTC presentation, preset resume, and full smoke boot.
- **Skill rule:** group diagnostics by service owner, then verify lifecycle and cancellation semantics at the replacement seam; matching the new signature alone is insufficient.

### LAB-009 · Profile module fallback now requires an awaited resolved Profile

- **Stage:** composition and runtime.
- **Symptom:** `healProfilesModuleFallback` changed from a synchronous two-argument call to an asynchronous options-object call requiring the loaded Profile.
- **Old assumption:** the installation dependency closure alone supplies every Loader fallback.
- **New contract:** selected Profile bundles may carry their own plugin dependencies, so module fallback is healed after Profile resolution and before Loader boot.
- **Source:** published declarations and the official CLI's [profile boot sequence](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/apps/cli/src/profile-boot.ts).
- **Fix:** keep Profile/config composition synchronous, then `await healProfilesModuleFallback({ installAnchor, profile, home })` immediately before `boot()`.
- **Regression:** pack the application, install a Profile-local example bundle, and boot a command contributed by that bundle.
- **Skill rule:** preserve the upstream lifecycle order: load Profile, await fallback healing with that Profile, then mount the Loader tree. Do not fire-and-forget the healing promise.

### LAB-010 · New shipped defaults can shadow product-owned preset IDs

- **Stage:** runtime composition.
- **Symptom:** the `standard` preset failed health validation on five unresolved workflow/Web plugins even though the product-owned `standard/agent.cordis.yml` names only its persona.
- **Old assumption:** configured preset roots win, or the package's shipped root is absent unless explicitly added.
- **New contract:** `includeShippedRoot` defaults to true and prepends the Harness shipped root before configured roots, so shipped `standard`, `code`, and `minimal` presets shadow product-owned presets with the same IDs.
- **Source:** the alpha.2 [`AgentPresets.Config`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/packages/preset/agent-presets/src/preset.ts) and the runtime preset-health diagnostic.
- **Fix:** set `includeShippedRoot: false` for this product-owned roster. Do not add unrelated dependencies merely to satisfy a preset the product did not select.
- **Regression:** config-composition test asserts the explicit false value; full smoke and packed-plugin boot must mount the product `standard` preset successfully.
- **Skill rule:** after an upgrade adds default roots or built-ins, inspect precedence and duplicate IDs. An unresolved dependency may be evidence that the wrong composition won, not that the dependency belongs in the plugin.

### LAB-011 · A workspace-successful pack can still describe the wrong install graph

- **Stage:** distribution.
- **Symptom:** both public packages packed successfully and contained the expected exports, binary, configuration, declarations, and source maps, but an empty consumer that explicitly installed both tarballs still resolved the application's `^0.13.0` dependency on `@agi-fans/dsh-tui` from the registry. The resulting rc.2/alpha.2 peer intersections produced unsatisfiable ranges such as `@deepseek-ai/dsh-code-runtime@>=0.1.2 <0.2.0-0` because the registry has only the `0.1.2-alpha.2` prerelease.
- **Old assumption:** a successful workspace build and `pnpm pack` prove that the application tarball installs the same dependency graph that was tested locally.
- **New contract:** package-manager workspace rewriting is version-based, and a sibling tarball supplied separately by the consumer does not override the registry dependency encoded inside another tarball. Until both product packages receive coordinated prerelease versions, installing the application tarball resolves the previously published TUI package and recreates a mixed Harness cohort.
- **Source:** the generated `@agi-fans/oh-my-dsh@0.13.0` tarball manifest and pnpm's empty-consumer resolution trace.
- **Fix:** keep the alpha branch unpublished at the stable package version; before any prerelease, assign synchronized prerelease versions to both public packages, repack them, and test installation from both tarballs in an empty consumer project.
- **Regression:** inspect packed manifests and resolve every product-owned dependency from the candidate tarballs, not from workspace links or an older registry release.
- **Skill rule:** distribution validation must test the graph encoded by the packed manifests. A workspace link can hide a stale or incompatible published dependency.

## Validation status

The alpha branch passes dependency installation and peer closure, cold typecheck, all workspace tests, production build, resolved-config inspection, Profile-local packed-plugin boot, happy smoke, PTY smoke, Markdown checks, repository boundary checks, diff checks, tarball content inspection, and reference-submodule cleanliness.

The empty-consumer install is intentionally not marked passed at package version `0.13.0`; it exposed LAB-011. Completing that release check requires an authorized synchronized prerelease version for `@agi-fans/oh-my-dsh` and `@agi-fans/dsh-tui`, followed by repacking and installing those candidate versions together. No npm publication, GitHub push, tag, or external Discussion reply is part of this migration experiment.

## Skill contribution target

The completed migration should produce focused changes to the existing community skill rather than a parallel skill:

- add cohort and published-package contract inspection before the six source touchpoints;
- provide a deterministic script for target availability, version convergence, peer closure, removed packages, and export-map changes;
- make the failure record above the input format for new version cards;
- require installed-artifact evidence and layered verification even when source scans find no internal touchpoints;
- distinguish automatic mechanical adaptations from user decisions that change behavior, compatibility, or side effects;
- forward-test the workflow against a legacy fixture and at least one real plugin or product composition.

The Discussion contribution should link the reproducible checks and concrete findings, state which existing guidance was confirmed or corrected, and avoid claiming that an unobserved release-note item is a general migration requirement.
