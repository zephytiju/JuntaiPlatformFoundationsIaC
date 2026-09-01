import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { deployFoundations } from "../src/package.js";
import type { ContractRouteInput } from "../src/contract-composition.js";
import type { FoundationPreflightResolver } from "../src/preflight.js";
import { capabilities, foundationsInputs, secrets } from "./helpers.js";
import type { FoundationsInputs } from "../src/types.js";

interface RegisteredResource {
  readonly type: string;
  readonly name: string;
  readonly inputs: Record<string, unknown>;
}

const resources: RegisteredResource[] = [];

beforeAll(() => {
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        resources.push({
          type: args.type,
          name: args.name,
          inputs: args.inputs,
        });
        return { id: `${args.name}_id`, state: args.inputs };
      },
      call: (args) => args.inputs,
    },
    "foundations-test",
    "development-local",
    false,
  );
});

const verifiedYaml =
  "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: verified-upstream\n  namespace: default\n";

const blueprintRoute: ContractRouteInput = Object.freeze({
  serviceId: "platform.blueprint",
  gatewaySurface: "platform",
  pathPrefix: "/api/blueprints/v1",
  paths: ["/api/blueprints/v1/assets"],
  operationIds: ["platform_blueprint__listAssets"],
});

const accountRoute: ContractRouteInput = Object.freeze({
  serviceId: "platform.account",
  gatewaySurface: "platform",
  pathPrefix: "/api/platform.account/v1",
  paths: ["/api/platform.account/v1/accounts/{accountId}"],
  operationIds: ["platform_account__getAccount"],
});

const applicationMetadataRoute: ContractRouteInput = Object.freeze({
  serviceId: "platform.application-metadata",
  gatewaySurface: "platform",
  pathPrefix: "/api/platform/applications/v1",
  paths: ["/api/platform/applications/v1/applications"],
  operationIds: ["platform_application_metadata__listApplications"],
});

const preflight: FoundationPreflightResolver = async (inputs) => {
  const routes = [
    ...(inputs.account.enabled === false ? [] : [accountRoute]),
    ...(inputs.applicationMetadata.enabled === false
      ? []
      : [applicationMetadataRoute]),
    ...(inputs.blueprint.enabled === false ? [] : [blueprintRoute]),
  ];
  const evidence = Object.freeze({
    schemaVersion:
      "juntai.platform/foundation-contract-composition/v1" as const,
    compositionDigest: `sha256:${"e".repeat(64)}` as const,
    artifacts: Object.freeze([]),
    releaseArtifacts: Object.freeze([]),
    routes: Object.freeze(routes),
    bindings: Object.freeze([]),
  });
  return Object.freeze({
    gatewayApiYaml: verifiedYaml,
    envoyGatewayYaml: verifiedYaml,
    gatewayManifestOwnership: Object.freeze([]),
    contracts: Object.freeze({
      aggregateOpenApi: Object.freeze({}),
      protobufServices: Object.freeze([]),
      routes: evidence.routes,
      bindings: evidence.bindings,
      evidence,
    }),
  });
};

describe("Pulumi composition", () => {
  async function runDeployment(inputs: FoundationsInputs): Promise<{
    readonly published: Map<string, unknown>;
    readonly registered: readonly RegisteredResource[];
  }> {
    resources.length = 0;
    const capabilityState = capabilities();
    await pulumi.runtime.runInPulumiStack(async () => {
      const provider = new k8s.Provider("cluster", {
        kubeconfig: "apiVersion: v1",
      });
      const result = await deployFoundations(
        {
          target: {
            organization: "juntai",
            project: "platform",
            stack: "development-local",
            environment: "development-local",
            configuration: {},
          },
          providers: { kubernetes: provider },
          inputs,
          capabilities: capabilityState.consumer,
          secrets: secrets(),
        },
        { preflight },
      );
      return result.outputs;
    });
    const expectedDeployments =
      2 +
      Number(inputs.account.enabled !== false) +
      Number(inputs.applicationMetadata.enabled !== false) +
      Number(inputs.blueprint.enabled !== false);
    const deadline = Date.now() + 1_000;
    while (
      resources.filter(({ type }) => type === "kubernetes:apps/v1:Deployment")
        .length < expectedDeployments &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return {
      published: capabilityState.published,
      registered: [...resources],
    };
  }

  it("owns shared resources and publishes only typed opaque outputs", async () => {
    const result = await runDeployment(foundationsInputs());
    const types = new Set(resources.map((entry) => entry.type));
    expect(types).toContain("juntai:foundations:NamespaceSet");
    expect(types).toContain("juntai:platform:CasdoorService");
    expect(types).toContain("juntai:platform:JuntaiService");
    expect(types).toContain("juntai:platform:GatewayBinding");
    expect(types).toContain("juntai:platform:MeridianRuntimeConfig");
    expect(types).toContain("meridian:storage:Deployment");
    expect(types).toContain("meridian:storage:ExternalEngine");
    expect(types).not.toContain("meridian:storage:ManagedEngine");
    expect(result.published.size).toBe(4);
    const meridianConfig = resources.find(
      ({ type, inputs }) =>
        type === "kubernetes:core/v1:ConfigMap" &&
        JSON.stringify(inputs).includes("juntai-meridian-config"),
    );
    const renderedMeridianConfig = JSON.parse(
      (meridianConfig?.inputs.data as Record<string, string>)[
        "meridian-config.v1.json"
      ]!,
    ) as {
      readonly bindings: readonly {
        readonly id: string;
        readonly settings: Record<string, unknown>;
      }[];
    };
    const applicationMetadataMeridianConfig = resources.find(
      ({ type, inputs }) =>
        type === "kubernetes:core/v1:ConfigMap" &&
        JSON.stringify(inputs).includes(
          "juntai-meridian-application-metadata-config",
        ),
    );
    const renderedApplicationMetadataMeridianConfig = JSON.parse(
      (
        applicationMetadataMeridianConfig?.inputs.data as Record<string, string>
      )["meridian-config.v1.json"]!,
    ) as {
      readonly bindings: readonly {
        readonly id: string;
        readonly settings: Record<string, unknown>;
      }[];
    };
    expect(
      renderedApplicationMetadataMeridianConfig.bindings.find(
        ({ id }) => id === "structured",
      )?.settings,
    ).toEqual({
      formatVersion: "meridian.postgresql.settings.v1",
      resources: [
        {
          ref: "structured:application-metadata.applications",
          table: "application_metadata_applications",
        },
      ],
    });
    const blueprintMeridianConfig = resources.find(
      ({ type, inputs }) =>
        type === "kubernetes:core/v1:ConfigMap" &&
        JSON.stringify(inputs).includes("juntai-meridian-blueprint-config"),
    );
    expect(blueprintMeridianConfig).toBeDefined();
    expect(
      resources.filter(({ type }) => type === "meridian:storage:Deployment"),
    ).toHaveLength(3);
    expect(JSON.stringify(renderedMeridianConfig)).toContain(
      '"catalog":"structured","name":"accounts","namespace":"platform.account"',
    );
    expect(JSON.stringify(renderedMeridianConfig)).toContain(
      '"catalog":"evidence","name":"audit","namespace":"platform.account"',
    );
    expect(JSON.stringify(renderedMeridianConfig)).toContain(
      '"coLocationGroup":"platform.account.profile-mutation.v1"',
    );
    expect(JSON.stringify(renderedMeridianConfig)).toContain(
      '"id":"platform-account","package":"juntai-account-service"',
    );
    expect(JSON.stringify(renderedMeridianConfig)).not.toContain(
      "juntai.application-metadata",
    );
    expect(JSON.stringify(renderedApplicationMetadataMeridianConfig)).toContain(
      '"id":"juntai.application-metadata","package":"juntai-application-metadata"',
    );
    expect(
      JSON.stringify(renderedApplicationMetadataMeridianConfig),
    ).not.toContain("platform.account");
    expect(
      resources.filter(
        (entry) =>
          entry.type === "juntai:platform:JuntaiService" &&
          ["account", "application-metadata", "blueprint"].some((name) =>
            entry.name.includes(name),
          ),
      ),
    ).toHaveLength(3);
    expect(
      resources.some(
        (entry) =>
          entry.type ===
            "kubernetes:rbac.authorization.k8s.io/v1:ClusterRole" &&
          entry.name.includes("application-metadata-token-reviewer"),
      ),
    ).toBe(true);
    const applicationMetadataDeployment = resources.find((entry) =>
      JSON.stringify(entry.inputs).includes(
        "ghcr.io/zephytiju/juntai-application-metadata@sha256:",
      ),
    );
    expect(applicationMetadataDeployment).toBeDefined();
    expect(applicationMetadataDeployment?.type).toBe(
      "kubernetes:apps/v1:Deployment",
    );
    expect(JSON.stringify(applicationMetadataDeployment?.inputs)).toContain(
      "token-reviewer",
    );
    expect(JSON.stringify(applicationMetadataDeployment?.inputs)).toContain(
      "kube-root-ca.crt",
    );
    const blueprintDeployment = resources.find((entry) =>
      JSON.stringify(entry.inputs).includes(
        "ghcr.io/zephytiju/juntai-blueprint-marketplace@sha256:",
      ),
    );
    expect(JSON.stringify(blueprintDeployment?.inputs)).toContain(
      "CASDOOR_POLICY_ENDPOINT",
    );
    expect(JSON.stringify(blueprintDeployment?.inputs)).toContain(
      "CASDOOR_POLICY_CLIENT_ID",
    );
    const accountDeployment = resources.find((entry) =>
      JSON.stringify(entry.inputs).includes(
        "ghcr.io/zephytiju/juntai-account-service@sha256:",
      ),
    );
    expect(accountDeployment?.inputs).toMatchObject({
      spec: {
        template: {
          spec: {
            securityContext: {
              fsGroup: 65532,
              runAsGroup: 65532,
              runAsNonRoot: true,
              runAsUser: 65532,
            },
          },
        },
      },
    });
    expect(JSON.stringify(accountDeployment?.inputs)).toContain(
      '"name":"ACCOUNT_ENVIRONMENT","value":"production"',
    );
    for (const deployment of [
      accountDeployment,
      applicationMetadataDeployment,
      blueprintDeployment,
    ]) {
      expect(JSON.stringify(deployment?.inputs)).toContain(
        "meridian-runtime-credentials",
      );
      expect(JSON.stringify(deployment?.inputs)).toContain(
        "/var/run/juntai/runtime",
      );
    }
    const applicationMetadataRouteResource = resources.find(
      (entry) =>
        entry.inputs.kind === "HTTPRoute" &&
        JSON.stringify(entry.inputs).includes("/api/platform/applications/v1"),
    );
    expect(applicationMetadataRouteResource).toBeDefined();
    expect(applicationMetadataRouteResource?.type).toBe(
      "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute",
    );
    expect(JSON.stringify(applicationMetadataRouteResource?.inputs)).toContain(
      "ReplacePrefixMatch",
    );
    expect(
      resources.some((entry) =>
        /kes|kingbase/i.test(JSON.stringify(entry.inputs)),
      ),
    ).toBe(false);
  });

  it("supports TLS references, explicit addresses, adoption, and optional Blueprint", async () => {
    const base = foundationsInputs();
    const result = await runDeployment({
      ...base,
      adoption: {
        "namespace/juntai-platform": {
          aliases: [{ name: "legacy-platform" }],
          import: "juntai-platform",
          protect: true,
          retainOnDelete: true,
        },
        "meridian/deployment": { aliases: [{ name: "legacy-meridian" }] },
        "meridian/engine/structured": {
          aliases: [{ name: "legacy-structured" }],
        },
      },
      gateway: {
        serviceType: "LoadBalancer",
        addresses: { public: "192.0.2.10" },
        tlsSecrets: {
          public: "gateway-public-tls",
          platform: "gateway-platform-tls",
          operator: "gateway-operator-tls",
        },
      },
      observability: {
        exportEndpoint: "https://otel.example.test:4317",
        replicas: 1,
        authorization: { name: "otel-auth", key: "authorization" },
        certificateAuthority: {
          name: "otel-export-ca",
          mountPath: "/var/run/otel/export-ca",
          items: { "ca.crt": "ca.crt" },
        },
        receiverTls: {
          name: "otel-receiver-tls",
          mountPath: "/var/run/otel/receiver",
          items: { "tls.crt": "tls.crt", "tls.key": "tls.key" },
        },
      },
      account: { ...base.account, enabled: false },
      applicationMetadata: {
        ...base.applicationMetadata,
        enabled: false,
      },
      blueprint: { ...base.blueprint, enabled: false },
      casdoor: { ...base.casdoor, reconciliationSchedule: "0 4 * * *" },
    });
    expect(result.published.size).toBe(4);
    expect(
      result.registered.some(
        (entry) =>
          entry.type === "juntai:platform:JuntaiService" &&
          ["blueprint", "account", "application-metadata"].some((name) =>
            entry.name.includes(name),
          ),
      ),
    ).toBe(false);
    expect(JSON.stringify(result.registered)).toContain("gateway-public-tls");
    expect(JSON.stringify(result.registered)).toContain(
      "OTEL_EXPORTER_AUTHORIZATION",
    );
  });

  it("fails preflight before registering any package-owned resource", async () => {
    resources.length = 0;
    await pulumi.runtime.runInPulumiStack(async () => {
      const provider = new k8s.Provider("preflight-cluster", {
        kubeconfig: "apiVersion: v1",
      });
      const before = resources.filter(
        ({ type }) => type !== "pulumi:providers:kubernetes",
      ).length;
      const rejectedPreflight: FoundationPreflightResolver = () =>
        Promise.reject(new Error("contract digest mismatch"));
      await expect(
        deployFoundations(
          {
            target: {
              organization: "juntai",
              project: "platform",
              stack: "development-local",
              environment: "development-local",
              configuration: {},
            },
            providers: { kubernetes: provider },
            inputs: foundationsInputs(),
            capabilities: capabilities().consumer,
            secrets: secrets(),
          },
          { preflight: rejectedPreflight },
        ),
      ).rejects.toThrow(/contract digest mismatch/);
      expect(
        resources.filter(({ type }) => type !== "pulumi:providers:kubernetes"),
      ).toHaveLength(before);
      return {};
    });
  });
});
