import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import { MeridianRuntimeConfig } from "@zephytiju/juntai-platform-constructs";
import {
  ExternalEngine,
  MeridianDeployment,
  defaultValidationPolicy,
  getEngineProfile,
  type EngineBinding,
  type MeridianResourceRequirementV1,
  type OperationRequirementV1,
  type SchemaProviderV1,
} from "@zephytiju/meridian-storage-constructs";
import { childMigration } from "./adoption.js";
import type {
  AdoptionMap,
  MeridianEngineSelection,
  MeridianInputs,
  MeridianRuntimeOutput,
} from "./types.js";

const ACCOUNT_PROVIDER = Object.freeze({
  id: "platform-account",
  package: "juntai-account-service",
  contract: "1.0.0",
  version: "2.1.4",
  requiredFingerprint:
    "sha256:c4a79a209e925a10f0c931c711b3c1a9b443a3bcae4495aea467267af1316673",
});
const APPLICATION_METADATA_PROVIDER = Object.freeze({
  id: "juntai.application-metadata",
  package: "juntai-application-metadata",
  contract: "1.0.0",
  version: "3.0.2",
  requiredFingerprint:
    "sha256:e950b20bbb97d7f5fd44d99a52b56eac77e25a6dcfd552e407562653eb4824c2",
});
const BLUEPRINT_PROVIDER = Object.freeze({
  id: "juntai.blueprint",
  package: "juntai-blueprint-marketplace",
  contract: "1.0.0",
  version: "3.0.2",
  requiredFingerprint:
    "sha256:bcea0a3aa4272c09803ed98d1d9a2a795cd916fb149e6d2c4efa6cfe004e2c49",
});
const CONFIG_ARTIFACT_PROVIDER = Object.freeze({
  id: "meridian.plugin.config-artifact",
  package: "meridian-plugin-config-artifact",
  contract: "1.0.0",
  version: "1.0.2",
  requiredFingerprint:
    "sha256:67ed231448870ac0cdb16aee25b44859ca5ab6bc331d417b5006e8fc2d4189ee",
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

interface ProviderPin {
  readonly id: string;
  readonly package: string;
  readonly contract: string;
  readonly version: string;
  readonly requiredFingerprint: string;
}

const structuredOperation = (method: string): OperationRequirementV1 => ({
  contract: `meridian.structured.${method}`,
  version: "1.0.0",
});

const transactionOperation: OperationRequirementV1 = Object.freeze({
  contract: "meridian.transaction",
  version: "1.0.0",
  guarantees: ["atomic", "no-dirty-reads"],
});

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

const applicationMetadataResources = Object.freeze([
  resourceRequirement({
    catalog: "structured",
    namespace: "application-metadata",
    name: "applications",
    provider: APPLICATION_METADATA_PROVIDER,
    operations: [
      ...["get", "patch", "put", "query"].map(structuredOperation),
      transactionOperation,
    ],
  }),
  resourceRequirement({
    catalog: "structured",
    namespace: "application-metadata",
    name: "contributions",
    provider: APPLICATION_METADATA_PROVIDER,
    operations: [
      ...["delete", "get", "put", "query"].map(structuredOperation),
      transactionOperation,
    ],
  }),
  resourceRequirement({
    catalog: "structured",
    namespace: "application-metadata",
    name: "idempotency",
    provider: APPLICATION_METADATA_PROVIDER,
    operations: [
      ...["delete", "get", "put"].map(structuredOperation),
      transactionOperation,
    ],
  }),
  resourceRequirement({
    catalog: "structured",
    namespace: "application-metadata",
    name: "versions",
    provider: APPLICATION_METADATA_PROVIDER,
    operations: [
      ...["get", "patch", "put", "query"].map(structuredOperation),
      transactionOperation,
    ],
  }),
]);

const configArtifactResources = Object.freeze([
  resourceRequirement({
    catalog: "structured",
    namespace: "resources",
    name: "channels",
    provider: CONFIG_ARTIFACT_PROVIDER,
    operations: [
      ...["get", "put", "query"].map(structuredOperation),
      transactionOperation,
    ],
  }),
  resourceRequirement({
    catalog: "structured",
    namespace: "resources",
    name: "metadata",
    provider: CONFIG_ARTIFACT_PROVIDER,
    operations: [
      ...["get", "patch", "put", "query"].map(structuredOperation),
      transactionOperation,
    ],
  }),
  resourceRequirement({
    catalog: "structured",
    namespace: "resources",
    name: "orphan-candidates",
    provider: CONFIG_ARTIFACT_PROVIDER,
    operations: [
      ...["get", "patch", "put", "query"].map(structuredOperation),
      transactionOperation,
    ],
  }),
  resourceRequirement({
    catalog: "structured",
    namespace: "resources",
    name: "provenance",
    provider: CONFIG_ARTIFACT_PROVIDER,
    operations: [
      ...["get", "put", "query"].map(structuredOperation),
      transactionOperation,
    ],
  }),
  resourceRequirement({
    catalog: "object",
    namespace: "resources",
    name: "objects",
    provider: CONFIG_ARTIFACT_PROVIDER,
    operations: [
      {
        contract: "meridian.object.get",
        version: "1.0.0",
        guarantees: ["object.digest-verification", "object.streaming"],
      },
      {
        contract: "meridian.object.list",
        version: "1.0.0",
        guarantees: ["object.bounded-prefix-list"],
      },
      {
        contract: "meridian.object.put",
        version: "1.0.0",
        guarantees: [
          "object.conditional-create",
          "object.digest-sha256",
          "object.metadata-after-commit",
          "object.streaming",
        ],
      },
      {
        contract: "meridian.object.read_range",
        version: "1.0.0",
        guarantees: ["object.digest-verification", "object.range-read"],
      },
      { contract: "meridian.object.stat", version: "1.0.0" },
    ],
  }),
]);

function externalEngine(
  selection: MeridianEngineSelection,
  adoption?: AdoptionMap,
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
    `meridian-${selection.bindingId}`,
    {
      binding: {
        bindingId: selection.bindingId,
        profileId: selection.profileId,
        requiredCapabilityFingerprint: selection.requiredCapabilityFingerprint,
        topology: selection.topology ?? profile.defaultTopology,
        engineVersion: selection.engineVersion ?? profile.defaultEngineVersion,
        compatibilityPins: profile.compatibilityPins,
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
  readonly adoption?: AdoptionMap;
  readonly adoptionKey?: string;
  readonly dependsOn?: readonly pulumi.Resource[];
}): MeridianDeployment {
  const accountResourceSelectors = args.resources
    .filter(({ selector }) => selector.namespace === "platform.account")
    .map(({ selector }) => selector);
  const structuredResources = args.resources
    .filter(
      ({ selector }) =>
        selector.catalog === "structured" &&
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
      catalogs: (
        ["structured", "object", "cache", "evidence", "streaming"] as const
      ).map((name) => ({
        name,
        package: "meridian-storage-core",
        contract: "1.0.0",
        requiredFingerprint: CATALOG_FINGERPRINTS[name],
      })),
      schemaProviders: args.schemaProviders.map(schemaProvider),
      resources: args.resources,
      engines: args.engines,
      placements: [
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
        ...(structuredResources.length === 0
          ? []
          : [
              {
                id: `${args.name}-structured`,
                selector: {
                  resources: structuredResources,
                  catalog: null,
                  labels: {},
                },
                bindingId: "structured",
                extensions: {},
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
        engineAuthority: "@zephytiju/meridian-storage-constructs@1.0.0",
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
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly inputs: MeridianInputs;
  readonly adoption?: AdoptionMap;
  readonly dependsOn?: readonly pulumi.Resource[];
}): {
  readonly deployment: MeridianDeployment;
  readonly blueprintDeployment: MeridianDeployment;
  readonly runtime: MeridianRuntimeConfig;
  readonly blueprintRuntime: MeridianRuntimeConfig;
  readonly output: MeridianRuntimeOutput;
} {
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
    externalEngine(engine, args.adoption),
  );
  const deployment = createDeployment({
    name: "foundations-meridian",
    schemaProviders: [
      ACCOUNT_PROVIDER,
      APPLICATION_METADATA_PROVIDER,
      CONFIG_ARTIFACT_PROVIDER,
    ],
    resources: [
      ...accountResources,
      ...applicationMetadataResources,
      ...configArtifactResources,
    ],
    engines,
    adoption: args.adoption,
    adoptionKey: "meridian/deployment",
    dependsOn: args.dependsOn,
  });
  const blueprintDeployment = createDeployment({
    name: "foundations-meridian-blueprint",
    schemaProviders: [BLUEPRINT_PROVIDER, CONFIG_ARTIFACT_PROVIDER],
    resources: configArtifactResources,
    engines,
    adoption: args.adoption,
    dependsOn: args.dependsOn,
  });
  const runtime = new MeridianRuntimeConfig("foundations-meridian", {
    namespace: args.namespace,
    provider: args.provider,
    deployment,
    configMapName: "juntai-meridian-config",
    mountPath: "/etc/juntai/meridian",
    environmentVariable: "MERIDIAN_CONFIG",
    resourceMigration: childMigration(args.adoption, "meridian/runtime-config"),
  });
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
  return {
    deployment,
    blueprintDeployment,
    runtime,
    blueprintRuntime,
    output: Object.freeze({
      configFingerprint: deployment.configFingerprint,
      configMapName: runtime.configMap.metadata.name,
      namespace: runtime.configMap.metadata.namespace,
      resourceBindings: deployment.resourceBindings,
    }),
  };
}
