# JuntaiPlatformFoundationsIaC

`JuntaiPlatformFoundationsIaC` is the independently released Pulumi package that owns Juntai shared infrastructure and approved foundation services. Its Core package identity remains `juntai.platform.substrate` for state continuity.

`JuntaiPlatformInfrastructure` is intentionally only the thin infrastructure Core. It selects immutable package versions, supplies provider and target context, validates the dependency graph, invokes each package, preserves state, and aggregates opaque typed outputs. It does not declare or interpret Kubernetes resources, service releases, contracts, routes, data engines, migrations, or recovery operations.

## Owned resources

- Shared namespaces, Gateway API v1.5.1, Envoy Gateway v1.8.3, GatewayClass, and the four platform gateway surfaces.
- OpenTelemetry Collector gateway v0.153.0 with durable queueing, bounded resources, TLS/authorization references, and no inline secret bytes.
- Official unmodified Casdoor 3.125.0, its workload identity, exact public/private routes, public-API bootstrap Job, and idempotent reconciliation schedule. The gated `client_credentials` application is deliberately absent.
- Blueprint 3.0.0, including the package-owned release pin, deployment, identity, route, policy, immutable OpenAPI verification, observability binding, and Meridian runtime reference.
- Deployment-selected data engines only through `@zephytiju/meridian-storage-constructs@1.0.0`. KES and Kingbase are rejected.
- State adoption aliases/imports, protected-by-default resources, and rollback metadata.

No fetched OpenAPI, Protobuf, MCP, CRD, or upstream install document is stored in this repository or release archive. HTTPS release artifacts are fetched and SHA-256 verified during Pulumi execution before resource registration.

## Package contract

The deterministic release asset is `platform-iac-package.v1.tar.gz`. It contains the bundled `dist/runtime/package.mjs`, package descriptor, contribution, construct lock, service releases, adoption inventory, SBOM, provenance, and checksums. Pulumi and Kubernetes providers remain external; reusable constructs are bundled at their reviewed exact versions.

The package requires Core contract `^1.1.0` and provides:

- `juntai.platform.gateway-set@1.0.0`
- `juntai.platform.meridian-runtime@1.0.0`
- `juntai.platform.observability-gateway@1.0.0`
- `juntai.platform.foundation-services@1.0.0`

## Development

```bash
npm ci --ignore-scripts
npm run check
SOURCE_DATE_EPOCH=0 FOUNDATIONS_SOURCE_REVISION=$(git rev-parse HEAD) npm run package:build
```

See [adoption and rollback](docs/adoption-and-rollback.md) and [package ownership](docs/package-ownership.md).
