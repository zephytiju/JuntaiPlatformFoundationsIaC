# Platform Meridian Python distribution

This directory produces an auxiliary OCI artifact of Foundations. It adds no
Python package or domain runtime dependency. The current distribution version is
1.1.0 and supports the typed platform Meridian capability 1.1.0.

The profile fixes Python 3.12.11 / cp312 / Linux amd64 and the platform-selected
`postgresql-postgis-s3-compatible-local` profile. It contains public Meridian
Core, Semantics, Query, Evidence, Streaming and PostgreSQL wheels at 1.0.0,
Object Common and S3 at 1.0.1, and Pydantic 2.13.5, with every
transitive dependency locked by version and public distribution hash. Other
physical profiles need a separately reviewed distribution. The catalog entry
point inventory records all installed providers; domain requirements remain
limited to structured, object and evidence resources. Streaming is a transitive
library requirement of the released consumer; this profile selects no streaming
engine or adapter.

The image owns `/opt/juntai/meridian-runtime`. It contains a deterministic package
and file inventory, a Python CycloneDX SBOM, a full dependency lock, plain version
constraints, and a platform-owned verifier. `runtime-release.yml` publishes the
merged source by immutable image digest, attaches BuildKit image SPDX SBOM and
SLSA provenance, and exports their exact hashes in `runtime-distribution.v1.json`.
The descriptor points to immutable GitHub release assets. See the official
[BuildKit attestation documentation](https://docs.docker.com/build/metadata/attestations/)
for the attached image metadata format.

A domain service image uses the exact published base digest, installs its own
verified wheel under the supplied `constraints.txt`, and re-runs the embedded
integrity check. Its release metadata attests the inherited image and inventory
digest. Domain source does not copy the physical package list. Domain IaC pins
the final service image and consumes the exact runtime descriptor from
Foundations capability 1.1.0. Foundations projects that descriptor, the logical
Meridian configuration, and opaque secret references. The runtime base contains
none of those deployment-specific values.

At startup the service calls the platform verifier with the descriptor path and
its expected digest. The verifier checks the descriptor, inventory, Python ABI,
installed distribution versions, package files and plugin entry points. Missing
pins, drift, duplicate required entry points and extra Adapter distributions
fail closed. Additional domain and observability plugins are allowed when they
do not replace the selected runtime. Only build-time smoke tests use `--embedded`.
The service then starts the public Meridian runtime and verifies live Binding,
capability and domain Schema/Resource fingerprints before readiness. Migration
remains an explicit platform-owned Job.

The offline image test runs native installed code under a non-root user, with a
read-only root, no network and no capabilities. It verifies the positive path
and rejection of missing descriptor pins, changed descriptors, changed locks,
modified package files and unselected Adapters. These tests establish packaging
integrity; they do not claim a live Engine, migration or deployed-service gate.

## Exact consumer compatibility

`consumer-lock.json` records the resolver-selected service overlay for
LatticeModelConfigurationService 0.3.0 and LatticeRuntimeGenerationService 0.1.0.
It contains coordinates and hashes, never private wheel bytes. Reproduce it with:

```sh
python runtime/meridian-python/check_consumers.py IMAGE_BY_DIGEST \
  --cache /tmp/consumer-wheels --output /tmp/compatibility.json
```

Existing GitHub credentials read the pinned private releases. Public dependencies
come from exact hashed PyPI wheels. Installation uses no network, index, source
substitution or base-package changes. The installed probe checks the projected
descriptor, all base files, pip dependency integrity, required catalogs, every
non-executable service module and all service-authored Pydantic model schemas.
The release attaches the result against the published base image digest, plus
the exact consumer lock. This is packaging evidence; live Engine/service
acceptance remains with the downstream owner. Consumer-specific code never
enters the platform base image.
