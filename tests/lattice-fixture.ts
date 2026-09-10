import observation from "./fixtures/lattice-released-contracts.json" with { type: "json" };
import type {
  DomainMeridianRequirements,
  DomainResourceStoreDependency,
  DomainSchemaProviderPin,
  SharedResourceStoreRequirements,
} from "../src/types.js";
import type { MeridianResourceRequirementV1 } from "@zephytiju/meridian-storage-constructs";

export { observation };
type Provider = (typeof observation.providers)[number];

function providerPin(provider: Provider): DomainSchemaProviderPin {
  return {
    id: provider.providerId,
    package: provider.package,
    contract: provider.providerContract,
    version: provider.version,
    requiredFingerprint: provider.providerFingerprint as `sha256:${string}`,
  };
}

function requirements(provider: Provider): MeridianResourceRequirementV1[] {
  const pin = providerPin(provider);
  return provider.resources.map((resource) => ({
    selector: resource.selector as MeridianResourceRequirementV1["selector"],
    schemas: [
      {
        providerId: pin.id,
        package: pin.package,
        version: pin.version,
        resourceFingerprint: resource.fingerprint,
      },
    ],
    operations: resource.operations,
    guarantees: { required: [] },
    limits: { values: {} },
    dataClass: "internal",
  }));
}

export function latticeSharedStore(): SharedResourceStoreRequirements {
  const provider = observation.providers[2]!;
  return {
    id: "configuration-artifact",
    kind: "configuration-artifact",
    provider: providerPin(provider),
    resources: requirements(provider),
  };
}

export function latticeDependency(): DomainResourceStoreDependency {
  const store = latticeSharedStore();
  return {
    storeId: store.id,
    kind: store.kind,
    provider: store.provider,
    resourceFingerprints: observation.providers[2]!.resources.map(
      (resource) => ({
        selector:
          resource.selector as MeridianResourceRequirementV1["selector"],
        requiredFingerprint: resource.fingerprint as `sha256:${string}`,
      }),
    ),
  };
}

export function latticeDomains(): DomainMeridianRequirements[] {
  return observation.providers.slice(0, 2).map((provider) => {
    const resources = requirements(provider);
    const namespace = resources[0]!.selector.namespace;
    const pin = providerPin(provider);
    return {
      id: namespace,
      ownerPackage: "juntai.platform.domain.lattice",
      resourceNamespace: namespace,
      namespaceOwnership: { namespace, provider: pin },
      schemaProviders: [pin],
      resources,
      resourceStoreDependencies: [latticeDependency()],
    };
  });
}
