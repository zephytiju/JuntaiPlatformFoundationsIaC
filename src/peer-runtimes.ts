import contracts from "./peer-runtime-contracts.json" with { type: "json" };
import {
  canonicalJson,
  resourceDefinitionFingerprint,
  resourceSelectorKey,
  type CatalogProviderV1,
  type JsonObject,
  type MeridianResourceRequirementV1,
  type ResourceSelectorV1,
} from "@zephytiju/meridian-storage-constructs";
import { sha256 } from "./artifacts.js";
import type {
  DomainSchemaProviderPin,
  MeridianEngineSelection,
  SharedResourceStoreRequirements,
} from "./types.js";

export type FoundationPeer = "application-metadata" | "blueprint";

interface Resource {
  readonly definition: JsonObject & {
    readonly ref: ResourceSelectorV1;
    readonly profile: string;
    readonly requirements: readonly {
      readonly operationContract: string;
      readonly operationVersion: string;
      readonly guarantees: readonly string[];
      readonly minimumLimits: Readonly<Record<string, number>>;
    }[];
  };
  readonly fingerprint: string;
  readonly schemaFingerprint: string | null;
}
interface Provider {
  readonly pin: DomainSchemaProviderPin;
  readonly resources: readonly Resource[];
}
interface PeerContract {
  readonly package: string;
  readonly version: string;
  readonly packages: Readonly<Record<string, string>>;
  readonly providers: readonly Provider[];
  readonly catalogs: readonly CatalogProviderV1[];
}

function selected(peer: FoundationPeer): PeerContract {
  const contract = structuredClone(
    contracts.peers[peer],
  ) as unknown as PeerContract;
  for (const provider of contract.providers) {
    for (const resource of provider.resources) {
      if (sha256(canonicalJson(resource.definition)) !== resource.fingerprint)
        throw new Error("released peer ResourceDefinition fingerprint drift");
    }
  }
  return contract;
}

function requirements(
  providers: readonly Provider[],
): MeridianResourceRequirementV1[] {
  return providers.flatMap(({ pin, resources }) =>
    resources.map((resource) => ({
      selector: resource.definition.ref,
      schemas: [
        {
          providerId: pin.id,
          package: pin.package,
          version: pin.version,
          resourceFingerprint: resource.fingerprint,
        },
      ],
      operations: resource.definition.requirements.map((requirement) => ({
        contract: requirement.operationContract,
        version: requirement.operationVersion,
        guarantees: requirement.guarantees,
        limits: requirement.minimumLimits,
      })),
      guarantees: { required: [] },
      limits: { values: {} },
      dataClass: "internal",
    })),
  );
}

/** Exact logical contracts observed from the selected, normally installed peer releases. */
export function peerRuntimeRequirements(
  peer: FoundationPeer,
  ownedReferences = false,
) {
  const contract = selected(peer);
  const providers = ownedReferences
    ? contract.providers.slice(1)
    : contract.providers;
  return {
    schemaProviders: providers.map(({ pin }) => ({ ...pin })),
    resources: requirements(providers),
    catalogs: contract.catalogs.filter(
      ({ name }) => !ownedReferences || name !== "evidence",
    ),
    compatibilityPins: { ...contract.packages },
  };
}

/** Keep producer ownership and exact physical pins while selecting the released reader ABI. */
export function peerOwnedReferenceEngines(
  peer: FoundationPeer,
  store: SharedResourceStoreRequirements,
  engines: readonly MeridianEngineSelection[],
): readonly MeridianEngineSelection[] {
  const ids = engines.map(({ bindingId }) => bindingId);
  if (
    ids.length !== 2 ||
    !ids.includes("structured") ||
    !ids.includes("object") ||
    engines.some(
      (engine) =>
        !/^sha256:[a-f0-9]{64}$/.test(engine.requiredPhysicalFingerprint),
    )
  )
    throw new Error(
      "peer owned-reference bindings require exact structured/object physical pins",
    );
  const stored = selected("application-metadata").providers[1]!;
  const reader = selected(peer).providers[1]!;
  if (
    store.kind !== "configuration-artifact" ||
    canonicalJson(store.provider) !== canonicalJson(stored.pin)
  )
    throw new Error(
      "peer owned-reference store must select the exact released producer provider",
    );
  const pins = new Map(
    store.resources.map((resource) => [
      resourceSelectorKey(resource.selector),
      resourceDefinitionFingerprint(resource.schemas[0]!),
    ]),
  );
  if (
    pins.size !== stored.resources.length ||
    store.resources.length !== pins.size ||
    stored.resources.some(
      (resource) =>
        pins.get(resourceSelectorKey(resource.definition.ref)) !==
        resource.fingerprint,
    )
  )
    throw new Error(
      "peer owned-reference producer Resource fingerprints differ",
    );
  const required = new Map(
    stored.resources
      .filter((resource) => resource.definition.ref.catalog === "structured")
      .map((resource) => [
        resourceSelectorKey(resource.definition.ref),
        resource,
      ]),
  );
  return engines.map((engine) => {
    if (engine.bindingId !== "structured") return engine;
    const settings = engine.settings;
    if (
      settings?.formatVersion !== "meridian.postgresql.settings.v1" ||
      !Array.isArray(settings.resources)
    )
      throw new Error(
        "peer owned-reference structured binding requires its stored layout",
      );
    const scopeKeys: readonly unknown[] = Array.isArray(settings.scopeKeys)
      ? settings.scopeKeys
      : [];
    if (
      scopeKeys.length !== 2 ||
      !scopeKeys.includes("application") ||
      !scopeKeys.includes("tenant")
    )
      throw new Error(
        "peer owned-reference layout requires exact application and tenant scope",
      );
    if (settings.readCompatibility !== undefined)
      throw new Error(
        "Foundations composes owned-reference compatibility from the producer contract",
      );
    const layouts = new Map<string, JsonObject>();
    for (const item of settings.resources as readonly unknown[]) {
      if (item === null || typeof item !== "object" || Array.isArray(item))
        throw new Error("peer owned-reference layout must be an object");
      const layout = item as JsonObject;
      const key =
        typeof layout.ref === "string"
          ? layout.ref
          : resourceSelectorKey(layout.ref as unknown as ResourceSelectorV1);
      if (layouts.has(key))
        throw new Error("duplicate peer owned-reference physical layout");
      layouts.set(key, layout);
    }
    const resources = [...required].map(([key, resource]) => {
      const layout = layouts.get(key);
      const target = reader.resources.find(
        (candidate) => resourceSelectorKey(candidate.definition.ref) === key,
      )!;
      if (
        layout === undefined ||
        layout.resourceFingerprint !== resource.fingerprint ||
        layout.schemaFingerprint !== resource.schemaFingerprint ||
        layout.profile !== resource.definition.profile ||
        target.schemaFingerprint !== resource.schemaFingerprint
      )
        throw new Error(
          "peer owned-reference stored layout/schema fingerprint differs",
        );
      return { ...layout, resourceFingerprint: target.fingerprint };
    });
    return {
      ...engine,
      settings: {
        ...settings,
        resources,
        ...(peer === "blueprint"
          ? {
              readCompatibility: {
                formatVersion: "meridian.postgresql.read-compatibility.v1",
                resources: [...required].map(([key, resource]) => ({
                  storedResource: resource.definition,
                  readerResource: reader.resources.find(
                    (candidate) =>
                      resourceSelectorKey(candidate.definition.ref) === key,
                  )!.definition,
                })),
              },
            }
          : {}),
      },
    };
  });
}
