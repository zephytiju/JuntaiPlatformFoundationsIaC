# Typed Meridian runtime distribution

Foundations IaC 1.4.0 publishes `MeridianRuntimeCapability` at contract 1.1.0.
Its default selection is the immutable `meridian-runtime-python-v1.1.0`
descriptor exported as `MERIDIAN_RUNTIME_DISTRIBUTION`. Foundations may select a
different exact descriptor through `meridian.distribution`; the same resolver
verifies bytes, ownership, artifact coordinates, ABI, entrypoints, catalogs and
the dependency lock before registering infrastructure. Release versions are
provenance, not a compiled compatibility allowlist.

```ts
const runtime = context.capabilities.require(MeridianRuntimeCapability);
const image = runtime.distribution.descriptor.image;
const pin = runtime.distribution.descriptorDigest;
const descriptorConfigMap = runtime.distribution.configMapName;
const logicalConfigMap = runtime.configMapName;
const opaqueReferences = runtime.runtimeReferences;
```

`distribution` contains the exact descriptor and its source pin, an immutable
ConfigMap reference, key `runtime-distribution.v1.json`, and the recommended
mount directory `/etc/juntai/meridian-distribution`. ConfigMap data preserves the
verified descriptor bytes, including whitespace, so its SHA-256 survives
projection. Its namespace is explicit; consumers project references into their
own workload namespace through their deployment composition. They do not mount
a ConfigMap across namespaces or read another stack's state.

The existing config fingerprint, logical resource references, and domain runtime
outputs remain present. `runtimeReferences` carries only ConfigMap or Secret
names, keys and mount references already selected by Foundations. Secret values,
physical bindings and engine endpoints are not added to the capability. Domain
runtime outputs also carry those opaque mount references. The descriptor contains
public package and adapter inventory, with no deployment configuration.

Domain deployment images inherit `distribution.descriptor.image`, install their
exact released service closure under the base `constraints.txt`, and rerun the
embedded verifier at build time. Before readiness, the service passes the
projected descriptor path and `descriptorDigest` to the platform verifier, then
performs its own live Meridian Binding/capability/schema checks. Service
factories, policy, migrations and live lifecycle remain with the owning package.

The runtime release's `runtime-consumer-compatibility.json` binds the published
image digest to a hash-locked overlay of Model Configuration Service 0.3.0 and
Runtime Generation Service 0.1.0. It proves 23 unchanged base distributions,
three required catalog entrypoints, 24 installed service modules and 33 Pydantic
schemas under network-disabled, read-only, non-root execution. It does not
replace downstream service/Engine lifecycle acceptance.

## Domain selections in the 1.5.0 candidate

Prism selects the separately published `meridian-runtime-python-v2.0.0`
distribution with `MERIDIAN_DURABLE_RUNTIME_DISTRIBUTION`. The default 1.1.0
selection and its immutable Lattice consumer lock remain unchanged. A domain
package supplies only `DomainMeridianRequirements`; the Platform composition
supplies physical choices separately in `meridian.domainRuntimeSelections`.
Each key must identify a declared domain. Each selection supplies an exact
`distribution`, its own `engines`, and its own `runtimeReferences`. Global
credential projections are never implicitly added to an explicit domain
selection. Every file identity, password or TLS reference must be covered by a
Secret projection in that same selection.

An optional `metadataBindingId` selects a dedicated structured Engine binding
for the native Semantics metadata registry. Component and Composition select
the same persistent metadata backend while retaining separate business data
bindings. Foundations adds the released Semantics provider and metadata
ResourceDefinition to those runtime configurations. This does not grant a
domain ownership of the `meridian` namespace. The provider bundle fingerprint,
ResourceDefinition fingerprint, metadata wrapper fingerprint, and inner
SchemaDocument fingerprint remain separate values.

`domainRuntimes[id].distribution` exposes that domain's verified descriptor,
immutable ConfigMap reference and digest. `metadataBindingId` is passed as
`MERIDIAN_METADATA_BINDING` to the published platform runtime helper. The
helper builds a fresh native SchemaAPI repository for each request, reads
projected credentials as needed and preserves the caller's tenant and deadline.
It does not run DDL. The Platform composition must complete and verify the
owner's physical migration before a workload is ready.

The 1.5.0 candidate currently uses public Constructs 1.4.0 for declaration and
projection checks. Final Prism physical acceptance requires the upstream
`put@2.0.0` and atomic Evidence declaration repair. Offline tests and the public
2.0.0 image verification do not establish physical Engine readiness. No
migration or environment application is authorized by this candidate.

The Platform also supplies `serviceConsumers` as exact service/namespace/workload
triples for direct Application Metadata and Blueprint calls. Foundations owns
these destination ingress policies and echoes the grants in the service
capability; Prism verifies the grants before declaring its workloads. IAM
continues to authorize every request independently of network access.

`GatewaySetOutput.dataPlaneNamespace` identifies `envoy-gateway-system` for the
verified standard Envoy deployment. Gateway objects remain in `juntai-gateway`.
These are separate namespaces: [Envoy's deployment mode documentation](https://gateway.envoyproxy.io/docs/tasks/operations/gateway-namespace-mode/)
places the data plane in the controller namespace by default. Consumers use the
explicit data-plane namespace for traffic policies.
