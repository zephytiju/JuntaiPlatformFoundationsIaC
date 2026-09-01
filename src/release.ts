import type { ImmutableReleaseInput } from "./contract.js";

export const FOUNDATIONS_PACKAGE_VERSION = "1.2.4" as const;
export const FOUNDATIONS_PACKAGE_ID = "juntai.platform.substrate" as const;

export const CASDOOR_IMAGE =
  "docker.io/casbin/casdoor@sha256:d7658640aba370495e59dc1464756d2ae7ec66576203b9de0040e9cc37793607";
export const CASDOOR_BOOTSTRAP_IMAGE =
  "ghcr.io/zephytiju/juntai-platform-casdoor-bootstrap@sha256:6282606098e982d9d6880819e7c895c4bd9696318a014eeb04f5b190821edf9b";
export const BLUEPRINT_IMAGE =
  "ghcr.io/zephytiju/juntai-blueprint-marketplace@sha256:5bfbcdd4073e3b0c16730904691310d8ccd6b913a2a525d3263d52535578fcdc";
export const ACCOUNT_IMAGE =
  "ghcr.io/zephytiju/juntai-account-service@sha256:26c7c5e2f109aeeb47157f45bd95f2df6e34b9de83085fe1bc32512f9c7cd084";
export const APPLICATION_METADATA_IMAGE =
  "ghcr.io/zephytiju/juntai-application-metadata@sha256:66ccf5d5e0bb77564f7d5fd8bd3a7d673bbf4f0c5ce4f438e4e48eec0ef26872";
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
  uri: "https://github.com/zephytiju/JuntaiBlueprintMarketplace/releases/download/v3.0.0/blueprint-service.v1.json",
  digest:
    "sha256:0a1d34129ed514fc0e7b227c6d23fbff61f025de209d0ebeedd0cf618a6bd26d",
});
export const ACCOUNT_OPENAPI = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.4/account-service.v1.openapi.json",
  digest:
    "sha256:56910abbac64d3c8a7065c001d7c69b291c59f0904355c2cc7dacb0f9ad58695",
});
export const ACCOUNT_DEPLOYMENT_MANIFEST = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.4/deployment-manifest.v1.json",
  digest:
    "sha256:5bde3a4a98f4da4e80f3aedc1eec1c6eb15e433828a630d1f31e7171d7857df2",
});
export const ACCOUNT_RELEASE_MANIFEST = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.4/release-manifest.v1.json",
  digest:
    "sha256:cfe43d7d3f71380d8d4e9089d7445a7fd5da815678dcba919b923eeba13b5c92",
});
export const ACCOUNT_CONTRACT_BUNDLE = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiAccountService/releases/download/account-service-v2.1.4/juntai-account-contracts-2.1.4.json",
  digest:
    "sha256:c4a79a209e925a10f0c931c711b3c1a9b443a3bcae4495aea467267af1316673",
});
export const APPLICATION_METADATA_OPENAPI = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiApplicationMetadata/releases/download/v3.0.0/application-metadata.v1.json",
  digest:
    "sha256:04d80ef99114dcacb3fee9755eb96adc664d520d54a41b17cdbe1e18463f68eb",
});
export const APPLICATION_METADATA_RELEASE_CONTRACT = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiApplicationMetadata/releases/download/v3.0.0/release-contract.v1.json",
  digest:
    "sha256:dd3b8ea5f5bd4fa84b48378bdaca0ffc34eacdc668326b9e5eaa0021c8ba0159",
});
export const APPLICATION_METADATA_RELEASE_MANIFEST = Object.freeze({
  uri: "https://github.com/zephytiju/JuntaiApplicationMetadata/releases/download/v3.0.0/release-manifest.json",
  digest:
    "sha256:48c7dc966766e3f8e124bc30f7f76348b2121de5ee41132e71c26a29082437c1",
});
export const APPLICATION_METADATA_MIGRATION = Object.freeze({
  uri: "https://raw.githubusercontent.com/zephytiju/JuntaiApplicationMetadata/ba1ca5df9dbbc64e5c5c1d8a169db015791d38c9/migrations/application-metadata.v2.json",
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
      "sha256:26c7c5e2f109aeeb47157f45bd95f2df6e34b9de83085fe1bc32512f9c7cd084",
  },
  { id: "account-openapi", ...ACCOUNT_OPENAPI },
  { id: "account-release-manifest", ...ACCOUNT_RELEASE_MANIFEST },
  {
    id: "application-metadata-image",
    uri: APPLICATION_METADATA_IMAGE,
    digest:
      "sha256:66ccf5d5e0bb77564f7d5fd8bd3a7d673bbf4f0c5ce4f438e4e48eec0ef26872",
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
      "sha256:5bfbcdd4073e3b0c16730904691310d8ccd6b913a2a525d3263d52535578fcdc",
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
