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
    packages: Object.entries({
      "meridian-storage-core": "1.0.0",
      "meridian-storage-semantics": "1.0.0",
      "meridian-storage-query": "1.0.0",
      "meridian-storage-streaming": "1.0.0",
      "meridian-storage-evidence": "1.0.0",
      "meridian-storage-postgresql": "1.0.0",
      "meridian-storage-object-common": "1.0.1",
      "meridian-storage-s3": "1.0.1",
    }).map(([name, version]) => ({
      name,
      version,
      url: `https://files.pythonhosted.org/packages/test/${name}-${version}-py3-none-any.whl`,
      sha256: "f".repeat(64),
    })),
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

export function durableRuntimeDistributionFixture(): ResolvedRuntimeDistribution {
  const legacy = runtimeDistributionFixture();
  const packages = {
    "meridian-storage-core": "1.1.0",
    "meridian-storage-semantics": "2.1.0",
    "meridian-storage-query": "1.0.3",
    "meridian-storage-evidence": "1.0.2",
    "meridian-storage-projection": "1.0.3",
    "meridian-storage-postgresql": "2.3.1",
  };
  const descriptor: RuntimeDistributionDescriptor = {
    ...legacy.descriptor,
    version: "2.0.0",
    profileId: "postgresql-postgis-s3-durable-schema-registry",
    packages: Object.entries(packages).map(([name, version]) => ({
      name,
      version,
      url: `https://files.pythonhosted.org/packages/test/${name}-${version}-py3-none-any.whl`,
      sha256: "f".repeat(64),
    })),
    supportedCatalogs: ["structured", "evidence"],
  };
  const text = JSON.stringify(descriptor, null, 2) + "\n";
  return {
    descriptor,
    text,
    selection: {
      uri: "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/releases/download/meridian-runtime-python-v2.0.0/test.json",
      digest: sha256(text),
    },
  };
}
