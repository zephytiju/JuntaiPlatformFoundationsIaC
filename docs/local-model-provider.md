# Local model provider

`deployModelProvider` provisions a small OpenAI-compatible model service only for
`development-local`. Other stages require an explicit `ModelProviderBinding` and
allocate no model resources. This is an ordinary authenticated HTTPS provider;
it does not use or relax Nous's credential-free native-loopback acceptance mode.

The deployment owns a namespace, credential Secret, disposable 2 GiB model-cache
PVC, one CPU inference Deployment, and an internal ClusterIP Service. The default
llama.cpp b11118 image and Qwen2.5 0.5B Instruct Q4_K_M model are digest-pinned.
The model is Apache-2.0; llama.cpp is MIT. Public model acquisition runs in an
initialization container and verifies SHA-256 before activation, including on
restart. Inference uses offline mode, a read-only model mount, one slot, 4096
context tokens, a 512-token default completion ceiling, four CPU threads and a
2 GiB memory limit. Server inference is real; this is not a response stub.

By default, Pulumi Random and TLS resources generate the API key, CA and server
certificate automatically. They are retained in encrypted Pulumi state. The CA
lasts 48 hours and server certificate 24 hours; applying IaC renews them near
expiry. An environment may alternatively supply secret credential inputs. Certificate generation must include CA basicConstraints and keyCertSign,
plus serverAuth and DNS SANs for the returned origin. Python's strict TLS checking
must pass. Credentials rotate by changing the input Secret and credential digest
on the pod template, which restarts the server. No existing user credential or
provider account is required. Model TLS keys are never passed to consumers.

The returned binding supplies origin, exact model alias, credential Secret name
and API-key/CA keys. Mount those keys in each authorized consumer and configure
Nous's existing `origin`, `model`, `credentialFile`, and `caFile` fields. The
adapter appends `/v1/chat/completions`; do not append `/v1` to its origin. Other
OpenAI-compatible clients may require a base URL ending in `/v1`. This endpoint
implements the tested Chat Completions subset; embeddings and all other vendor
APIs are not implied.

`deployModelVerificationClient` creates a separate, one-hour local diagnostic pod
with only the API key and public CA projected. It is for consumer connectivity
checks, not an application agent. Core composes these exports from the installed
npm package; it does not implement the Kubernetes resources itself.

Use a fresh owned namespace. Reapplying unchanged inputs should report no changes.
Destroy through the same Pulumi stack; the PVC is disposable and is destroyed too.
Readiness probes establish model loading; actual authenticated generation and
Nous JSON-decision decoding must pass separately. An independent pod must connect
through the service DNS with TLS verification. Missing/wrong credentials, expired
deadlines, restart recovery and cleanup are required verification cases.

This small model supports bounded verification scenarios. Its API compatibility
does not establish general agent quality or full application acceptance. Qualify
larger pinned artifacts if the intended governed scenario exceeds its ability.
