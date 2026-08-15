---
name: publish-oh-my-dsh
description: Prepare, publish, finalize, or audit oh-my-dsh releases across npm and GitHub. Use for version bumps, release readiness, Keep a Changelog updates, publishing @agi-fans/dsh-tui and @agi-fans/oh-my-dsh, creating or repairing Git tags and GitHub Releases, and verifying or recovering a partially completed release.
---

# Publish oh-my-dsh

Release oh-my-dsh without drifting the two public packages, the repository version, npm, Git tags, or GitHub Releases out of sync. Treat every phase as resumable: inspect existing state first, perform only authorized writes, and skip work that is already correct.

## Establish scope

1. Read the repository `AGENTS.md` and obey its release, verification, dependency, documentation, and read-only `refs/` rules.
2. Verify that the current repository is oh-my-dsh by checking the root name in `package.json`, `@agi-fans/oh-my-dsh` in `apps/omdsh/package.json`, and `@agi-fans/dsh-tui` in `packages/tui/omdsh-tui/package.json`.
3. Accept an explicit target version from the user. Otherwise derive the smallest valid Semantic Versioning increment from the user-visible entries under `Unreleased`, following the repository's special rules for the `0.y.z` series. Ask only when the required increment is genuinely ambiguous.

Classify the request before writing anything:

- **Prepare:** Update versions and Changelog, verify, and optionally commit. Do not publish, push, tag, or create a GitHub Release.
- **Publish npm:** Publish only the requested packages. Do not infer permission to push or create GitHub state.
- **Finalize GitHub:** Push the requested commit or branch, create and push the tag, and create the GitHub Release. Do not infer permission to publish npm.
- **End-to-end release:** Run all applicable phases only when the user explicitly asks to release, publish and finalize, or otherwise clearly authorizes all external writes.
- **Audit or recovery:** Inspect npm, Git, and GitHub; perform only the missing operations explicitly requested.

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
```

Also inspect the three manifest versions, `CHANGELOG.md`, the latest release tag, and the commits since that tag. Confirm that `origin` is the intended `agi-fans/oh-my-dsh` repository before any push or GitHub write.

Preserve unrelated user changes. Never reset, discard, stash, or silently include them. Stop if overlapping dirty changes make a release commit unsafe. Treat an already-published package version, existing tag, or existing GitHub Release as state to verify and reuse, not as an error to overwrite.

## Prepare the release

1. Require meaningful user-visible or release-operational entries under `## [Unreleased]`. Do not manufacture a release from an empty section unless the user explicitly requests an exceptional metadata-only release.
2. Set the same target version in all three manifests. Keep the root package private.
3. Move all `Unreleased` entries into `## [X.Y.Z] - YYYY-MM-DD`, using the current local ISO date. Restore an empty `## [Unreleased]` section.
4. Update comparison links so `[Unreleased]` compares `vX.Y.Z...HEAD`, `[X.Y.Z]` compares the previous release tag with `vX.Y.Z`, and the first-release link remains a direct release URL.
5. Update `pnpm-lock.yaml` only if package-manager metadata actually changes. Never hand-edit registry integrity data.
6. Review the diff for unrelated files, accidental `refs/` changes, stale versions, and Markdown hard wrapping.

Use `apply_patch` for repository file edits. Do not use `npm version` or another command that implicitly creates a tag.

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

## Publish npm packages

Treat a direct request to publish or release as authorization for the npm writes it names. Otherwise stop after preparation and provide the exact commands instead of executing them.

1. Run `npm whoami` and confirm the authenticated account can publish both `@agi-fans` packages. Never ask the user to paste an npm token or one-time password into chat.
2. Query each exact target version before publishing:

```sh
npm view @agi-fans/dsh-tui@X.Y.Z version
npm view @agi-fans/oh-my-dsh@X.Y.Z version
```

3. Publish the dependency package first when its target version is absent:

```sh
pnpm --filter @agi-fans/dsh-tui publish --access public --no-git-checks
```

4. Wait for the exact TUI version to become readable from the registry, then publish the CLI package when its target version is absent:

```sh
pnpm --filter @agi-fans/oh-my-dsh publish --access public --no-git-checks
```

5. Verify both exact versions and their `latest` dist-tags with `npm view`.

Never attempt to republish an existing npm version. If TUI publication succeeds and CLI publication fails, report the partial state and resume later from the CLI publication step. Do not bump the version merely to conceal a recoverable partial release.

## Push, tag, and create the GitHub Release

Perform these writes only when explicitly authorized. Keep the tag and GitHub Release behind successful npm verification for an end-to-end release so GitHub does not announce packages that failed to publish.

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

4. Extract only the target version section from `CHANGELOG.md` into a temporary notes file. Create the release from the existing tag:

```sh
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file RELEASE_NOTES_FILE
```

5. If the release already exists, inspect it with `gh release view`; do not create a duplicate. Edit it only when the user explicitly asks to correct metadata.

Never force-push, delete a remote tag, retag a different commit, or rewrite a published GitHub Release without explicit user authorization and a clear recovery reason.

## Perform final audit

Verify all release surfaces independently:

```sh
npm view @agi-fans/dsh-tui@X.Y.Z version dist-tags.latest
npm view @agi-fans/oh-my-dsh@X.Y.Z version dist-tags.latest
git ls-remote --tags origin refs/tags/vX.Y.Z refs/tags/vX.Y.Z^{}
gh release view vX.Y.Z
git status --short --branch
```

Confirm that:

- Both npm packages expose the target version.
- The annotated remote tag dereferences to the recorded release commit.
- The GitHub Release is published at the same tag and contains the intended Changelog notes.
- The local branch is synchronized with its upstream.
- No generated tarballs, release-note files, build outputs, or reference-repository modifications remain.

Report the version, release commit, npm package results, tag result, GitHub Release URL, verification result, and any intentionally deferred phase. When blocked, report the exact completed state so another run can resume without repeating irreversible operations.
