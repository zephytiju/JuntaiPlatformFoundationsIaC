import type { DomainMeridianRequirements } from "../src/types.js";

export function domainRequirements(
  id = "prism-composition",
  namespace = "prism.composition",
): DomainMeridianRequirements {
  const pin = {
    id: namespace,
    package: `prism-${id.split("-").at(-1)}-service`,
    contract: "1.0.0",
    version: "1.0.0",
    requiredFingerprint: `sha256:${"a".repeat(64)}` as const,
  };
  return {
    id,
    ownerPackage: "juntai.platform.domain.prism",
    resourceNamespace: namespace,
    schemaProviders: [pin],
    resources: ["structured", "evidence"].map((catalog) => ({
      selector: {
        catalog: catalog as "structured" | "evidence",
        namespace,
        name: catalog === "structured" ? "records" : "audit",
      },
      schemas: [
        {
          providerId: pin.id,
          package: pin.package,
          version: pin.version,
          fingerprint: `sha256:${(catalog === "structured" ? "b" : "c").repeat(64)}`,
        },
      ],
      operations: [
        {
          contract:
            catalog === "structured"
              ? "meridian.structured.put"
              : "meridian.evidence.append",
          version: "1.0.0",
        },
        {
          contract: "meridian.transaction",
          version: "1.0.0",
          guarantees: ["atomic", "no-dirty-reads"],
        },
      ],
      guarantees: { required: [] },
      limits: { values: {} },
      dataClass: "internal",
      labels: { owner: namespace },
    })),
  };
}
