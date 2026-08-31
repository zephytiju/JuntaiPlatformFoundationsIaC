import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import { MeridianRuntimeConfig } from "@zephytiju/juntai-platform-constructs";
import {
  ExternalEngine,
  MeridianDeployment,
  defaultValidationPolicy,
  getEngineProfile,
  type EngineBinding,
} from "@zephytiju/meridian-storage-constructs";
import { childMigration } from "./adoption.js";
import type {
  AdoptionMap,
  MeridianEngineSelection,
  MeridianInputs,
  MeridianRuntimeOutput,
} from "./types.js";

const BLUEPRINT_SCHEMA_FINGERPRINT =
  "sha256:0a1d34129ed514fc0e7b227c6d23fbff61f025de209d0ebeedd0cf618a6bd26d";
const MERIDIAN_CORE_FINGERPRINT =
  "sha256:6b8ebb70ee1a8467a96d668878a8eebf826c1c4b63b3832ae70f2c630a8ef4a1";
const CATALOG_FINGERPRINTS = Object.freeze({
  structured: MERIDIAN_CORE_FINGERPRINT,
  object:
    "sha256:62d838ab872a933d5c9f51b30de7389786400f49ed9f006b0cbab07fb67fce36",
  cache:
    "sha256:282136e4be38ae6343bcdb240939e5f036e9edc3d3a7459a73b4d3ef33be4ba5",
  evidence:
    "sha256:0752cbb1cac2b72e9a041a455bdf80a33c26eea1643526ac45c12d15f7210a3e",
  streaming:
    "sha256:8fa802d1f4d69082b1bb2643856f82db9159ebe92fcd819aa529c143cd8d51eb",
} as const);

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
        settings: {},
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

export function createMeridianRuntime(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly inputs: MeridianInputs;
  readonly adoption?: AdoptionMap;
  readonly dependsOn?: readonly pulumi.Resource[];
}): {
  readonly deployment: MeridianDeployment;
  readonly runtime: MeridianRuntimeConfig;
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
  if (structured === undefined) {
    throw new Error(
      "Foundations requires a Meridian structured binding for approved foundation services",
    );
  }
  const structuredProfile = getEngineProfile(structured.profileId);
  if (!structuredProfile.catalogs.includes("structured")) {
    throw new Error(
      "the Meridian 'structured' binding must select a released structured profile",
    );
  }
  const engines = args.inputs.engines.map((engine) =>
    externalEngine(engine, args.adoption),
  );
  const deploymentAdoption = args.adoption?.["meridian/deployment"];
  const deployment = new MeridianDeployment(
    "foundations-meridian",
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
      schemaProviders: [
        {
          id: "platform-blueprint",
          package: "juntai-blueprint-marketplace",
          contract: "1.0.0",
          requiredFingerprint: BLUEPRINT_SCHEMA_FINGERPRINT,
        },
      ],
      resources: [
        {
          selector: {
            catalog: "structured",
            namespace: "platform",
            name: "blueprints",
          },
          schemas: [
            {
              providerId: "platform-blueprint",
              package: "juntai-blueprint-marketplace",
              version: "3.0.0",
              fingerprint: BLUEPRINT_SCHEMA_FINGERPRINT,
            },
          ],
          operations: [
            "meridian.structured.create_resource",
            "meridian.structured.delete",
            "meridian.structured.get",
            "meridian.structured.put",
            "meridian.structured.query",
          ].map((contract) => ({ contract, version: "1.0.0" })),
          guarantees: { required: [] },
          limits: { values: {} },
          dataClass: "internal",
          labels: { owner: "juntai-platform-foundations-iac" },
        },
      ],
      engines,
      placements: [
        {
          id: "place-platform-blueprints",
          selector: {
            resources: [
              {
                catalog: "structured",
                namespace: "platform",
                name: "blueprints",
              },
            ],
            catalog: null,
            labels: {},
          },
          bindingId: "structured",
          extensions: {},
        },
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
  const runtime = new MeridianRuntimeConfig("foundations-meridian", {
    namespace: args.namespace,
    provider: args.provider,
    deployment,
    configMapName: "juntai-meridian-config",
    mountPath: "/etc/juntai/meridian",
    environmentVariable: "MERIDIAN_CONFIG",
    resourceMigration: childMigration(args.adoption, "meridian/runtime-config"),
  });
  return {
    deployment,
    runtime,
    output: Object.freeze({
      configFingerprint: deployment.configFingerprint,
      configMapName: runtime.configMap.metadata.name,
      namespace: runtime.configMap.metadata.namespace,
      resourceBindings: deployment.resourceBindings,
    }),
  };
}
