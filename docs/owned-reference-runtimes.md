# Owned-reference runtime integration

Metadata 3.2.1 and Blueprint 3.3.0 accept a separate Meridian runtime for references carrying an explicit application owner. The primary runtime continues to hold tenant-scoped service state and legacy references. Foundations projects the optional input through each peer's public environment variable:

| Service              | Optional environment variable                          |
| -------------------- | ------------------------------------------------------ |
| Application Metadata | `APPLICATION_METADATA_OWNED_REFERENCE_MERIDIAN_CONFIG` |
| Blueprint            | `BLUEPRINT_OWNED_REFERENCE_MERIDIAN_CONFIG`            |

Both typed service inputs accept `ownedReferenceRuntime`, with a `configuration` ConfigMap reference and optional `runtimeReferences` for opaque Secret or ConfigMap projections. The configuration must project `meridian-config.v1.json`; its destination filename may differ. Every mount is read-only. Normalized absolute mount paths must not overlap each other, the primary runtime, service credentials, or Metadata's projected workload tokens. Inline credentials and extra configuration fields are rejected before resource registration.

Foundations must compose the referenced runtime using the selected released Meridian contracts and own all physical choices. This input does not authorize domain packages or Core to construct a runtime, override an owner, rewrite a provider, or select physical engines. The peer establishes the authorized tenant/application scope from the original request. No owner or identity is injected through this configuration.

## Verified release inputs

The service catalog selects Metadata 3.2.1 at source `0be25621317d9f438e728ab9655078e53afa3432` and Blueprint 3.3.0 at source `79532df7df91c093254d72f2907e72bf72eb09f4`. Image and OpenAPI digests, release manifests, and both Metadata migration artifacts are pinned in `src/release.ts`. Public contract resolution verifies the exact fetched bytes before composition.

## Unresolved storage compatibility

This is an unreleased integration draft. The existing primary service recipes in `src/meridian.ts` are still based on the previous peer providers. They must be updated and tested against the exact selected service wheels before publication.

The shared-store probe additionally established a runtime boundary that configuration projection alone cannot solve:

- The Lattice producer uses Core 1.0.0, Configuration/Artifact plugin 1.0.3, and PostgreSQL adapter 1.0.0. Its application-owned publication and restart/read succeed.
- Blueprint 3.3.0 normally installs Core 1.1.0, plugin 1.1.2, and PostgreSQL adapter 2.3.1. The unchanged producer configuration fails Catalog fingerprint verification.
- Regenerating the reader configuration from its installed public provider and adapter manifests leaves the existing data untouched, but startup rejects the physical ResourceDefinition fingerprint for `structured:resources.channels`.
- The original producer still restarts and reads both metadata and object bytes. No reader migration or physical metadata edit was performed.

The plugin's [released dependency compatibility](https://github.com/zephytiju/MeridianConfigArtifactPlugin/blob/v1.1.2/docs/dependency-compatibility.md) and [put-mode validation](https://github.com/zephytiju/MeridianConfigArtifactPlugin/blob/v1.1.2/docs/put-mode-validation.md) document the newer operation contract and dependency set. They do not declare compatibility with the older physical ResourceDefinition. Installing plugin 1.0.3 alongside the new Core is also rejected by its exact normal dependency requirements.

A supported Meridian migration or explicit compatibility contract must preserve exact schema and physical fingerprint validation, application/tenant isolation, original caller authorization, legacy consumers, and rollback or restore. Do not substitute raw SQL, synthetic schema providers, modified release bytes, dependency overrides, or a fallback to tenant-only reads.

Release acceptance requires real producer-to-peer publish/read/import/association, cross-tenant and cross-application denial, legacy reference readback, restart, and rollback/recovery against the selected immutable artifacts. Pulumi mocks and input hash verification are separate evidence and do not satisfy that gate.
