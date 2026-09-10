# Peer and owned-reference runtime composition

Foundations 1.7.0 selects Metadata 3.2.1 and Blueprint 3.3.1. Each service uses its own released schema providers, catalog manifests, per-Resource fingerprints and normal Meridian dependency inventory. Provider versions follow their logical contract: Metadata's provider is 3.1.3 and Blueprint's is 3.2.0. They are independent of the service release version.

The exact image, OpenAPI and release-contract digests are in `src/release.ts`. `src/peer-runtime-contracts.json` contains the public logical definitions exported from the normally installed final wheels. Reproduce that snapshot with `scripts/export-peer-contracts.py --metadata-python /path/to/metadata/python --blueprint-python /path/to/blueprint/python --output /path/to/contracts.json`. Both interpreters must contain the selected releases and their normally resolved dependencies.

## Platform composition

`meridian.peerRuntimeSelections` accepts `application-metadata` and `blueprint`. Each selection supplies exactly one `structured` and one `object` Engine, plus its own opaque `runtimeReferences`. Omitted primary selections use the existing global Engine inputs. Blueprint requires the capabilities of its released PostgreSQL 2.4.0 runtime; an older producer Engine manifest cannot satisfy Blueprint's current write contracts.

`peerRuntimeRequirements(peer)` exports the selected logical requirements for Foundations-owned physical provisioning. Schema layouts and migration plans are produced with the selected public adapter compiler. Foundations owns these physical choices; domain packages continue to supply logical requirements and receive opaque runtime outputs. Exact package coordinates are planning/distribution locks, while runtime compatibility assertions use Core's separate manifest contract. Normal installation, pinned service images and capability fingerprints enforce the selected runtime inventory.

Existing primary source ConfigMaps retain their identities and namespaces. Metadata copies its configuration into its existing service configuration; Blueprint now projects the primary payload into `juntai-blueprint-runtime-config` in `juntai-platform`, beside its pods. Generated owned-reference ConfigMaps also live in the peer service namespace. Their resource dependencies precede workload creation.

## Reading application-owned producer artifacts

A peer selection can include `ownedReferences: { storeId, engines, runtimeReferences }`. The store must be a declared Configuration/Artifact store using the exact plugin 1.0.3 producer bundle and all five Resource fingerprints. Its PostgreSQL selection retains the original physical namespace, layout, physical fingerprint and both `application` and `tenant` scope keys. Provide dedicated read credentials through opaque Secret references. The selection must describe the deployed store; it is not permission to change that store.

For Blueprint, Foundations constructs PostgreSQL 2.4.0's closed `meridian.postgresql.read-compatibility.v1` proof from the full released producer and reader ResourceDefinitions. Only the supported structured `put` 1.0.0 to 2.0.0 contract difference is admitted by the adapter. All schema, fingerprint, layout and other Resource contract checks remain exact. The compatibility binding is read-only, rejects mutation/activation/import paths and opens read-only database sessions. No migration, DDL or physical metadata rewrite is performed on the older store. Metadata retains its compatible legacy ABI. The producer's own writer runtime is unchanged.

The object binding is preserved, and the peer's primary mutable catalog remains separate from the owned-reference reader. Foundations rejects missing or duplicate layouts, changed source fingerprints, tenant-only scope, missing physical pins, pre-existing compatibility overrides, unprojected credentials and overlapping mounts before creating provider resources.

| Service   | Environment variable                                   |
| --------- | ------------------------------------------------------ |
| Metadata  | `APPLICATION_METADATA_OWNED_REFERENCE_MERIDIAN_CONFIG` |
| Blueprint | `BLUEPRINT_OWNED_REFERENCE_MERIDIAN_CONFIG`            |

For an already composed Foundations-owned runtime, the existing service-level `ownedReferenceRuntime` input accepts an opaque configuration ConfigMap plus optional file references. Generated and externally supplied owned-reference configurations are mutually exclusive for each peer. The ConfigMap must contain `meridian-config.v1.json`; all projections are read-only and use normalized, non-overlapping paths. Configuration inputs never supply an application owner or impersonate a caller. The peer obtains owner scope and source authorization from the original authenticated request.

## Acceptance

The integration was verified with final normally installed Metadata 3.2.1 and Blueprint 3.3.1 wheels, real PostgreSQL 16/PostGIS and MinIO. All four JSON configurations emitted by Foundations started successfully; both owned readers retrieved the existing producer's metadata and exact artifact bytes with unchanged physical pins. Blueprint's ten catalog mutation/rollback/restart probes passed through the generated primary configuration. Metadata's HTTP/generated-client association probe passed 22 checks, including atomic rollback, lost-response replay, three service processes, cross-tenant denial and the 501-contribution aggregate.

`node --import tsx scripts/verify-peer-configs.ts /path/to/fixture-inputs` emits the actual Foundations ConfigMap payloads using Pulumi mocks. The directory contains `application-metadata.json` and `blueprint.json`, each a `PeerRuntimeSelection` for provisioned disposable fixtures. The mock Kubernetes provider performs no deployment; installed-runtime and service probes must run separately against those emitted payloads. The local acceptance uses fixture admission decisions and real IAM context enforcement, not production authentication. Full Lattice lifecycle acceptance remains a separate consumer integration gate.
