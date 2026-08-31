# Adoption and rollback

All package-managed custom resources default to Pulumi `protect: true`. Existing resources are adopted by passing exact entries in `FoundationsInputs.adoption`, keyed by [the release inventory](../release/adoption-inventory.v1.json). A rule may provide an exact Pulumi import ID, aliases for a prior logical identity, `retainOnDelete`, and an explicit protection override.

## Adoption procedure

1. Pin the exact `@juntai/platform-foundations-iac` version in Core's `package.json`, commit the registry-resolved `package-lock.json`, and install it with `npm ci`.
2. Export the current Core state and record the old URNs and provider IDs.
3. Populate aliases and exact import IDs for every existing physical resource. Never use discovery results as implicit selection.
4. Run a refresh-only preview, then a normal preview. Both must report zero deletes and zero replacements.
5. Verify that every Kubernetes resource is protected and that Gateway/Blueprint contracts were fetched from the recorded immutable coordinates.
6. Apply only after the reviewed preview matches the adoption inventory. Record the stack update permalink and state checkpoint digest.

## Rollback procedure

Before applying, retain the prior Core selection, registry tarball integrity from `package-lock.json`, state checkpoint, and exported adoption map. To roll back:

1. Stop if a package-owned operation reports an irreversible external data change.
2. Restore the prior exact npm dependency and lockfile without editing or republishing the old release.
3. Restore prior aliases/imports and run refresh-only plus normal preview.
4. Require zero deletes and zero replacements. A replacement is a blocker, not an accepted rollback step.
5. Apply the prior selection and verify Casdoor desired-state convergence, Blueprint health, Gateway routes, OTel export, and Meridian binding fingerprints.

If state restoration is required, use the recorded Pulumi checkpoint only after validating stack identity and provider coordinates. Never delete a physical resource to make adoption succeed.
