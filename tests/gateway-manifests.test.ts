import { describe, expect, it } from "vitest";
import { parseAllDocuments, stringify } from "yaml";
import {
  ENVOY_GATEWAY_IDENTITIES,
  GATEWAY_MANIFEST_NORMALIZATIONS,
  GATEWAY_API_STANDARD_IDENTITIES,
  partitionGatewayManifests,
  physicalResourceKey,
  type PhysicalResourceIdentity,
} from "../src/gateway-manifests.js";

function resource(
  identity: PhysicalResourceIdentity,
  source: string,
): Record<string, unknown> {
  return {
    apiVersion: identity.apiVersion,
    kind: identity.kind,
    metadata: {
      name: identity.name,
      ...(identity.namespace === null ? {} : { namespace: identity.namespace }),
    },
    spec: {
      source,
      ...(physicalResourceKey(identity) ===
      "batch/v1|Job|envoy-gateway-system|eg-gateway-helm-certgen"
        ? { ttlSecondsAfterFinished: 30 }
        : {}),
    },
  };
}

function yaml(resources: readonly Record<string, unknown>[]): string {
  return resources
    .map((entry) => stringify(entry).trimEnd())
    .join("\n---\n")
    .concat("\n");
}

function sourceForOverlap(
  identity: PhysicalResourceIdentity,
  owner: "standard" | "envoy",
): string {
  return identity.kind.startsWith("ValidatingAdmissionPolicy")
    ? "shared-overlap"
    : `${owner}-definition`;
}

function fixtures(): {
  readonly gateway: string;
  readonly envoy: string;
} {
  return {
    gateway: yaml(
      GATEWAY_API_STANDARD_IDENTITIES.map((identity) =>
        resource(identity, sourceForOverlap(identity, "standard")),
      ),
    ),
    envoy: yaml([
      ...GATEWAY_API_STANDARD_IDENTITIES.map((identity) =>
        resource(identity, sourceForOverlap(identity, "envoy")),
      ),
      ...ENVOY_GATEWAY_IDENTITIES.map((identity) =>
        resource(identity, "envoy-owned"),
      ),
    ]),
  };
}

function keys(payload: string): readonly string[] {
  return parseAllDocuments(payload).map((document) => {
    const value = document.toJS() as {
      readonly apiVersion: string;
      readonly kind: string;
      readonly metadata: { readonly name: string; readonly namespace?: string };
    };
    return physicalResourceKey({
      apiVersion: value.apiVersion,
      kind: value.kind,
      namespace: value.metadata.namespace ?? null,
      name: value.metadata.name,
    });
  });
}

describe("Gateway manifest ownership", () => {
  it("assigns every overlap to Gateway API standard and keeps all remaining Envoy resources", () => {
    const input = fixtures();
    const partitioned = partitionGatewayManifests(input.gateway, input.envoy);
    const gatewayKeys = keys(partitioned.gatewayApiYaml);
    const envoyKeys = keys(partitioned.envoyGatewayYaml);

    expect(gatewayKeys).toEqual(
      GATEWAY_API_STANDARD_IDENTITIES.map(physicalResourceKey),
    );
    expect(envoyKeys).toEqual(
      [...ENVOY_GATEWAY_IDENTITIES.map(physicalResourceKey)].sort(
        (left, right) => {
          const inputOrder = ENVOY_GATEWAY_IDENTITIES.map(physicalResourceKey);
          return inputOrder.indexOf(left) - inputOrder.indexOf(right);
        },
      ),
    );
    expect(new Set([...gatewayKeys, ...envoyKeys]).size).toBe(40);
    expect(partitioned.ownership).toHaveLength(40);
    expect(
      partitioned.ownership.filter(
        ({ owner }) => owner === "gateway-api-standard",
      ),
    ).toHaveLength(10);
    expect(
      partitioned.ownership.filter(
        ({ owner }) => owner === "envoy-gateway-install",
      ),
    ).toHaveLength(30);
    expect(partitioned.gatewayApiYaml).toContain("standard-definition");
    expect(partitioned.gatewayApiYaml).not.toContain("envoy-definition");
    const certgenJob = parseAllDocuments(partitioned.envoyGatewayYaml)
      .map((document) => document.toJS() as Record<string, unknown>)
      .find(
        (entry) =>
          entry.kind === "Job" &&
          (entry.metadata as { readonly name?: string }).name ===
            "eg-gateway-helm-certgen",
      );
    expect(certgenJob).toBeDefined();
    expect(certgenJob).not.toHaveProperty("spec.ttlSecondsAfterFinished");
    expect(GATEWAY_MANIFEST_NORMALIZATIONS).toEqual([
      {
        owner: "envoy-gateway-install",
        resourceKey:
          "batch/v1|Job|envoy-gateway-system|eg-gateway-helm-certgen",
        removedInput: "spec.ttlSecondsAfterFinished",
        expectedSourceValue: 30,
        purpose:
          "retain the completed package-owned Job for stable desired state",
      },
    ]);
  });

  it("fails closed if the reviewed certgen Job TTL drifts", () => {
    const input = fixtures();
    expect(() =>
      partitionGatewayManifests(
        input.gateway,
        input.envoy.replace(
          "ttlSecondsAfterFinished: 30",
          "ttlSecondsAfterFinished: 60",
        ),
      ),
    ).toThrow(/source TTL drifted from the reviewed value 30/);
  });

  it("fails closed on a duplicate or drifted physical identity", () => {
    const input = fixtures();
    const duplicate = `${input.gateway}\n---\n${stringify(
      resource(GATEWAY_API_STANDARD_IDENTITIES[0]!, "duplicate"),
    )}`;
    expect(() => partitionGatewayManifests(duplicate, input.envoy)).toThrow(
      /duplicate physical identity/,
    );
    expect(() =>
      partitionGatewayManifests(
        input.gateway.replace(
          "backendtlspolicies.gateway.networking.k8s.io",
          "unexpected.gateway.networking.k8s.io",
        ),
        input.envoy,
      ),
    ).toThrow(/physical identity drift/);
  });

  it("fails closed when the approved overlap payload relationship changes", () => {
    const input = fixtures();
    expect(() =>
      partitionGatewayManifests(
        input.gateway.replaceAll("standard-definition", "envoy-definition"),
        input.envoy,
      ),
    ).toThrow(/expected different/);
    expect(() =>
      partitionGatewayManifests(
        input.gateway.replace("shared-overlap", "changed-shared-overlap"),
        input.envoy,
      ),
    ).toThrow(/expected equivalent/);
  });

  it("rejects malformed Kubernetes documents", () => {
    const input = fixtures();
    expect(() =>
      partitionGatewayManifests(
        input.gateway.replace(
          "name: backendtlspolicies.gateway.networking.k8s.io",
          "name: ''",
        ),
        input.envoy,
      ),
    ).toThrow(/metadata.name/);
  });
});
