import { resolveAndComposeServiceContracts } from "../src/contract-composition.js";

const { evidence } = await resolveAndComposeServiceContracts();
if (
  [...evidence.artifacts, ...evidence.releaseArtifacts].some(
    ({ expectedDigest, resolvedDigest }) => expectedDigest !== resolvedDigest,
  )
) {
  throw new Error("service artifact evidence contains a digest mismatch");
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
