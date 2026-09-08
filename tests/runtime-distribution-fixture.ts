import { sha256 } from "../src/artifacts.js";
import type {
  ResolvedRuntimeDistribution,
  RuntimeDistributionDescriptor,
} from "../src/runtime-distribution.js";

export function runtimeDistributionFixture(): ResolvedRuntimeDistribution {
  const artifact = {
    url: "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/releases/download/meridian-runtime-python-v1.1.0/test.json",
    digest: `sha256:${"a".repeat(64)}` as const,
  };
  const descriptor: RuntimeDistributionDescriptor = {
    format: "juntai.platform.meridian-runtime-distribution/v1",
    version: "1.1.0",
    capability: { id: "juntai.platform.meridian-runtime", version: "1.1.0" },
    image: `ghcr.io/zephytiju/juntai-platform-meridian-runtime-python@sha256:${"b".repeat(64)}`,
    baseImage: `docker.io/library/python@sha256:${"c".repeat(64)}`,
    profileId: "postgresql-postgis-s3-compatible-local",
    pythonAbi: "cp312",
    pythonVersion: "3.12.11",
    platform: "linux/amd64",
    sourceRevision: "d".repeat(40),
    inventoryDigest: artifact.digest,
    inventory: artifact,
    lock: artifact,
    constraints: artifact,
    sbom: artifact,
    pythonSbom: artifact,
    provenance: artifact,
    compatibility: artifact,
    consumerLock: artifact,
    packages: [
      {
        name: "meridian-storage-core",
        version: "1.0.0",
        url: "https://files.pythonhosted.org/packages/test/core-1.0.0-py3-none-any.whl",
        sha256: "f".repeat(64),
      },
    ],
    supportedCatalogs: ["structured", "object", "evidence"],
    entryPointContract: {
      contract: "juntai.platform.meridian-runtime-entrypoints",
      version: "1.0.0",
      required: {
        "meridian_storage.catalogs": {
          structured: "test:Structured",
          object: "test:Object",
          evidence: "test:Evidence",
        },
      },
    },
    workflow:
      "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/actions/runs/123",
  };
  const text = JSON.stringify(descriptor, null, 2) + "\n";
  return {
    descriptor,
    text,
    selection: { uri: artifact.url, digest: sha256(text) },
  };
}
