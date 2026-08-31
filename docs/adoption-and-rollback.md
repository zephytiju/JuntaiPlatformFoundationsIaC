# Adoption and rollback

All package-managed custom resources default to Pulumi `protect: true`. Existing resources are adopted by passing exact entries in `FoundationsInputs.adoption`, keyed by [the release inventory](../release/adoption-inventory.v1.json). A rule may provide an exact Pulumi import ID, aliases for a prior logical identity, `retainOnDelete`, and an explicit protection override.

The Core v1.9.0 cutover also selects the package-owned `core-v1.9.0-uid-preserving` compatibility profile in the normal opaque Foundations input. Unlike the one-shot `adoption` map, this profile remains selected after import options are removed. It applies `ignoreChanges: ["*"]` only to the exact 37 imported type/logical-name identities in the [compatibility release artifact](../release/legacy-adoption-compatibility.v1.json). This is an explicit ownership-only migration contract: it preserves the reviewed live input shapes, immutable configuration bytes, server-assigned Service identities, Gateway listener list-map keys, and the complete physical UID set through Task 08 verification. Removing the profile is a separate reviewed rollout and must satisfy every gate in that artifact.

## Adoption procedure

1. Pin the exact `@zephytiju/platform-foundations-iac` version in Core's `package.json`, commit the registry-resolved `package-lock.json`, and install it with `npm ci`.
2. Export the current Core state and record the old URNs and provider IDs.
3. Populate aliases and exact import IDs for every existing physical resource. Never use discovery results as implicit selection.
4. Run a refresh-only preview, then a normal preview. Both must report zero deletes and zero replacements.
5. Verify that every Kubernetes resource is protected and that Gateway, Account, Application Metadata, and Blueprint artifacts were fetched from the recorded immutable coordinates.
6. Compare the registered Gateway identities with the [single-owner inventory](../release/gateway-manifest-ownership.v1.json). Preserve the twelve identities in the [Envoy migration mapping](../release/envoy-legacy-migration.v1.json) as unmanaged physical resources through Task 08 verification.
7. Apply only after the reviewed preview matches the adoption inventory. Record the stack update permalink and state checkpoint digest.

## Rollback procedure

Before applying, retain the prior Core selection, registry tarball integrity from `package-lock.json`, state checkpoint, and exported adoption map. To roll back:

1. Stop if a package-owned operation reports an irreversible external data change.
2. Restore the prior exact npm dependency and lockfile without editing or republishing the old release.
3. Restore prior aliases/imports and run refresh-only plus normal preview.
4. Require zero deletes and zero replacements. A replacement is a blocker, not an accepted rollback step.
5. Apply the prior selection and verify Casdoor desired-state convergence; Account, Application Metadata, and Blueprint health; all Gateway routes and the Application Metadata prefix rewrite; OTel export; workload-token projection; and Meridian binding fingerprints.

Account rollback disables its route and workload while retaining all Meridian logical resources. Application Metadata rollback retains the v1 export read-only until target counts, exact-reference resolution, handoff digests, and rejected-record evidence have passed cutover acceptance. Neither rollback deletes or reverses physical data.

If state restoration is required, use the recorded Pulumi checkpoint only after validating stack identity and provider coordinates. Never delete a physical resource to make adoption succeed.
