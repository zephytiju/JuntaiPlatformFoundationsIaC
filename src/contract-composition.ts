import {
  ArtifactVerificationError,
  fetchVerifiedArtifact,
  resolveVerifiedBytes,
  sha256,
  validateArtifactDeclaration,
  type ArtifactFetcher,
  type Sha256Digest,
} from "./artifacts.js";
import {
  FOUNDATION_SERVICE_CATALOG,
  type ContractArtifact,
  type FoundationServiceCatalog,
  type FoundationServiceDeclaration,
  type OpenApiCompatibility,
  type ProtobufCompatibility,
} from "./service-contracts.js";

type JsonObject = Record<string, unknown>;

export interface ResolvedContractEvidence {
  readonly serviceId: string;
  readonly artifactId: string;
  readonly format: ContractArtifact["format"];
  readonly uri: string;
  readonly mediaType: string;
  readonly expectedDigest: Sha256Digest;
  readonly resolvedDigest: Sha256Digest;
}

export interface ContractRouteInput {
  readonly serviceId: string;
  readonly gatewaySurface: "internal" | "operator" | "platform" | "public";
  readonly pathPrefix: `/${string}`;
  readonly paths: readonly string[];
  readonly operationIds: readonly string[];
}

export interface ContractBindingInput {
  readonly serviceId: string;
  readonly namespace: string;
  readonly serviceName: string;
  readonly port: number;
  readonly protocol: "http" | "grpc";
}

export interface ContractCompositionEvidence {
  readonly schemaVersion: "juntai.platform/foundation-contract-composition/v1";
  readonly compositionDigest: Sha256Digest;
  readonly artifacts: readonly ResolvedContractEvidence[];
  readonly routes: readonly ContractRouteInput[];
  readonly bindings: readonly ContractBindingInput[];
}

export interface ContractCompositionResult {
  readonly aggregateOpenApi?: Readonly<JsonObject>;
  readonly protobufServices: readonly string[];
  readonly routes: readonly ContractRouteInput[];
  readonly bindings: readonly ContractBindingInput[];
  readonly evidence: ContractCompositionEvidence;
}

interface ResolvedContract {
  readonly service: FoundationServiceDeclaration;
  readonly artifact: ContractArtifact;
  readonly bytes: Uint8Array;
}

interface ParsedOpenApi {
  readonly service: FoundationServiceDeclaration;
  readonly artifact: ContractArtifact;
  readonly document: JsonObject;
  readonly paths: JsonObject;
  readonly components: JsonObject;
}

interface DescriptorIdentity {
  readonly packages: readonly string[];
  readonly services: readonly string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function namespaceFor(serviceId: string): string {
  return serviceId.replaceAll(/[^A-Za-z0-9_]/g, "_");
}

function validateCatalog(
  catalog: FoundationServiceCatalog,
  selectedServiceIds: ReadonlySet<string>,
): readonly FoundationServiceDeclaration[] {
  if (
    catalog.schemaVersion !== "juntai.platform/foundation-service-releases/v1"
  ) {
    throw new ArtifactVerificationError(
      "unsupported foundation service catalog schema",
    );
  }
  const serviceIds = new Set<string>();
  const artifactIds = new Set<string>();
  for (const service of catalog.services) {
    if (serviceIds.has(service.id)) {
      throw new ArtifactVerificationError(
        `duplicate foundation service declaration '${service.id}'`,
      );
    }
    serviceIds.add(service.id);
    if (!/^sha256:[0-9a-f]{64}$/.test(service.release.imageDigest)) {
      throw new ArtifactVerificationError(
        `service '${service.id}' has an invalid image digest`,
      );
    }
    if (!service.release.image.endsWith(`@${service.release.imageDigest}`)) {
      throw new ArtifactVerificationError(
        `service '${service.id}' image is not pinned to its declared digest`,
      );
    }
    if (
      service.deployment.protocols.includes("http") &&
      (service.deployment.gatewaySurface === undefined ||
        service.deployment.routePrefix === undefined)
    ) {
      throw new ArtifactVerificationError(
        `HTTP service '${service.id}' must declare a gateway surface and route prefix`,
      );
    }
    for (const artifact of service.artifacts) {
      if (artifactIds.has(artifact.id)) {
        throw new ArtifactVerificationError(
          `duplicate service artifact declaration '${artifact.id}'`,
        );
      }
      artifactIds.add(artifact.id);
      validateArtifactDeclaration(artifact);
      if (artifact.format !== artifact.compatibility.format) {
        throw new ArtifactVerificationError(
          `artifact '${artifact.id}' format and compatibility declaration disagree`,
        );
      }
    }
  }
  for (const selected of selectedServiceIds) {
    if (!serviceIds.has(selected)) {
      throw new ArtifactVerificationError(
        `selected foundation service '${selected}' has no declaration`,
      );
    }
  }
  return catalog.services.filter(({ id }) => selectedServiceIds.has(id));
}

function transformOpenApi(value: unknown, namespace: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => transformOpenApi(entry, namespace));
  }
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (
        key === "$ref" &&
        typeof entry === "string" &&
        entry.startsWith("#/components/")
      ) {
        const parts = entry.split("/");
        if (parts.length < 4 || parts[3] === undefined) {
          throw new ArtifactVerificationError(
            `invalid OpenAPI component reference '${entry}'`,
          );
        }
        parts[3] = `${namespace}__${parts[3]}`;
        return [key, parts.join("/")];
      }
      if (key === "$ref" && typeof entry === "string") {
        throw new ArtifactVerificationError(
          `external or non-component OpenAPI reference '${entry}' is not allowed`,
        );
      }
      if (key === "operationId" && typeof entry === "string") {
        return [key, `${namespace}__${entry}`];
      }
      return [key, transformOpenApi(entry, namespace)];
    }),
  );
}

function parseOpenApiContract(contract: ResolvedContract): ParsedOpenApi {
  const compatibility = contract.artifact.compatibility as OpenApiCompatibility;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(contract.bytes),
    ) as unknown;
  } catch (error) {
    throw new ArtifactVerificationError(
      `artifact '${contract.artifact.id}' is not valid UTF-8 OpenAPI JSON: ${String(error)}`,
    );
  }
  if (!isObject(parsed)) {
    throw new ArtifactVerificationError(
      `artifact '${contract.artifact.id}' is not an OpenAPI object`,
    );
  }
  const info = parsed.info;
  const paths = parsed.paths;
  if (
    typeof parsed.openapi !== "string" ||
    !parsed.openapi.startsWith(`${compatibility.documentVersion}.`) ||
    !isObject(info) ||
    info.title !== compatibility.title ||
    info.version !== compatibility.version ||
    !isObject(paths)
  ) {
    throw new ArtifactVerificationError(
      `artifact '${contract.artifact.id}' does not satisfy its OpenAPI identity declaration`,
    );
  }
  for (const requiredPath of compatibility.requiredPaths) {
    if (paths[requiredPath] === undefined) {
      throw new ArtifactVerificationError(
        `artifact '${contract.artifact.id}' is missing required path '${requiredPath}'`,
      );
    }
  }
  if (parsed.components !== undefined && !isObject(parsed.components)) {
    throw new ArtifactVerificationError(
      `artifact '${contract.artifact.id}' has invalid OpenAPI components`,
    );
  }
  return {
    service: contract.service,
    artifact: contract.artifact,
    document: parsed,
    paths,
    components: isObject(parsed.components) ? parsed.components : {},
  };
}

function addNamespacedComponents(
  aggregate: JsonObject,
  document: ParsedOpenApi,
  namespace: string,
): void {
  for (const [groupName, groupValue] of Object.entries(document.components)) {
    if (!isObject(groupValue)) {
      throw new ArtifactVerificationError(
        `artifact '${document.artifact.id}' component group '${groupName}' is invalid`,
      );
    }
    const existing = aggregate[groupName];
    const target = isObject(existing) ? existing : {};
    for (const [componentName, component] of Object.entries(groupValue)) {
      target[`${namespace}__${componentName}`] = transformOpenApi(
        component,
        namespace,
      );
    }
    aggregate[groupName] = target;
  }
}

function collectOperationIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectOperationIds(entry, output));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "operationId" && typeof entry === "string") {
      output.add(entry);
    } else {
      collectOperationIds(entry, output);
    }
  }
}

function jsonPointerExists(root: unknown, pointer: string): boolean {
  if (!pointer.startsWith("#/")) return false;
  let current = root;
  for (const encoded of pointer.slice(2).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) || !(key in current)) return false;
    current = current[key];
  }
  return true;
}

function validateInternalReferences(value: unknown, root: JsonObject): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => validateInternalReferences(entry, root));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") {
      if (!jsonPointerExists(root, entry)) {
        throw new ArtifactVerificationError(
          `composed OpenAPI contains unresolved reference '${entry}'`,
        );
      }
    } else {
      validateInternalReferences(entry, root);
    }
  }
}

function composeOpenApi(documents: readonly ParsedOpenApi[]): {
  readonly aggregateOpenApi?: Readonly<JsonObject>;
  readonly routes: readonly ContractRouteInput[];
} {
  if (documents.length === 0) return { routes: [] };
  const paths: JsonObject = {};
  const components: JsonObject = {};
  const routes: ContractRouteInput[] = [];
  for (const document of documents) {
    const namespace = namespaceFor(document.service.id);
    const routePrefix = document.service.deployment.routePrefix;
    const gatewaySurface = document.service.deployment.gatewaySurface;
    if (routePrefix === undefined || gatewaySurface === undefined) {
      throw new ArtifactVerificationError(
        `OpenAPI service '${document.service.id}' has no HTTP route declaration`,
      );
    }
    const routePaths: string[] = [];
    const operationIds = new Set<string>();
    for (const [path, pathValue] of Object.entries(document.paths)) {
      if (paths[path] !== undefined) {
        throw new ArtifactVerificationError(
          `OpenAPI path '${path}' is declared by more than one foundation service`,
        );
      }
      const transformed = transformOpenApi(pathValue, namespace);
      paths[path] = transformed;
      if (path.startsWith(routePrefix)) {
        routePaths.push(path);
        collectOperationIds(transformed, operationIds);
      }
    }
    if (routePaths.length === 0) {
      throw new ArtifactVerificationError(
        `OpenAPI service '${document.service.id}' exposes no path beneath '${routePrefix}'`,
      );
    }
    addNamespacedComponents(components, document, namespace);
    routes.push(
      Object.freeze({
        serviceId: document.service.id,
        gatewaySurface,
        pathPrefix: routePrefix,
        paths: Object.freeze(routePaths.sort()),
        operationIds: Object.freeze([...operationIds].sort()),
      }),
    );
  }
  const aggregate: JsonObject = {
    openapi: "3.1.0",
    info: {
      title: "Juntai Foundation Service Contracts",
      version: "1.0.0",
    },
    paths,
    components,
  };
  validateInternalReferences(aggregate, aggregate);
  return {
    aggregateOpenApi: Object.freeze(aggregate),
    routes: Object.freeze(routes),
  };
}

class ProtobufReader {
  public offset = 0;

  public constructor(
    public readonly bytes: Uint8Array,
    public readonly end = bytes.length,
  ) {}

  public varint(): number {
    let result = 0n;
    let shift = 0n;
    while (this.offset < this.end && shift <= 63n) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) break;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        const number = Number(result);
        if (!Number.isSafeInteger(number)) break;
        return number;
      }
      shift += 7n;
    }
    throw new ArtifactVerificationError("invalid Protobuf varint encoding");
  }

  public child(): ProtobufReader {
    const length = this.varint();
    const end = this.offset + length;
    if (length < 0 || end > this.end) {
      throw new ArtifactVerificationError(
        "invalid Protobuf length-delimited field",
      );
    }
    const child = new ProtobufReader(this.bytes.subarray(this.offset, end));
    this.offset = end;
    return child;
  }

  public text(): string {
    const reader = this.child();
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(reader.bytes);
    } catch (error) {
      throw new ArtifactVerificationError(
        `invalid Protobuf UTF-8 string: ${String(error)}`,
      );
    }
  }

  public skip(wireType: number): void {
    if (wireType === 0) {
      this.varint();
      return;
    }
    if (wireType === 1) {
      this.offset += 8;
    } else if (wireType === 2) {
      const length = this.varint();
      this.offset += length;
    } else if (wireType === 5) {
      this.offset += 4;
    } else {
      throw new ArtifactVerificationError(
        `unsupported Protobuf wire type '${wireType}'`,
      );
    }
    if (this.offset > this.end) {
      throw new ArtifactVerificationError("truncated Protobuf descriptor set");
    }
  }
}

function readServiceName(reader: ProtobufReader): string | undefined {
  let name: string | undefined;
  while (reader.offset < reader.end) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (field === 1 && wireType === 2) name = reader.text();
    else reader.skip(wireType);
  }
  return name;
}

function readFileDescriptor(reader: ProtobufReader): {
  readonly packageName?: string;
  readonly serviceNames: readonly string[];
} {
  let packageName: string | undefined;
  const serviceNames: string[] = [];
  while (reader.offset < reader.end) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (field === 2 && wireType === 2) {
      packageName = reader.text();
    } else if (field === 6 && wireType === 2) {
      const name = readServiceName(reader.child());
      if (name !== undefined) serviceNames.push(name);
    } else {
      reader.skip(wireType);
    }
  }
  return { packageName, serviceNames };
}

function parseDescriptorSet(bytes: Uint8Array): DescriptorIdentity {
  const reader = new ProtobufReader(bytes);
  const packages = new Set<string>();
  const services = new Set<string>();
  while (reader.offset < reader.end) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (field === 1 && wireType === 2) {
      const descriptor = readFileDescriptor(reader.child());
      if (descriptor.packageName !== undefined) {
        packages.add(descriptor.packageName);
        for (const service of descriptor.serviceNames) {
          services.add(`${descriptor.packageName}.${service}`);
        }
      }
    } else {
      reader.skip(wireType);
    }
  }
  return {
    packages: Object.freeze([...packages].sort()),
    services: Object.freeze([...services].sort()),
  };
}

function validateProtobufContract(
  contract: ResolvedContract,
): DescriptorIdentity {
  const compatibility = contract.artifact
    .compatibility as ProtobufCompatibility;
  const identity = parseDescriptorSet(contract.bytes);
  for (const packageName of compatibility.requiredPackages) {
    if (!identity.packages.includes(packageName)) {
      throw new ArtifactVerificationError(
        `artifact '${contract.artifact.id}' is missing Protobuf package '${packageName}'`,
      );
    }
  }
  for (const serviceName of compatibility.requiredServices) {
    if (!identity.services.includes(serviceName)) {
      throw new ArtifactVerificationError(
        `artifact '${contract.artifact.id}' is missing Protobuf service '${serviceName}'`,
      );
    }
  }
  return identity;
}

export async function resolveAndComposeServiceContracts(
  options: {
    readonly catalog?: FoundationServiceCatalog;
    readonly selectedServiceIds?: readonly string[];
    readonly fetcher?: ArtifactFetcher;
  } = {},
): Promise<ContractCompositionResult> {
  const catalog = options.catalog ?? FOUNDATION_SERVICE_CATALOG;
  const selectedServiceIds = new Set(
    options.selectedServiceIds ?? catalog.services.map(({ id }) => id),
  );
  const services = validateCatalog(catalog, selectedServiceIds);
  const fetcher = options.fetcher ?? fetchVerifiedArtifact;
  const resolved = await Promise.all(
    services.flatMap((service) =>
      service.artifacts.map(async (artifact): Promise<ResolvedContract> => ({
        service,
        artifact,
        bytes: await resolveVerifiedBytes(artifact, fetcher),
      })),
    ),
  );
  const openApi = composeOpenApi(
    resolved
      .filter(({ artifact }) => artifact.format === "openapi")
      .map(parseOpenApiContract),
  );
  const protobufServices = new Set<string>();
  for (const contract of resolved.filter(
    ({ artifact }) => artifact.format === "protobuf-file-descriptor-set",
  )) {
    for (const service of validateProtobufContract(contract).services) {
      protobufServices.add(service);
    }
  }
  const bindings = Object.freeze(
    services.flatMap((service) =>
      service.deployment.protocols.map((protocol) =>
        Object.freeze({
          serviceId: service.id,
          namespace: service.deployment.namespace,
          serviceName: service.deployment.serviceName,
          port: service.deployment.port,
          protocol,
        }),
      ),
    ),
  );
  const artifactEvidence = Object.freeze(
    resolved.map(({ service, artifact, bytes }) =>
      Object.freeze({
        serviceId: service.id,
        artifactId: artifact.id,
        format: artifact.format,
        uri: artifact.uri,
        mediaType: artifact.mediaType,
        expectedDigest: artifact.digest,
        resolvedDigest: sha256(bytes),
      }),
    ),
  );
  const digestInput = {
    aggregateOpenApi: openApi.aggregateOpenApi ?? null,
    artifacts: artifactEvidence,
    bindings,
    protobufServices: [...protobufServices].sort(),
    routes: openApi.routes,
  };
  const evidence: ContractCompositionEvidence = Object.freeze({
    schemaVersion: "juntai.platform/foundation-contract-composition/v1",
    compositionDigest: sha256(canonicalJson(digestInput)),
    artifacts: artifactEvidence,
    routes: openApi.routes,
    bindings,
  });
  return Object.freeze({
    ...(openApi.aggregateOpenApi === undefined
      ? {}
      : { aggregateOpenApi: openApi.aggregateOpenApi }),
    protobufServices: Object.freeze([...protobufServices].sort()),
    routes: openApi.routes,
    bindings,
    evidence,
  });
}
