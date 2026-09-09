# Native Adapter manifest fixtures

These JSON files contain the exact `manifest.to_dict()` and `manifest.fingerprint`
exported by `meridian_storage.adapters.postgresql.descriptor.manifest` for
`postgresql-postgis-local-single-primary`, Engine `17-postgis-3.5`.

- `legacy-postgresql-manifest.json`: immutable runtime 1.1.0,
  `ghcr.io/zephytiju/juntai-platform-meridian-runtime-python@sha256:5f7532afb22678cd3bd7f69043419e52e1e71d8a4a70282e40893ebae5706e3b`,
  PostgreSQL Adapter 1.0.0.
- `durable-postgresql-manifest.json`: immutable runtime 2.0.0,
  `ghcr.io/zephytiju/juntai-platform-meridian-runtime-python@sha256:7553d1014d9c0772be813ffbdbf32f906269556f9ce8131bf269a84c4dd6db39`,
  PostgreSQL Adapter 2.3.1.

Exports ran with network disabled and a read-only filesystem. These are native
contract metadata, not evidence of live Engine readiness. Other test inputs
(endpoints, physical fingerprints, and runtime-distribution fixture artifacts)
remain synthetic and are never release evidence.
