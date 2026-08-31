import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FOUNDATION_SERVICE_CATALOG } from "../src/service-contracts.js";

interface PackedFile {
  readonly path: string;
}

interface PackResult {
  readonly filename: string;
  readonly name: string;
  readonly version: string;
  readonly files: readonly PackedFile[];
  readonly integrity: string;
  readonly shasum: string;
}

const repository = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(resolve(repository, "package.json"), "utf8"),
) as { readonly name: string; readonly version: string };
const manifest = JSON.parse(
  await readFile(resolve(repository, "release/manifest.v1.json"), "utf8"),
) as Record<string, unknown>;
const serviceReleases = JSON.parse(
  await readFile(
    resolve(repository, "release/service-releases.v1.json"),
    "utf8",
  ),
) as Record<string, unknown>;
const manifestKeys = [
  "compatibility",
  "entrypoint",
  "id",
  "owners",
  "provides",
  "releaseInputs",
  "requires",
  "schemaVersion",
  "targetProfiles",
  "version",
];
if (
  JSON.stringify(Object.keys(manifest).sort()) !==
    JSON.stringify(manifestKeys) ||
  manifest.id !== "juntai.platform.substrate" ||
  manifest.version !== packageJson.version ||
  manifest.entrypoint !== "dist/index.js"
) {
  throw new Error("npm package descriptor is not the canonical v1 contract");
}
if (
  JSON.stringify(serviceReleases) !== JSON.stringify(FOUNDATION_SERVICE_CATALOG)
) {
  throw new Error(
    "packaged service release catalog differs from the Pulumi TypeScript declaration",
  );
}
const temporary = await mkdtemp(join(tmpdir(), "juntai-foundations-npm-"));
const npmEnvironment = {
  ...process.env,
  npm_config_audit: "false",
  npm_config_cache: resolve(temporary, "npm-cache"),
  npm_config_fund: "false",
};

function run(command: string, args: readonly string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: npmEnvironment,
  });
}

try {
  run("npm", ["run", "build"], repository);
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        ".",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        temporary,
      ],
      { cwd: repository, encoding: "utf8", env: npmEnvironment },
    ),
  ) as readonly PackResult[];
  const result = packed[0];
  if (
    result === undefined ||
    result.name !== packageJson.name ||
    result.version !== packageJson.version ||
    !/^sha512-/.test(result.integrity) ||
    !/^[0-9a-f]{40}$/.test(result.shasum)
  ) {
    throw new Error("npm pack did not produce the exact reviewed package");
  }

  const files = new Set(result.files.map(({ path }) => path));
  const required = [
    "NOTICE",
    "README.md",
    "dist/index.d.ts",
    "dist/index.js",
    "docs/npm-release.md",
    "package.json",
    "release/adoption-inventory.v1.json",
    "release/construct-lock.v1.json",
    "release/contribution.v1.json",
    "release/manifest.v1.json",
    "release/service-releases.v1.json",
  ];
  for (const path of required) {
    if (!files.has(path)) throw new Error(`npm package is missing '${path}'`);
  }
  const forbidden = [".github/", "preview/", "scripts/", "src/", "tests/"];
  for (const { path } of result.files) {
    if (forbidden.some((prefix) => path.startsWith(prefix))) {
      throw new Error(`npm package contains forbidden source path '${path}'`);
    }
  }
  for (const path of files) {
    if (
      (/(?:^|\/)(?:openapi|protobuf)(?:\/|\.)/i.test(path) ||
        /(?:^|\/)contracts?\//i.test(path)) &&
      path !== "release/service-releases.v1.json"
    ) {
      throw new Error(
        `npm package contains vendored service contract '${path}'`,
      );
    }
  }

  const tarball = resolve(temporary, result.filename);
  const consumer = resolve(temporary, "consumer");
  await mkdir(consumer);
  await copyFile(tarball, resolve(temporary, "foundations.tgz"));
  await writeFile(
    resolve(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "foundations-npm-consumer-verification",
        private: true,
        type: "module",
        dependencies: {
          [packageJson.name]: "file:../foundations.tgz",
        },
        devDependencies: { typescript: "5.9.3" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(consumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2023",
        },
        include: ["verify.mts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(consumer, "verify.mts"),
    `import foundationsPackage, { FOUNDATION_SERVICE_CATALOG, FOUNDATIONS_PACKAGE_VERSION, resolveAndComposeServiceContracts } from "${packageJson.name}";\n\n` +
      `if (foundationsPackage.id !== "juntai.platform.substrate") throw new Error("unexpected package id");\n` +
      `if (foundationsPackage.version !== FOUNDATIONS_PACKAGE_VERSION) throw new Error("version mismatch");\n` +
      `if (foundationsPackage.version !== "${packageJson.version}") throw new Error("unexpected package version");\n` +
      `if (typeof foundationsPackage.deploy !== "function") throw new Error("missing Pulumi entrypoint");\n` +
      `if (FOUNDATION_SERVICE_CATALOG.services.length < 2) throw new Error("missing service declarations");\n` +
      `if (typeof resolveAndComposeServiceContracts !== "function") throw new Error("missing contract resolver");\n`,
  );

  run("npm", ["install", "--package-lock-only", "--ignore-scripts"], consumer);
  run("npm", ["ci", "--ignore-scripts"], consumer);
  run("npm", ["exec", "--", "tsc"], consumer);
  run(
    "node",
    ["--experimental-strip-types", resolve(consumer, "verify.mts")],
    consumer,
  );

  const lock = JSON.parse(
    await readFile(resolve(consumer, "package-lock.json"), "utf8"),
  ) as {
    readonly packages?: Readonly<
      Record<string, { readonly version?: string; readonly integrity?: string }>
    >;
  };
  const installed = lock.packages?.[`node_modules/${packageJson.name}`];
  if (
    installed?.version !== packageJson.version ||
    !installed.integrity?.startsWith("sha512-")
  ) {
    throw new Error("clean consumer lock lacks exact npm tarball integrity");
  }

  process.stdout.write(
    `${result.name}@${result.version} ${result.integrity} ${result.shasum}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
