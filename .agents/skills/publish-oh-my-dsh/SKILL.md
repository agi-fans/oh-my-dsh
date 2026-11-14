---
name: publish-oh-my-dsh
description: Prepare, publish, finalize, or audit oh-my-dsh releases across npm and GitHub. Use for version bumps, release readiness, Keep a Changelog updates, tag-triggered CI publication of @agi-fans/dsh-tui and @agi-fans/oh-my-dsh through npm trusted publishing, creating or repairing Git tags and GitHub Releases, and verifying or recovering a partially completed release.
---

# Publish oh-my-dsh

Release oh-my-dsh without drifting the two public packages, the repository version, npm, Git tags, or GitHub Releases out of sync. Treat every phase as resumable: inspect existing state first, perform only authorized writes, and skip work that is already correct. npm publication runs in GitHub Actions through npm trusted publishing (OIDC) when a `vX.Y.Z` tag is pushed. The agent prepares, verifies, and audits the release; it never runs a publish command, handles an npm token, or asks for a one-time password.

## Establish scope

1. Read the repository `AGENTS.md` and obey its release, verification, dependency, documentation, and read-only `refs/` rules.
2. Verify that the current repository is oh-my-dsh by checking the root name in `package.json`, `@agi-fans/oh-my-dsh` in `apps/omdsh/package.json`, and `@agi-fans/dsh-tui` in `packages/tui/omdsh-tui/package.json`.
3. Accept an explicit target version from the user. Otherwise derive the smallest valid Semantic Versioning increment from the user-visible entries under `Unreleased`, following the repository's special rules for the `0.y.z` series. Ask only when the required increment is genuinely ambiguous.

Classify the request before writing anything:

- **Prepare:** Update versions and Changelog, verify, and optionally commit. Do not publish, push, tag, or create a GitHub Release.
- **Publish npm:** Prepare and verify the requested packages, then push the branch and the annotated tag when authorized. The tag run publishes both packages; resume by watching it and auditing the registry. Do not publish from a local terminal.
- **Finalize GitHub:** Push the requested commit or branch and create and push the tag. The tag run creates the GitHub Release from `CHANGELOG.md`; create it manually only when that job cannot.
- **End-to-end release:** Run all applicable phases only when the user explicitly asks to release, publish and finalize, or otherwise clearly authorizes all external writes. The tag run is the publication step; wait for it to succeed instead of pausing for a human npm checkpoint.
- **Audit or recovery:** Inspect npm, Git, GitHub, and the tag run; perform only the missing operations explicitly requested.

## Inspect release state

Run read-only checks before changing files:

```sh
git status --short --branch
git log -5 --oneline --decorate
git remote -v
git tag --sort=-version:refname
npm view @agi-fans/dsh-tui version
npm view @agi-fans/oh-my-dsh version
gh release list --limit 10
gh run list --workflow publish.yml --limit 5
```

Also inspect the three manifest versions, `CHANGELOG.md`, the latest release tag, and the commits since that tag. Confirm that `origin` is the intended `agi-fans/oh-my-dsh` repository before any push or GitHub write. The publish workflow depends on a one-time Trusted Publisher entry for both npm packages; [`docs/releases.md`](../../../docs/releases.md) records the exact configuration.

Preserve unrelated user changes. Never reset, discard, stash, or silently include them. Stop if overlapping dirty changes make a release commit unsafe. Treat an already-published package version, existing tag, or existing GitHub Release as state to verify and reuse, not as an error to overwrite.

## Prepare the release

1. Require meaningful user-visible or release-operational entries under `## [Unreleased]`. Do not manufacture a release from an empty section unless the user explicitly requests an exceptional metadata-only release.
2. Set the same target version in all three manifests. Keep the root package private.
3. Move all `Unreleased` entries into `## [X.Y.Z] - YYYY-MM-DD`, using the current local ISO date. Restore an empty `## [Unreleased]` section.
4. Update comparison links so `[Unreleased]` compares `vX.Y.Z...HEAD`, `[X.Y.Z]` compares the previous release tag with `vX.Y.Z`, and the first-release link remains a direct release URL.
5. Update `pnpm-lock.yaml` only if package-manager metadata actually changes. Never hand-edit registry integrity data.
6. Synchronize the documentation demo version using the checks below.
7. Review the diff for unrelated files, accidental `refs/` changes, stale versions, and Markdown hard wrapping.

Use `apply_patch` for repository file edits. Do not use `npm version` or another command that implicitly creates a tag.

### Synchronize documentation demos

- The English and Chinese homepages' interactive terminal illustration must display the target release version. Keep `apps/site/src/version.ts` sourced from `apps/omdsh/package.json` and pass that value through `Home.astro` to `TerminalDemo.astro`. After building, inspect `apps/site/dist/index.html` and `apps/site/dist/zh/index.html` and verify the version inside `.td-name` equals the target.
- Check the README pair, the generated npm README, and both first-task tutorials for demo references and captions. Keep the video, GIF, and poster aligned and run `pnpm sync:package-readme` after changing the English README.
- Native recordings retain the version actually visible in their frames. If a recording predates the version bump, identify its captured version in the visible caption. When footage of the target version is requested or the interaction has changed, use [record-tui-demo](../record-tui-demo/SKILL.md) to capture the built target version and refresh the video, GIF, poster, and bilingual captions together. Preserve a user-selected recording unless replacement is requested; never paint over its version or label older footage as a new capture.

## Verify source and packages

Run the full repository verification required by `AGENTS.md`:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:md
pnpm smoke:happy
git diff --check
```

Run the dependency-boundary audits from `AGENTS.md`, including clean reference submodules. Run `pnpm smoke` as well when the release contains raw TTY, viewport, scrolling, cursor, signal, or startup changes.

Pack both public packages into a temporary directory without publishing:

```sh
release_pack_dir="$(mktemp -d)"
pnpm --filter @agi-fans/dsh-tui pack --pack-destination "$release_pack_dir"
pnpm --filter @agi-fans/oh-my-dsh pack --pack-destination "$release_pack_dir"
```

Inspect both tarballs and verify:

- Package names and versions equal the target.
- Only intended runtime files are included.
- The CLI tarball exposes the `omdsh` binary.
- The packed CLI depends on `@agi-fans/dsh-tui` at the target-compatible published version rather than `workspace:`.
- No file, dependency, source map, symlink, or configuration points into `refs/` or a local workspace path.

Remove only the exact temporary directory created for packing after inspection.

## Commit the prepared release

Commit only when the user requested a commit or an authorized publish/finalization phase requires one. Stage only the intended release files and use:

```text
chore(release): prepare X.Y.Z
```

Record the exact release commit SHA. If the correct release commit already exists, reuse it instead of creating an empty or duplicate commit. Require a clean worktree after the commit, apart from unrelated changes that were deliberately excluded and are safe to leave present.

## Publish from the tag run

Publication is a tag-triggered GitHub Actions run, not a local command. Never invoke `npm publish`, `pnpm publish`, or any command that writes a package to npm; never supply or request an npm token or one-time password. The `publish` job exchanges its OIDC identity for a short-lived credential, publishes `@agi-fans/dsh-tui` and then `@agi-fans/oh-my-dsh` with provenance, and the `release` job creates the GitHub Release only after both publishes succeed. [`docs/releases.md`](../../../docs/releases.md) documents the pipeline and the one-time npm configuration.

1. Confirm both exact target versions are absent or already published:

```sh
npm view @agi-fans/dsh-tui@X.Y.Z version
npm view @agi-fans/oh-my-dsh@X.Y.Z version
```

Do not work around a missing version locally. The workflow skips a package whose exact version already exists, so a partial release resumes by re-running the failed jobs.

2. Push the release commit to `main`. The workflow refuses a tag whose commit is not an ancestor of `origin/main`.

3. Create the annotated tag at the exact release commit and push only that tag (see the next section). The tag push is the publication request.

4. Wait for the run and record its conclusion:

```sh
gh run list --workflow publish.yml --limit 1
gh run watch <run-id> --exit-status
```

5. If the run fails, read the failing job log. Fix configuration or the environment and re-run only the failed jobs:

```sh
gh run rerun <run-id> --failed
```

When the original run cannot be re-run, dispatch the workflow on the same tag instead:

```sh
gh workflow run publish.yml --ref vX.Y.Z
```

Never delete, move, or re-create the tag to retry, and never publish the same version from a local terminal as a workaround.

6. If the failure is an OIDC or authentication error (`ENEEDAUTH`, 403, or a trusted-publishing handshake message), the Trusted Publisher entry is missing or names a different repository or workflow. Ask the user to verify it at npmjs.com and re-run the workflow; do not ask for a token. The repository has no long-lived npm credential to repair.

The workflow publishes `@agi-fans/dsh-tui` first and waits up to 15 minutes for the registry to expose it before publishing `@agi-fans/oh-my-dsh`. The wait timing out is a warning, not a failure.

### Registry reads lag behind a successful publish

A publish can report success while every read endpoint still serves the previous version. Observed for `@agi-fans/dsh-tui` on 0.15.0: `npm view … version`, the full and abbreviated registry documents, and the exact-version manifest URL all reported the prior version and a stale `modified` timestamp, and `npm view '@agi-fans/dsh-tui@^X.Y.Z' version` answered `E404`, roughly four minutes after the publish reported `✅ Published package @agi-fans/dsh-tui@X.Y.Z`. The registry caught up on its own with no further action.

Treat the workflow's publish step and its log output as the write-side fact and a registry read as an eventually-consistent view:

- A `404` or a stale `latest` immediately after a successful publish step is not evidence that the publish failed and is not a reason to re-run the job or withhold the GitHub Release.
- Never conclude "the package was not published" from reads alone. If the state matters, say only what the read showed and that reads lag writes.
- Never re-publish or bump the version to "fix" a stale read; the version may already be live.
- The workflow waits for the TUI package before publishing the CLI. If that wait times out, the run continues and the lag is recorded as residual lag in the final report.

Verification that both packages carry the target version remains part of the final audit. Never attempt to publish an existing npm version. If both exact target versions were already published before the tag was pushed, the run still creates the GitHub Release; only the publish steps are skipped.

## Push and tag

Perform these writes only when explicitly authorized. The tag is the publication request, so push the verified release commit first and keep the tag as the last write.

1. Confirm the release commit is the intended `HEAD` and the target tag is absent locally and remotely. If the tag exists, require it to resolve to the exact release commit; never move or replace a published release tag.
2. Push the intended branch without force:

```sh
git push origin main
```

3. Create an annotated tag at the exact release commit and push only that tag:

```sh
git tag -a vX.Y.Z RELEASE_COMMIT_SHA -m "vX.Y.Z"
git push origin vX.Y.Z
```

4. Do not create the GitHub Release by hand for a normal release: the `release` job creates it from the matching `CHANGELOG.md` section with `gh release create --verify-tag`. Use this manual command only to recover a release whose job could not create it:

```sh
node scripts/release-notes.mjs X.Y.Z > RELEASE_NOTES_FILE
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file RELEASE_NOTES_FILE
```

Add `--prerelease` when the version contains a hyphen. If the release already exists, inspect it with `gh release view`; do not create a duplicate. Edit it only when the user explicitly asks to correct metadata.

Never force-push, delete a remote tag, retag a different commit, or rewrite a published GitHub Release without explicit user authorization and a clear recovery reason.

## Perform final audit

Verify all release surfaces independently:

```sh
npm view @agi-fans/dsh-tui@X.Y.Z version dist-tags.latest
npm view @agi-fans/oh-my-dsh@X.Y.Z version dist-tags.latest
npm view @agi-fans/dsh-tui@X.Y.Z dist.attestations --json
npm view @agi-fans/oh-my-dsh@X.Y.Z dist.attestations --json
git ls-remote --tags origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
gh release view vX.Y.Z
gh run list --workflow publish.yml --limit 1
git status --short --branch
```

Confirm that:

- Both npm packages expose the target version. A registry read that still shows the previous version for `@agi-fans/dsh-tui` is propagation lag, not a failed release: record it as residual lag and never let it hold up the report.
- Both packages carry a provenance attestation (`dist.attestations.provenance`), proving the GitHub Actions build.
- The publish run succeeded and its `release` job created the GitHub Release.
- The annotated remote tag dereferences to the recorded release commit.
- The GitHub Release is published at the same tag and contains the intended Changelog notes.
- The local branch is synchronized with its upstream.
- No generated tarballs, release-note files, build outputs, or reference-repository modifications remain.

Report the version, release commit, npm package results, provenance, tag result, publish-run result, GitHub Release URL, verification result, and any intentionally deferred phase. When blocked, report the exact completed state so another run can resume without repeating irreversible operations.
