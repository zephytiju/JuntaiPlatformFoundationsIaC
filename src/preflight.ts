import {
  fetchVerifiedArtifact,
  fetchVerifiedText,
  type ArtifactFetcher,
} from "./artifacts.js";
import {
  resolveAndComposeServiceContracts,
  type ContractCompositionResult,
} from "./contract-composition.js";
import { ENVOY_GATEWAY_MANIFEST, GATEWAY_API_MANIFEST } from "./release.js";
import type { FoundationsInputs } from "./types.js";

export interface FoundationPreflight {
  readonly gatewayApiYaml: string;
  readonly envoyGatewayYaml: string;
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
  const [gatewayApiYaml, envoyGatewayYaml, contracts] = await Promise.all([
    fetchVerifiedText(GATEWAY_API_MANIFEST, fetcher),
    fetchVerifiedText(ENVOY_GATEWAY_MANIFEST, fetcher),
    resolveAndComposeServiceContracts({ selectedServiceIds, fetcher }),
  ]);
  return Object.freeze({ gatewayApiYaml, envoyGatewayYaml, contracts });
};
