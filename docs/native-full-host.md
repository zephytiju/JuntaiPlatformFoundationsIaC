# Native full-host deployment inputs

Version 1.9.0 publishes the previously qualified C2 selected-reader compiler through
`compile_reader_exposure` and `compile_reader_exposures`, with its strict renderer,
public input schema and trust-file verifier. Outputs retain the existing exact native
read routes, pinned Envoy/Casdoor images, independent non-admin reader identities,
TLS certificate lanes and isolated Linux namespace policy. Import/rendering has no
allocation or listener side effects. A rendered artifact is never live admission.

`deployNativeVerificationSubstrate` exposes the existing bounded bootstrap substrate:
a fresh task namespace, secret, quota, four expiring jobs and four ClusterIP services
for Casdoor, its database, domain PostgreSQL and Object storage. It accepts only
`development-local` and names matching `nous-r2-t<task number>`. The deployment owner
must verify namespace absence and obtain the exact plan approval before invoking it.
The returned allocation is declared, not ready. No native identity, policy, migration,
reader service, model, listener or proof is fabricated by this helper. Casdoor's
configuration is projected read-only with its required supplemental filesystem group.

These are separate building blocks. The substrate alone does not enforce the C2
namespace policy or establish native readiness. The deployment owner must compile
and execute a complete reviewed plan, verify the actual proxy configuration,
trust, native permissions, process isolation and storage placement, and record the
live denial and cleanup matrix before admitting a full-host consumer. The existing
R2 read-only receiver scope remains unchanged. Local model provisioning continues
through the independently exported `deployModelProvider` API.

The selected-reader implementation retains its qualified upstream image/source
coordinates; packaging is not a new source-to-image attestation. No production,
external paid inference or M5 allocation is authorized by package availability.
