import { describe, expect, it } from "vitest";
import { sha256 } from "../src/artifacts.js";
import {
  MERIDIAN_PYTHON_RUNTIME,
  resolveRuntimeDistribution,
} from "../src/runtime-distribution.js";

// Recording artifact transport. The release-artifact CI gate independently
// downloads and verifies all seven actual published artifacts.
function fixture(
  change: (descriptor: Record<string, unknown>) => void = () => undefined,
) {
  const bytes = new Map<string, Uint8Array>();
  const directory = MERIDIAN_PYTHON_RUNTIME.descriptor.uri.replace(
    /[^/]+$/,
    "",
  );
  const encode = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  const packages = [
    {
      name: "meridian_storage_core",
      version: "1.0.0",
      sha256: "a".repeat(64),
      url: "https://files.pythonhosted.org/packages/meridian_storage_core-1.0.0-py3-none-any.whl",
    },
  ];
  const entryPoints = {
    contract: "juntai.platform.meridian-runtime-entrypoints",
    version: "1.0.0",
    required: {
      "meridian_storage.adapters": { adapter: "package:Adapter" },
      "meridian_storage.catalogs": { structured: "package:Catalog" },
      "meridian_storage.schemas": { schemas: "package:Schemas" },
    },
  };
  const inventory = {
    format: "juntai.platform.meridian-runtime-inventory/v1",
    sourceRevision: MERIDIAN_PYTHON_RUNTIME.sourceRevision,
    profile: {
      profileId: MERIDIAN_PYTHON_RUNTIME.profileId,
      pythonAbi: "cp312",
      pythonVersion: "3.12.11",
      platform: "linux/amd64",
      entryPointContract: entryPoints,
    },
    packages,
  };
  const contents = {
    inventory: ["runtime-manifest.json", inventory],
    lock: ["requirements.txt", "locked"],
    constraints: ["constraints.txt", "constraints"],
    sbom: ["image-sbom.spdx.json", { spdxVersion: "SPDX-2.3" }],
    pythonSbom: ["python-sbom.cdx.json", { bomFormat: "CycloneDX" }],
    provenance: ["image-provenance.slsa.json", { buildType: "fixture" }],
  } as const;
  const references = Object.fromEntries(
    Object.entries(contents).map(([key, [name, value]]) => {
      const raw = encode(value);
      const url = directory + name;
      bytes.set(url, raw);
      return [key, { url, digest: sha256(raw) }];
    }),
  );
  const inventoryDigest = references.inventory!.digest;
  const descriptor = {
    format: "juntai.platform.meridian-runtime-distribution/v1",
    capability: { id: "juntai.platform.meridian-runtime", version: "1.1.0" },
    ...MERIDIAN_PYTHON_RUNTIME,
    inventoryDigest,
    entryPointContract: entryPoints,
    packages,
    ...references,
  };
  change(descriptor);
  const raw = encode(descriptor);
  bytes.set(MERIDIAN_PYTHON_RUNTIME.descriptor.uri, raw);
  const selection = {
    ...MERIDIAN_PYTHON_RUNTIME,
    inventoryDigest,
    descriptor: { ...MERIDIAN_PYTHON_RUNTIME.descriptor, digest: sha256(raw) },
  };
  return {
    bytes,
    selection,
    fetcher: async (artifact: { uri: string }) => {
      const result = bytes.get(artifact.uri);
      if (!result) throw new Error("unexpected artifact");
      return result;
    },
  };
}

describe("platform runtime distribution resolution", () => {
  it("verifies every exact related artifact and preserves the descriptor bytes", async () => {
    const f = fixture();
    const result = await resolveRuntimeDistribution(f.selection, f.fetcher);
    expect(result.verifiedArtifacts).toHaveLength(7);
    expect(sha256(result.descriptorText)).toBe(f.selection.descriptor.digest);
    expect(result.selection.image).toBe(MERIDIAN_PYTHON_RUNTIME.image);
  });

  it.each(["image", "profileId", "pythonAbi", "sourceRevision"])(
    "rejects mismatched %s before using it",
    async (key) => {
      const f = fixture((d) => {
        d[key] = "mismatch";
      });
      await expect(
        resolveRuntimeDistribution(f.selection, f.fetcher),
      ).rejects.toThrow(`${key} differs`);
    },
  );

  it("rejects equivalent duplicate Python distribution names", async () => {
    const f = fixture((d) => {
      const packages = d.packages as Record<string, unknown>[];
      d.packages = [
        ...packages,
        { ...packages[0], name: "meridian-storage-core" },
      ];
    });
    await expect(
      resolveRuntimeDistribution(f.selection, f.fetcher),
    ).rejects.toThrow("duplicate package");
  });

  it("rejects a credential-bearing or foreign wheel source", async () => {
    const f = fixture((d) => {
      d.packages = [
        {
          ...(d.packages as Record<string, unknown>[])[0],
          url: "https://private.invalid/wheel.whl",
        },
      ];
    });
    await expect(
      resolveRuntimeDistribution(f.selection, f.fetcher),
    ).rejects.toThrow("public PyPI");
  });

  it("rejects missing SBOM/provenance bytes and corrupted inventory bytes", async () => {
    for (const name of [
      "image-sbom.spdx.json",
      "image-provenance.slsa.json",
      "runtime-manifest.json",
    ]) {
      const f = fixture();
      const url = [...f.bytes.keys()].find((value) => value.endsWith(name))!;
      f.bytes.set(url, new TextEncoder().encode("corrupted"));
      await expect(
        resolveRuntimeDistribution(f.selection, f.fetcher),
      ).rejects.toThrow(/digest|SHA-256/);
    }
  });
});
