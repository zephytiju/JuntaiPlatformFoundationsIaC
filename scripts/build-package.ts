import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build, version as esbuildVersion } from "esbuild";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(repository, "dist/foundations-package");
const staging = resolve(output, "platform-iac-package.v1");
const requiredToolchain = Object.freeze({
  node: "24.14.0",
  zlib: "1.3.1-e00f703",
  esbuild: "0.28.2",
  archive: "ustar-v1+gzip-level-9-mtime-0-os-255",
});

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item === null || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sort(nested)]),
    );
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

if (
  process.versions.node !== requiredToolchain.node ||
  process.versions.zlib !== requiredToolchain.zlib ||
  esbuildVersion !== requiredToolchain.esbuild
) {
  throw new Error(
    `package build requires Node ${requiredToolchain.node}, zlib ${requiredToolchain.zlib}, and esbuild ${requiredToolchain.esbuild}`,
  );
}

const sourceRevision =
  process.env.FOUNDATIONS_SOURCE_REVISION ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH ?? "0");
if (!/^[0-9a-f]{40}$/.test(sourceRevision)) {
  throw new Error("FOUNDATIONS_SOURCE_REVISION must be an exact Git commit");
}
if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
  throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
}

await rm(output, { recursive: true, force: true });
await mkdir(resolve(staging, "contracts"), { recursive: true });
await mkdir(resolve(staging, "dist/runtime"), { recursive: true });
await mkdir(resolve(staging, "docs"), { recursive: true });

const entrypoint = resolve(staging, "dist/runtime/package.mjs");
await build({
  entryPoints: [resolve(repository, "src/package.ts")],
  outfile: entrypoint,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  charset: "utf8",
  legalComments: "none",
  sourcemap: false,
  external: ["@pulumi/kubernetes", "@pulumi/pulumi"],
  banner: {
    js: 'import { createRequire as __juntaiCreateRequire } from "node:module"; const require = __juntaiCreateRequire(import.meta.url);',
  },
});

const staticFiles = [
  ["release/adoption-inventory.v1.json", "adoption-inventory.v1.json"],
  ["release/construct-lock.v1.json", "construct-lock.v1.json"],
  ["release/contribution.v1.json", "contribution.v1.json"],
  ["release/manifest.v1.json", "manifest.v1.json"],
  ["release/service-releases.v1.json", "service-releases.v1.json"],
  ["docs/adoption-and-rollback.md", "docs/adoption-and-rollback.md"],
  ["docs/package-ownership.md", "docs/package-ownership.md"],
] as const;
for (const [source, destination] of staticFiles) {
  await writeFile(
    resolve(staging, destination),
    await readFile(resolve(repository, source)),
  );
}
await writeFile(
  resolve(staging, "contracts/meridian-config.v1.schema.json"),
  await readFile(
    resolve(
      repository,
      "node_modules/@zephytiju/meridian-storage-constructs/contracts/meridian-config.v1.schema.json",
    ),
  ),
);

const rawSbom = JSON.parse(
  execFileSync("npm", ["sbom", "--omit=dev", "--sbom-format=spdx"], {
    cwd: repository,
    encoding: "utf8",
  }),
) as Record<string, unknown>;
rawSbom.creationInfo = {
  ...(rawSbom.creationInfo as Record<string, unknown>),
  created: new Date(sourceDateEpoch * 1000).toISOString(),
};
rawSbom.documentNamespace = `https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/tree/${sourceRevision}/sbom`;
await writeFile(resolve(staging, "SBOM.spdx.json"), canonicalJson(rawSbom));

const manifest = JSON.parse(
  await readFile(resolve(repository, "release/manifest.v1.json"), "utf8"),
) as { readonly releaseInputs: readonly unknown[] };
const entrypointBytes = await readFile(entrypoint);
const provenance = {
  _type: "https://in-toto.io/Statement/v1",
  subject: [
    {
      name: "dist/runtime/package.mjs",
      digest: { sha256: sha256(entrypointBytes) },
    },
  ],
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: "https://juntai.dev/builds/platform-iac-package/v1",
      externalParameters: {
        packageId: "juntai.platform.substrate",
        packageVersion: "1.0.0",
        sourceRevision,
      },
      internalParameters: { sourceDateEpoch, toolchain: requiredToolchain },
      resolvedDependencies: manifest.releaseInputs,
    },
    runDetails: {
      builder: {
        id: "https://github.com/zephytiju/JuntaiPlatformFoundationsIaC/actions/workflows/release.yml",
      },
    },
  },
};
await writeFile(
  resolve(staging, "provenance.intoto.jsonl"),
  canonicalJson(provenance),
);

const checksumFiles = [
  "SBOM.spdx.json",
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
await writeFile(
  resolve(staging, "SHA256SUMS"),
  `${(
    await Promise.all(
      checksumFiles.map(
        async (file) =>
          `${sha256(await readFile(resolve(staging, file)))}  ${file}`,
      ),
    )
  ).join("\n")}\n`,
);

function octal(value: number, width: number): Buffer {
  const encoded = value.toString(8).padStart(width - 1, "0");
  if (encoded.length >= width) {
    throw new Error(`tar value ${value} exceeds width ${width}`);
  }
  return Buffer.from(`${encoded}\0`, "ascii");
}

function tarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  const name = Buffer.from(path, "utf8");
  if (name.length > 100) throw new Error(`tar path exceeds 100 bytes: ${path}`);
  name.copy(header, 0);
  octal(0o644, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(size, 12).copy(header, 124);
  octal(sourceDateEpoch, 12).copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  Buffer.from("ustar\0", "ascii").copy(header, 257);
  Buffer.from("00", "ascii").copy(header, 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(
    header,
    148,
  );
  return header;
}

const archiveFiles = [...checksumFiles, "SHA256SUMS"].sort();
const parts: Buffer[] = [];
for (const path of archiveFiles) {
  const bytes = await readFile(resolve(staging, path));
  parts.push(tarHeader(path, bytes.length), bytes);
  const padding = (512 - (bytes.length % 512)) % 512;
  if (padding > 0) parts.push(Buffer.alloc(padding));
}
parts.push(Buffer.alloc(1024));
const compressed = gzipSync(Buffer.concat(parts), { level: 9 });
compressed.writeUInt32LE(0, 4);
compressed[9] = 255;
const archive = resolve(output, "platform-iac-package.v1.tar.gz");
await writeFile(archive, compressed, { mode: 0o644 });
await writeFile(
  resolve(output, "platform-iac-package.v1.tar.gz.sha256"),
  `${sha256(compressed)}  platform-iac-package.v1.tar.gz\n`,
);
process.stdout.write(
  `${sha256(entrypointBytes)}  dist/runtime/package.mjs\n${sha256(compressed)}  platform-iac-package.v1.tar.gz\n`,
);
