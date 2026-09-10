/** Emit the real Foundations peer ConfigMap payloads for installed-release acceptance. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { createMeridianRuntime } from "../src/meridian.js";
import { peerRuntimeRequirements } from "../src/peer-runtimes.js";
import { runtimeDistributionFixture } from "../tests/runtime-distribution-fixture.js";
import type { PeerRuntimeSelection } from "../src/types.js";

const directory = resolve(process.argv[2] ?? ".");
const selections = Object.fromEntries(
  await Promise.all(
    (["application-metadata", "blueprint"] as const).map(async (peer) => [
      peer,
      JSON.parse(
        await readFile(resolve(directory, `${peer}.json`), "utf8"),
      ) as PeerRuntimeSelection,
    ]),
  ),
) as Record<"application-metadata" | "blueprint", PeerRuntimeSelection>;
await pulumi.runtime.setMocks(
  {
    newResource: (args) => ({
      id: args.name,
      state: args.inputs as Record<string, unknown>,
    }),
    call: (args) => args.inputs as Record<string, unknown>,
  },
  "foundations-peer-acceptance",
  "local",
  false,
);
await pulumi.runtime.runInPulumiStack(async () => {
  const requirements = peerRuntimeRequirements("application-metadata", true);
  const runtime = createMeridianRuntime({
    provider: new k8s.Provider("fixture", { kubeconfig: "apiVersion: v1" }),
    namespace: "juntai-capabilities",
    peerNamespace: "juntai-platform",
    distribution: runtimeDistributionFixture(),
    inputs: {
      engines: selections["application-metadata"].engines,
      peerRuntimeSelections: selections,
      sharedResourceStores: [
        {
          id: "configuration-artifact",
          kind: "configuration-artifact",
          provider: requirements.schemaProviders[0]!,
          resources: requirements.resources,
        },
      ],
    },
  });
  for (const [name, config] of Object.entries({
    "application-metadata": runtime.applicationMetadataRuntime.configMap,
    blueprint: runtime.blueprintRuntime.configMap,
    "application-metadata-owned":
      runtime.peerOwnedReferenceConfigMaps["application-metadata"]!,
    "blueprint-owned": runtime.peerOwnedReferenceConfigMaps.blueprint!,
  })) {
    const data = await new Promise<Record<string, string>>((resolve) =>
      config.data.apply((value) => {
        resolve(value);
        return value;
      }),
    );
    await writeFile(
      resolve(directory, `foundations-${name}-config.json`),
      data["meridian-config.v1.json"]! + "\n",
    );
  }
});
console.log(
  JSON.stringify({
    generated: 4,
    namespace: "juntai-platform",
    source: "Foundations MeridianRuntimeConfig",
  }),
);
