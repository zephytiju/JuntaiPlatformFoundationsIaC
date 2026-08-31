import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");

await rm(resolve(repository, "dist"), { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    resolve(repository, "node_modules/typescript/bin/tsc"),
    "-p",
    resolve(repository, "tsconfig.build.json"),
  ],
  { cwd: repository, stdio: "inherit" },
);
