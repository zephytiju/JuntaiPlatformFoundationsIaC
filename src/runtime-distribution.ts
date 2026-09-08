import {
  fetchVerifiedText,
  validateArtifactDeclaration,
  type ArtifactFetcher,
  type Sha256Digest,
  type VerifiedArtifact,
} from "./artifacts.js";

export interface RuntimeArtifactReference {
  readonly url: string;
  readonly digest: Sha256Digest;
}

export interface RuntimeDistributionDescriptor {
  readonly format: "juntai.platform.meridian-runtime-distribution/v1";
  readonly version: string;
  readonly capability: {
    readonly id: "juntai.platform.meridian-runtime";
    readonly version: "1.1.0";
  };
  readonly image: string;
  readonly profileId: string;
  readonly pythonAbi: string;
  readonly pythonVersion: string;
  readonly platform: string;
  readonly baseImage: string;
  readonly sourceRevision: string;
  readonly inventoryDigest: Sha256Digest;
  readonly inventory: RuntimeArtifactReference;
  readonly lock: RuntimeArtifactReference;
  readonly constraints: RuntimeArtifactReference;
  readonly sbom: RuntimeArtifactReference;
  readonly pythonSbom: RuntimeArtifactReference;
  readonly provenance: RuntimeArtifactReference;
  readonly compatibility: RuntimeArtifactReference;
  readonly consumerLock: RuntimeArtifactReference;
  readonly supportedCatalogs: readonly string[];
  readonly packages: readonly {
    readonly name: string;
    readonly version: string;
    readonly url: string;
    readonly sha256: string;
  }[];
  readonly entryPointContract: {
    readonly contract: string;
    readonly version: string;
    readonly required: Readonly<
      Record<string, Readonly<Record<string, string>>>
    >;
  };
  readonly workflow: string;
}

export interface ResolvedRuntimeDistribution {
  readonly selection: VerifiedArtifact;
  readonly descriptor: RuntimeDistributionDescriptor;
  /** Exact verified bytes must survive projection without JSON reserialization. */
  readonly text: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error(`invalid Meridian runtime distribution: ${message}`);
}

function artifact(value: unknown): asserts value is RuntimeArtifactReference {
  require(object(value) &&
    typeof value.url === "string" &&
    typeof value.digest === "string", "artifact reference");
  validateArtifactDeclaration({
    uri: value.url,
    digest: value.digest as Sha256Digest,
  });
}

export function validateRuntimeDistribution(
  value: unknown,
): asserts value is RuntimeDistributionDescriptor {
  require(object(value), "descriptor object");
  const keys = [
    "format",
    "version",
    "capability",
    "image",
    "profileId",
    "pythonAbi",
    "pythonVersion",
    "platform",
    "baseImage",
    "sourceRevision",
    "inventoryDigest",
    "inventory",
    "lock",
    "constraints",
    "packages",
    "entryPointContract",
    "supportedCatalogs",
    "sbom",
    "pythonSbom",
    "provenance",
    "compatibility",
    "consumerLock",
    "workflow",
  ];
  require(Object.keys(value).length === keys.length &&
    keys.every((k) => k in value), "closed descriptor fields");
  require(value.format ===
    "juntai.platform.meridian-runtime-distribution/v1", "format");
  require(object(value.capability) &&
    value.capability.id === "juntai.platform.meridian-runtime" &&
    value.capability.version === "1.1.0", "capability contract");
  for (const key of ["version", "pythonVersion"])
    require(typeof value[key] === "string" &&
      /^\d+\.\d+\.\d+$/.test(value[key]), key);
  for (const key of ["image", "baseImage"])
    require(typeof value[key] === "string" &&
      /^[a-zA-Z0-9./_:-]+@sha256:[0-9a-f]{64}$/.test(value[key]), key);
  require(typeof value.image === "string" &&
    value.image.startsWith(
      "ghcr.io/zephytiju/juntai-platform-meridian-runtime-python@",
    ), "Foundations image ownership");
  require(typeof value.sourceRevision === "string" &&
    /^[0-9a-f]{40}$/.test(value.sourceRevision), "source revision");
  require(typeof value.inventoryDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(value.inventoryDigest), "inventory digest");
  require(typeof value.profileId === "string" &&
    /^[a-z0-9-]+$/.test(value.profileId), "profile identity");
  require(value.pythonAbi === "cp312" &&
    value.platform === "linux/amd64", "supported ABI/platform");
  require(typeof value.workflow === "string" &&
    /^https:\/\/github\.com\/zephytiju\/JuntaiPlatformFoundationsIaC\/actions\/runs\/\d+$/.test(
      value.workflow,
    ), "release workflow");
  for (const key of [
    "inventory",
    "lock",
    "constraints",
    "sbom",
    "pythonSbom",
    "provenance",
    "compatibility",
    "consumerLock",
  ])
    artifact(value[key]);
  require((value.inventory as RuntimeArtifactReference).digest ===
    value.inventoryDigest, "inventory pin mismatch");
  const catalogs = value.supportedCatalogs;
  require(Array.isArray(catalogs) &&
    catalogs.length > 0 &&
    new Set(catalogs).size === catalogs.length &&
    catalogs.every(
      (c: unknown) =>
        typeof c === "string" &&
        ["structured", "object", "cache", "evidence", "streaming"].includes(c),
    ), "catalog subset");
  require(Array.isArray(value.packages) &&
    value.packages.length > 0, "package lock");
  const names = new Set<string>();
  for (const p of value.packages) {
    require(object(p) &&
      typeof p.name === "string" &&
      /^[A-Za-z0-9_.-]+$/.test(p.name) &&
      typeof p.version === "string" &&
      /^[0-9][A-Za-z0-9.+!-]*$/.test(p.version) &&
      typeof p.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(p.sha256), "package coordinate");
    const name = p.name.toLowerCase().replaceAll(/[_.]+/g, "-");
    require(!names.has(name), "duplicate package");
    names.add(name);
    require(typeof p.url === "string" &&
      /^https:\/\/files\.pythonhosted\.org\/[A-Za-z0-9/_.+-]+\.whl$/.test(
        p.url,
      ), "public wheel coordinate");
  }
  const ep = value.entryPointContract;
  require(object(ep) &&
    ep.contract === "juntai.platform.meridian-runtime-entrypoints" &&
    ep.version === "1.0.0" &&
    object(ep.required), "entrypoint contract");
  for (const [group, entries] of Object.entries(ep.required)) {
    require([
      "meridian_storage.adapters",
      "meridian_storage.catalogs",
      "meridian_storage.schemas",
    ].includes(group) &&
      object(entries) &&
      Object.keys(entries).length > 0 &&
      Object.values(entries).every(
        (v) =>
          typeof v === "string" && /^[A-Za-z0-9_.]+:[A-Za-z0-9_.]+$/.test(v),
      ), "entrypoint group");
  }
  require(object(
    ep.required["meridian_storage.catalogs"],
  ), "catalog entrypoints");
  const installed = ep.required["meridian_storage.catalogs"];
  require(catalogs.every(
    (c) => c in installed,
  ), "required catalog entrypoint missing");
}

export async function resolveRuntimeDistribution(
  selection: VerifiedArtifact,
  fetcher?: ArtifactFetcher,
): Promise<ResolvedRuntimeDistribution> {
  const text = await fetchVerifiedText(selection, fetcher);
  require(Buffer.byteLength(text) <= 4 * 1024 * 1024, "descriptor size");
  const descriptor: unknown = JSON.parse(text);
  validateRuntimeDistribution(descriptor);
  return Object.freeze({
    selection: Object.freeze({ ...selection }),
    text,
    descriptor,
  });
}
