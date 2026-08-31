import { fetchVerifiedText } from "../src/artifacts.js";
import { resolveAndComposeServiceContracts } from "../src/contract-composition.js";
import { partitionGatewayManifests } from "../src/gateway-manifests.js";
import {
  ENVOY_GATEWAY_MANIFEST,
  GATEWAY_API_MANIFEST,
} from "../src/release.js";

const [contracts, gatewayApiPayload, envoyGatewayPayload] = await Promise.all([
  resolveAndComposeServiceContracts(),
  fetchVerifiedText(GATEWAY_API_MANIFEST),
  fetchVerifiedText(ENVOY_GATEWAY_MANIFEST),
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
      gatewayManifests: {
        payloads: [GATEWAY_API_MANIFEST, ENVOY_GATEWAY_MANIFEST],
        ownership: gatewayManifests.ownership,
      },
    },
    null,
    2,
  )}\n`,
);
