import type { ImmutableReleaseInput } from "./contract.js";

export const FOUNDATIONS_PACKAGE_VERSION = "1.2.5" as const;
export const FOUNDATIONS_PACKAGE_ID = "juntai.platform.substrate" as const;

export const CASDOOR_IMAGE =
  "docker.io/casbin/casdoor@sha256:d7658640aba370495e59dc1464756d2ae7ec66576203b9de0040e9cc37793607";
export const CASDOOR_BOOTSTRAP_IMAGE =
  "ghcr.io/zephytiju/juntai-platform-casdoor-bootstrap@sha256:6282606098e982d9d6880819e7c895c4bd9696318a014eeb04f5b190821edf9b";
export const BLUEPRINT_IMAGE =
  "ghcr.io/zephytiju/juntai-blueprint-marketplace@sha256:3dfb716006175c32027ac04e325f7e6269911b3e5900ceda04668c240ab7019a";
export const ACCOUNT_IMAGE =
  "ghcr.io/zephytiju/juntai-account-service@sha256:2f657c47b6aa556f86b1b67b8164180d7aa2fb3c23dbd3c80a20a709edcb8adf";
export const APPLICATION_METADATA_IMAGE =
  "ghcr.io/zephytiju/juntai-application-metadata@sha256:19ee6fd561b5dc2c139f31c563f1b6316d5523ede7221d9f6404090ac5fb08cb";
export const OTEL_COLLECTOR_IMAGE =
  "docker.io/otel/opentelemetry-collector-contrib@sha256:93aad750175cbf1a973ae1c5886c3371f4d800f61be25cdd26870b8441ffe9fa";

export const GATEWAY_API_MANIFEST = Object.freeze({
  uri: "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.5.1/standard-install.yaml",
  digest:
    "sha256:751002b3b91a87f7ae3bd2517c79a47a8d7ed6702901808a1cf9bd97d284f9b8",
});
export const ENVOY_GATEWAY_MANIFEST = Object.freeze({
  uri: "https://github.com/envoyproxy/gateway/releases/download/v1.8.3/install.yaml",
  digest:
    "sha256:37a62afe9bb07d87e86c5c2cff32f046f17397cb4fca9f2a741165826212d781",
});
export const BLUEPRINT_OPENAPI = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiBlueprintMarketplace/releases/download/v3.0.2/blueprint-service.v1.json",
  digest:
    "sha256:e1457e42a9844f26b5716d4627fefe496f318ea7e3d6b4fd0a70a812a0e84165",
});
export const ACCOUNT_OPENAPI = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.5/account-service.v1.openapi.json",
  digest:
    "sha256:56910abbac64d3c8a7065c001d7c69b291c59f0904355c2cc7dacb0f9ad58695",
});
export const ACCOUNT_DEPLOYMENT_MANIFEST = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.5/deployment-manifest.v1.json",
  digest:
    "sha256:b8317ed2ba0cf0fa9d42d46eaf95956c010a9da8a1d55c8d9136979b4483458f",
});
export const ACCOUNT_RELEASE_MANIFEST = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.5/release-manifest.v1.json",
  digest:
    "sha256:1810bd82d3f1bef0bb6e83ebe09c835a893aaca48ef1367db1aa8835b2c25de0",
});
export const ACCOUNT_CONTRACT_BUNDLE = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.5/juntai-account-contracts-2.1.5.json",
  digest:
    "sha256:698b2a264f300bed70070d101c86b3ecfd364434cbb30d7f17cdbbb5a3a3e8c5",
});
export const ACCOUNT_MERIDIAN_PROVIDER = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.5/account-meridian-provider.v1.json",
  digest:
    "sha256:7745367cd1b1b5f65929e779adf222595f7536cd48ed1455bd03295faa0ecccb",
});
export const APPLICATION_METADATA_OPENAPI = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiApplicationMetadata/releases/download/v3.0.2/application-metadata.v1.json",
  digest:
    "sha256:ef15f29569ea44a5013dc9ddba6e9ef889e38b08e8815dd2766511c298f7d9eb",
});
export const APPLICATION_METADATA_RELEASE_CONTRACT = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiApplicationMetadata/releases/download/v3.0.2/release-contract.v1.json",
  digest:
    "sha256:79d40670008753e786f01a9de07d554f420702e68fe606be2fcddaaaada5a019",
});
export const APPLICATION_METADATA_RELEASE_MANIFEST = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiApplicationMetadata/releases/download/v3.0.2/release-manifest.json",
  digest:
    "sha256:4e47658e074150a1537b75554685d32587a952e7d6f34e374ba591bbec099031",
});
export const APPLICATION_METADATA_MIGRATION = Object.freeze({
  uri: "https://raw.githubusercontent.com/zephytiju/JuntaiApplicationMetadata/34edbb5f8247a46cfe4142b03f442788d1706d10/migrations/application-metadata.v2.json",
  digest:
    "sha256:a66d986e8b7e663b37275f1be39bb7cd6e87582abe315eca720c218ebe3f79a1",
});

export const releaseInputs: readonly ImmutableReleaseInput[] = Object.freeze([
  {
    id: "account-contract-bundle",
    ...ACCOUNT_CONTRACT_BUNDLE,
  },
  {
    id: "account-deployment-manifest",
    ...ACCOUNT_DEPLOYMENT_MANIFEST,
  },
  {
    id: "account-image",
    uri: ACCOUNT_IMAGE,
    digest:
      "sha256:2f657c47b6aa556f86b1b67b8164180d7aa2fb3c23dbd3c80a20a709edcb8adf",
  },
  { id: "account-meridian-provider", ...ACCOUNT_MERIDIAN_PROVIDER },
  { id: "account-openapi", ...ACCOUNT_OPENAPI },
  { id: "account-release-manifest", ...ACCOUNT_RELEASE_MANIFEST },
  {
    id: "application-metadata-image",
    uri: APPLICATION_METADATA_IMAGE,
    digest:
      "sha256:19ee6fd561b5dc2c139f31c563f1b6316d5523ede7221d9f6404090ac5fb08cb",
  },
  {
    id: "application-metadata-logical-migration",
    ...APPLICATION_METADATA_MIGRATION,
  },
  { id: "application-metadata-openapi", ...APPLICATION_METADATA_OPENAPI },
  {
    id: "application-metadata-release-contract",
    ...APPLICATION_METADATA_RELEASE_CONTRACT,
  },
  {
    id: "application-metadata-release-manifest",
    ...APPLICATION_METADATA_RELEASE_MANIFEST,
  },
  {
    id: "blueprint-image",
    uri: BLUEPRINT_IMAGE,
    digest:
      "sha256:3dfb716006175c32027ac04e325f7e6269911b3e5900ceda04668c240ab7019a",
  },
  { id: "blueprint-openapi", ...BLUEPRINT_OPENAPI },
  {
    id: "casdoor-bootstrap-image",
    uri: CASDOOR_BOOTSTRAP_IMAGE,
    digest:
      "sha256:6282606098e982d9d6880819e7c895c4bd9696318a014eeb04f5b190821edf9b",
  },
  {
    id: "casdoor-image",
    uri: CASDOOR_IMAGE,
    digest:
      "sha256:d7658640aba370495e59dc1464756d2ae7ec66576203b9de0040e9cc37793607",
  },
  { id: "envoy-gateway-install", ...ENVOY_GATEWAY_MANIFEST },
  { id: "gateway-api-standard", ...GATEWAY_API_MANIFEST },
  {
    id: "juntai-platform-constructs",
    uri: "https://registry.npmjs.org/@zephytiju/juntai-platform-constructs/-/juntai-platform-constructs-1.0.0.tgz",
    digest:
      "sha256:62412821373d48922a0beeb24b644dd061e4f8d37e692287e7ac731ebfb431e2",
  },
  {
    id: "meridian-storage-constructs",
    uri: "https://registry.npmjs.org/@zephytiju/meridian-storage-constructs/-/meridian-storage-constructs-1.0.0.tgz",
    digest:
      "sha256:7b853db0e745863517245378a10fc7651ed8f515e763ea8d95258b65aee5dbd5",
  },
  {
    id: "otel-collector-image",
    uri: OTEL_COLLECTOR_IMAGE,
    digest:
      "sha256:93aad750175cbf1a973ae1c5886c3371f4d800f61be25cdd26870b8441ffe9fa",
  },
]);
