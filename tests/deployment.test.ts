import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";
import { deployFoundations } from "../src/package.js";
import type { ArtifactFetcher } from "../src/artifacts.js";
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

const fetcher: ArtifactFetcher = async (artifact) => {
  if (artifact.uri.endsWith(".json")) {
    return new TextEncoder().encode(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Juntai Blueprint Service", version: "3.0.0" },
        paths: { "/api/blueprints/v1/assets": {} },
      }),
    );
  }
  return new TextEncoder().encode(
    "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: verified-upstream\n  namespace: default\n",
  );
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
        { fetcher },
      );
      return result.outputs;
    });
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
      blueprint: { ...base.blueprint, enabled: false },
      casdoor: { ...base.casdoor, reconciliationSchedule: "0 4 * * *" },
    });
    expect(result.published.size).toBe(4);
    expect(
      result.registered.some(
        (entry) =>
          entry.type === "juntai:platform:JuntaiService" &&
          entry.name.includes("blueprint"),
      ),
    ).toBe(false);
    expect(JSON.stringify(result.registered)).toContain("gateway-public-tls");
    expect(JSON.stringify(result.registered)).toContain(
      "OTEL_EXPORTER_AUTHORIZATION",
    );
  });
});
