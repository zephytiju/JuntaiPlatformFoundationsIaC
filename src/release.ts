import type { ImmutableReleaseInput } from "./contract.js";

export const FOUNDATIONS_PACKAGE_VERSION = "1.0.1" as const;
export const FOUNDATIONS_PACKAGE_ID = "juntai.platform.substrate" as const;

export const CASDOOR_IMAGE =
  "docker.io/casbin/casdoor@sha256:d7658640aba370495e59dc1464756d2ae7ec66576203b9de0040e9cc37793607";
export const CASDOOR_BOOTSTRAP_IMAGE =
  "ghcr.io/zephytiju/juntai-platform-casdoor-bootstrap@sha256:6282606098e982d9d6880819e7c895c4bd9696318a014eeb04f5b190821edf9b";
export const BLUEPRINT_IMAGE =
  "ghcr.io/zephytiju/juntai-blueprint-marketplace@sha256:5bfbcdd4073e3b0c16730904691310d8ccd6b913a2a525d3263d52535578fcdc";
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

export const releaseInputs: readonly ImmutableReleaseInput[] = Object.freeze([
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
