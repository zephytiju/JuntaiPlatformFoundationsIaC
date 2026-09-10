import {
  canonicalJson,
  resourceSelectorKey,
  resourceDefinitionFingerprint,
  validateResourceRequirement,
} from "@zephytiju/meridian-storage-constructs";
import type { MeridianResourceRequirementV1 } from "@zephytiju/meridian-storage-constructs";
import type {
  DomainMeridianRequirements,
  DomainSchemaProviderPin,
  SharedResourceStoreRequirements,
} from "./types.js";

function closed(value: object, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(
      `${label} cannot select physical engines or runtime configuration`,
    );
}

function validateProvider(provider: DomainSchemaProviderPin): void {
  closed(
    provider,
    ["id", "package", "contract", "version", "requiredFingerprint"],
    "schema provider",
  );
  if (
    !/^[a-z][a-z0-9_.-]*$/.test(provider.id) ||
    !/^[a-z][a-z0-9_.-]*$/.test(provider.package) ||
    !/^\d+\.\d+\.\d+$/.test(provider.version) ||
    provider.contract !== "1.0.0" ||
    !/^sha256:[0-9a-f]{64}$/.test(provider.requiredFingerprint)
  )
    throw new Error(
      "domain Meridian schema providers must have unique identities and exact release fingerprints",
    );
}

function validateResource(
  resource: MeridianResourceRequirementV1,
  providers: ReadonlyMap<string, DomainSchemaProviderPin>,
): void {
  validateResourceRequirement(resource);
  if (resource.schemas.length !== 1)
    throw new Error(
      "domain Meridian resources need one exact ResourceDefinition provider pin",
    );
  for (const schema of resource.schemas) {
    const provider = providers.get(schema.providerId);
    if (
      provider === undefined ||
      schema.package !== provider.package ||
      schema.version !== provider.version ||
      resourceDefinitionFingerprint(schema) === provider.requiredFingerprint
    )
      throw new Error(
        "domain Meridian resource needs its own ResourceDefinition fingerprint and matching provider identity",
      );
  }
}

function sharedStores(
  stores: readonly SharedResourceStoreRequirements[],
): ReadonlyMap<string, SharedResourceStoreRequirements> {
  const selected = new Map<string, SharedResourceStoreRequirements>();
  const owned = new Set<string>();
  for (const store of stores) {
    closed(
      store,
      ["id", "kind", "provider", "resources"],
      "shared ResourceStore",
    );
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(store.id) || selected.has(store.id))
      throw new Error("shared ResourceStore IDs must be unique DNS labels");
    validateProvider(store.provider);
    if (
      store.kind !== "configuration-artifact" ||
      store.provider.id !== "meridian.plugin.config-artifact" ||
      store.provider.package !== "meridian-plugin-config-artifact"
    )
      throw new Error(
        "shared ResourceStore must select the released Configuration/Artifact provider",
      );
    const expected = new Set([
      "object:resources.objects",
      "structured:resources.channels",
      "structured:resources.metadata",
      "structured:resources.orphan-candidates",
      "structured:resources.provenance",
    ]);
    for (const resource of store.resources) {
      validateResource(
        resource,
        new Map([[store.provider.id, store.provider]]),
      );
      const key = resourceSelectorKey(resource.selector);
      if (!expected.delete(key) || owned.has(key))
        throw new Error(
          "shared ResourceStore resource ownership collision or unsupported selector",
        );
      owned.add(key);
    }
    if (expected.size)
      throw new Error(
        "shared ResourceStore requires all Configuration/Artifact Resources including object binding",
      );
    selected.set(store.id, store);
  }
  return selected;
}

/** Resolve exact logical dependencies. Physical placement remains in Foundations' composer. */
function resolveDomainRequirements(
  domain: DomainMeridianRequirements,
  stores: readonly SharedResourceStoreRequirements[] = [],
): Pick<DomainMeridianRequirements, "resources" | "schemaProviders"> {
  const selected = sharedStores(stores);
  const seen = new Set<string>();
  const resources = [...domain.resources];
  const providers = [...domain.schemaProviders];
  for (const dependency of domain.resourceStoreDependencies ?? []) {
    closed(
      dependency,
      ["storeId", "kind", "provider", "resourceFingerprints"],
      "ResourceStore dependency",
    );
    validateProvider(dependency.provider);
    const store = selected.get(dependency.storeId);
    if (store === undefined)
      throw new Error(
        `missing shared ResourceStore dependency '${dependency.storeId}'`,
      );
    if (seen.has(dependency.storeId))
      throw new Error("duplicate shared ResourceStore dependency");
    seen.add(dependency.storeId);
    if (
      dependency.kind !== store.kind ||
      canonicalJson(dependency.provider) !== canonicalJson(store.provider)
    )
      throw new Error(
        "shared ResourceStore provider release or bundle fingerprint drift",
      );
    const pins = new Map(
      store.resources.map((resource) => [
        resourceSelectorKey(resource.selector),
        resourceDefinitionFingerprint(resource.schemas[0]!),
      ]),
    );
    for (const pin of dependency.resourceFingerprints) {
      closed(
        pin,
        ["selector", "requiredFingerprint"],
        "ResourceStore Resource pin",
      );
      closed(
        pin.selector,
        ["catalog", "namespace", "name"],
        "ResourceStore selector",
      );
      const key = resourceSelectorKey(pin.selector);
      if (pins.get(key) !== pin.requiredFingerprint || !pins.delete(key))
        throw new Error(
          "shared ResourceStore ResourceDefinition fingerprint drift or duplicate selector",
        );
    }
    if (pins.size)
      throw new Error(
        "shared ResourceStore dependency is missing required Resource fingerprints",
      );
    if (providers.some((provider) => provider.id === store.provider.id))
      throw new Error("shared ResourceStore provider cannot be domain-owned");
    providers.push(store.provider);
    resources.push(...store.resources);
  }
  return { resources, schemaProviders: providers };
}

/** Validate the logical ownership boundary before registering any provider resources. */
export function validateDomainRequirements(
  domains: readonly DomainMeridianRequirements[] = [],
  stores: readonly SharedResourceStoreRequirements[] = [],
): void {
  sharedStores(stores);
  const ids = new Set<string>();
  const resources = new Set<string>();
  const namespaces = new Map<string, { owner: string; release?: string }>();
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
    const ownership = domain.namespaceOwnership;
    if (ownership !== undefined) {
      closed(ownership, ["namespace", "provider"], "namespace ownership");
      validateProvider(ownership.provider);
      if (
        ownership.namespace !== domain.resourceNamespace ||
        !ownership.provider.id.startsWith(`${owner}.`) ||
        !domain.schemaProviders.some(
          (provider) =>
            canonicalJson(provider) === canonicalJson(ownership.provider),
        )
      )
        throw new Error(
          "namespace ownership must match its domain's exact released schema provider",
        );
    } else if (!domain.resourceNamespace.startsWith(`${owner}.`)) {
      throw new Error(
        "domain Meridian namespace must be beneath its package owner or have release-bound ownership",
      );
    }
    if (
      !/^[a-z][a-z0-9.-]*$/.test(domain.resourceNamespace) ||
      /^(?:platform(?:[.-]|$)|meridian(?:[.-]|$)|resources(?:[.-]|$)|application-metadata(?:[.-]|$))/.test(
        domain.resourceNamespace,
      )
    )
      throw new Error(
        "domain Meridian namespace cannot claim Foundations-owned resources",
      );
    const release =
      ownership === undefined ? undefined : canonicalJson(ownership.provider);
    const previous = namespaces.get(domain.resourceNamespace);
    if (
      previous !== undefined &&
      (previous.owner !== domain.ownerPackage || previous.release !== release)
    ) {
      throw new Error(
        "domain Meridian namespace has conflicting owners or releases",
      );
    }
    namespaces.set(domain.resourceNamespace, {
      owner: domain.ownerPackage,
      release,
    });
    closed(
      domain,
      [
        "id",
        "ownerPackage",
        "resourceNamespace",
        "schemaProviders",
        "resources",
        "namespaceOwnership",
        "resourceStoreDependencies",
      ],
      "domain Meridian requirements",
    );
    if (domain.resources.length === 0 || domain.schemaProviders.length === 0) {
      throw new Error(
        "domain Meridian requirements need resources and exact schema providers",
      );
    }
    const providers = new Map<string, DomainSchemaProviderPin>();
    for (const provider of domain.schemaProviders) {
      validateProvider(provider);
      if (providers.has(provider.id))
        throw new Error(
          "domain Meridian schema providers must have unique identities and exact release fingerprints",
        );
      providers.set(provider.id, provider);
    }
    for (const resource of domain.resources) {
      validateResource(resource, providers);
      if (
        ownership !== undefined &&
        resource.schemas.some(
          ({ providerId }) => providerId !== ownership.provider.id,
        )
      ) {
        throw new Error(
          "namespace Resources must use the release-bound owning provider",
        );
      }
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
    }
    resolveDomainRequirements(domain, stores);
  }
}

/** Validate ownership and resolve exact shared declarations through the public logical boundary. */
export function composeDomainRequirements(
  domain: DomainMeridianRequirements,
  stores: readonly SharedResourceStoreRequirements[] = [],
): Pick<DomainMeridianRequirements, "resources" | "schemaProviders"> {
  validateDomainRequirements([domain], stores);
  return resolveDomainRequirements(domain, stores);
}
