import type { Sha256Digest, VerifiedArtifact } from "./artifacts.js";
import {
  BLUEPRINT_IMAGE,
  BLUEPRINT_OPENAPI,
  CASDOOR_IMAGE,
} from "./release.js";

export type ContractFormat = "openapi" | "protobuf-file-descriptor-set";

export interface OpenApiCompatibility {
  readonly format: "openapi";
  readonly documentVersion: `${number}.${number}`;
  readonly title: string;
  readonly version: string;
  readonly requiredPaths: readonly string[];
}

export interface ProtobufCompatibility {
  readonly format: "protobuf-file-descriptor-set";
  readonly requiredPackages: readonly string[];
  readonly requiredServices: readonly string[];
}

export interface ContractArtifact extends VerifiedArtifact {
  readonly id: string;
  readonly format: ContractFormat;
  readonly mediaType: string;
  readonly compatibility: OpenApiCompatibility | ProtobufCompatibility;
}

export interface ServiceRelease {
  readonly version: string;
  readonly sourceCommit: string;
  readonly releaseTagCommit?: string;
  readonly image: string;
  readonly imageDigest: Sha256Digest;
}

export interface ServiceDeployment {
  readonly namespace: string;
  readonly serviceName: string;
  readonly port: number;
  readonly protocols: readonly ("http" | "grpc")[];
  readonly gatewaySurface?: "internal" | "operator" | "platform" | "public";
  readonly routePrefix?: `/${string}`;
  readonly storageBoundary: string;
  readonly migration: string;
  readonly recovery: string;
}

export interface FoundationServiceDeclaration {
  readonly id: string;
  readonly implementation?: string;
  readonly distribution?: string;
  readonly release: ServiceRelease;
  readonly deployment: ServiceDeployment;
  readonly artifacts: readonly ContractArtifact[];
  readonly bootstrap?: string;
}

export interface FoundationServiceCatalog {
  readonly schemaVersion: "juntai.platform/foundation-service-releases/v1";
  readonly contractResolution: string;
  readonly services: readonly FoundationServiceDeclaration[];
}

export const FOUNDATION_SERVICE_CATALOG = Object.freeze({
  schemaVersion: "juntai.platform/foundation-service-releases/v1",
  contractResolution:
    "fetch-and-sha256-verify-at-execution; compose-in-memory; never-vendor",
  services: Object.freeze([
    Object.freeze({
      id: "foundation.iam",
      implementation: "Casdoor",
      distribution: "official-unmodified",
      release: Object.freeze({
        version: "3.125.0",
        image: CASDOOR_IMAGE,
        imageDigest:
          "sha256:d7658640aba370495e59dc1464756d2ae7ec66576203b9de0040e9cc37793607",
        sourceCommit: "8bb6c391480b2ac9ea04d3e2b5d3c7ab12115b1f",
        releaseTagCommit: "7d2ad5faba830a74fabba914921a8d47a5b511d0",
      }),
      deployment: Object.freeze({
        namespace: "juntai-iam",
        serviceName: "casdoor",
        port: 8000,
        protocols: Object.freeze(["http"] as const),
        gatewaySurface: "public",
        routePrefix: "/api/identity",
        storageBoundary:
          "deployment-selected Meridian structured Engine binding",
        migration: "official-Casdoor-schema-through-release-configuration",
        recovery: "scheduled-idempotent-desired-state-reconciliation",
      }),
      bootstrap: "supported-public-api",
      artifacts: Object.freeze([]),
    }),
    Object.freeze({
      id: "platform.blueprint",
      release: Object.freeze({
        version: "3.0.0",
        image: BLUEPRINT_IMAGE,
        imageDigest:
          "sha256:5bfbcdd4073e3b0c16730904691310d8ccd6b913a2a525d3263d52535578fcdc",
        sourceCommit: "0da9bf43a6323f00ba7dc292847a600924f7f15a",
      }),
      deployment: Object.freeze({
        namespace: "juntai-platform",
        serviceName: "blueprint",
        port: 8080,
        protocols: Object.freeze(["http"] as const),
        gatewaySurface: "platform",
        routePrefix: "/api/blueprints/v1",
        storageBoundary: "in-process-Meridian-config-artifact-plugin",
        migration: "not-required-by-3.0.0-release-contract",
        recovery: "Meridian-binding-owned",
      }),
      artifacts: Object.freeze([
        Object.freeze({
          id: "blueprint-openapi",
          format: "openapi",
          mediaType: "application/json",
          ...BLUEPRINT_OPENAPI,
          compatibility: Object.freeze({
            format: "openapi",
            documentVersion: "3.1",
            title: "Juntai Blueprint Service",
            version: "3.0.0",
            requiredPaths: Object.freeze(["/api/blueprints/v1/assets"]),
          }),
        }),
      ]),
    }),
  ]),
}) satisfies FoundationServiceCatalog;

export function serviceDeclaration(
  serviceId: string,
  catalog: FoundationServiceCatalog = FOUNDATION_SERVICE_CATALOG,
): FoundationServiceDeclaration {
  const declaration = catalog.services.find(({ id }) => id === serviceId);
  if (declaration === undefined) {
    throw new Error(`unknown foundation service declaration '${serviceId}'`);
  }
  return declaration;
}
