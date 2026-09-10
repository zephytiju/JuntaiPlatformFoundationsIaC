import contracts from "../src/peer-runtime-contracts.json" with { type: "json" };
import type {
  FoundationsInputs,
  MeridianEngineSelection,
} from "../src/types.js";
import {
  foundationsInputs,
  objectEngine,
  structuredEngine,
} from "./helpers.js";
import { latticeSharedStore } from "./lattice-fixture.js";
export function ownedEngines(
  blueprint = true,
): readonly MeridianEngineSelection[] {
  const base = structuredEngine(blueprint);
  return [
    {
      ...base,
      identityRef: { provider: "file", reference: "/var/run/owned/identity" },
      secretRef: { provider: "file", reference: "/var/run/owned/credential" },
      settings: {
        formatVersion: "meridian.postgresql.settings.v1",
        scopeKeys: ["application", "tenant"],
        resources: contracts.peers[
          "application-metadata"
        ].providers[1]!.resources.filter(
          (r) => r.definition.ref.catalog === "structured",
        ).map((r) => ({
          ref: `${r.definition.ref.catalog}:${r.definition.ref.namespace}.${r.definition.ref.name}`,
          profile: r.definition.profile,
          schemaFingerprint: r.schemaFingerprint,
          resourceFingerprint: r.fingerprint,
          table: r.definition.ref.name.replaceAll("-", "_"),
        })),
      },
    },
    {
      ...objectEngine(),
      identityRef: { provider: "file", reference: "/var/run/owned/identity" },
      secretRef: { provider: "file", reference: "/var/run/owned/credential" },
    },
  ];
}
export function peerInputs(): FoundationsInputs {
  const base = foundationsInputs();
  return {
    ...base,
    meridian: {
      ...base.meridian,
      sharedResourceStores: [latticeSharedStore()],
      peerRuntimeSelections: {
        blueprint: {
          ...base.meridian.peerRuntimeSelections!.blueprint!,
          ownedReferences: {
            storeId: "configuration-artifact",
            engines: ownedEngines(),
            runtimeReferences: [
              {
                kind: "secret",
                name: "owned-credentials",
                mountPath: "/var/run/owned",
                items: {
                  identity: "identity",
                  "runtime-credential": "credential",
                },
              },
            ],
          },
        },
      },
    },
  };
}
