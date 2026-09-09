import { fetchVerifiedText } from "../src/artifacts.js";
import { resolveAndComposeServiceContracts } from "../src/contract-composition.js";
import { partitionGatewayManifests } from "../src/gateway-manifests.js";
import {
  ENVOY_GATEWAY_MANIFEST,
  GATEWAY_API_MANIFEST,
  MERIDIAN_DURABLE_RUNTIME_DISTRIBUTION,
  MERIDIAN_RUNTIME_DISTRIBUTION,
} from "../src/release.js";
import { resolveRuntimeDistribution } from "../src/runtime-distribution.js";

const [
  contracts,
  gatewayApiPayload,
  envoyGatewayPayload,
  runtimeDistributions,
] = await Promise.all([
  resolveAndComposeServiceContracts(),
  fetchVerifiedText(GATEWAY_API_MANIFEST),
  fetchVerifiedText(ENVOY_GATEWAY_MANIFEST),
  Promise.all(
    [MERIDIAN_RUNTIME_DISTRIBUTION, MERIDIAN_DURABLE_RUNTIME_DISTRIBUTION].map(
      (selection) => resolveRuntimeDistribution(selection),
    ),
  ),
]);
const { evidence } = contracts;
if (
  [...evidence.artifacts, ...evidence.releaseArtifacts].some(
    ({ expectedDigest, resolvedDigest }) => expectedDigest !== resolvedDigest,
  )
) {
  throw new Error("service artifact evidence contains a digest mismatch");
}
const gatewayManifests = partitionGatewayManifests(
  gatewayApiPayload,
  envoyGatewayPayload,
);

process.stdout.write(
  `${JSON.stringify(
    {
      contracts: evidence,
      runtimeDistributions: runtimeDistributions.map(
        ({ selection, descriptor }) => ({
          selection,
          profile: descriptor.profileId,
          packages: descriptor.packages,
        }),
      ),
      gatewayManifests: {
        payloads: [GATEWAY_API_MANIFEST, ENVOY_GATEWAY_MANIFEST],
        ownership: gatewayManifests.ownership,
      },
    },
    null,
    2,
  )}\n`,
);
