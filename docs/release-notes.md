## 1.10.3

Allow bounded 180-second Nous start/resume requests to return through the
full-host Nous and Console proxies. Their response and idle limits are now
200 seconds; issuer/Lattice limits and request-body deadlines remain unchanged.

## 1.10.2

The disposable full-host Object service fetches the exact unchanged MinIO
RELEASE.2025-04-22T22-12-26Z binary from the official public GitHub release because
the former official image registry denies access. Both architecture hashes and
byte lengths are pinned and match the original image. A credential-free init
stages the executable before network isolation; only Object storage receives its
bounded readonly binary volume. Its UID, data custody and network policy remain
unchanged. No MinIO code, custom MinIO image or mirror is published. The standalone
bootstrap helper retains its previous image contract.

## 1.10.1

Restricts packaged release assets to JSON contracts and Python source. Python
bytecode created by isolation tests is excluded, and the packed-consumer gate
rejects cache files. The 1.10.0 runtime/configuration payload is unchanged; its
published tarball had one test-generated Python 3.12 cache file.

## 1.10.0

Adds the explicit disposable full-host environment: staged local model, sealed
Linux network namespace, exact process UIDs, independent private reader lanes,
dedicated service origins and private file custody. Kernel and pinned Envoy
qualification are required in CI and release. Ordinary local model behavior and
existing shared-platform composition remain unchanged. Registry readback now
allows five minutes for npm's asynchronous processing. See native-full-host-environment.md.

## 1.9.0

Publishes the qualified native selected-reader compiler and bounded disposable
bootstrap substrate for explicit local deployment composition. Neither rendering
nor resource declaration establishes native readiness. See native-full-host.md.

## 1.7.1

Preserve the Meridian runtime capability 1.0.0 alongside 1.1.0 for exact-version consumers such as Axiom 2.0.1. The older publication projects the original four fields from the same runtime Outputs. No resources, storage selections, fingerprints, service images, or migration behavior change.
