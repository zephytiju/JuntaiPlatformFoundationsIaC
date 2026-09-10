import { literalValue } from "@zephytiju/juntai-platform-constructs";
import type { OwnedReferenceRuntimeInput } from "./types.js";

/** Project the peer's optional public runtime input without parsing Meridian configuration. */
export function ownedReferenceRuntime(
  variable:
    | "APPLICATION_METADATA_OWNED_REFERENCE_MERIDIAN_CONFIG"
    | "BLUEPRINT_OWNED_REFERENCE_MERIDIAN_CONFIG",
  input: OwnedReferenceRuntimeInput | undefined,
) {
  if (input === undefined) return { environment: [], files: [] };
  const config = input.configuration;
  return {
    environment: [
      literalValue(
        variable,
        `${config.mountPath}/${config.items["meridian-config.v1.json"]}`,
      ),
    ],
    files: [
      { kind: "configMap" as const, ...config, readOnly: true as const },
      ...(input.runtimeReferences ?? []).map((reference) => ({
        ...reference,
        readOnly: true as const,
      })),
    ],
  };
}
