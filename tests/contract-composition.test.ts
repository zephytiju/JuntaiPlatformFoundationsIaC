import { describe, expect, it } from "vitest";
import { sha256 } from "../src/artifacts.js";
import { resolveAndComposeServiceContracts } from "../src/contract-composition.js";
import type {
  ContractArtifact,
  FoundationServiceCatalog,
  FoundationServiceDeclaration,
} from "../src/service-contracts.js";

function lengthDelimited(field: number, payload: readonly number[]): number[] {
  if (payload.length >= 128) throw new Error("test payload is too large");
  return [(field << 3) | 2, payload.length, ...payload];
}

function textField(field: number, value: string): number[] {
  return lengthDelimited(field, [...new TextEncoder().encode(value)]);
}

function descriptorSet(packageName: string, serviceName: string): Uint8Array {
  const service = textField(1, serviceName);
  const file = [...textField(2, packageName), ...lengthDelimited(6, service)];
  return Uint8Array.from(lengthDelimited(1, file));
}

function release(serviceId: string): FoundationServiceDeclaration["release"] {
  const normalized =
    `sha256:${(serviceId === "one" ? "a" : "b").repeat(64)}` as const;
  return {
    version: "1.0.0",
    sourceCommit: "1".repeat(40),
    image: `registry.example.test/${serviceId}@${normalized}`,
    imageDigest: normalized,
  };
}

function catalog(
  services: readonly FoundationServiceDeclaration[],
): FoundationServiceCatalog {
  return {
    schemaVersion: "juntai.platform/foundation-service-releases/v1",
    contractResolution: "test",
    services,
  };
}

function openApiService(
  id: string,
  bytes: Uint8Array,
  path = "/api/widgets/v1/items",
): FoundationServiceDeclaration {
  return {
    id,
    release: release(id),
    deployment: {
      namespace: "platform",
      serviceName: id.replaceAll(".", "-"),
      port: 8080,
      protocols: ["http"],
      gatewaySurface: "platform",
      routePrefix: "/api/widgets/v1",
      storageBoundary: "none",
      migration: "none",
      recovery: "none",
    },
    artifacts: [
      {
        id: `${id}-openapi`,
        format: "openapi",
        mediaType: "application/json",
        uri: `https://example.test/releases/download/v1.0.0/${id}.json`,
        digest: sha256(bytes),
        compatibility: {
          format: "openapi",
          documentVersion: "3.1",
          title: `${id} API`,
          version: "1.0.0",
          requiredPaths: [path],
        },
      },
    ],
  };
}

function openApiBytes(id: string, options: { externalRef?: boolean } = {}) {
  return new TextEncoder().encode(
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: `${id} API`, version: "1.0.0" },
      paths: {
        "/api/widgets/v1/items": {
          get: {
            operationId: "listItems",
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      $ref: options.externalRef
                        ? "https://example.test/common.json#/Widget"
                        : "#/components/schemas/Widget",
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: { Widget: { type: "object", properties: { id: {} } } },
      },
    }),
  );
}

describe("service contract composition", () => {
  it("composes namespaced OpenAPI and compatible Protobuf inputs in memory", async () => {
    const openApi = openApiBytes("widgets");
    const protobuf = descriptorSet("juntai.widgets.v1", "WidgetService");
    const protobufArtifact: ContractArtifact = {
      id: "widgets-protobuf",
      format: "protobuf-file-descriptor-set",
      mediaType: "application/vnd.juntai.protobuf.descriptor.v1",
      uri: `oci://registry.example.test/contracts/widgets@sha256:${"c".repeat(64)}`,
      digest: sha256(protobuf),
      compatibility: {
        format: "protobuf-file-descriptor-set",
        requiredPackages: ["juntai.widgets.v1"],
        requiredServices: ["juntai.widgets.v1.WidgetService"],
      },
    };
    const declarations = catalog([
      openApiService("widgets", openApi),
      {
        id: "widgets-grpc",
        release: release("widgets-grpc"),
        deployment: {
          namespace: "platform",
          serviceName: "widgets-grpc",
          port: 9090,
          protocols: ["grpc"],
          storageBoundary: "none",
          migration: "none",
          recovery: "none",
        },
        artifacts: [protobufArtifact],
      },
    ]);
    const byId = new Map([
      ["widgets-openapi", openApi],
      ["widgets-protobuf", protobuf],
    ]);
    const composed = await resolveAndComposeServiceContracts({
      catalog: declarations,
      fetcher: async (artifact) => byId.get(artifact.id ?? "")!,
    });
    expect(JSON.stringify(composed.aggregateOpenApi)).toContain(
      "widgets__Widget",
    );
    expect(JSON.stringify(composed.aggregateOpenApi)).toContain(
      "widgets__listItems",
    );
    expect(composed.protobufServices).toEqual([
      "juntai.widgets.v1.WidgetService",
    ]);
    expect(composed.routes).toEqual([
      expect.objectContaining({
        serviceId: "widgets",
        pathPrefix: "/api/widgets/v1",
        operationIds: ["widgets__listItems"],
      }),
    ]);
    expect(composed.bindings.map(({ protocol }) => protocol)).toEqual([
      "http",
      "grpc",
    ]);
    expect(composed.evidence.artifacts).toHaveLength(2);
    expect(composed.evidence.compositionDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("produces identical evidence when credential-specific fetchers return identical bytes", async () => {
    const bytes = openApiBytes("widgets");
    const declaration = catalog([openApiService("widgets", bytes)]);
    const local = await resolveAndComposeServiceContracts({
      catalog: declaration,
      fetcher: async () => bytes,
    });
    const ci = await resolveAndComposeServiceContracts({
      catalog: declaration,
      fetcher: async () => Uint8Array.from(bytes),
    });
    expect(ci.evidence).toEqual(local.evidence);
  });

  it("rejects mismatched, incompatible, externally referenced, and conflicting contracts", async () => {
    const valid = openApiBytes("widgets");
    await expect(
      resolveAndComposeServiceContracts({
        catalog: catalog([openApiService("widgets", valid)]),
        fetcher: async () => new TextEncoder().encode("changed"),
      }),
    ).rejects.toThrow(/digest mismatch/);

    const missing = new TextEncoder().encode(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "widgets API", version: "1.0.0" },
        paths: {},
      }),
    );
    await expect(
      resolveAndComposeServiceContracts({
        catalog: catalog([openApiService("widgets", missing)]),
        fetcher: async () => missing,
      }),
    ).rejects.toThrow(/missing required path/);

    const external = openApiBytes("widgets", { externalRef: true });
    await expect(
      resolveAndComposeServiceContracts({
        catalog: catalog([openApiService("widgets", external)]),
        fetcher: async () => external,
      }),
    ).rejects.toThrow(/external or non-component/);

    await expect(
      resolveAndComposeServiceContracts({
        catalog: catalog([
          openApiService("one", openApiBytes("one")),
          openApiService("two", openApiBytes("two")),
        ]),
        fetcher: async (artifact) =>
          artifact.id === "one-openapi"
            ? openApiBytes("one")
            : openApiBytes("two"),
      }),
    ).rejects.toThrow(/more than one foundation service/);
  });

  it("rejects catalog and Protobuf compatibility violations before mutation", async () => {
    const protobuf = descriptorSet("juntai.widgets.v1", "WidgetService");
    const service: FoundationServiceDeclaration = {
      id: "widgets-grpc",
      release: release("widgets-grpc"),
      deployment: {
        namespace: "platform",
        serviceName: "widgets-grpc",
        port: 9090,
        protocols: ["grpc"],
        storageBoundary: "none",
        migration: "none",
        recovery: "none",
      },
      artifacts: [
        {
          id: "widgets-protobuf",
          format: "protobuf-file-descriptor-set",
          mediaType: "application/vnd.juntai.protobuf.descriptor.v1",
          uri: `oci://registry.example.test/contracts/widgets@sha256:${"c".repeat(64)}`,
          digest: sha256(protobuf),
          compatibility: {
            format: "protobuf-file-descriptor-set",
            requiredPackages: ["juntai.missing.v1"],
            requiredServices: ["juntai.missing.v1.MissingService"],
          },
        },
      ],
    };
    await expect(
      resolveAndComposeServiceContracts({
        catalog: catalog([service]),
        fetcher: async () => protobuf,
      }),
    ).rejects.toThrow(/missing Protobuf package/);
    await expect(
      resolveAndComposeServiceContracts({
        catalog: catalog([service]),
        selectedServiceIds: ["not-declared"],
        fetcher: async () => protobuf,
      }),
    ).rejects.toThrow(/has no declaration/);

    const unpinned = {
      ...service,
      release: { ...service.release, image: "registry.example.test/latest" },
    };
    await expect(
      resolveAndComposeServiceContracts({
        catalog: catalog([unpinned]),
        fetcher: async () => protobuf,
      }),
    ).rejects.toThrow(/image is not pinned/);
  });
});
