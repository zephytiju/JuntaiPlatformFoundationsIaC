Adds the Object catalog and the exact S3 1.0.1 adapter to the Platform-owned
PostgreSQL/S3 runtime profile. Pydantic 2.13.5 and its complete transitive wheel
closure are locked for Python 3.12.11 / Linux amd64. The released Streaming
library required transitively by Lattice is included; no Streaming engine or
adapter is selected by this profile.

The release includes digest-pinned image, descriptor, inventory, dependency lock,
Python and image SBOMs, BuildKit provenance, and reproducible installed-consumer
compatibility evidence for Model Configuration Service 0.3.0 and Runtime
Generation Service 0.1.0. The exact service overlay installs offline from hashed
wheels and preserves every base runtime file and version. All service modules
(excluding executables) and their Pydantic schemas load offline as non-root on a
read-only root filesystem. Private consumer wheels remain ephemeral CI inputs.

This verifies packaging compatibility. Service factories, authorization,
migration, live PostgreSQL/S3 behavior, lifecycle and recovery remain owned by
Lattice and its downstream infrastructure acceptance. Prior releases are unchanged.
