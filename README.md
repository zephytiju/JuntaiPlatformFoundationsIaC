# JuntaiPlatformFoundationsIaC

`JuntaiPlatformFoundationsIaC` is published to npm as `@zephytiju/platform-foundations-iac`. It owns Juntai shared infrastructure and approved foundation services. Its Core package identity remains `juntai.platform.substrate` for state continuity.

`JuntaiPlatformInfrastructure` is intentionally only the thin infrastructure Core. It selects immutable package versions, supplies provider and target context, validates the dependency graph, invokes each package, preserves state, and aggregates opaque typed outputs. It does not declare or interpret Kubernetes resources, service releases, contracts, routes, data engines, migrations, or recovery operations.

## Owned resources

- Shared namespaces, Gateway API v1.5.1, Envoy Gateway v1.8.3, GatewayClass, and the four platform gateway surfaces.
- OpenTelemetry Collector gateway v0.153.0 with durable queueing, bounded resources, TLS/authorization references, and no inline secret bytes.
- Official unmodified Casdoor 3.125.0, its workload identity, exact public/private routes, public-API bootstrap Job, and idempotent reconciliation schedule. The gated `client_credentials` application is deliberately absent.
- Blueprint 3.0.0, including the package-owned release and deployment declarations, identity, route, policy, immutable OpenAPI composition, observability binding, and Meridian runtime reference.
- Deployment-selected data engines only through `@zephytiju/meridian-storage-constructs@1.0.0`. KES and Kingbase are rejected.
- State adoption aliases/imports, protected-by-default resources, and rollback metadata.

No fetched OpenAPI, Protobuf, MCP, CRD, or upstream install document is stored in this repository or npm tarball. Exact GitHub release and OCI manifest coordinates are fetched, SHA-256 verified, compatibility checked, and composed only in memory during Pulumi execution before resource registration. Local and CI execution use the same coordinates and digests; only environment-provided authentication may differ.

Private GitHub release assets use `JUNTAI_GITHUB_ARTIFACT_TOKEN` (falling back to `GH_TOKEN`). Private OCI layers use `JUNTAI_OCI_ARTIFACT_TOKEN` and may fall back to the GitHub token for GHCR. Credentials select authorization only; they never alter artifact coordinates, digests, composition evidence, or Pulumi inputs.

## npm package contract

`JuntaiPlatformInfrastructure` consumes this package as an exact direct dependency in `package.json` and commits the registry-generated `package-lock.json`. `npm ci` is the only installation path. The npm tarball contains the compiled Pulumi entrypoint, TypeScript declarations, package descriptor, contribution, construct lock, service releases, adoption inventory, and operating guidance. It contains no source checkout loader, GitHub archive downloader, or staging path.

GitHub and OCI coordinates in the package contract are reserved for immutable service artifacts that this package owns and verifies during Pulumi execution. They are not a distribution mechanism for first-party IaC package code.

Install the exact release and commit the resulting lockfile:

```bash
npm install --save-exact @zephytiju/platform-foundations-iac@1.1.0
npm ci
```

The package requires Core contract `^1.1.0` and provides:

- `juntai.platform.gateway-set@1.0.0`
- `juntai.platform.meridian-runtime@1.0.0`
- `juntai.platform.observability-gateway@1.0.0`
- `juntai.platform.foundation-services@1.0.0`

## Development

```bash
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

See [adoption and rollback](docs/adoption-and-rollback.md) and [package ownership](docs/package-ownership.md).
