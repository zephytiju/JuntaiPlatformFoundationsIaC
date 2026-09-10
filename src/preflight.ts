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
import {
  composeDomainRequirements,
  validateDomainRequirements,
} from "./domain-requirements.js";
import type { FoundationsInputs, MeridianInputs } from "./types.js";
import {
  resolveRuntimeDistribution,
  type ResolvedRuntimeDistribution,
} from "./runtime-distribution.js";
import { MERIDIAN_RUNTIME_DISTRIBUTION } from "./release.js";

export interface FoundationPreflight {
  readonly runtimeDistribution: ResolvedRuntimeDistribution;
  readonly domainRuntimeDistributions: Readonly<
    Record<string, ResolvedRuntimeDistribution>
  >;
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
  for (const catalog of ["structured", "object", "evidence"]) {
    requireCatalog(runtimeDistribution, catalog);
  }
  const domainRuntimeDistributions = await resolveDomainRuntimeDistributions(
    inputs.meridian,
    runtimeDistribution,
    fetcher,
  );
  return Object.freeze({
    runtimeDistribution,
    domainRuntimeDistributions,
    gatewayApiYaml: gatewayManifests.gatewayApiYaml,
    envoyGatewayYaml: gatewayManifests.envoyGatewayYaml,
    gatewayManifestOwnership: gatewayManifests.ownership,
    contracts,
  });
};

function requireCatalog(
  distribution: ResolvedRuntimeDistribution,
  catalog: string,
): void {
  if (!distribution.descriptor.supportedCatalogs.includes(catalog)) {
    throw new Error(
      `selected Meridian runtime does not support required catalog '${catalog}'`,
    );
  }
}

/** Resolve only explicitly declared domains; the default's immutable lock is never rewritten. */
export async function resolveDomainRuntimeDistributions(
  inputs: MeridianInputs,
  fallback: ResolvedRuntimeDistribution,
  fetcher: ArtifactFetcher = fetchVerifiedArtifact,
): Promise<Readonly<Record<string, ResolvedRuntimeDistribution>>> {
  validateDomainRequirements(inputs.domains, inputs.sharedResourceStores);
  const domains = [...(inputs.domains ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const ids = new Set(domains.map(({ id }) => id));
  for (const id of Object.keys(inputs.domainRuntimeSelections ?? {})) {
    if (!ids.has(id))
      throw new Error(`runtime distribution selects undeclared domain '${id}'`);
  }
  const selected = await Promise.all(
    domains.map(async (domain) => {
      const declaration =
        inputs.domainRuntimeSelections?.[domain.id]?.distribution;
      const distribution =
        declaration === undefined
          ? fallback
          : await resolveRuntimeDistribution(declaration, fetcher);
      for (const catalog of new Set(
        composeDomainRequirements(
          domain,
          inputs.sharedResourceStores,
        ).resources.map(({ selector }) => selector.catalog),
      )) {
        requireCatalog(distribution, catalog);
      }
      return [domain.id, distribution] as const;
    }),
  );
  return Object.freeze(Object.fromEntries(selected));
}
