# Package ownership and composition

The deployment graph has one ownership direction:

```text
JuntaiPlatformInfrastructure (thin Core)
  -> JuntaiPlatformFoundationsIaC (shared infrastructure + foundation services)
  -> <Domain>IaC packages (domain services + domain resources)

JuntaiPlatformFoundationsIaC and each domain package
  -> JuntaiPlatformConstructs (reusable components)
  -> released Meridian construct libraries (data-engine declarations)
```

Core owns exact direct npm dependency selection, provider construction, target context, graph ordering, invocation, state continuity, and opaque output aggregation. It installs committed registry locks with `npm ci`; it does not download or stage first-party IaC source archives. Foundations owns every resource declared by this repository. A domain package owns its domain resources and consumes Foundations capabilities without modifying Foundations resources.

The same rule applies to release metadata. This package pins Casdoor, Account, Application Metadata, Blueprint, Envoy Gateway, Gateway API, OpenTelemetry, and construct releases. Service OpenAPI documents, release manifests, logical migrations, and upstream Gateway manifests are fetched from immutable GitHub/OCI coordinates and digest-verified at execution. Core selects the exact `@zephytiju/platform-foundations-iac` npm version; it never fetches or interprets those package-owned service artifacts.

## Migration boundary

Casdoor bootstrap is an idempotent desired-state migration through supported public APIs. It owns only the platform organization, Console application, generic model, adapter, and enforcer. It does not create the gated service `client_credentials` Application.

Account owns no physical migration. Foundations registers the exact logical resource mapping and supplies the composition boundary that injects Meridian public data-access contracts at runtime.

Application Metadata migration `juntai.application-metadata/1-to-2` is platform-managed and pinned to its source commit and SHA-256 digest. The service does not execute that migration at startup or own a physical datastore migration.

Blueprint 3.0.0 has no standalone database migration: its release contract uses the in-process Meridian config-artifact plugin. Adding a future migration requires a new package release with a digest-pinned supported entrypoint, desired fingerprint, rollback reference, preview evidence, and state-adoption update.

## Recovery boundary

Casdoor recovery converges the same reviewed desired state on a bounded schedule. Account recovery disables route/workload without deleting data. Application Metadata retains the v1 export through cutover acceptance. All physical data recovery belongs to the selected Meridian binding and its typed recovery capability; the package never invokes a physical engine directly.
