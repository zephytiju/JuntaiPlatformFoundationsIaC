import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { deployFoundations } from "../src/package.js";
import type { ContractRouteInput } from "../src/contract-composition.js";
import {
  resolveDomainRuntimeDistributions,
  type FoundationPreflightResolver,
} from "../src/preflight.js";
import {
  capabilities,
  foundationsInputs,
  secrets,
  structuredEngine,
} from "./helpers.js";
import { peerInputs, ownedEngines } from "./peer-fixture.js";
import { domainRequirements } from "./domain-fixture.js";
import {
  latticeDomains,
  latticeSharedStore,
  observation,
} from "./lattice-fixture.js";
import type { FoundationsInputs, MeridianRuntimeOutput } from "../src/types.js";
import {
  runtimeDistributionFixture,
  durableRuntimeDistributionFixture,
} from "./runtime-distribution-fixture.js";

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
    runtimeDistribution: runtimeDistributionFixture(),
    domainRuntimeDistributions: await resolveDomainRuntimeDistributions(
      inputs.meridian,
      runtimeDistributionFixture(),
      async () =>
        new TextEncoder().encode(durableRuntimeDistributionFixture().text),
    ),
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
  it("publishes exact 1.0.0 fields from the same runtime alongside 1.1.0", async () => {
    const result = await runDeployment(foundationsInputs());
    const legacy = result.publishedVersions.get(
      "juntai.platform.meridian-runtime@1.0.0",
    ) as Record<string, unknown>;
    const current = result.publishedVersions.get(
      "juntai.platform.meridian-runtime@1.1.0",
    ) as Record<string, unknown>;
    expect(Object.keys(legacy).sort()).toEqual([
      "configFingerprint",
      "configMapName",
      "namespace",
      "resourceBindings",
    ]);
    for (const key of Object.keys(legacy))
      expect(legacy[key]).toBe(current[key]);
    expect(current.distribution).toBeDefined();
    expect(legacy).not.toHaveProperty("domainRuntimes");
  });

  async function runDeployment(inputs: FoundationsInputs): Promise<{
    readonly published: Map<string, unknown>;
    readonly publishedVersions: Map<string, unknown>;
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
      publishedVersions: capabilityState.publishedVersions,
      registered: [...resources],
    };
  }

  it("generates peer configurations in the service namespace with exact read-only compatibility", async () => {
    const input = peerInputs();
    const blueprint = input.meridian.peerRuntimeSelections!.blueprint!;
    const result = await runDeployment({
      ...input,
      meridian: {
        ...input.meridian,
        peerRuntimeSelections: {
          blueprint,
          "application-metadata": {
            engines: input.meridian.engines,
            runtimeReferences: input.meridian.runtimeReferences!,
            ownedReferences: {
              ...blueprint.ownedReferences!,
              engines: ownedEngines(false),
            },
          },
        },
      },
    });
    for (const peer of ["application-metadata", "blueprint"] as const) {
      for (const suffix of ["", "-owned-references"]) {
        const name = `juntai-meridian-${peer}${suffix}-config`;
        const config = result.registered.find(
          (r) =>
            r.type === "kubernetes:core/v1:ConfigMap" &&
            (r.inputs.metadata as { name: string }).name === name,
        )!;
        expect(config.inputs.metadata).toMatchObject({
          name,
          namespace: suffix ? "juntai-platform" : "juntai-capabilities",
        });
        const runtime = JSON.parse(
          (config.inputs.data as Record<string, string>)[
            "meridian-config.v1.json"
          ]!,
        ) as {
          bindings: {
            adapterId: string;
            compatibilityPins: Record<string, string>;
            requiredPhysicalFingerprint: string;
            settings: { readCompatibility?: { resources: unknown[] } };
          }[];
        };
        const structured = runtime.bindings.find(
          (b: { adapterId: string }) => b.adapterId === "postgresql",
        )!;
        if (peer === "blueprint" && suffix) {
          expect(structured.settings.readCompatibility!.resources).toHaveLength(
            4,
          );
          expect(structured.requiredPhysicalFingerprint).toBe(
            ownedEngines()[0]!.requiredPhysicalFingerprint,
          );
        } else expect(structured.settings.readCompatibility).toBeUndefined();
      }
      if (peer === "blueprint") {
        const projection = result.registered.find(
          (r) =>
            r.type === "kubernetes:core/v1:ConfigMap" &&
            (r.inputs.metadata as { name: string }).name ===
              "juntai-blueprint-runtime-config",
        )!;
        expect(projection.inputs.metadata).toMatchObject({
          namespace: "juntai-platform",
        });
        const source = result.registered.find(
          (r) =>
            r.type === "kubernetes:core/v1:ConfigMap" &&
            (r.inputs.metadata as { name: string }).name ===
              "juntai-meridian-blueprint-config",
        )!;
        expect(projection.inputs.data).toEqual(source.inputs.data);
      }
      const deployment = result.registered.find(
        (r) =>
          r.type === "kubernetes:apps/v1:Deployment" &&
          (r.inputs.metadata as { name: string }).name === peer,
      )!;
      const pod = (
        deployment.inputs.spec as {
          template: {
            spec: {
              containers: { env: { name: string; value: string }[] }[];
              volumes: { configMap?: { name: string } }[];
            };
          };
        }
      ).template.spec;
      expect(pod.containers[0]!.env).toContainEqual({
        name:
          peer === "blueprint"
            ? "BLUEPRINT_OWNED_REFERENCE_MERIDIAN_CONFIG"
            : "APPLICATION_METADATA_OWNED_REFERENCE_MERIDIAN_CONFIG",
        value: "/etc/juntai/owned-references/meridian-config.v1.json",
      });
      expect(
        pod.volumes.some(
          (v) =>
            v.configMap?.name ===
            `juntai-meridian-${peer}-owned-references-config`,
        ),
      ).toBe(true);
    }
  });

  it("projects owned-reference configuration beside each peer's primary runtime", async () => {
    const base = foundationsInputs();
    const ownedReferenceRuntime = {
      configuration: {
        name: "owned-artifact-runtime",
        mountPath: "/etc/juntai/owned-artifacts",
        items: { "meridian-config.v1.json": "runtime.json" },
      },
      runtimeReferences: [
        {
          kind: "secret" as const,
          name: "owned-artifact-credentials",
          mountPath: "/var/run/juntai/owned-artifacts",
          items: { connection: "connection" },
        },
      ],
    };
    const result = await runDeployment({
      ...base,
      applicationMetadata: {
        ...base.applicationMetadata,
        ownedReferenceRuntime,
      },
      blueprint: { ...base.blueprint, ownedReferenceRuntime },
    });
    for (const [name, variable, primary] of [
      [
        "application-metadata",
        "APPLICATION_METADATA_OWNED_REFERENCE_MERIDIAN_CONFIG",
        "/etc/juntai/application-metadata/meridian-config.v1.json",
      ],
      [
        "blueprint",
        "BLUEPRINT_OWNED_REFERENCE_MERIDIAN_CONFIG",
        "/etc/juntai/meridian/meridian-config.v1.json",
      ],
    ]) {
      const deployment = result.registered.find(
        (r) =>
          r.type === "kubernetes:apps/v1:Deployment" &&
          (r.inputs.metadata as { name: string }).name === name,
      )!;
      const pod = (
        deployment.inputs.spec as {
          template: {
            spec: {
              containers: {
                env: { name: string; value: string }[];
                volumeMounts: { mountPath: string; readOnly: boolean }[];
              }[];
              volumes: {
                configMap?: { name: string; items: unknown[] };
                secret?: { secretName: string };
              }[];
            };
          };
        }
      ).template.spec;
      expect(pod.containers[0]!.env).toEqual(
        expect.arrayContaining([
          { name: "MERIDIAN_CONFIG", value: primary },
          { name: variable, value: "/etc/juntai/owned-artifacts/runtime.json" },
        ]),
      );
      for (const mountPath of [
        "/etc/juntai/owned-artifacts",
        "/var/run/juntai/owned-artifacts",
      ])
        expect(pod.containers[0]!.volumeMounts).toContainEqual(
          expect.objectContaining({ mountPath, readOnly: true }),
        );
      expect(pod.volumes).toContainEqual(
        expect.objectContaining({
          configMap: {
            name: "owned-artifact-runtime",
            optional: false,
            items: [{ key: "meridian-config.v1.json", path: "runtime.json" }],
          },
        }),
      );
      expect(pod.volumes).toContainEqual(
        expect.objectContaining({
          secret: expect.objectContaining({
            secretName: "owned-artifact-credentials",
          }),
        }),
      );
    }
  });

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
    const distribution = result.registered.find(
      ({ name }) => name === "foundations-meridian-distribution",
    );
    const fixture = runtimeDistributionFixture();
    expect(distribution?.inputs.immutable).toBe(true);
    expect(distribution?.inputs.data).toEqual({
      "runtime-distribution.v1.json": fixture.text,
    });
    const runtime = result.published.get(
      "juntai.platform.meridian-runtime",
    ) as MeridianRuntimeOutput;
    expect(runtime.distribution.descriptorDigest).toBe(
      fixture.selection.digest,
    );
    expect(runtime.distribution.descriptor).toEqual(fixture.descriptor);
    expect(runtime.runtimeReferences).toEqual(
      foundationsInputs().meridian.runtimeReferences,
    );
    expect(pulumi.Output.isInstance(runtime.configMapName)).toBe(true);
    expect(pulumi.Output.isInstance(runtime.distribution.configMapName)).toBe(
      true,
    );
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

  it("renders isolated domain runtime configurations while retaining engine ownership", async () => {
    const base = foundationsInputs();
    const result = await runDeployment({
      ...base,
      meridian: {
        ...base.meridian,
        domains: [
          domainRequirements(),
          domainRequirements("prism-build", "prism.build"),
        ],
      },
    });
    const configs = result.registered.filter(
      ({ type, inputs }) =>
        type === "kubernetes:core/v1:ConfigMap" &&
        JSON.stringify(inputs).includes("juntai-meridian-prism-"),
    );
    expect(configs).toHaveLength(2);
    for (const [name, other] of [
      ["composition", "build"],
      ["build", "composition"],
    ]) {
      const config = configs.find(({ inputs }) =>
        JSON.stringify(inputs).includes(`juntai-meridian-prism-${name}-config`),
      )!;
      const body = JSON.parse(
        (config.inputs.data as Record<string, string>)[
          "meridian-config.v1.json"
        ]!,
      ) as {
        placements: {
          id: string;
          selector: { resources: unknown[] };
          bindingId: string;
          extensions: { coLocationGroup: string };
        }[];
        bindings: { id: string }[];
      };
      expect(JSON.stringify(body)).toContain(`prism.${name}`);
      expect(JSON.stringify(body)).not.toContain(`prism.${other}`);
      expect(JSON.stringify(body)).not.toContain("platform.account");
      expect(body.bindings.map(({ id }) => id)).toEqual(["structured"]);
      const placement = body.placements.find((p: { id: string }) =>
        p.id.endsWith("-structured"),
      );
      expect(placement!.selector.resources).toHaveLength(2);
      expect(placement!.bindingId).toBe("structured");
      expect(placement!.extensions.coLocationGroup).toBe(
        `prism.${name}.transaction.v1`,
      );
    }
    expect(
      result.registered.filter(
        ({ type }) => type === "meridian:storage:ExternalEngine",
      ),
    ).toHaveLength(6);
    const output = result.published.get("juntai.platform.meridian-runtime") as {
      domainRuntimes: Record<
        string,
        { configMapName: pulumi.Output<string>; ownerPackage: string }
      >;
    };
    expect(Object.keys(output.domainRuntimes).sort()).toEqual([
      "prism-build",
      "prism-composition",
    ]);
    expect(output.domainRuntimes["prism-build"]!.ownerPackage).toBe(
      "juntai.platform.domain.prism",
    );
    expect(
      pulumi.Output.isInstance(
        output.domainRuntimes["prism-build"]!.configMapName,
      ),
    ).toBe(true);
  });

  it("composes exact released Lattice and shared ResourceStore Resources with namespace-local outputs", async () => {
    const base = foundationsInputs();
    const domains = latticeDomains();
    const result = await runDeployment({
      ...base,
      meridian: {
        ...base.meridian,
        domains,
        sharedResourceStores: [latticeSharedStore()],
      },
    });
    const output = result.published.get(
      "juntai.platform.meridian-runtime",
    ) as MeridianRuntimeOutput;
    for (const domain of domains) {
      const runtime = output.domainRuntimes![domain.id]!;
      const namespace = await new Promise<string>((resolve) =>
        runtime.namespace.apply(resolve),
      );
      expect(namespace).toBe(
        await new Promise<string>((resolve) => output.namespace.apply(resolve)),
      );
      expect(runtime.runtimeReferences).toEqual(
        base.meridian.runtimeReferences,
      );
      expect(runtime.ownerPackage).toBe("juntai.platform.domain.lattice");
      expect(runtime.resourceNamespace).toBe(domain.resourceNamespace);
      const config = result.registered.find(
        ({ type, inputs }) =>
          type === "kubernetes:core/v1:ConfigMap" &&
          (inputs.metadata as { name?: string })?.name ===
            `juntai-meridian-${domain.id}-config`,
      )!;
      const renderedText = (config.inputs.data as Record<string, string>)[
        "meridian-config.v1.json"
      ]!;
      if (process.env.FOUNDATIONS_LATTICE_EVIDENCE_DIR) {
        mkdirSync(process.env.FOUNDATIONS_LATTICE_EVIDENCE_DIR, {
          recursive: true,
        });
        writeFileSync(
          resolve(
            process.env.FOUNDATIONS_LATTICE_EVIDENCE_DIR,
            `${domain.id}.json`,
          ),
          renderedText,
        );
      }
      const body = JSON.parse(renderedText) as {
        resources: { pins: { ref: unknown; requiredFingerprint: string }[] };
        bindings: { id: string }[];
        catalogs: {
          providers: { name: string; requiredFingerprint: string }[];
        };
        schemas: { providers: { id: string; requiredFingerprint: string }[] };
        extensions: { sharedResourceStores: unknown[] };
        placements: { id: string; selector: { resources: unknown[] } }[];
      };
      expect(body.resources.pins).toHaveLength(domain.resources.length + 5);
      expect(
        body.bindings.map((binding: { id: string }) => binding.id),
      ).toEqual(["object", "structured"]);
      expect(
        body.catalogs.providers.find(
          (catalog: { name: string }) => catalog.name === "object",
        )!.requiredFingerprint,
      ).toBe(
        observation.catalogs.find((catalog) => catalog.name === "object")!
          .fingerprint,
      );
      expect(
        body.schemas.providers.find(
          (provider: { id: string }) =>
            provider.id === "meridian.plugin.config-artifact",
        )!.requiredFingerprint,
      ).toBe(latticeSharedStore().provider.requiredFingerprint);
      expect(body.extensions.sharedResourceStores).toEqual([
        {
          id: "configuration-artifact",
          ownerPackage: "juntai.platform.substrate",
        },
      ]);
      expect(
        body.placements.find((placement: { id: string }) =>
          placement.id.endsWith("-object"),
        )!.selector.resources,
      ).toEqual([
        { catalog: "object", namespace: "resources", name: "objects" },
      ]);
      for (const resource of [
        ...domain.resources,
        ...latticeSharedStore().resources,
      ]) {
        const rendered = body.resources.pins.find(
          (item: { ref: unknown }) =>
            JSON.stringify(item.ref) === JSON.stringify(resource.selector),
        );
        expect(rendered).toBeDefined();
        expect(rendered!.requiredFingerprint).toBe(
          resource.schemas[0]!.resourceFingerprint,
        );
      }
      const other = domains.find((other) => other.id !== domain.id)!;
      expect(JSON.stringify(body)).not.toContain(other.resourceNamespace);
    }
    // Shared Engine references are selected once by Foundations, never by a domain namespace declaration.
    expect(
      result.registered.filter(
        ({ type }) => type === "meridian:storage:ExternalEngine",
      ),
    ).toHaveLength(6);
  });

  it("rejects a shared ResourceStore's missing object binding before package resources", async () => {
    const base = foundationsInputs();
    const domain = latticeDomains()[0]!;
    resources.length = 0;
    await pulumi.runtime.runInPulumiStack(async () => {
      const provider = new k8s.Provider("missing-object-cluster", {
        kubeconfig: "apiVersion: v1",
      });
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
            capabilities: capabilities().consumer,
            secrets: secrets(),
            inputs: {
              ...base,
              meridian: {
                ...base.meridian,
                domains: [domain],
                sharedResourceStores: [latticeSharedStore()],
                domainRuntimeSelections: {
                  [domain.id]: {
                    distribution: runtimeDistributionFixture().selection,
                    engines: [structuredEngine()],
                    runtimeReferences: base.meridian.runtimeReferences!,
                  },
                },
              },
            },
          },
          { preflight },
        ),
      ).rejects.toThrow("requires a Foundations-selected object binding");
      return {};
    });
    expect(
      resources.filter(({ type }) => !type.startsWith("pulumi:")),
    ).toHaveLength(0);
  });

  it("projects durable metadata bindings independently of the default runtime and Engine locks", async () => {
    const base = foundationsInputs();
    const durable = durableRuntimeDistributionFixture();
    const structured = structuredEngine(true);
    const result = await runDeployment({
      ...base,
      meridian: {
        ...base.meridian,
        domains: [
          domainRequirements("prism-composition", "prism.composition", true),
        ],
        domainRuntimeSelections: {
          "prism-composition": {
            distribution: durable.selection,
            engines: [
              structured,
              {
                ...structured,
                bindingId: "metadata",
                physicalNamespace: "prism_metadata",
              },
            ],
            runtimeReferences: base.meridian.runtimeReferences ?? [],
            metadataBindingId: "metadata",
          },
        },
      },
    });
    const runtime = result.published.get(
      "juntai.platform.meridian-runtime",
    ) as MeridianRuntimeOutput;
    expect(runtime.distribution.descriptor).toEqual(
      runtimeDistributionFixture().descriptor,
    );
    const domain = runtime.domainRuntimes!["prism-composition"]!;
    expect(domain.distribution.descriptor).toEqual(durable.descriptor);
    expect(domain.metadataBindingId).toBe("metadata");
    expect(domain.metadataBindingFingerprint).toBe(
      base.meridian.engines[0]!.requiredPhysicalFingerprint,
    );
    const descriptor = result.registered.find(
      ({ name }) =>
        name === "foundations-meridian-prism-composition-distribution",
    )!;
    expect(descriptor.inputs.data).toEqual({
      "runtime-distribution.v1.json": durable.text,
    });
    const config = result.registered.find(
      ({ type, inputs }) =>
        type === "kubernetes:core/v1:ConfigMap" &&
        JSON.stringify(inputs).includes(
          "juntai-meridian-prism-composition-config",
        ),
    )!;
    const body = JSON.parse(
      (config.inputs.data as Record<string, string>)[
        "meridian-config.v1.json"
      ]!,
    ) as {
      catalogs: { providers: { name: string }[] };
      resources: { pins: unknown[] };
      placements: { id: string; bindingId: string }[];
      bindings: {
        extensions: Record<string, { packages: Record<string, string> }>;
      }[];
    };
    expect(
      body.catalogs.providers.map((p: { name: string }) => p.name).sort(),
    ).toEqual(["evidence", "structured"]);
    expect(body.resources.pins).toContainEqual(
      expect.objectContaining({
        requiredFingerprint:
          "sha256:b02229d273a6c5439da926c7be897dbcc2545bb1778d72f124cb0b8528487b39",
      }),
    );
    expect(
      body.placements.find((p: { id: string }) => p.id.endsWith("-metadata"))
        ?.bindingId,
    ).toBe("metadata");
    for (const binding of body.bindings) {
      expect(
        binding.extensions["org.meridian.constructs/package-lock.v1"]!.packages[
          "meridian-storage-semantics"
        ],
      ).toBe("2.1.0");
    }
    expect(JSON.stringify(body)).not.toContain("platform.account");
  });

  it("grants only explicit domain workloads access to selected foundation destinations", async () => {
    const grant = {
      service: "blueprint" as const,
      namespace: "prism",
      workloadName: "prism-component",
    };
    const result = await runDeployment({
      ...foundationsInputs(),
      serviceConsumers: [grant],
    });
    const policy = result.registered.find(
      ({ name }) => name === "foundations-blueprint-consumers",
    )!;
    expect(policy.inputs.spec).toMatchObject({
      podSelector: { matchLabels: { "app.kubernetes.io/name": "blueprint" } },
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prism" },
              },
              podSelector: {
                matchLabels: { "app.kubernetes.io/name": "prism-component" },
              },
            },
          ],
          ports: [{ protocol: "TCP", port: 8080 }],
        },
      ],
    });
    expect(
      result.registered.some(
        ({ name }) => name === "foundations-application-metadata-consumers",
      ),
    ).toBe(false);
    expect(
      result.published.get("juntai.platform.foundation-services"),
    ).toMatchObject({ consumers: [grant] });
    const gateway = result.published.get("juntai.platform.gateway-set") as {
      dataPlaneNamespace: pulumi.Output<string>;
    };
    expect(
      await new Promise((resolve) => gateway.dataPlaneNamespace.apply(resolve)),
    ).toBe("envoy-gateway-system");
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
    const telemetry = result.published.get(
      "juntai.platform.observability-gateway",
    ) as { endpoint: pulumi.Output<string> };
    expect(
      await new Promise((resolve) => telemetry.endpoint.apply(resolve)),
    ).toMatch(/^https:\/\//);
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
