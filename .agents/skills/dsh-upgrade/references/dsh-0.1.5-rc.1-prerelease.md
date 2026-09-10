# DSH 0.1.5-alpha.2 to 0.1.5-rc.1 prerelease evidence

## Applicability

These cards were observed while moving a TUI host composition from published `0.1.5-alpha.2` packages to published `0.1.5-rc.1` packages. The corridor spans one day and 17 commits, so the cards cover a narrow, prerelease-only situation: a consumer that already sat on the immediately preceding alpha. Re-read the selected package metadata, exports, declarations, official release notes, and tagged source before applying a card to a later prerelease.

Primary evidence: [DSH 0.1.5-rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) and the [oh-my-dsh upgrade record](../../../../docs/dsh-0.1.5-rc.1-upgrade.md).

## V015RC-01 · A prerelease peer range silently absorbs the next prerelease cohort

- **Applies when:** the consumer pins one prerelease line exactly while the packages it installs declare peer or dependency ranges on that same line, and a later prerelease in the same version tuple has been published.
- **Stage:** resolution and distribution.
- **Symptom:** the installed tree carries two copies of the same package at different prerelease versions, and booting the packaged application fails with a duplicate-registration error rather than a resolution error. Observed: `prompt section "deployment:persona-prefix" is already registered`, raised because two `dsh-system-prompt` copies each owned a prompt-section registry.
- **Old assumption:** pinning every direct dependency to `0.1.5-alpha.2` yields an alpha.2 graph, because the pins are exact.
- **Target contract:** `^0.1.5-alpha.2` is satisfied by `0.1.5-rc.1`. Any package reached only through such a range resolves to the newest prerelease in the `0.1.5` tuple, so an exact pin on a subset of the graph does not pin the graph.
- **Source:** an isolated npm consumer of the packed application artifacts. With alpha.2 pins: 97 packages at `0.1.5-alpha.2` and 29 at `0.1.5-rc.1`, with eight packages present twice (`dsh-system-prompt`, `dsh-scope`, `dsh-invariants`, `dsh-llm`, `dsh-timeout`, `dsh-http-proxy`, `dsh-output-retention`, `dsh-sandbox-policy`). With rc.1 pins: 127 packages at `0.1.5-rc.1` and no duplicate.
- **Adaptation:** move every DSH pin in the same change as the cohort selection. Do not leave a published package on a prerelease line while a newer prerelease exists.
- **Regression:** install the packed artifacts in an empty consumer with npm and assert one DSH version in the tree plus zero nested duplicates. A workspace install with a committed lockfile does not reproduce the defect and is not sufficient evidence.
- **Remaining risk:** this is npm peer auto-install behavior. A consumer whose ranges are rewritten, or a package manager that resolves differently, may not reproduce it; verify against the distribution path actually used.
- **Reusable rule:** a cohort is pinned only when the whole resolved graph is one version. A prerelease range inside an `x.y.z` tuple matches later prereleases, so mixed cohorts appear as duplicate package copies rather than as a version conflict.

## V015RC-02 · Measure the corridor at the artifact level before trusting the release notes

- **Applies when:** the target release notes aggregate changes over several prereleases, as `0.1.5-rc.1` does from `0.1.2-rc.1`.
- **Stage:** static and behavioral contract.
- **Symptom:** the release notes list session lifecycle, inbox API, agent context, and log-format changes that the consumer has already absorbed in earlier prereleases and that do not apply to this corridor.
- **Old assumption:** every release-note item in the target's summary is a change between the baseline and the target.
- **Target contract:** comparing the two tags shows 17 commits and three source files. Unpacking both published tarballs of all 129 DSH packages in the consumer's lock graph and diffing them shows the only package with content differences beyond version strings is `@deepseek-ai/dsh-llm-deepseek` (an added `deepseek-flash` catalog entry, a declaration comment, and READMEs); the other 128 dists are byte-identical.
- **Source:** `git compare` between the two tags plus a recursive diff of both extracted tarball trees per package.
- **Adaptation:** treat the aggregated release notes as an index, decide per package from the artifacts, and expect a version-only change when the corridor is one prerelease wide.
- **Regression:** the consumer's own gates must pass with a cache-invalidated build; no source adaptation should be needed for a version-only corridor.
- **Remaining risk:** a prerelease released moments earlier may still be revised; re-run the artifact diff against the final release.
- **Reusable rule:** release notes describe a range, not a corridor. Diff the selected artifacts to find the corridor.

## V015RC-03 · A product-owned composition does not inherit a changed upstream default

- **Applies when:** the host ships its own composition patch instead of mounting the upstream base bundle, and the corridor changes a default in that bundle.
- **Stage:** composition and runtime startup.
- **Symptom:** after the version bump, the running application still reports the previous model, and the pinned value that upstream changed is duplicated across a config file, CLI help text, and startup assertions.
- **Old assumption:** adopting a cohort also adopts the cohort's defaults.
- **Target contract:** `0.1.5-rc.1` adds `deepseek-flash` (`DeepSeek-V41-Flash`, text and image input, `systemPromptUpdate: in-history`) to the `dsh-llm-deepseek` default catalog, and the upstream base bundle (`@deepseek-ai/dsh-base`, which a self-composing product does not depend on) switches its `dsh-agent-default-model` row to it. The DeepSeek connection layer grants the same reasoning-effort ladder to every catalog entry, so the new id needs no separate reasoning registration.
- **Source:** the published `dsh-llm-deepseek` `lib/index.js` at rc.1 and the release-tag `packages/bundle/base/cordis.patch.yml`.
- **Adaptation:** decide the default explicitly and change every place that restates it — composition config, CLI help, and terminal assertions. Recording the route without probing gateway availability means a gateway that has not enabled the id answers `INVALID_REQUEST`, so the decision is a product one, not a mechanical one.
- **Regression:** boot the real entry point and assert the displayed model, not just the composed configuration dump.
- **Remaining risk:** gateway availability for the new model id cannot be verified without provider credentials.
- **Reusable rule:** when a cohort changes a default, a product that owns its composition must re-state that default everywhere it is duplicated.

## V015RC-04 · Supply-chain age policy is verified against the stale lockfile first

- **Applies when:** the package manager enforces a minimum release age, the target prerelease is hours old, and the previously committed lockfile references the baseline versions.
- **Stage:** resolution.
- **Symptom:** `pnpm install` fails with a minimum-release-age violation listing the *baseline* versions, even though the manifests and the exclude list already name the target versions.
- **Old assumption:** editing the exclude list is enough for the next install to proceed.
- **Target contract:** verification of the existing lockfile runs before resolution, so the committed lock must satisfy the policy under the *new* exclude list. Once alpha.2 leaves the exclude list, the stale alpha.2 entries are rejected and the update never starts.
- **Source:** the policy failure output plus the registered `minimumReleaseAgeExclude` list.
- **Adaptation:** complete the transition in one step, either with a single trusted-lockfile install that lets the new lock be written (then re-run a normal install to confirm the policy accepts it), or by keeping the outgoing version in the exclude list for the transition and removing it afterwards. Rebuilding the lock from scratch is not required.
- **Regression:** a plain install with no extra flags must pass after the new lock is written.
- **Remaining risk:** the effective age window is environment policy, not part of the DSH contract.
- **Reusable rule:** when a policy is checked against committed resolution state before re-resolution, the outgoing state must satisfy the incoming policy for exactly one run.
