Platform-owned Python 3.12 Meridian distribution for the selected structured and
evidence profile. The OCI image contains public, fully locked wheels and no
endpoint, credential, Binding, domain schema or service configuration. Domain
service wheels remain independent of physical Adapters.

The runtime descriptor pins the official image, Python ABI, public wheel URLs and
hashes, plugin entry points, file inventory, full image SPDX SBOM, Python package
SBOM and BuildKit SLSA provenance. All assets are immutable. Foundations package
consumers must select this descriptor explicitly through capability 1.1.0 before
any service adopts the base image.

Image acceptance loads native plugin entry points, validates every inventoried
file, and rejects missing/mismatched pins, changed locks, changed package files,
or an unselected Adapter. It runs as a non-root user with no network, a read-only
root and no capabilities. This validates distribution integrity; deployed
services must separately validate live Meridian Bindings, capabilities, domain
migrations and data operations before readiness.
