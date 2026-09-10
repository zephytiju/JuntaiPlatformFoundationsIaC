import { latticeDomains, latticeSharedStore } from "./lattice-fixture.js";
import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/artifacts.js";
import { resolveDomainRuntimeDistributions } from "../src/preflight.js";
import { domainRequirements } from "./domain-fixture.js";
import { runtimeDistributionFixture } from "./runtime-distribution-fixture.js";

function durableFixture() {
  const base = runtimeDistributionFixture();
  const descriptor = {
    ...base.descriptor,
    version: "2.0.0",
    profileId: "postgresql-postgis-s3-durable-schema-registry",
    supportedCatalogs: ["structured", "evidence"],
  };
  const text = JSON.stringify(descriptor, null, 2) + "\n";
  return {
    descriptor,
    text,
    selection: {
      uri: "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/releases/download/meridian-runtime-python-v2.0.0/runtime-distribution.v1.json",
      digest: sha256(text),
    },
  };
}

describe("explicit Platform-owned domain runtime selection", () => {
  it("keeps the default bytes and lock while independently selecting a domain profile", async () => {
    const legacy = runtimeDistributionFixture();
    const durable = durableFixture();
    const fetcher = vi.fn(async () => new TextEncoder().encode(durable.text));
    const result = await resolveDomainRuntimeDistributions(
      {
        engines: [],
        domains: [
          domainRequirements("prism-build", "prism.build"),
          domainRequirements(),
        ],
        domainRuntimeSelections: {
          "prism-build": {
            distribution: durable.selection,
            engines: [],
            runtimeReferences: [],
          },
        },
      },
      legacy,
      fetcher,
    );
    expect(result["prism-build"]).toEqual(durable);
    expect(result["prism-composition"]).toBe(legacy);
    expect(legacy).toEqual(runtimeDistributionFixture());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown owners before fetching a distribution", async () => {
    const fetcher = vi.fn();
    await expect(
      resolveDomainRuntimeDistributions(
        {
          engines: [],
          domains: [domainRequirements()],
          domainRuntimeSelections: {
            other: {
              distribution: durableFixture().selection,
              engines: [],
              runtimeReferences: [],
            },
          },
        },
        runtimeDistributionFixture(),
        fetcher,
      ),
    ).rejects.toThrow("undeclared domain");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks each selected domain's catalog subset and exact artifact bytes", async () => {
    const durable = durableFixture();
    const inputs = {
      engines: [],
      domains: [domainRequirements()],
      domainRuntimeSelections: {
        "prism-composition": {
          distribution: durable.selection,
          engines: [],
          runtimeReferences: [],
        },
      },
    };
    await expect(
      resolveDomainRuntimeDistributions(
        inputs,
        runtimeDistributionFixture(),
        async () => new TextEncoder().encode(durable.text + " "),
      ),
    ).rejects.toThrow("digest mismatch");
    const text = JSON.stringify({
      ...durable.descriptor,
      supportedCatalogs: ["structured"],
    });
    await expect(
      resolveDomainRuntimeDistributions(
        {
          ...inputs,
          domainRuntimeSelections: {
            "prism-composition": {
              distribution: { ...durable.selection, digest: sha256(text) },
              engines: [],
              runtimeReferences: [],
            },
          },
        },
        runtimeDistributionFixture(),
        async () => new TextEncoder().encode(text),
      ),
    ).rejects.toThrow("required catalog 'evidence'");
  });
});

it("requires the shared object Catalog even when a domain owns only structured Resources", async () => {
  const fallback = runtimeDistributionFixture();
  const withoutObject = {
    ...fallback,
    descriptor: {
      ...fallback.descriptor,
      supportedCatalogs: ["structured", "evidence"],
    },
  };
  await expect(
    resolveDomainRuntimeDistributions(
      {
        engines: [],
        domains: [latticeDomains()[1]!],
        sharedResourceStores: [latticeSharedStore()],
      },
      withoutObject,
    ),
  ).rejects.toThrow("required catalog 'object'");
});
