import type { Sha256Digest, VerifiedArtifact } from "./artifacts.js";
import {
  ACCOUNT_CONTRACT_BUNDLE,
  ACCOUNT_DEPLOYMENT_MANIFEST,
  ACCOUNT_IMAGE,
  ACCOUNT_MERIDIAN_PROVIDER,
  ACCOUNT_OPENAPI,
  ACCOUNT_RELEASE_MANIFEST,
  APPLICATION_METADATA_IMAGE,
  APPLICATION_METADATA_MIGRATION,
  APPLICATION_METADATA_OPENAPI,
  APPLICATION_METADATA_RELEASE_CONTRACT,
  APPLICATION_METADATA_RELEASE_MANIFEST,
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
  readonly manifests?: readonly VerifiedArtifact[];
}

export interface ServiceDeployment {
  readonly namespace: string;
  readonly serviceName: string;
  readonly port: number;
  readonly protocols: readonly ("http" | "grpc")[];
  readonly gatewaySurface?: "internal" | "operator" | "platform" | "public";
  readonly routePrefix?: `/${string}`;
  readonly contractPathPrefix?: `/${string}`;
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
      id: "platform.account",
      release: Object.freeze({
        version: "2.1.5",
        image: ACCOUNT_IMAGE,
        imageDigest:
          "sha256:2f657c47b6aa556f86b1b67b8164180d7aa2fb3c23dbd3c80a20a709edcb8adf",
        sourceCommit: "e0cd8c44bbbb6856a098058dba9eeaa7e74693cc",
        manifests: Object.freeze([
          ACCOUNT_DEPLOYMENT_MANIFEST,
          ACCOUNT_RELEASE_MANIFEST,
          ACCOUNT_CONTRACT_BUNDLE,
          ACCOUNT_MERIDIAN_PROVIDER,
        ]),
      }),
      deployment: Object.freeze({
        namespace: "juntai-platform",
        serviceName: "account",
        port: 8080,
        protocols: Object.freeze(["http"] as const),
        gatewaySurface: "platform",
        routePrefix: "/api/platform.account/v1",
        storageBoundary:
          "in-process-Meridian-public-data-access-contracts-with-platform-composition",
        migration:
          "platform-registered-logical-resources; no production data migration",
        recovery: "disable-route-and-workload; retain-Meridian-managed-data",
      }),
      artifacts: Object.freeze([
        Object.freeze({
          id: "account-openapi",
          format: "openapi",
          mediaType: "application/json",
          ...ACCOUNT_OPENAPI,
          compatibility: Object.freeze({
            format: "openapi",
            documentVersion: "3.1",
            title: "Juntai Account Service",
            version: "1.0.0",
            requiredPaths: Object.freeze([
              "/api/platform.account/v1/accounts/{accountId}",
              "/api/platform.account/v1/accounts/{accountId}/profile",
            ]),
          }),
        }),
      ]),
    }),
    Object.freeze({
      id: "platform.application-metadata",
      release: Object.freeze({
        version: "3.0.2",
        image: APPLICATION_METADATA_IMAGE,
        imageDigest:
          "sha256:19ee6fd561b5dc2c139f31c563f1b6316d5523ede7221d9f6404090ac5fb08cb",
        sourceCommit: "34edbb5f8247a46cfe4142b03f442788d1706d10",
        manifests: Object.freeze([
          APPLICATION_METADATA_RELEASE_CONTRACT,
          APPLICATION_METADATA_RELEASE_MANIFEST,
          APPLICATION_METADATA_MIGRATION,
        ]),
      }),
      deployment: Object.freeze({
        namespace: "juntai-platform",
        serviceName: "application-metadata",
        port: 8080,
        protocols: Object.freeze(["http"] as const),
        gatewaySurface: "platform",
        routePrefix: "/api/platform/applications/v1",
        contractPathPrefix: "/v1",
        storageBoundary:
          "in-process-Meridian-structured-and-config-artifact-plugin",
        migration:
          "platform-managed-Meridian-logical-migration-juntai.application-metadata/1-to-2",
        recovery:
          "retain-v1-export-read-only-until-platform-cutover-acceptance",
      }),
      artifacts: Object.freeze([
        Object.freeze({
          id: "application-metadata-openapi",
          format: "openapi",
          mediaType: "application/json",
          ...APPLICATION_METADATA_OPENAPI,
          compatibility: Object.freeze({
            format: "openapi",
            documentVersion: "3.1",
            title: "Juntai Application Metadata",
            version: "3.0.2",
            requiredPaths: Object.freeze([
              "/v1/applications",
              "/v1/applications/{application_id}/versions",
            ]),
          }),
        }),
      ]),
    }),
    Object.freeze({
      id: "platform.blueprint",
      release: Object.freeze({
        version: "3.0.2",
        image: BLUEPRINT_IMAGE,
        imageDigest:
          "sha256:3dfb716006175c32027ac04e325f7e6269911b3e5900ceda04668c240ab7019a",
        sourceCommit: "d4b8a9761350a6892659b260802bf83e905f2574",
      }),
      deployment: Object.freeze({
        namespace: "juntai-platform",
        serviceName: "blueprint",
        port: 8080,
        protocols: Object.freeze(["http"] as const),
        gatewaySurface: "platform",
        routePrefix: "/api/blueprints/v1",
        storageBoundary: "in-process-Meridian-config-artifact-plugin",
        migration: "not-required-by-3.0.2-release-contract",
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
            version: "3.0.2",
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
