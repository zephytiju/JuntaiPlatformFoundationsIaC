import { parseAllDocuments, stringify } from "yaml";

export type GatewayManifestOwner =
  "gateway-api-standard" | "envoy-gateway-install";

export interface PhysicalResourceIdentity {
  readonly apiVersion: string;
  readonly kind: string;
  readonly namespace: string | null;
  readonly name: string;
}

export interface GatewayManifestOwnership extends PhysicalResourceIdentity {
  readonly owner: GatewayManifestOwner;
  readonly presentIn: readonly GatewayManifestOwner[];
}

export interface PartitionedGatewayManifests {
  readonly gatewayApiYaml: string;
  readonly envoyGatewayYaml: string;
  readonly ownership: readonly GatewayManifestOwnership[];
}

interface ParsedManifestDocument {
  readonly identity: PhysicalResourceIdentity;
  readonly key: string;
  readonly resource: Record<string, unknown>;
}

const GATEWAY_API_STANDARD_KEYS = Object.freeze([
  "apiextensions.k8s.io/v1|CustomResourceDefinition||backendtlspolicies.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||gatewayclasses.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||gateways.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||grpcroutes.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||httproutes.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||listenersets.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||referencegrants.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||tlsroutes.gateway.networking.k8s.io",
  "admissionregistration.k8s.io/v1|ValidatingAdmissionPolicy||safe-upgrades.gateway.networking.k8s.io",
  "admissionregistration.k8s.io/v1|ValidatingAdmissionPolicyBinding||safe-upgrades.gateway.networking.k8s.io",
] as const);

const EQUIVALENT_OVERLAP_KEYS = new Set<string>([
  "admissionregistration.k8s.io/v1|ValidatingAdmissionPolicy||safe-upgrades.gateway.networking.k8s.io",
  "admissionregistration.k8s.io/v1|ValidatingAdmissionPolicyBinding||safe-upgrades.gateway.networking.k8s.io",
]);

const ENVOY_GATEWAY_OWNED_KEYS = Object.freeze([
  "admissionregistration.k8s.io/v1|MutatingWebhookConfiguration||envoy-gateway-topology-injector.envoy-gateway-system",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||backends.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||backendtrafficpolicies.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||clienttrafficpolicies.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||envoyextensionpolicies.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||envoypatchpolicies.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||envoyproxies.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||httproutefilters.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||securitypolicies.gateway.envoyproxy.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||tcproutes.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||udproutes.gateway.networking.k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||xbackendtrafficpolicies.gateway.networking.x-k8s.io",
  "apiextensions.k8s.io/v1|CustomResourceDefinition||xmeshes.gateway.networking.x-k8s.io",
  "apps/v1|Deployment|envoy-gateway-system|envoy-gateway",
  "batch/v1|Job|envoy-gateway-system|eg-gateway-helm-certgen",
  "rbac.authorization.k8s.io/v1|ClusterRole||eg-gateway-helm-certgen:envoy-gateway-system",
  "rbac.authorization.k8s.io/v1|ClusterRole||eg-gateway-helm-envoy-gateway-role",
  "rbac.authorization.k8s.io/v1|ClusterRoleBinding||eg-gateway-helm-certgen:envoy-gateway-system",
  "rbac.authorization.k8s.io/v1|ClusterRoleBinding||eg-gateway-helm-envoy-gateway-rolebinding",
  "rbac.authorization.k8s.io/v1|Role|envoy-gateway-system|eg-gateway-helm-certgen",
  "rbac.authorization.k8s.io/v1|Role|envoy-gateway-system|eg-gateway-helm-infra-manager",
  "rbac.authorization.k8s.io/v1|Role|envoy-gateway-system|eg-gateway-helm-leader-election-role",
  "rbac.authorization.k8s.io/v1|RoleBinding|envoy-gateway-system|eg-gateway-helm-certgen",
  "rbac.authorization.k8s.io/v1|RoleBinding|envoy-gateway-system|eg-gateway-helm-infra-manager",
  "rbac.authorization.k8s.io/v1|RoleBinding|envoy-gateway-system|eg-gateway-helm-leader-election-rolebinding",
  "v1|ConfigMap|envoy-gateway-system|envoy-gateway-config",
  "v1|Namespace||envoy-gateway-system",
  "v1|Service|envoy-gateway-system|envoy-gateway",
  "v1|ServiceAccount|envoy-gateway-system|eg-gateway-helm-certgen",
  "v1|ServiceAccount|envoy-gateway-system|envoy-gateway",
] as const);

const ENVOY_CERTGEN_JOB_KEY =
  "batch/v1|Job|envoy-gateway-system|eg-gateway-helm-certgen";

export const GATEWAY_MANIFEST_NORMALIZATIONS = Object.freeze([
  Object.freeze({
    owner: "envoy-gateway-install" as const,
    resourceKey: ENVOY_CERTGEN_JOB_KEY,
    removedInput: "spec.ttlSecondsAfterFinished" as const,
    expectedSourceValue: 30,
    purpose: "retain the completed package-owned Job for stable desired state",
  }),
]);

const EXPECTED_ENVOY_INPUT_KEYS = Object.freeze([
  ...GATEWAY_API_STANDARD_KEYS,
  ...ENVOY_GATEWAY_OWNED_KEYS,
]);

function identityFromKey(key: string): PhysicalResourceIdentity {
  const [apiVersion, kind, namespace, name, ...unexpected] = key.split("|");
  if (
    apiVersion === undefined ||
    kind === undefined ||
    namespace === undefined ||
    name === undefined ||
    unexpected.length > 0
  ) {
    throw new Error(`invalid physical resource key '${key}'`);
  }
  return Object.freeze({
    apiVersion,
    kind,
    namespace: namespace.length === 0 ? null : namespace,
    name,
  });
}

export const GATEWAY_API_STANDARD_IDENTITIES = Object.freeze(
  GATEWAY_API_STANDARD_KEYS.map(identityFromKey),
);

export const ENVOY_GATEWAY_IDENTITIES = Object.freeze(
  ENVOY_GATEWAY_OWNED_KEYS.map(identityFromKey),
);

export const GATEWAY_MANIFEST_OWNERSHIP = Object.freeze(
  [
    ...GATEWAY_API_STANDARD_KEYS.map((key) => ({
      ...identityFromKey(key),
      owner: "gateway-api-standard" as const,
      presentIn: Object.freeze([
        "gateway-api-standard" as const,
        "envoy-gateway-install" as const,
      ]),
    })),
    ...ENVOY_GATEWAY_OWNED_KEYS.map((key) => ({
      ...identityFromKey(key),
      owner: "envoy-gateway-install" as const,
      presentIn: Object.freeze(["envoy-gateway-install" as const]),
    })),
  ].sort((left, right) =>
    physicalResourceKey(left).localeCompare(physicalResourceKey(right)),
  ),
);

export function physicalResourceKey(
  identity: PhysicalResourceIdentity,
): string {
  return [
    identity.apiVersion,
    identity.kind,
    identity.namespace ?? "",
    identity.name,
  ].join("|");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  source: string,
  documentIndex: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${source} document ${documentIndex + 1} must declare a non-empty ${field}`,
    );
  }
  return value;
}

function parseManifestDocuments(
  source: GatewayManifestOwner,
  yaml: string,
): readonly ParsedManifestDocument[] {
  const parsed = parseAllDocuments(yaml, { strict: true });
  if (parsed.length === 0) {
    throw new Error(`${source} payload contains no YAML documents`);
  }
  const documents = parsed.flatMap((document, index) => {
    if (document.errors.length > 0) {
      throw new Error(
        `${source} document ${index + 1} is invalid YAML: ${document.errors.map(({ message }) => message).join("; ")}`,
      );
    }
    const resource: unknown = document.toJS();
    if (resource === null || resource === undefined) return [];
    if (!isRecord(resource)) {
      throw new Error(
        `${source} document ${index + 1} must contain one Kubernetes resource object`,
      );
    }
    const metadata = resource.metadata;
    if (!isRecord(metadata)) {
      throw new Error(`${source} document ${index + 1} must declare metadata`);
    }
    const namespace = metadata.namespace;
    if (
      namespace !== undefined &&
      (typeof namespace !== "string" || namespace.trim().length === 0)
    ) {
      throw new Error(
        `${source} document ${index + 1} metadata.namespace must be a non-empty string when present`,
      );
    }
    const identity = Object.freeze({
      apiVersion: requiredString(
        resource.apiVersion,
        "apiVersion",
        source,
        index,
      ),
      kind: requiredString(resource.kind, "kind", source, index),
      namespace: namespace ?? null,
      name: requiredString(metadata.name, "metadata.name", source, index),
    });
    return [
      Object.freeze({
        identity,
        key: physicalResourceKey(identity),
        resource,
      }),
    ];
  });
  if (documents.length === 0) {
    throw new Error(`${source} payload contains no Kubernetes resources`);
  }
  const seen = new Set<string>();
  for (const document of documents) {
    if (seen.has(document.key)) {
      throw new Error(
        `${source} payload contains duplicate physical identity '${document.key}'`,
      );
    }
    seen.add(document.key);
  }
  return Object.freeze(documents);
}

function assertExactInventory(
  source: GatewayManifestOwner,
  documents: readonly ParsedManifestDocument[],
  expectedKeys: readonly string[],
): void {
  const actual = new Set(documents.map(({ key }) => key));
  const expected = new Set(expectedKeys);
  const missing = [...expected].filter((key) => !actual.has(key)).sort();
  const unexpected = [...actual].filter((key) => !expected.has(key)).sort();
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${source} physical identity drift: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`,
    );
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function resourcesEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return (
    JSON.stringify(canonicalValue(left)) ===
    JSON.stringify(canonicalValue(right))
  );
}

function serializeDocuments(
  documents: readonly ParsedManifestDocument[],
): string {
  return documents
    .map(({ resource }) => stringify(resource, { lineWidth: 0 }).trimEnd())
    .join("\n---\n")
    .concat("\n");
}

function normalizeEnvoyOwnedDocument(
  document: ParsedManifestDocument,
): ParsedManifestDocument {
  if (document.key !== ENVOY_CERTGEN_JOB_KEY) return document;
  const spec = document.resource.spec;
  if (!isRecord(spec) || spec.ttlSecondsAfterFinished !== 30) {
    throw new Error(
      `${ENVOY_CERTGEN_JOB_KEY} source TTL drifted from the reviewed value 30`,
    );
  }
  const retainedSpec = { ...spec };
  delete retainedSpec.ttlSecondsAfterFinished;
  return Object.freeze({
    ...document,
    resource: {
      ...document.resource,
      spec: retainedSpec,
    },
  });
}

export function partitionGatewayManifests(
  gatewayApiYaml: string,
  envoyGatewayYaml: string,
): PartitionedGatewayManifests {
  const gatewayDocuments = parseManifestDocuments(
    "gateway-api-standard",
    gatewayApiYaml,
  );
  const envoyDocuments = parseManifestDocuments(
    "envoy-gateway-install",
    envoyGatewayYaml,
  );
  assertExactInventory(
    "gateway-api-standard",
    gatewayDocuments,
    GATEWAY_API_STANDARD_KEYS,
  );
  assertExactInventory(
    "envoy-gateway-install",
    envoyDocuments,
    EXPECTED_ENVOY_INPUT_KEYS,
  );

  const gatewayByKey = new Map(
    gatewayDocuments.map((document) => [document.key, document] as const),
  );
  const envoyByKey = new Map(
    envoyDocuments.map((document) => [document.key, document] as const),
  );
  for (const key of GATEWAY_API_STANDARD_KEYS) {
    const gateway = gatewayByKey.get(key);
    const envoy = envoyByKey.get(key);
    if (gateway === undefined || envoy === undefined) {
      throw new Error(
        `overlap '${key}' disappeared after inventory validation`,
      );
    }
    const equal = resourcesEqual(gateway.resource, envoy.resource);
    if (EQUIVALENT_OVERLAP_KEYS.has(key) !== equal) {
      throw new Error(
        `${key} payload relationship drifted; expected ${EQUIVALENT_OVERLAP_KEYS.has(key) ? "equivalent" : "different"} Gateway API and Envoy definitions`,
      );
    }
  }

  const overlap = new Set<string>(GATEWAY_API_STANDARD_KEYS);
  const envoyOwnedDocuments = envoyDocuments
    .filter(({ key }) => !overlap.has(key))
    .map(normalizeEnvoyOwnedDocument);
  assertExactInventory(
    "envoy-gateway-install",
    envoyOwnedDocuments,
    ENVOY_GATEWAY_OWNED_KEYS,
  );
  const registeredKeys = [
    ...gatewayDocuments.map(({ key }) => key),
    ...envoyOwnedDocuments.map(({ key }) => key),
  ];
  if (new Set(registeredKeys).size !== registeredKeys.length) {
    throw new Error("final Gateway manifest partition contains a second owner");
  }

  return Object.freeze({
    gatewayApiYaml: serializeDocuments(gatewayDocuments),
    envoyGatewayYaml: serializeDocuments(envoyOwnedDocuments),
    ownership: GATEWAY_MANIFEST_OWNERSHIP,
  });
}
