# Disposable full-host environment

Version 1.10.0 adds `deployNativeFullHostEnvironment`,
`compileNativeFullHostNetwork` and `compileNativeFullHostServiceExposures`.
These complete the physical isolation composition missing from the independent
1.9.0 reader compiler and bootstrap helpers. Core selects this package and passes
owner inputs through; Foundation owns all physical declarations and exposure.

The opt-in target is `development-local`, in a fresh `nous-full-host-t<task>`
namespace. One expiring Job holds 19 containers in a shared Linux network
namespace: Nous, Lattice, Console, browser, independent client, bounded operator,
Casdoor, its database, domain database, Object storage, model, the authenticated
telemetry Collector and ClickHouse, two private reader
proxies and four dedicated public-origin proxies. Immutable domain images and
their configuration come from the domain owners. Foundation fixes its own image
pins, all process UIDs, proxy commands and generated routing. No Service, host
port, host network, host mount, shared PID namespace or service-account token is
created. The deployment controller uses existing Kubernetes exec authority for
control and evidence collection.

Startup has three ordered phases:

1. Download the existing pinned Qwen model and verify its exact SHA-256.
   Version 1.10.2 also stages the unchanged MinIO April 22, 2025 binary from its
   official GitHub release, using the architecture-specific SHA-256 and byte length
   in `release/minio-official-artifact.v1.json`. Both amd64 and arm64 binaries match
   the original official image byte-for-byte. The staging containers have no
   credential mounts; Kubernetes pulls their immutable public base images.
   The Object executable occupies a separate bounded 128Mi volume, owned only by
   its service UID and mounted read-only by that service. Its base is pinned Python
   Debian; no MinIO fork, source rebuild or registry mirror is involved. Startup
   fails before network sealing if the download, checksum or architecture is invalid.
   The older standalone bootstrap helper keeps its existing image contract.
2. The network init process installs the combined default-deny nft policy and
   reads back every kernel chain and rule. It removes non-loopback interfaces.
   Linux may retain unconfigured tunnel templates; only the enumerated kernel
   defaults are accepted, DOWN, addressless and without a peer or configured
   endpoint. External interfaces and configured tunnels fail closed. This init
   has only NET_ADMIN, and has no secret mounts.
3. A separate init process copies projected configuration and secrets into each
   service's own memory-backed volume, assigning its exact UID, directory mode
   0700 and file mode 0600. It has only CHOWN and runs after network isolation.
   All services mount only their own completed material, read-only. This phase
   also assigns each fresh service data volume to its owning UID at mode 0700.

Every service runs under a fixed non-root UID with all capabilities dropped,
privilege escalation disabled and a read-only root filesystem. Services cannot
alter the firewall, create external interfaces or change their process identity.
The original selected-reader Envoy configurations remain intact, including
exact native object routes, independent mTLS identities and native User bearer
checks. The full-host composition supplies dedicated issuer/Nous/Lattice/Console
origins and one combined policy. It does not install the old C2 `publicEnvoy` or
standalone `network.nft` alongside them. Native issuer and domain authorization
remain mandatory; reaching an origin is not permission to perform an operation.

Version 1.10.3 gives the Nous and Console public proxies a bounded 200-second
upstream response and stream-idle window. Runtime start/resume calls wait for
their result, so the verification host's 180-second run budget needs this window
through both proxy hops. Issuer and Lattice keep their 60-second response limits;
all request-body receive deadlines remain 10 seconds. The application must still
enforce its run deadline, cancellation and unknown-outcome reconciliation.

Kernel UID rules transparently send Nous, Lattice and the independent client from
the logical issuer port 9443 to its restricted loopback listener on 19443. That
listener retains the original C2 token/JWKS-only HTTP gate, rejecting reader
bearers, cookies, Origin headers and native object reads. Browser/Console/operator
traffic uses the dedicated browser issuer listener. No request header can select
that path for a host process. This prevents the browser routes from becoming an
alternate selected-reader path; both listeners use the same pinned issuer TLS
identity and unchanged logical issuer URL.

Collector configuration and the explicit telemetry migration are rendered using
the released Meridian `createClickHouseTelemetryPlan` interface and actual
compiled log/span/metric layouts. The Collector has a private queue volume. Only
the Collector can reach its authenticated internal relay on 18180. Nous and the
deployment operator can reach the TLS ClickHouse endpoint on 8443; telemetry
ingestion uses authenticated OTLP on 4317/4318. Neither the entrypoint nor its
network policy substitutes for the renderer's TLS, scope and credential checks.

The same released llama.cpp server arguments are shared with the ordinary local
model provider. Here it binds `https://model.m4.invalid:9843` on loopback and uses
the existing authenticated Chat Completions API, 512-token default completion setting, one
slot, TLS and fixed model digest. Nous and the independent verification client
are the only model callers admitted by the network policy. Model credentials and
CA inputs must be delivered to those clients through their own private volumes.

All durable service data is disposable `emptyDir` state in this bounded local
environment. The owner controller must use the published Meridian schema and
migration interfaces to provision and verify the exact scoped resource bindings.
The model cache is also ephemeral. Neither a declared Job nor its network receipt
establishes native IAM, storage readiness or application acceptance. The entrypoint
always returns `allocation: declared` and `nativeAdmission: false`.

The exact image/configuration/identity/trust/migration inventory requires approval
before allocation. Admission then requires live C2 checks, actual native signed
proofs, storage and service readiness, and genuine application verification.
The controller must destroy its full Pulumi stack on success, failure or signal
and verify all owned resources and private files are gone. The Job's two-hour
deadline and ten-minute TTL bound compute; they do not replace complete teardown
of the namespace, ConfigMaps and Secrets. No production, paid inference or M5.

`npm run test:native-isolation` uses invocation-owned network-none Docker
containers to check the actual Linux UID firewall, custody permissions and all
six pinned Envoy configurations. Its throwaway TLS files and offline reader
fixtures are never deployment trust. This qualification does not start Casdoor,
the model or the application, and does not claim the later Kubernetes/native gate.
