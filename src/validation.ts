import type { FoundationsInputs } from "./types.js";

const SECRET_MATERIAL_KEY =
  /^(?:access[-_.]?key|credential|password|private[-_.]?key|secret(?:Bytes|Material|Value)?|token)$/i;

function rejectSecretMaterial(value: unknown, path = "inputs"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectSecretMaterial(item, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_MATERIAL_KEY.test(key)) {
      throw new Error(
        `${path}.${key} looks like secret material; Foundations accepts only opaque Secret references`,
      );
    }
    rejectSecretMaterial(item, `${path}.${key}`);
  }
}

function assertFileReference(
  label: string,
  reference: {
    readonly name: string;
    readonly items: Readonly<Record<string, string>>;
    readonly mountPath: string;
  },
  requiredKeys: readonly string[],
): void {
  if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(reference.name)) {
    throw new Error(`${label} Secret name must be a DNS label`);
  }
  if (
    !reference.mountPath.startsWith("/") ||
    reference.mountPath.includes("..")
  ) {
    throw new Error(`${label} mount path must be an absolute normalized path`);
  }
  for (const key of requiredKeys) {
    if (reference.items[key] === undefined) {
      throw new Error(`${label} Secret must project '${key}'`);
    }
  }
}

export function validateFoundationsInputs(inputs: FoundationsInputs): void {
  rejectSecretMaterial(inputs);
  assertFileReference("Casdoor configuration", inputs.casdoor.configuration, [
    "app.conf",
  ]);
  assertFileReference("Blueprint cursor HMAC", inputs.blueprint.cursorHmac, [
    "hmac-key",
  ]);
  assertFileReference(
    "Blueprint policy-reader credential",
    inputs.blueprint.policyReaderClientSecret,
    ["client-secret"],
  );
  if (!inputs.casdoor.consoleRedirectUri.startsWith("https://")) {
    throw new Error("Casdoor Console redirect URI must use HTTPS");
  }
  if (
    !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(
      inputs.casdoor.bootstrapCredential.name,
    ) ||
    !/^[A-Za-z0-9._-]+$/.test(inputs.casdoor.bootstrapCredential.key)
  ) {
    throw new Error(
      "Casdoor bootstrap credential must be an opaque Secret key reference",
    );
  }
  if (inputs.meridian.engines.length === 0) {
    throw new Error(
      "Foundations requires deployment-selected Meridian Engines",
    );
  }
  if (/\b(?:kes|kingbase)\b/i.test(JSON.stringify(inputs.meridian))) {
    throw new Error("Foundations data engines must not expose KES or Kingbase");
  }
}
