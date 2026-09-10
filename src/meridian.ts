import type { ResolvedRuntimeDistribution } from "./runtime-distribution.js";
import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import { MeridianRuntimeConfig } from "@zephytiju/juntai-platform-constructs";
import {
  ExternalEngine,
  canonicalJson,
  MeridianDeployment,
  defaultValidationPolicy,
  getEngineProfile,
  type EngineBinding,
  type CatalogProviderV1,
  type MeridianResourceRequirementV1,
  type OperationRequirementV1,
  type SchemaProviderV1,
} from "@zephytiju/meridian-storage-constructs";
import { adoptionOptions, childMigration } from "./adoption.js";
import { sha256 } from "./artifacts.js";
import {
  peerOwnedReferenceEngines,
  peerRuntimeRequirements,
  type FoundationPeer,
} from "./peer-runtimes.js";
import {
  composeDomainRequirements,
  validateDomainRequirements,
} from "./domain-requirements.js";
import { validateDomainRuntimeSelections } from "./validation.js";
import type {
  AdoptionMap,
  DomainMeridianRuntimeOutput,
  MeridianEngineSelection,
  MeridianInputs,
  MeridianRuntimeOutput,
  MeridianRuntimeDistributionOutput,
  OwnedReferenceRuntimeInput,
} from "./types.js";

const ACCOUNT_PROVIDER = Object.freeze({
  id: "platform-account",
  package: "juntai-account-service",
  contract: "1.0.0",
  version: "2.1.5",
  requiredFingerprint:
    "sha256:6483e0a226a28a3521136d7099162509274bbc93db9a6106f04e65ca44a69d4b",
});
const CATALOG_FINGERPRINTS = Object.freeze({
  structured:
    "sha256:6b8ebb70ee1a8467a96d668878a8eebf826c1c4b63b3832ae70f2c630a8ef4a1",
  object:
    "sha256:62d838ab872a933d5c9f51b30de7389786400f49ed9f006b0cbab07fb67fce36",
  cache:
    "sha256:282136e4be38ae6343bcdb240939e5f036e9edc3d3a7459a73b4d3ef33be4ba5",
  evidence:
    "sha256:0752cbb1cac2b72e9a041a455bdf80a33c26eea1643526ac45c12d15f7210a3e",
  streaming:
    "sha256:8fa802d1f4d69082b1bb2643856f82db9159ebe92fcd819aa529c143cd8d51eb",
} as const);

// Public Catalog manifests for the selected legacy package inventory.
// These are distinct from Core's placeholder Catalog contracts used by legacy inputs.
const DOMAIN_CATALOGS = Object.freeze([
  {
    name: "structured",
    package: "meridian-storage-semantics",
    contract: "1.0.0",
    requiredFingerprint:
      "sha256:f4861315e02054fdc7c78eb62cf2f6f0150af5e67d7ef008fbeb2459d5cc0d87",
  },
  {
    name: "evidence",
    package: "meridian-storage-evidence",
    contract: "1.0.0",
    requiredFingerprint:
      "sha256:20a4c630f47a9c40377d3a6009e5df1e8f407c8fa14b75ae449d0e37f496acb0",
  },
] as const);
// Native public Object Catalog from meridian-storage-object-common 1.0.1.
const DOMAIN_OBJECT_CATALOG = Object.freeze({
  name: "object" as const,
  package: "meridian-storage-object-common",
  contract: "1.0.0",
  requiredFingerprint:
    "sha256:e6696e6944768e9a42acffa331d91c75fe7222ae331bfbda3640a4a4fe024b1b",
});
const DOMAIN_EVIDENCE_PROVIDER = Object.freeze({
  id: "meridian.evidence",
  package: "meridian-storage-evidence",
  contract: "1.0.0",
  requiredFingerprint:
    "sha256:69abbca1a2fdb18941920f09b2ac0ae4a00f2d18d799ba9b4c62969ad044a14b",
});

// Native public provider pins for the durable 2.0.0 package inventory.
const DURABLE_CATALOGS = Object.freeze([
  {
    name: "structured",
    package: "meridian-storage-semantics",
    contract: "1.0.0",
    requiredFingerprint:
      "sha256:8de756277ed7eadc552b3e9cb4314d71a104e335ab8bfed066f9719c056f7efa",
  },
  {
    name: "evidence",
    package: "meridian-storage-evidence",
    contract: "1.0.0",
    requiredFingerprint:
      "sha256:2c144cf5b1e33055dd39bb51f6e44fb7481ebf3643f8ada7899136556a7e2cd5",
  },
] as const);
const DURABLE_EVIDENCE_PROVIDER = Object.freeze({
  id: "meridian.evidence",
  package: "meridian-storage-evidence",
  contract: "1.0.0",
  requiredFingerprint:
    "sha256:e633005121632f4add17c4607667f5106ee1888e0c4fa7cba42575adaf701295",
});
const METADATA_PROVIDER = Object.freeze({
  id: "meridian.semantics",
  package: "meridian-storage-semantics",
  contract: "1.0.0",
  version: "2.1.0",
  requiredFingerprint:
    "sha256:1579517f378f4ceaec3ee78de6f14f705b73320737384f14c720aa4c0edf0366",
});
const METADATA_RESOURCE: MeridianResourceRequirementV1 = Object.freeze({
  selector: {
    catalog: "structured" as const,
    namespace: "meridian",
    name: "registry",
  },
  schemas: [
    {
      providerId: METADATA_PROVIDER.id,
      package: METADATA_PROVIDER.package,
      version: METADATA_PROVIDER.version,
      resourceFingerprint:
        "sha256:b02229d273a6c5439da926c7be897dbcc2545bb1778d72f124cb0b8528487b39",
    },
  ],
  operations: [
    { contract: "meridian.structured.publish_schema", version: "1.0.0" },
  ],
  guarantees: { required: [] },
  limits: { values: {} },
  dataClass: "internal",
});

interface ProviderPin {
  readonly id: string;
  readonly package: string;
  readonly contract: string;
  readonly version: string;
  readonly requiredFingerprint: string;
}

const accountStructuredOperation = (
  method: string,
): OperationRequirementV1 => ({
  contract: `meridian.structured.${method}`,
  version: "1.0.0",
  guarantees: [
    "bound-parameters",
    "scope-injected",
    "single-binding",
    "strong-consistency",
    ...(["delete", "patch", "put"].includes(method)
      ? ["conditional-mutation", "read-committed"]
      : []),
  ],
});

const accountTransactionOperation: OperationRequirementV1 = Object.freeze({
  contract: "meridian.transaction",
  version: "1.0.0",
  guarantees: ["atomic", "no-dirty-reads", "read-committed"],
});

function resourceRequirement(args: {
  readonly catalog: "structured" | "object";
  readonly namespace: string;
  readonly name: string;
  readonly provider: ProviderPin;
  readonly operations: readonly OperationRequirementV1[];
}): MeridianResourceRequirementV1 {
  return {
    selector: {
      catalog: args.catalog,
      namespace: args.namespace,
      name: args.name,
    },
    schemas: [
      {
        providerId: args.provider.id,
        package: args.provider.package,
        version: args.provider.version,
        fingerprint: args.provider.requiredFingerprint,
      },
    ],
    operations: args.operations,
    guarantees: { required: [] },
    limits: { values: {} },
    dataClass: "internal",
    labels: { owner: args.provider.id },
  };
}

const accountResources = Object.freeze([
  ...(
    [
      ["accounts", ["get", "put", "patch", "query"]],
      ["profiles", ["get", "put", "patch", "query"]],
      ["integration-bindings", ["get", "put", "query"]],
      ["mutation-receipts", ["get", "put"]],
      ["mutation-outbox", ["get", "put", "patch", "query"]],
    ] as const
  ).map(([name, methods]) =>
    resourceRequirement({
      catalog: "structured",
      namespace: "platform.account",
      name,
      provider: ACCOUNT_PROVIDER,
      operations: [
        ...methods.map(accountStructuredOperation),
        accountTransactionOperation,
      ],
    }),
  ),
  {
    selector: {
      catalog: "evidence",
      namespace: "platform.account",
      name: "audit",
    },
    schemas: [
      {
        providerId: ACCOUNT_PROVIDER.id,
        package: ACCOUNT_PROVIDER.package,
        version: ACCOUNT_PROVIDER.version,
        fingerprint: ACCOUNT_PROVIDER.requiredFingerprint,
      },
    ],
    operations: [
      {
        contract: "meridian.evidence.append",
        version: "1.0.0",
        guarantees: [
          "append-only",
          "bound-parameters",
          "read-committed",
          "scope-injected",
          "transactional-with-structured",
        ],
      },
      {
        contract: "meridian.evidence.query",
        version: "1.0.0",
        guarantees: [
          "bound-parameters",
          "scope-injected",
          "strong-consistency",
        ],
      },
    ],
    guarantees: { required: [] },
    limits: { values: {} },
    dataClass: "internal",
    labels: { owner: ACCOUNT_PROVIDER.id },
  } satisfies MeridianResourceRequirementV1,
]);

function externalEngine(
  selection: MeridianEngineSelection,
  adoption?: AdoptionMap,
  domainId?: string,
  distribution?: ResolvedRuntimeDistribution,
  compatibilityPins?: Readonly<Record<string, string>>,
): EngineBinding {
  const profile = getEngineProfile(selection.profileId);
  if (!profile.allowedModes.includes("external")) {
    throw new Error(
      `Meridian profile '${selection.profileId}' is not released for external deployment`,
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(selection.requiredCapabilityFingerprint)) {
    throw new Error(
      `Meridian Engine '${selection.bindingId}' requires an exact Adapter capability fingerprint`,
    );
  }
  if (selection.requiredCapabilityFingerprint === profile.profileFingerprint) {
    throw new Error(
      `Meridian Engine '${selection.bindingId}' must use an Adapter capability fingerprint, not an IaC profile fingerprint`,
    );
  }
  return new ExternalEngine(
    `meridian-${domainId === undefined ? "" : domainId + "-"}${selection.bindingId}`,
    {
      binding: {
        bindingId: selection.bindingId,
        profileId: selection.profileId,
        requiredCapabilityFingerprint: selection.requiredCapabilityFingerprint,
        ...(selection.capabilityManifest === undefined
          ? {}
          : { capabilityManifest: selection.capabilityManifest }),
        topology: selection.topology ?? profile.defaultTopology,
        engineVersion: selection.engineVersion ?? profile.defaultEngineVersion,
        compatibilityPins:
          compatibilityPins ??
          (distribution === undefined
            ? profile.compatibilityPins
            : Object.fromEntries(
                distribution.descriptor.packages.map(({ name, version }) => [
                  name,
                  version,
                ]),
              )),
        acl: selection.acl,
        migration: selection.migration,
        observability: selection.observability,
        recovery: selection.recovery,
      },
      connection: {
        physicalNamespace: selection.physicalNamespace,
        identityRef: selection.identityRef,
        secretRef: selection.secretRef,
        tls: {
          mode: selection.tls.mode,
          ...(selection.tls.serverName === null
            ? {}
            : { serverName: selection.tls.serverName }),
          ...(selection.tls.caRef === null
            ? {}
            : { caRef: selection.tls.caRef }),
          ...(selection.tls.clientCertificateRef === null
            ? {}
            : { clientCertificateRef: selection.tls.clientCertificateRef }),
        },
        endpoint: selection.endpoint,
        serviceRef: selection.serviceRef,
        requiredPhysicalFingerprint: selection.requiredPhysicalFingerprint,
        settings: selection.settings ?? {},
        extensions: {},
      },
    },
    {
      ...(adoption?.[`meridian/engine/${selection.bindingId}`]?.aliases ===
      undefined
        ? {}
        : {
            aliases: [
              ...adoption[`meridian/engine/${selection.bindingId}`]!.aliases!,
            ],
          }),
      protect:
        adoption?.[`meridian/engine/${selection.bindingId}`]?.protect ?? true,
    },
  );
}

function schemaProvider(provider: ProviderPin): SchemaProviderV1 {
  return {
    id: provider.id,
    package: provider.package,
    contract: provider.contract,
    requiredFingerprint: provider.requiredFingerprint,
  };
}

function createDeployment(args: {
  readonly name: string;
  readonly schemaProviders: readonly ProviderPin[];
  readonly resources: readonly MeridianResourceRequirementV1[];
  readonly engines: readonly EngineBinding[];
  readonly catalogs?: readonly CatalogProviderV1[];
  readonly evidenceProvider?: SchemaProviderV1;
  readonly metadataBindingId?: string;
  readonly adoption?: AdoptionMap;
  readonly adoptionKey?: string;
  readonly dependsOn?: readonly pulumi.Resource[];
  readonly domain?: {
    readonly ownerPackage: string;
    readonly resourceNamespace: string;
    readonly resourceStoreDependencies?: readonly {
      readonly storeId: string;
    }[];
  };
}): MeridianDeployment {
  const accountResourceSelectors = args.resources
    .filter(({ selector }) => selector.namespace === "platform.account")
    .map(({ selector }) => selector);
  const structuredResources = args.resources
    .filter(
      ({ selector }) =>
        selector.catalog === "structured" &&
        selector.namespace !== "platform.account" &&
        !(
          args.metadataBindingId !== undefined &&
          selector.namespace === "meridian" &&
          selector.name === "registry"
        ),
    )
    .map(({ selector }) => selector);
  const domainEvidenceResources = args.resources
    .filter(
      ({ selector }) =>
        selector.catalog === "evidence" &&
        selector.namespace !== "platform.account",
    )
    .map(({ selector }) => selector);
  const objectResources = args.resources
    .filter(({ selector }) => selector.catalog === "object")
    .map(({ selector }) => selector);
  const deploymentAdoption =
    args.adoptionKey === undefined
      ? undefined
      : args.adoption?.[args.adoptionKey];
  return new MeridianDeployment(
    args.name,
    {
      profile: "juntai-foundations/open-source-selected/v1",
      catalogs:
        args.catalogs ??
        (args.domain
          ? DOMAIN_CATALOGS
          : (
              [
                "structured",
                "object",
                "cache",
                "evidence",
                "streaming",
              ] as const
            ).map((name) => ({
              name,
              package: "meridian-storage-core",
              contract: "1.0.0",
              requiredFingerprint: CATALOG_FINGERPRINTS[name],
            }))),
      schemaProviders: [
        ...(args.domain
          ? [args.evidenceProvider ?? DOMAIN_EVIDENCE_PROVIDER]
          : []),
        ...args.schemaProviders.map(schemaProvider),
      ],
      resources: args.resources,
      engines: args.engines,
      placements: [
        ...(args.metadataBindingId === undefined
          ? []
          : [
              {
                id: `${args.name}-metadata`,
                selector: {
                  resources: [METADATA_RESOURCE.selector],
                  catalog: null,
                  labels: {},
                },
                bindingId: args.metadataBindingId,
                extensions: {},
              },
            ]),
        ...(accountResourceSelectors.length === 0
          ? []
          : [
              {
                id: `${args.name}-account`,
                selector: {
                  resources: accountResourceSelectors,
                  catalog: null,
                  labels: {},
                },
                bindingId: "structured",
                extensions: {
                  coLocationGroup: "platform.account.profile-mutation.v1",
                },
              },
            ]),
        ...(structuredResources.length === 0 &&
        domainEvidenceResources.length === 0
          ? []
          : [
              {
                id: `${args.name}-structured`,
                selector: {
                  resources: [
                    ...structuredResources,
                    ...domainEvidenceResources,
                  ],
                  catalog: null,
                  labels: {},
                },
                bindingId: "structured",
                extensions:
                  args.domain === undefined
                    ? {}
                    : {
                        coLocationGroup: `${args.domain.resourceNamespace}.transaction.v1`,
                      },
              },
            ]),
        ...(objectResources.length === 0
          ? []
          : [
              {
                id: `${args.name}-object`,
                selector: {
                  resources: objectResources,
                  catalog: null,
                  labels: {},
                },
                bindingId: "object",
                extensions: {},
              },
            ]),
      ],
      validation: defaultValidationPolicy,
      telemetry: {
        enabled: false,
        serviceName: null,
        suppressExporterRecursion: true,
        attributes: {},
        extensions: {},
      },
      extensions: {
        ownerPackage: "juntai.platform.substrate",
        ...(args.domain === undefined
          ? {}
          : { logicalOwnerPackage: args.domain.ownerPackage }),
        ...(args.domain?.resourceStoreDependencies?.length
          ? {
              sharedResourceStores: args.domain.resourceStoreDependencies.map(
                ({ storeId }) => ({
                  id: storeId,
                  ownerPackage: "juntai.platform.substrate",
                }),
              ),
            }
          : {}),
        engineAuthority: "@zephytiju/meridian-storage-constructs@1.6.1",
      },
    },
    {
      dependsOn: args.dependsOn === undefined ? undefined : [...args.dependsOn],
      protect: deploymentAdoption?.protect ?? true,
      ...(deploymentAdoption?.aliases === undefined
        ? {}
        : { aliases: [...deploymentAdoption.aliases] }),
    },
  );
}

export function createMeridianRuntime(args: {
  readonly distribution: ResolvedRuntimeDistribution;
  readonly domainDistributions?: Readonly<
    Record<string, ResolvedRuntimeDistribution>
  >;
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly peerNamespace?: pulumi.Input<string>;
  readonly inputs: MeridianInputs;
  readonly adoption?: AdoptionMap;
  readonly dependsOn?: readonly pulumi.Resource[];
}): {
  readonly deployment: MeridianDeployment;
  readonly applicationMetadataDeployment: MeridianDeployment;
  readonly blueprintDeployment: MeridianDeployment;
  readonly runtime: MeridianRuntimeConfig;
  readonly applicationMetadataRuntime: MeridianRuntimeConfig;
  readonly blueprintRuntime: MeridianRuntimeConfig;
  readonly peerOwnedReferenceInputs: Readonly<
    Partial<Record<FoundationPeer, OwnedReferenceRuntimeInput>>
  >;
  readonly peerOwnedReferenceConfigMaps: Readonly<
    Partial<Record<FoundationPeer, k8s.core.v1.ConfigMap>>
  >;
  readonly output: MeridianRuntimeOutput;
} {
  validateDomainRequirements(
    args.inputs.domains,
    args.inputs.sharedResourceStores,
  );
  validateDomainRuntimeSelections(args.inputs);
  if (args.inputs.engines.length === 0) {
    throw new Error(
      "Foundations requires at least one Meridian Engine selection",
    );
  }
  if (/\b(?:kes|kingbase)\b/i.test(JSON.stringify(args.inputs))) {
    throw new Error("Foundations data engines must not expose KES or Kingbase");
  }
  const ids = args.inputs.engines.map((engine) => engine.bindingId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Meridian Engine binding IDs must be unique");
  }
  const structured = args.inputs.engines.find(
    (engine) => engine.bindingId === "structured",
  );
  const object = args.inputs.engines.find(
    (engine) => engine.bindingId === "object",
  );
  if (structured === undefined || object === undefined) {
    throw new Error(
      "Foundations requires Meridian structured and object bindings for the approved services",
    );
  }
  const structuredCatalogs = getEngineProfile(structured.profileId).catalogs;
  if (
    !structuredCatalogs.includes("structured") ||
    !structuredCatalogs.includes("evidence")
  ) {
    throw new Error(
      "the Meridian 'structured' binding must select a released structured and evidence profile",
    );
  }
  if (!getEngineProfile(object.profileId).catalogs.includes("object")) {
    throw new Error(
      "the Meridian 'object' binding must select a released object profile",
    );
  }
  const engines = args.inputs.engines.map((engine) =>
    externalEngine(engine, args.adoption, undefined, args.distribution),
  );
  const projectDistribution = (
    distribution: ResolvedRuntimeDistribution,
    domainId?: string,
  ): MeridianRuntimeDistributionOutput => {
    const config = new k8s.core.v1.ConfigMap(
      domainId === undefined
        ? "foundations-meridian-distribution"
        : `foundations-meridian-${domainId}-distribution`,
      {
        metadata: {
          name: `juntai-meridian-${domainId === undefined ? "" : domainId + "-"}distribution-${distribution.selection.digest.slice(7, 19)}`,
          namespace: args.namespace,
        },
        immutable: true,
        data: { "runtime-distribution.v1.json": distribution.text },
      },
      {
        provider: args.provider,
        ...(domainId === undefined
          ? adoptionOptions(args.adoption, "meridian/runtime-distribution")
          : {}),
        dependsOn:
          args.dependsOn === undefined ? undefined : [...args.dependsOn],
      },
    );
    return Object.freeze({
      selection: distribution.selection,
      descriptor: distribution.descriptor,
      configMapName: config.metadata.name,
      namespace: config.metadata.namespace,
      key: "runtime-distribution.v1.json" as const,
      mountPath: "/etc/juntai/meridian-distribution" as const,
      descriptorDigest: distribution.selection.digest,
    });
  };
  const defaultDistribution = projectDistribution(args.distribution);
  const deployment = createDeployment({
    name: "foundations-meridian",
    schemaProviders: [ACCOUNT_PROVIDER],
    resources: accountResources,
    engines,
    adoption: args.adoption,
    adoptionKey: "meridian/deployment",
    dependsOn: args.dependsOn,
  });
  const peerDeployment = (peer: FoundationPeer) => {
    const requirements = peerRuntimeRequirements(peer);
    return createDeployment({
      name: `foundations-meridian-${peer}`,
      ...requirements,
      engines: (
        args.inputs.peerRuntimeSelections?.[peer]?.engines ??
        args.inputs.engines
      ).map((engine) =>
        externalEngine(
          engine,
          undefined,
          peer,
          undefined,
          requirements.compatibilityPins,
        ),
      ),
      adoption: args.adoption,
      dependsOn: args.dependsOn,
    });
  };
  const applicationMetadataDeployment = peerDeployment("application-metadata");
  const blueprintDeployment = peerDeployment("blueprint");
  const runtime = new MeridianRuntimeConfig("foundations-meridian", {
    namespace: args.namespace,
    provider: args.provider,
    deployment,
    configMapName: "juntai-meridian-config",
    mountPath: "/etc/juntai/meridian",
    environmentVariable: "MERIDIAN_CONFIG",
    resourceMigration: childMigration(args.adoption, "meridian/runtime-config"),
  });
  const applicationMetadataRuntime = new MeridianRuntimeConfig(
    "foundations-meridian-application-metadata",
    {
      namespace: args.namespace,
      provider: args.provider,
      deployment: applicationMetadataDeployment,
      configMapName: "juntai-meridian-application-metadata-config",
      mountPath: "/etc/juntai/meridian",
      environmentVariable: "MERIDIAN_CONFIG",
      resourceMigration: childMigration(
        args.adoption,
        "meridian/application-metadata-runtime-config",
      ),
    },
  );
  const blueprintRuntime = new MeridianRuntimeConfig(
    "foundations-meridian-blueprint",
    {
      namespace: args.namespace,
      provider: args.provider,
      deployment: blueprintDeployment,
      configMapName: "juntai-meridian-blueprint-config",
      mountPath: "/etc/juntai/meridian",
      environmentVariable: "MERIDIAN_CONFIG",
      resourceMigration: childMigration(
        args.adoption,
        "meridian/blueprint-runtime-config",
      ),
    },
  );
  const peerOwnedReferenceInputs: Partial<
    Record<FoundationPeer, OwnedReferenceRuntimeInput>
  > = {};
  const peerOwnedReferenceConfigMaps: Partial<
    Record<FoundationPeer, k8s.core.v1.ConfigMap>
  > = {};
  for (const peer of ["application-metadata", "blueprint"] as const) {
    const selection =
      args.inputs.peerRuntimeSelections?.[peer]?.ownedReferences;
    if (selection === undefined) continue;
    const store = args.inputs.sharedResourceStores?.find(
      ({ id }) => id === selection.storeId,
    );
    if (store === undefined)
      throw new Error(
        `missing peer owned-reference store '${selection.storeId}'`,
      );
    const requirements = peerRuntimeRequirements(peer, true);
    const ownedDeployment = createDeployment({
      name: `foundations-meridian-${peer}-owned-references`,
      ...requirements,
      engines: peerOwnedReferenceEngines(peer, store, selection.engines).map(
        (engine) =>
          externalEngine(
            engine,
            undefined,
            `${peer}-owned-references`,
            undefined,
            requirements.compatibilityPins,
          ),
      ),
      dependsOn: args.dependsOn,
    });
    const configMapName = `juntai-meridian-${peer}-owned-references-config`;
    const ownedRuntime = new MeridianRuntimeConfig(
      `foundations-meridian-${peer}-owned-references`,
      {
        namespace: args.peerNamespace ?? args.namespace,
        provider: args.provider,
        deployment: ownedDeployment,
        configMapName,
        mountPath: "/etc/juntai/owned-references",
        environmentVariable:
          peer === "blueprint"
            ? "BLUEPRINT_OWNED_REFERENCE_MERIDIAN_CONFIG"
            : "APPLICATION_METADATA_OWNED_REFERENCE_MERIDIAN_CONFIG",
      },
    );
    peerOwnedReferenceInputs[peer] = {
      configuration: {
        name: configMapName,
        mountPath: "/etc/juntai/owned-references",
        items: { "meridian-config.v1.json": "meridian-config.v1.json" },
      },
      runtimeReferences: selection.runtimeReferences,
    };
    peerOwnedReferenceConfigMaps[peer] = ownedRuntime.configMap;
  }
  const domainRuntimes: Record<string, DomainMeridianRuntimeOutput> = {};
  for (const domain of [...(args.inputs.domains ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (
      args.inputs.domainRuntimeSelections?.[domain.id] !== undefined &&
      args.domainDistributions?.[domain.id] === undefined
    ) {
      throw new Error(
        `domain '${domain.id}' runtime distribution was not resolved by preflight`,
      );
    }
    const selectedDistribution =
      args.domainDistributions?.[domain.id] ?? args.distribution;
    const domainDistribution =
      selectedDistribution.selection.digest ===
      args.distribution.selection.digest
        ? defaultDistribution
        : projectDistribution(selectedDistribution, domain.id);
    const selection = args.inputs.domainRuntimeSelections?.[domain.id];
    const durable =
      selectedDistribution.descriptor.profileId ===
      "postgresql-postgis-s3-durable-schema-registry";
    if (durable) {
      const packages = new Map(
        selectedDistribution.descriptor.packages.map(({ name, version }) => [
          name,
          version,
        ]),
      );
      if (
        packages.get("meridian-storage-semantics") !== "2.1.0" ||
        packages.get("meridian-storage-evidence") !== "1.0.2"
      ) {
        throw new Error(
          "selected durable runtime does not match the released Catalog and Schema provider pins",
        );
      }
    }
    if (selection?.metadataBindingId !== undefined && !durable) {
      throw new Error(
        "metadata registry requires the explicitly selected durable runtime profile",
      );
    }
    if (
      selection !== undefined &&
      !selection.engines.some(({ bindingId }) => bindingId === "structured")
    ) {
      throw new Error(
        `domain '${domain.id}' requires its own structured Engine selection`,
      );
    }
    if (
      selection?.metadataBindingId !== undefined &&
      !selection.engines.some(
        ({ bindingId }) => bindingId === selection.metadataBindingId,
      )
    ) {
      throw new Error(`domain '${domain.id}' metadata binding is not selected`);
    }
    const composition = composeDomainRequirements(
      domain,
      args.inputs.sharedResourceStores,
    );
    const needsObject = composition.resources.some(
      ({ selector }) => selector.catalog === "object",
    );
    if (
      needsObject &&
      selection !== undefined &&
      !selection.engines.some(({ bindingId }) => bindingId === "object")
    ) {
      throw new Error(
        `domain '${domain.id}' shared ResourceStore requires a Foundations-selected object binding`,
      );
    }
    const domainEngines =
      selection === undefined
        ? engines.filter(
            ({ bindingId }) =>
              bindingId === "structured" ||
              (needsObject && bindingId === "object"),
          )
        : selection.engines.map((engine) =>
            externalEngine(engine, undefined, domain.id, selectedDistribution),
          );
    const domainDeployment = createDeployment({
      name: `foundations-meridian-${domain.id}`,
      schemaProviders: [
        ...composition.schemaProviders,
        ...(selection?.metadataBindingId === undefined
          ? []
          : [METADATA_PROVIDER]),
      ],
      resources: [
        ...composition.resources,
        ...(selection?.metadataBindingId === undefined
          ? []
          : [METADATA_RESOURCE]),
      ],
      engines: domainEngines,
      catalogs: [
        ...(durable ? DURABLE_CATALOGS : DOMAIN_CATALOGS),
        ...(needsObject ? [DOMAIN_OBJECT_CATALOG] : []),
      ],
      ...(durable
        ? {
            evidenceProvider: DURABLE_EVIDENCE_PROVIDER,
          }
        : {}),
      ...(selection?.metadataBindingId === undefined
        ? {}
        : { metadataBindingId: selection.metadataBindingId }),
      dependsOn: args.dependsOn,
      domain,
    });
    const domainRuntime = new MeridianRuntimeConfig(
      `foundations-meridian-${domain.id}`,
      {
        namespace: args.namespace,
        provider: args.provider,
        deployment: domainDeployment,
        configMapName: `juntai-meridian-${domain.id}-config`,
        mountPath: "/etc/juntai/meridian",
        environmentVariable: "MERIDIAN_CONFIG",
      },
    );
    domainRuntimes[domain.id] = Object.freeze({
      distribution: domainDistribution,
      ...(selection?.metadataBindingId === undefined
        ? {}
        : {
            metadataBindingId: selection.metadataBindingId,
            metadataBindingFingerprint: selection.engines.find(
              ({ bindingId }) => bindingId === selection.metadataBindingId,
            )!.requiredPhysicalFingerprint,
          }),
      runtimeReferences: Object.freeze([
        ...(selection?.runtimeReferences ??
          args.inputs.runtimeReferences ??
          []),
      ]),
      ownerPackage: domain.ownerPackage,
      resourceNamespace: domain.resourceNamespace,
      requirementsFingerprint: sha256(canonicalJson(domain)),
      configFingerprint: domainDeployment.configFingerprint,
      configMapName: domainRuntime.configMap.metadata.name,
      namespace: domainRuntime.configMap.metadata.namespace,
      resourceBindings: domainDeployment.resourceBindings,
    });
  }
  return {
    deployment,
    applicationMetadataDeployment,
    blueprintDeployment,
    runtime,
    applicationMetadataRuntime,
    blueprintRuntime,
    peerOwnedReferenceInputs,
    peerOwnedReferenceConfigMaps,
    output: Object.freeze({
      distribution: defaultDistribution,
      runtimeReferences: Object.freeze([
        ...(args.inputs.runtimeReferences ?? []),
      ]),
      configFingerprint: deployment.configFingerprint,
      configMapName: runtime.configMap.metadata.name,
      namespace: runtime.configMap.metadata.namespace,
      resourceBindings: deployment.resourceBindings,
      domainRuntimes: Object.freeze(domainRuntimes),
    }),
  };
}
