# Repository discovery

Use this reference when ownership, package sources, or the host/plugin boundary is not already obvious.

## Respect the repository first

Read the applicable agent instructions and inspect the worktree before changing files. Identify user-owned modifications and do not absorb unrelated work into the migration. A repository may impose stronger dependency, verification, or reference-source rules than this skill.

## Identify the repository shape

Determine which shape or combination applies:

- a single installable plugin package;
- a monorepo containing multiple independently released plugins;
- a host application that owns runtime composition;
- a product package that bundles configuration and depends on reusable plugin packages;
- a private or source-only integration with no public artifact.

Find the owning manifests, workspace or project configuration, lock or resolution files, plugin and Profile configuration, host entry point, build outputs, package exports, release metadata, and repository-native validation commands. Do not assume that the repository root owns every package version or that every source directory is publishable.

## Establish the migration corridor

Record:

| Field | Meaning |
| --- | --- |
| Baseline | Installed or declared plugin and Harness versions before migration |
| Target | Requested plugin version or Harness cohort |
| Host promise | Minimum, maximum, or exact host cohorts the result must support |
| Package source | Registry, source checkout, local artifact, vendored package, or another authorized source |
| Distribution | Public package, private package, source deployment, plugin directory, container, or no deployment |
| Repository toolchain | Package manager, compiler or generator, test runner, bundler, and release tooling actually in use |
| Existing failures | Reproducible failures already present before dependency mutation |

When the user asks for “latest,” verify the selected source and prerelease policy rather than assuming a dist-tag. When the target is unpublished, read [compatibility strategies](compatibility-strategies.md) before constructing artifacts or overrides.

## Build the package graph

Inventory direct and transitive DSH packages, Cordis foundation packages, product-owned packages, host-provided peers, optional capabilities, and removed or renamed packages. A coherent graph means the selected artifacts satisfy one another's declared requirements and the user's host promise; it does not require every ecosystem package to use the same version syntax.

Inspect installed and packed metadata when available. Source manifests can differ from published export maps, `files` lists, generated declarations, peer ranges, and workspace-rewritten dependency ranges.

## Discovery output

Before implementation, be able to state:

- which package or host corridor is changing;
- which packages and composition layers own that corridor;
- where the effective artifacts come from;
- which compatibility promise is preserved or intentionally changed;
- which checks can distinguish baseline failures from migration failures.
