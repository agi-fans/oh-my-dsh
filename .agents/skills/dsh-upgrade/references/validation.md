# Upgrade validation

Select repository-native evidence according to the migration mode and affected contract surfaces. Do not replace an existing real-entry check with a hand-mounted approximation merely because it is easier to run.

## Validation matrix

| Boundary | Use when | Evidence |
| --- | --- | --- |
| Resolution | Every mode; read-only evidence is sufficient for assessment-only work | Target availability, compatible dependency and peer graph, reviewed lock, dry-run, or resolution output, and no unintended source or cohort fallback |
| Static contract | The repository has compilation, generation, linting, schema, or ABI checks | A cache-invalidated run using the owning toolchain |
| Behavioral contract | A service, event, projection, configuration, command, or adapter changed | Focused regression at the owning public seam, followed by the repository's normal suite |
| Composition | The project mounts plugins, Profiles, or host configuration | Resolved composition plus a real host mount or health check |
| Runtime | Startup, session, terminal, remote, permission, persistence, or cancellation behavior changed | The real entry path, including replay, resume, cancellation, or failure paths when relevant |
| Compatibility | More than one host cohort is promised | Each declared host exercises the same capability, or each separate artifact is tested against its declared host |
| Distribution | The result will be installed or published | Candidate manifest and file audit plus isolated installation or the actual deployment path |

## Validation order

1. Capture baseline failures before changing dependency artifacts when feasible.
2. Resolve the selected target and inspect package-manager or workspace-policy changes.
3. Invalidate relevant dependency and build caches, then run static checks.
4. Add and run focused regressions for changed contracts.
5. Run the repository's broader test and build gates.
6. Inspect resolved host composition and exercise the real entry point when applicable.
7. Inspect and install candidate artifacts when distribution is part of the outcome.

This order localizes failures; it is not a command list. Use the repository's documented scripts and package manager.

## Artifact checks

For each candidate artifact, inspect applicable fields and files:

- package name, version, entry points, exports, binaries, files, types, engines, dependencies, peers, and optional peers;
- generated declarations, configuration, bundled assets, and source maps promised to consumers;
- workspace dependencies rewritten into installable ranges;
- symlinks, local paths, source overrides, or forbidden reference paths;
- sibling packages that must be released or installed together.

An isolated consumer should resolve the candidate artifacts rather than older registry siblings. If package identity has not yet changed, record that release validation is blocked instead of adding an implicit override and calling it passed.

## Report gaps honestly

Report exact commands or equivalent actions, pass/fail state, and environment. Separate unavailable credential- or platform-dependent checks from deterministic checks. Missing external credentials do not invalidate deterministic evidence, but they remain a residual risk when the changed path requires a real provider.

Assessment-only work may stop with read-only evidence and clearly marked unverified boundaries. An implemented migration is not verified while a required applicable boundary is failing.
