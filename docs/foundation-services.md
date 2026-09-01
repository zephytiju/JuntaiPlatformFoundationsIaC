# Foundation service deployments

The package deploys exactly the service inventory in `release/service-releases.v1.json`. Every image and release artifact is immutable and digest-pinned. OpenAPI contracts are fetched and verified before any package-owned resource is registered.

| Service              | Release   | Platform route                                                  | Runtime contract                                                                                                                                      | Recovery boundary                                                |
| -------------------- | --------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Casdoor / IAM        | `3.125.0` | `/api/identity` plus reviewed operator and policy-reader routes | Official image and public-API desired-state reconciliation                                                                                            | Re-run bounded reconciliation; data recovery belongs to Meridian |
| Account              | `2.1.4`   | `/api/platform.account/v1`                                      | Platform mounts a reviewed Python module and sets `ACCOUNT_COMPOSITION_FACTORY=module:function`; the service embeds no storage or credentials         | Disable route and workload; retain Meridian-managed data         |
| Application Metadata | `3.0.2`   | `/api/platform/applications/v1`, rewritten to internal `/v1`    | Platform supplies Meridian structured/object bindings, workload bindings, Casdoor settings, projected workload and TokenReview tokens, and cluster CA | Retain the v1 export read-only until cutover acceptance          |
| Blueprint            | `3.0.2`   | `/api/blueprints/v1`                                            | Platform supplies Meridian structured/object bindings and Casdoor policy-reader settings                                                              | Meridian binding owns recovery                                   |

## Required deployment inputs

Account composition is a `ConfigMap` file reference, never inline executable code. `compositionFactory` must use `module:function` syntax. Optional runtime references are opaque `ConfigMap` or `Secret` projections with unique absolute mount paths; no bytes enter Pulumi state.

Application Metadata requires exact Casdoor issuer, audience, enforcer and client identifiers; opaque cursor-HMAC and policy-reader Secret projections; a bounded Kubernetes API CIDR; workload token issuer/audience; and the reviewed service-account-to-tenant/workload bindings. The package creates only the `tokenreviews.create` cluster permission and projects short-lived tokens with a one-hour lifetime.

The deployment-selected Meridian `structured` binding must support both structured and evidence catalogs, and the `object` binding must support config-artifact object storage. The package registers Account's five co-located structured resources and audit evidence boundary, Application Metadata's four target resources plus config-artifact resources, and Blueprint's config-artifact resources. Account's design guarantees are mapped to released adapter primitives: conditional mutation, strong consistency, atomic transactions, transactional evidence append, explicit idempotency receipts, and binding-owned recovery.

## Typed output

`juntai.platform.foundation-services@1.1.0` returns a typed entry per enabled service with its internal endpoint, namespace and Service name, external route and gateway surface, exact release/image identity, readiness path, OpenTelemetry service name, and recovery boundary. Consumers do not inspect Kubernetes resources or service release manifests.
