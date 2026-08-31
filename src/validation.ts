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
    throw new Error(`${label} name must be a DNS label`);
  }
  if (
    !reference.mountPath.startsWith("/") ||
    reference.mountPath.includes("..")
  ) {
    throw new Error(`${label} mount path must be an absolute normalized path`);
  }
  for (const key of requiredKeys) {
    if (reference.items[key] === undefined) {
      throw new Error(`${label} must project '${key}'`);
    }
  }
  if (Object.keys(reference.items).length === 0) {
    throw new Error(`${label} must project at least one file`);
  }
  for (const [key, path] of Object.entries(reference.items)) {
    if (
      key.length === 0 ||
      path.length === 0 ||
      key.startsWith("/") ||
      path.startsWith("/") ||
      key.split("/").includes("..") ||
      path.split("/").includes("..")
    ) {
      throw new Error(`${label} file projections must use relative paths`);
    }
  }
}

function assertHttpsUrl(label: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error(`${label} must use HTTPS and contain no credentials`);
  }
}

function assertServiceUrl(label: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute service URL`);
  }
  const clusterLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname.endsWith(".svc") ||
      parsed.hostname.endsWith(".svc.cluster.local"));
  if (
    (parsed.protocol !== "https:" && !clusterLocalHttp) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error(
      `${label} must use HTTPS or cluster-local HTTP and contain no credentials`,
    );
  }
}

function assertIpv4Cidr(label: string, value: string): void {
  const match =
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/.exec(
      value,
    );
  if (
    match === null ||
    match.slice(1, 5).some((part) => Number(part) > 255) ||
    match[5] === "0"
  ) {
    throw new Error(
      `${label} must be a bounded IPv4 CIDR (prefix /1 through /32)`,
    );
  }
}

export function validateFoundationsInputs(inputs: FoundationsInputs): void {
  rejectSecretMaterial(inputs);
  if (
    inputs.legacyAdoptionCompatibility !== undefined &&
    (inputs.legacyAdoptionCompatibility.profile !==
      "core-v1.9.0-uid-preserving" ||
      inputs.legacyAdoptionCompatibility.retainedThrough !==
        "task-08-verification")
  ) {
    throw new Error(
      "legacy adoption compatibility must use the exact Core v1.9.0 UID-preserving lifecycle",
    );
  }
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
  assertFileReference("Account composition", inputs.account.composition, []);
  if (
    !/^[A-Za-z_][A-Za-z0-9_.]*:[A-Za-z_][A-Za-z0-9_]*$/.test(
      inputs.account.compositionFactory,
    )
  ) {
    throw new Error(
      "Account composition factory must use module:function syntax",
    );
  }
  const accountMounts = new Set([inputs.account.composition.mountPath]);
  for (const [index, reference] of (
    inputs.account.runtimeReferences ?? []
  ).entries()) {
    assertFileReference(`Account runtime reference ${index}`, reference, []);
    if (accountMounts.has(reference.mountPath)) {
      throw new Error("Account runtime reference mount paths must be unique");
    }
    accountMounts.add(reference.mountPath);
  }
  assertFileReference(
    "Application Metadata cursor HMAC",
    inputs.applicationMetadata.cursorHmac,
    ["hmac-key"],
  );
  assertFileReference(
    "Application Metadata policy-reader credential",
    inputs.applicationMetadata.policyReaderClientSecret,
    ["client-secret"],
  );
  if (
    inputs.applicationMetadata.cursorHmac.mountPath ===
    inputs.applicationMetadata.policyReaderClientSecret.mountPath
  ) {
    throw new Error("Application Metadata Secret mount paths must be unique");
  }
  assertHttpsUrl(
    "Casdoor Console redirect URI",
    inputs.casdoor.consoleRedirectUri,
  );
  assertServiceUrl(
    "Application Metadata Casdoor issuer",
    inputs.applicationMetadata.casdoorIssuer,
  );
  assertHttpsUrl(
    "Application Metadata Kubernetes API server",
    inputs.applicationMetadata.kubernetesApiServer ??
      "https://kubernetes.default.svc",
  );
  if (
    !/^[^/\s]+\/[^/\s]+$/.test(
      inputs.applicationMetadata.casdoorPolicyEnforcerId,
    )
  ) {
    throw new Error(
      "Application Metadata Casdoor policy enforcer must use owner/name syntax",
    );
  }
  for (const [label, value] of [
    ["Casdoor audience", inputs.applicationMetadata.casdoorAudience],
    [
      "Casdoor service client ID",
      inputs.applicationMetadata.casdoorServiceClientId,
    ],
    [
      "Kubernetes workload audience",
      inputs.applicationMetadata.kubernetesWorkloadAudience,
    ],
    [
      "Kubernetes workload issuer",
      inputs.applicationMetadata.kubernetesWorkloadIssuer,
    ],
  ] as const) {
    if (value.trim().length === 0) {
      throw new Error(`Application Metadata ${label} must not be empty`);
    }
  }
  assertIpv4Cidr(
    "Application Metadata Kubernetes API CIDR",
    inputs.applicationMetadata.kubernetesApiCidr,
  );
  const workloadBindingIds = new Set<string>();
  for (const binding of inputs.applicationMetadata.workloadBindings) {
    if (
      !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(binding.namespace) ||
      !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(binding.serviceAccount) ||
      binding.tenantId.trim().length === 0 ||
      binding.workloadId.trim().length === 0
    ) {
      throw new Error(
        "Application Metadata workload bindings require DNS namespace/service-account names and non-empty IDs",
      );
    }
    if (binding.tenantId.length > 2_048 || binding.workloadId.length > 2_048) {
      throw new Error(
        "Application Metadata workload binding IDs must not exceed 2048 characters",
      );
    }
    const id = `${binding.namespace}/${binding.serviceAccount}`;
    if (workloadBindingIds.has(id)) {
      throw new Error("Application Metadata workload bindings must be unique");
    }
    workloadBindingIds.add(id);
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
