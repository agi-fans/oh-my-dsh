# DSH upgrade skill architecture proposal

## Scope

The skill should be general across the DSH ecosystem: a single plugin package, a plugin monorepo, a host application, or a product composition that mounts many plugins. It should handle upgrading one plugin, migrating the Harness cohort, and intentionally maintaining compatibility with multiple host cohorts.

Generality does not mean removing DSH concepts. Cordis services and lifecycle, Profile composition, plugin configuration, event augmentation, package exports, and host/plugin compatibility are the shared domain model. Repository-specific package managers, build tools, test commands, package names, and version failures belong in conditional references or evidence cards.

The [oh-my-dsh 0.1.2 upgrade lab](dsh-0.1.2-upgrade-lab.md) is one forward test of this design. Its findings inform the skill but do not define the skill's universal workflow.

The concrete repository-local implementation is [`dsh-upgrade`](../.agents/skills/dsh-upgrade/SKILL.md).

## Design principles

The entry skill should encode decisions that apply to most DSH upgrades:

- discover the repository's shape and instructions instead of assuming pnpm, TypeScript, a monorepo, or npm publication;
- establish the requested compatibility outcome before changing dependencies;
- treat the installed or packed artifact and observable host behavior as the effective contract;
- distinguish source-touchpoint discovery from package-graph and composition analysis;
- adapt mechanical public-contract changes after an upgrade is authorized, while pausing for choices that change behavior, compatibility, security, data, or publication state;
- validate only applicable boundaries, but never infer safety solely from an empty text scan;
- record version-specific facts outside the entry skill so later releases can supersede them cleanly.

A proposed rule belongs in the entry skill only when it passes all of these checks:

1. It changes an agent's migration decision, safety boundary, or evidence standard.
2. It applies to more than one repository shape or follows directly from the DSH architecture.
3. It does not require a particular package manager, compiler, test runner, or distribution model unless the detected project uses it.
4. It can state its applicability without naming an oh-my-dsh file, package, or workaround.

Anything else belongs in a repository adapter, version card, or case study.

## Operating modes

The skill should select one mode from the user's request and the repository graph:

| Mode | Desired outcome | Important question |
| --- | --- | --- |
| Plugin release upgrade | Change one or more plugin packages while keeping the host contract stable | Does the new plugin still support the selected host cohort? |
| Harness cohort migration | Move the host-facing DSH graph to another coherent release | Which plugins, services, events, defaults, and lifecycle contracts move with the host? |
| Multi-cohort compatibility | Produce one or more artifacts that intentionally support multiple host cohorts | Is compatibility achieved through public feature detection, separate artifacts, or a documented minimum host version? |
| Assessment only | Produce an impact report without changing files | Which findings are confirmed, unresolved, or irrelevant? |

Publishing is not a migration mode. It is a separate external action after the candidate artifacts and compatibility claim have been validated.

## Implemented progressive-disclosure layout

```text
dsh-upgrade/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── repository-discovery.md
│   ├── contract-surfaces.md
│   ├── compatibility-strategies.md
│   ├── validation.md
│   ├── evidence-cards.md
│   └── dsh-0.1.1-to-0.1.2-prerelease.md
```

Only `SKILL.md` is always loaded. Repository discovery, contract analysis, compatibility strategy, validation, evidence recording, and the prerelease corridor are routed independently. A simple plugin upgrade therefore does not load host-composition or prerelease-specific material.

No automatic manifest-rewrite or package-inspection script is included yet. A future script should be added only after its cross-repository inputs and factual outputs can be validated without embedding one package manager's policy.

## Entrypoint implementation

The repository-local [`SKILL.md`](../.agents/skills/dsh-upgrade/SKILL.md) is the single maintained entrypoint. It owns mode selection, authorization boundaries, the shared migration loop, and routing to conditional references; this architecture document does not duplicate its instructions.

## Contract-surface model

The previous six-category scan is useful as a discovery aid, but a general skill should organize evidence by contract surface rather than regex count.

| Surface | Examples | Questions |
| --- | --- | --- |
| Package graph | Direct dependencies, peers, engines, optional packages, exports, bins, artifact contents | Does the selected source contain a mutually compatible graph, and can a clean consumer resolve it? |
| Cordis composition | Plugin entries, injects, providers, consumers, waterfalls, effects | Did ownership, readiness, scope, disposal, or listener semantics change? |
| Domain events and projections | Durable events, module augmentation, session projections | Which package owns the event or state, and will replay or resume preserve behavior? |
| Configuration and defaults | Schemas, renamed keys, built-in roots, precedence | Can a new default shadow or silently replace product configuration? |
| Lifecycle and host environment | Profile loading, fallback resolution, startup order, filesystem paths | Must work move earlier, later, or become awaited? |
| Runtime interaction | Cancellation, retries, permissions, commands, UI contributions | Does the adapted signature preserve the previous observable behavior? |
| Distribution or deployment | Tarballs, bundles, source installs, plugin directories, container images | Does the deployed artifact encode the graph that was tested? |
| Internal coupling | Monkey patches, undocumented source imports, reflection over host state | Can it move to a public seam, or is an explicit compatibility exception required? |

Raw scan results should use four classifications:

- **confirmed contract:** migration work and regression evidence are required if the target changed it;
- **confirmed internal coupling:** replace it with a public seam or surface the compatibility decision;
- **unresolved candidate:** inspect the owner, artifact, and runtime path before editing;
- **irrelevant match:** retain enough context to explain why it does not affect the migration.

“No source matches” lowers source-adaptation risk but says nothing about dependency resolution, changed defaults, host composition, or artifact installation.

## Validation selection

Validation should be conditional and repository-native:

| Boundary | Use when | Evidence shape |
| --- | --- | --- |
| Resolution | Every mode; read-only evidence is sufficient for assessment-only work | Target availability, compatible dependency/peer graph, reviewed lock, dry-run, or resolution output, and no accidental source or cohort fallback |
| Static contract | The repository has compilation, generation, linting, or schema checks | A cache-invalidated run using the owning toolchain |
| Behavioral contract | A service, event, projection, configuration, or command changed | Focused regression at the owning public seam, followed by the repository's normal suite |
| Composition | The project mounts plugins, Profiles, or host configuration | Resolved composition plus real host mount or health evidence |
| Runtime | Observable startup, session, terminal, remote, permission, or persistence behavior changed | The real entry path, including resume or cancellation when relevant |
| Compatibility | More than one host cohort is promised | Each promised host loads and exercises the same capability, or each separate artifact is tested against its declared host |
| Distribution | The result will be installed or published as an artifact | Inspect and install the exact candidate artifact in an isolated consumer or deployment environment |

The skill should report unavailable credential-dependent checks separately. Missing credentials do not invalidate deterministic evidence, but they remain an explicit gap when the affected path requires a real external provider.

## Evidence-card schema

| Field | Purpose |
| --- | --- |
| Applies when | Repository shape, package source, feature, and version corridor for which the finding matters |
| Stage | First boundary that exposed the difference |
| Symptom | Exact diagnostic or observable behavior without causal speculation |
| Old assumption | Contract used by the baseline consumer |
| Target contract | Contract exposed by the selected target artifact |
| Source | Published or installed metadata, official tagged source, release note, or deterministic runtime event |
| Adaptation | Smallest compatible product-owned response and alternatives rejected for material reasons |
| Regression | Evidence that distinguishes the old and target contracts |
| Remaining risk | Unverified environment, provider, platform, or compatibility claim |
| Reusable rule | Decision guidance that remains after project names and commands are removed |

Version cards should carry applicability and source fields and may refer to a repository case study for detail. A package-manager behavior, compiler-cache failure, or product-specific workaround should not become a universal version rule unless the applicability condition says exactly where it holds.

## Placement of the oh-my-dsh findings

The rc.2 → alpha.2 experiment distributes cleanly across the generic design:

| Finding | Generic destination |
| --- | --- |
| DSH and Cordis foundation packages moved together | Package-graph version card |
| pnpm changed supply-chain policy state during install | pnpm ecosystem reference and case study |
| A transitive peer raised a foundation requirement | Resolution validation |
| Warm `tsc -b` hid changed declarations | TypeScript case study supporting the general cache-invalidation rule |
| Runtime value exports disappeared | Public-export version card |
| Todo event augmentation moved to its domain package | Domain-event ownership version card |
| Waterfall, signal, Session, PTC, and projection signatures changed | Service-owner version cards |
| Profile fallback healing became asynchronous and Profile-aware | Lifecycle version card |
| A shipped preset root shadowed product IDs | Configuration-default version card |
| Workspace success hid a registry-resolved stale sibling package | pnpm/workspace distribution case study supporting artifact-graph validation |

This placement keeps the migration evidence useful without forcing every DSH plugin to run pnpm, TypeScript project references, a Profile-local bundle test, PTY smoke, or a multi-package npm installation.
