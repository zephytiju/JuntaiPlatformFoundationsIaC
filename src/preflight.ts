import {
  fetchVerifiedArtifact,
  fetchVerifiedText,
  type ArtifactFetcher,
} from "./artifacts.js";
import {
  resolveAndComposeServiceContracts,
  type ContractCompositionResult,
} from "./contract-composition.js";
import {
  partitionGatewayManifests,
  type GatewayManifestOwnership,
} from "./gateway-manifests.js";
import { ENVOY_GATEWAY_MANIFEST, GATEWAY_API_MANIFEST } from "./release.js";
import type { FoundationsInputs } from "./types.js";
import {
  resolveRuntimeDistribution,
  type ResolvedRuntimeDistribution,
} from "./runtime-distribution.js";
import { MERIDIAN_RUNTIME_DISTRIBUTION } from "./release.js";

export interface FoundationPreflight {
  readonly runtimeDistribution: ResolvedRuntimeDistribution;
  readonly gatewayApiYaml: string;
  readonly envoyGatewayYaml: string;
  readonly gatewayManifestOwnership: readonly GatewayManifestOwnership[];
  readonly contracts: ContractCompositionResult;
}

export type FoundationPreflightResolver = (
  inputs: FoundationsInputs,
  fetcher?: ArtifactFetcher,
) => Promise<FoundationPreflight>;

export const resolveFoundationPreflight: FoundationPreflightResolver = async (
  inputs,
  fetcher = fetchVerifiedArtifact,
) => {
  const selectedServiceIds = [
    "foundation.iam",
    ...(inputs.account.enabled === false ? [] : ["platform.account"]),
    ...(inputs.applicationMetadata.enabled === false
      ? []
      : ["platform.application-metadata"]),
    ...(inputs.blueprint.enabled === false ? [] : ["platform.blueprint"]),
  ];
  const [
    gatewayApiPayload,
    envoyGatewayPayload,
    contracts,
    runtimeDistribution,
  ] = await Promise.all([
    fetchVerifiedText(GATEWAY_API_MANIFEST, fetcher),
    fetchVerifiedText(ENVOY_GATEWAY_MANIFEST, fetcher),
    resolveAndComposeServiceContracts({ selectedServiceIds, fetcher }),
    resolveRuntimeDistribution(
      inputs.meridian.distribution ?? MERIDIAN_RUNTIME_DISTRIBUTION,
      fetcher,
    ),
  ]);
  const gatewayManifests = partitionGatewayManifests(
    gatewayApiPayload,
    envoyGatewayPayload,
  );
  const requiredCatalogs = new Set([
    "structured",
    "object",
    "evidence",
    ...(inputs.meridian.domains ?? []).flatMap((domain) =>
      domain.resources.map((resource) => resource.selector.catalog),
    ),
  ]);
  for (const catalog of requiredCatalogs) {
    if (!runtimeDistribution.descriptor.supportedCatalogs.includes(catalog)) {
      throw new Error(
        `selected Meridian runtime does not support required catalog '${catalog}'`,
      );
    }
  }
  return Object.freeze({
    runtimeDistribution,
    gatewayApiYaml: gatewayManifests.gatewayApiYaml,
    envoyGatewayYaml: gatewayManifests.envoyGatewayYaml,
    gatewayManifestOwnership: gatewayManifests.ownership,
    contracts,
  });
};
