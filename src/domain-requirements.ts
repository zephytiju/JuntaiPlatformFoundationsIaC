import {
  resourceSelectorKey,
  validateResourceRequirement,
} from "@zephytiju/meridian-storage-constructs";
import type { DomainMeridianRequirements } from "./types.js";

/** Validate the logical ownership boundary before registering any provider resources. */
export function validateDomainRequirements(
  domains: readonly DomainMeridianRequirements[] = [],
): void {
  const ids = new Set<string>();
  const resources = new Set<string>();
  const namespaces = new Map<string, string>();
  for (const domain of domains) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(domain.id) || ids.has(domain.id)) {
      throw new Error(
        "domain Meridian IDs must be unique DNS labels of at most 40 characters",
      );
    }
    ids.add(domain.id);
    if (
      !/^juntai\.platform\.domain\.[a-z][a-z0-9.-]+$/.test(domain.ownerPackage)
    ) {
      throw new Error(
        "domain Meridian requirements need a domain package owner",
      );
    }
    const owner = domain.ownerPackage.slice("juntai.platform.domain.".length);
    if (!domain.resourceNamespace.startsWith(`${owner}.`)) {
      throw new Error(
        "domain Meridian namespace must be beneath its package owner",
      );
    }
    const previous = namespaces.get(domain.resourceNamespace);
    if (previous !== undefined && previous !== domain.ownerPackage) {
      throw new Error("domain Meridian namespace has conflicting owners");
    }
    namespaces.set(domain.resourceNamespace, domain.ownerPackage);
    const extra = Object.keys(domain).filter(
      (key) =>
        ![
          "id",
          "ownerPackage",
          "resourceNamespace",
          "schemaProviders",
          "resources",
        ].includes(key),
    );
    if (extra.length)
      throw new Error(
        "domain Meridian requirements cannot select physical engines or runtime configuration",
      );
    if (domain.resources.length === 0 || domain.schemaProviders.length === 0) {
      throw new Error(
        "domain Meridian requirements need resources and exact schema providers",
      );
    }
    const providers = new Map<
      string,
      DomainMeridianRequirements["schemaProviders"][number]
    >();
    for (const provider of domain.schemaProviders) {
      if (
        providers.has(provider.id) ||
        !/^[a-z][a-z0-9_.-]*$/.test(provider.id) ||
        !/^[a-z][a-z0-9_.-]*$/.test(provider.package) ||
        !/^\d+\.\d+\.\d+$/.test(provider.version) ||
        provider.contract !== "1.0.0" ||
        !/^sha256:[0-9a-f]{64}$/.test(provider.requiredFingerprint)
      ) {
        throw new Error(
          "domain Meridian schema providers must have unique identities and exact release fingerprints",
        );
      }
      providers.set(provider.id, provider);
    }
    for (const resource of domain.resources) {
      validateResourceRequirement(resource);
      if (
        resource.selector.namespace !== domain.resourceNamespace ||
        !["structured", "evidence"].includes(resource.selector.catalog)
      ) {
        throw new Error(
          "domain Meridian resources must be owned structured or evidence resources",
        );
      }
      const key = resourceSelectorKey(resource.selector);
      if (resources.has(key))
        throw new Error(`duplicate domain Meridian resource '${key}'`);
      resources.add(key);
      if (resource.schemas.length === 0)
        throw new Error(
          "domain Meridian resources need exact schema requirements",
        );
      for (const schema of resource.schemas) {
        const provider = providers.get(schema.providerId);
        if (
          provider === undefined ||
          schema.package !== provider.package ||
          schema.version !== provider.version ||
          schema.fingerprint !== provider.requiredFingerprint
        ) {
          throw new Error(
            "domain Meridian resource schema differs from its exact provider pin",
          );
        }
      }
    }
  }
}
