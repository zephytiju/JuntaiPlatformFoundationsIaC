import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import foundationsPackage from "../src/package.js";

const repository = resolve(import.meta.dirname, "..");
const output = resolve(repository, "dist/foundations-package");
const staging = resolve(output, "platform-iac-package.v1");
const archive = resolve(output, "platform-iac-package.v1.tar.gz");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const revision =
  process.env.FOUNDATIONS_SOURCE_REVISION ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
execFileSync("node", ["--import", "tsx", "scripts/build-package.ts"], {
  cwd: repository,
  stdio: "inherit",
  env: {
    ...process.env,
    FOUNDATIONS_SOURCE_REVISION: revision,
    SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "0",
  },
});

const manifest = JSON.parse(
  await readFile(resolve(staging, "manifest.v1.json"), "utf8"),
) as Record<string, unknown>;
for (const key of [
  "id",
  "version",
  "targetProfiles",
  "owners",
  "compatibility",
  "releaseInputs",
  "requires",
  "provides",
] as const) {
  if (
    JSON.stringify(manifest[key]) !== JSON.stringify(foundationsPackage[key])
  ) {
    throw new Error(
      `release manifest '${key}' differs from the runtime contract`,
    );
  }
}
if (manifest.entrypoint !== "dist/runtime/package.mjs") {
  throw new Error("release manifest entrypoint is not canonical");
}

const expectedEntries = [
  "SBOM.spdx.json",
  "SHA256SUMS",
  "adoption-inventory.v1.json",
  "construct-lock.v1.json",
  "contribution.v1.json",
  "contracts/meridian-config.v1.schema.json",
  "dist/runtime/package.mjs",
  "docs/adoption-and-rollback.md",
  "docs/package-ownership.md",
  "manifest.v1.json",
  "provenance.intoto.jsonl",
  "service-releases.v1.json",
].sort();
const actualEntries = execFileSync("tar", ["-tzf", archive], {
  encoding: "utf8",
})
  .trim()
  .split("\n");
if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
  throw new Error("package archive contains an unexpected file surface");
}

const checksumLines = (await readFile(resolve(staging, "SHA256SUMS"), "utf8"))
  .trim()
  .split("\n");
for (const line of checksumLines) {
  const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
  if (match === null) throw new Error(`invalid checksum line '${line}'`);
  const [, expected, path] = match;
  if (expected === undefined || path === undefined) {
    throw new Error(`invalid checksum line '${line}'`);
  }
  const actual = sha256(await readFile(resolve(staging, path)));
  if (actual !== expected) throw new Error(`checksum mismatch for '${path}'`);
}

const entrypoint = resolve(staging, "dist/runtime/package.mjs");
const runtimeModule = (await import(pathToFileURL(entrypoint).href)) as {
  readonly default?: { readonly id?: unknown; readonly version?: unknown };
};
if (
  runtimeModule.default?.id !== "juntai.platform.substrate" ||
  runtimeModule.default.version !== "1.0.0"
) {
  throw new Error("bundled runtime does not export the reviewed package");
}
const bundle = await readFile(entrypoint, "utf8");
if (/contracts\/upstream|referencePath|helm\.sh\/|HelmRelease/.test(bundle)) {
  throw new Error(
    "bundled runtime contains a forbidden vendored deployment path",
  );
}
const archiveDigest = sha256(await readFile(archive));
const digestFile = await readFile(`${archive}.sha256`, "utf8");
if (digestFile !== `${archiveDigest}  platform-iac-package.v1.tar.gz\n`) {
  throw new Error("archive digest sidecar mismatch");
}
process.stdout.write(`${archiveDigest}  platform-iac-package.v1.tar.gz\n`);
