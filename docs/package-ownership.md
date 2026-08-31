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

Core owns selection, verification, provider construction, target context, graph ordering, invocation, state continuity, and opaque output aggregation. Foundations owns every resource declared by this repository. A domain package owns its domain resources and consumes Foundations capabilities without modifying Foundations resources.

The same rule applies to release metadata. This package pins Casdoor, Blueprint, Envoy Gateway, Gateway API, OpenTelemetry, and construct releases. Blueprint's OpenAPI document and upstream Gateway manifests are fetched from immutable release coordinates and digest-verified at execution. Core only selects this package archive; it never fetches or interprets those package-owned artifacts.

## Migration boundary

Casdoor bootstrap is an idempotent desired-state migration through supported public APIs. It owns only the platform organization, Console application, generic model, adapter, and enforcer. It does not create the gated service `client_credentials` Application.

Blueprint 3.0.0 has no standalone database migration: its release contract uses the in-process Meridian config-artifact plugin. Adding a future migration requires a new package release with a digest-pinned supported entrypoint, desired fingerprint, rollback reference, preview evidence, and state-adoption update.

## Recovery boundary

Casdoor recovery converges the same reviewed desired state on a bounded schedule. Data recovery belongs to the selected Meridian binding and its typed recovery capability. The package never invokes a physical engine directly.
