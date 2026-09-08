import { describe, expect, it } from "vitest";
import {
  resolveRuntimeDistribution,
  validateRuntimeDistribution,
} from "../src/runtime-distribution.js";
import { runtimeDistributionFixture } from "./runtime-distribution-fixture.js";

describe("verified runtime distribution", () => {
  it("preserves exact descriptor bytes and verifies the declared digest", async () => {
    const fixture = runtimeDistributionFixture();
    const resolved = await resolveRuntimeDistribution(
      fixture.selection,
      async () => new TextEncoder().encode(fixture.text),
    );
    expect(resolved).toEqual(fixture);
    await expect(
      resolveRuntimeDistribution(fixture.selection, async () =>
        new TextEncoder().encode(fixture.text + " "),
      ),
    ).rejects.toThrow("digest mismatch");
  });

  it.each([
    ["physical fields", { endpoint: "postgresql://private" }],
    [
      "mutable image",
      {
        image:
          "ghcr.io/zephytiju/juntai-platform-meridian-runtime-python:latest",
      },
    ],
    [
      "foreign image",
      { image: `ghcr.io/other/runtime@sha256:${"a".repeat(64)}` },
    ],
    ["ABI", { pythonAbi: "cp313" }],
    ["capability", { capability: { id: "other", version: "1.1.0" } }],
    ["empty catalogs", { supportedCatalogs: [] }],
    ["unknown catalogs", { supportedCatalogs: ["ontology"] }],
    ["duplicate catalogs", { supportedCatalogs: ["object", "object"] }],
    ["missing entrypoint", { supportedCatalogs: ["streaming"] }],
    ["missing packages", { packages: [] }],
    ["inventory mismatch", { inventoryDigest: `sha256:${"b".repeat(64)}` }],
    [
      "mutable artifact",
      {
        provenance: {
          url: "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/releases/latest/p.json",
          digest: `sha256:${"a".repeat(64)}`,
        },
      },
    ],
  ])("rejects %s", (_name, patch) => {
    expect(() =>
      validateRuntimeDistribution({
        ...runtimeDistributionFixture().descriptor,
        ...patch,
      }),
    ).toThrow();
  });

  it("rejects duplicate distributions and credential-bearing wheel locations", () => {
    const descriptor = runtimeDistributionFixture().descriptor;
    expect(() =>
      validateRuntimeDistribution({
        ...descriptor,
        packages: [...descriptor.packages, ...descriptor.packages],
      }),
    ).toThrow("duplicate package");
    expect(() =>
      validateRuntimeDistribution({
        ...descriptor,
        packages: [
          {
            ...descriptor.packages[0],
            url: "https://user:secret@files.pythonhosted.org/x.whl",
          },
        ],
      }),
    ).toThrow("public wheel");
  });

  it("validates release coordinates without compiling a package-version allowlist", () => {
    const descriptor = runtimeDistributionFixture().descriptor;
    expect(() =>
      validateRuntimeDistribution({
        ...descriptor,
        version: "2.3.4",
        packages: [{ ...descriptor.packages[0], version: "4.2.1" }],
      }),
    ).not.toThrow();
  });
});
