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
