# Compatibility strategies

Read this reference only when the migration may support multiple host cohorts, change the minimum host version, use an unpublished target, or patch an external package.

## Choose an explicit host strategy

Prefer the narrowest strategy that satisfies the user's compatibility promise:

| Strategy | Use when | Main risk |
| --- | --- | --- |
| Raise the minimum host version | Consumers can upgrade with the plugin and one target contract is sufficient | Compatibility break must be explicit and versioned appropriately |
| Public capability detection | A stable public seam can distinguish optional old and new capabilities at runtime | Hidden partial states or exception-based probing can mask real failures |
| Separate artifacts or entry points | Host contracts cannot coexist safely in one artifact | Release ordering and package selection must remain unambiguous |
| Intentional feature reduction | The user accepts a smaller common capability set | Silent loss of behavior is not acceptable |

Do not add dual-cohort support merely because two versions exist. Do not infer host versions from brittle source layout or error strings when a supported capability check is available.

## Unpublished or preview targets

Confirm that the user authorized the package source and the consequences of using it. Keep source-built artifacts isolated and reproducible, record the exact source revision, and ensure runtime resolution does not silently depend on an unrelated reference checkout or developer machine path.

Separate migration testing from publication. A package that depends on unavailable artifacts must not be published accidentally. Validate whether lockfiles, CI caches, source overrides, and install paths remain reproducible on another machine.

## External patches

Treat a patch as a compatibility exception, not an ordinary upgrade step. Before patching:

- verify that no published export, adapter, configuration, or supported composition seam solves the problem;
- identify the exact external artifact and version range affected;
- keep the patch minimal and inspectable;
- add a regression that fails when the patch no longer applies or is no longer needed;
- obtain authorization if the repository does not already own the patch policy.

Never edit a reference checkout to make the migration pass.

## Stop for a decision

Pause when alternatives differ materially in supported host versions, user-visible behavior, permission or security behavior, persistent data compatibility, package identity, source provenance, or publication state. Present the concrete alternatives and evidence; do not turn a mechanical signature change into an unnecessary approval gate.
