import { describe, expect, it } from "vitest";
import {
  LEGACY_CORE_V1_9_ADOPTION_RESOURCES,
  legacyAdoptionCompatibilityOptions,
} from "../src/legacy-adoption-compatibility.js";

describe("Core v1.9.0 UID-preserving adoption compatibility", () => {
  it("covers the exact 37 imported Kubernetes resources without duplicates", () => {
    expect(LEGACY_CORE_V1_9_ADOPTION_RESOURCES).toHaveLength(37);
    expect(
      new Set(
        LEGACY_CORE_V1_9_ADOPTION_RESOURCES.map(
          ({ type, name }) => `${type}\0${name}`,
        ),
      ).size,
    ).toBe(37);
  });

  it("preserves every imported input while retaining other resource options", () => {
    const transformed = legacyAdoptionCompatibilityOptions(
      "kubernetes:gateway.networking.k8s.io/v1:Gateway",
      "gateway-operator",
      { protect: true, retainOnDelete: true },
    );
    expect(transformed).toMatchObject({
      protect: true,
      retainOnDelete: true,
      ignoreChanges: ["*"],
    });
  });

  it("does not affect new package resources outside the migration inventory", () => {
    expect(
      legacyAdoptionCompatibilityOptions(
        "kubernetes:apps/v1:Deployment",
        "account-deployment",
        { protect: true },
      ),
    ).toBeUndefined();
  });
});
