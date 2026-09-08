import { canonicalJson } from "@zephytiju/meridian-storage-constructs";
import {
  fetchVerifiedArtifact,
  fetchVerifiedText,
  type ArtifactFetcher,
  type Sha256Digest,
  type VerifiedArtifact,
} from "./artifacts.js";

export interface MeridianRuntimeDistributionSelection {
  readonly descriptor: VerifiedArtifact;
  readonly image: string;
  readonly inventoryDigest: Sha256Digest;
  readonly sourceRevision: string;
  readonly profileId: string;
  readonly pythonAbi: string;
  readonly pythonVersion: string;
  readonly platform: string;
}

export const MERIDIAN_PYTHON_RUNTIME = Object.freeze({
  descriptor: Object.freeze({
    id: "meridian-python-runtime-descriptor",
    uri: "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/releases/download/meridian-runtime-python-v1.0.0/runtime-distribution.v1.json",
    digest:
      "sha256:e1957cfd3ed70c23adc975324014299db1969392ef410565c3bc063a0ddcfdc1",
  }),
  image:
    "ghcr.io/zephytiju/juntai-platform-meridian-runtime-python@sha256:60b6828202ad3cf2c5313c5605ac8bfeccfa5acb88d05f3ccaa56e93c94c78b1",
  inventoryDigest:
    "sha256:228e29f8a3f60f7acf6293121b388c533791dc64cff48cd78f477b0809d905b1",
  sourceRevision: "ce23bdd3b077ba4402a9dfbc4e049a945e559a09",
  profileId: "postgresql-postgis-local-single-primary",
  pythonAbi: "cp312",
  pythonVersion: "3.12.11",
  platform: "linux/amd64",
}) satisfies MeridianRuntimeDistributionSelection;

export interface PreparedRuntimeDistribution {
  readonly selection: MeridianRuntimeDistributionSelection;
  readonly descriptorText: string;
  readonly verifiedArtifacts: readonly VerifiedArtifact[];
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Meridian runtime descriptor must contain an object");
  }
  return value as Record<string, unknown>;
}

function require(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Meridian runtime distribution: ${message}`);
}

const assets = Object.freeze({
  inventory: "runtime-manifest.json",
  lock: "requirements.txt",
  constraints: "constraints.txt",
  sbom: "image-sbom.spdx.json",
  pythonSbom: "python-sbom.cdx.json",
  provenance: "image-provenance.slsa.json",
});

/** Resolve platform-owned immutable artifacts; no fetched document is vendored. */
export async function resolveRuntimeDistribution(
  selection: MeridianRuntimeDistributionSelection = MERIDIAN_PYTHON_RUNTIME,
  fetcher: ArtifactFetcher = fetchVerifiedArtifact,
): Promise<PreparedRuntimeDistribution> {
  const descriptorText = await fetchVerifiedText(selection.descriptor, fetcher);
  require(Buffer.byteLength(descriptorText) <=
    128 * 1024, "descriptor exceeds its bound");
  const descriptor = record(JSON.parse(descriptorText));
  require(descriptor.format ===
    "juntai.platform.meridian-runtime-distribution/v1", "unknown descriptor format");
  require(canonicalJson(record(descriptor.capability)) ===
    canonicalJson({
      id: "juntai.platform.meridian-runtime",
      version: "1.1.0",
    }), "unsupported capability");
  for (const name of [
    "image",
    "inventoryDigest",
    "sourceRevision",
    "profileId",
    "pythonAbi",
    "pythonVersion",
    "platform",
  ] as const) {
    require(descriptor[name] ===
      selection[name], `${name} differs from its release pin`);
  }
  const entryPoints = record(descriptor.entryPointContract);
  require(entryPoints.contract ===
    "juntai.platform.meridian-runtime-entrypoints" &&
    entryPoints.version === "1.0.0", "unsupported entry-point contract");
  require(Object.keys(record(entryPoints.required)).sort().join(",") ===
    "meridian_storage.adapters,meridian_storage.catalogs,meridian_storage.schemas", "incomplete entry-point groups");
  const packages = descriptor.packages;
  require(Array.isArray(packages) &&
    packages.length > 0 &&
    packages.length <= 128, "invalid locked package set");
  const packageNames = new Set<string>();
  for (const value of packages as unknown[]) {
    const item = record(value);
    require(typeof item.name === "string" &&
      /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(
        item.name,
      ), "invalid package name");
    const name = (item.name as string).toLowerCase().replace(/[-_.]+/g, "-");
    require(!packageNames.has(name), "duplicate package");
    packageNames.add(name);
    require(typeof item.version === "string" &&
      /^\d+\.\d+\.\d+$/.test(item.version), "non-exact package version");
    require(typeof item.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(item.sha256), "invalid wheel digest");
    const url = new URL(String(item.url));
    require(url.protocol === "https:" &&
      url.hostname === "files.pythonhosted.org" &&
      url.pathname.endsWith(".whl") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash, "wheel is not an immutable public PyPI artifact");
  }
  const directory = selection.descriptor.uri.slice(
    0,
    selection.descriptor.uri.lastIndexOf("/") + 1,
  );
  const references = Object.entries(assets).map(([key, filename]) => {
    const item = record(descriptor[key]);
    require(item.url === directory + filename &&
      typeof item.digest === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(item.digest), `invalid ${key} artifact`);
    return Object.freeze({
      id: `meridian-runtime-${key}`,
      uri: item.url as string,
      digest: item.digest as Sha256Digest,
    });
  });
  const documents = await Promise.all(
    references.map(async (artifact) => ({
      artifact,
      text: await fetchVerifiedText(artifact, fetcher),
    })),
  );
  const inventory = record(
    JSON.parse(
      documents.find(
        ({ artifact }) => artifact.id === "meridian-runtime-inventory",
      )!.text,
    ),
  );
  require(references.find(({ id }) => id === "meridian-runtime-inventory")!
    .digest ===
    selection.inventoryDigest, "inventory artifact differs from its pin");
  require(inventory.format ===
    "juntai.platform.meridian-runtime-inventory/v1" &&
    inventory.sourceRevision ===
      selection.sourceRevision, "inventory identity mismatch");
  const profile = record(inventory.profile);
  require(profile.profileId === selection.profileId &&
    profile.pythonAbi === selection.pythonAbi &&
    profile.pythonVersion === selection.pythonVersion &&
    profile.platform ===
      selection.platform, "inventory runtime profile mismatch");
  require(canonicalJson(record(inventory.profile).entryPointContract) ===
    canonicalJson(
      entryPoints,
    ), "inventory entry points differ from descriptor");
  require(canonicalJson(inventory.packages) ===
    canonicalJson(packages), "inventory packages differ from descriptor");
  return Object.freeze({
    selection,
    descriptorText,
    verifiedArtifacts: Object.freeze([selection.descriptor, ...references]),
  });
}
