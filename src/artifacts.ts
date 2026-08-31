import { createHash } from "node:crypto";

export type Sha256Digest = `sha256:${string}`;

export interface VerifiedArtifact {
  readonly id?: string;
  readonly uri: string;
  readonly digest: Sha256Digest;
  readonly mediaType?: string;
}

export type ArtifactFetcher = (
  artifact: VerifiedArtifact,
) => Promise<Uint8Array>;

export interface ArtifactCredentials {
  readonly githubToken?: string;
  readonly ociToken?: string;
}

export interface ArtifactResolverOptions {
  readonly credentials?: ArtifactCredentials;
  readonly fetch?: typeof fetch;
}

interface OciCoordinate {
  readonly registry: string;
  readonly repository: string;
  readonly manifestDigest: Sha256Digest;
}

interface GitHubReleaseCoordinate {
  readonly owner: string;
  readonly repository: string;
  readonly tag: string;
  readonly assetName: string;
}

interface GitHubRawCoordinate {
  readonly owner: string;
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
}

interface OciDescriptor {
  readonly digest: Sha256Digest;
  readonly mediaType: string;
}

interface OciManifest {
  readonly layers: readonly OciDescriptor[];
}

export class ArtifactVerificationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArtifactVerificationError";
  }
}

export function sha256(bytes: Uint8Array | string): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validateArtifactDeclaration(artifact: VerifiedArtifact): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(artifact.digest)) {
    throw new ArtifactVerificationError(
      `artifact '${artifact.uri}' has an invalid SHA-256 digest`,
    );
  }
  if (artifact.uri.startsWith("https://")) {
    validateHttpsCoordinate(artifact.uri);
    return;
  }
  if (artifact.uri.startsWith("oci://")) {
    parseOciCoordinate(artifact.uri);
    if (artifact.mediaType === undefined || artifact.mediaType.length === 0) {
      throw new ArtifactVerificationError(
        `OCI artifact '${artifact.uri}' must declare an exact layer media type`,
      );
    }
    return;
  }
  throw new ArtifactVerificationError(
    `artifact '${artifact.uri}' must use an immutable HTTPS release or OCI digest coordinate`,
  );
}

function validateHttpsCoordinate(uri: string): void {
  const coordinate = new URL(uri);
  if (
    coordinate.username.length > 0 ||
    coordinate.password.length > 0 ||
    coordinate.search.length > 0 ||
    coordinate.hash.length > 0 ||
    /(?:^|\/)latest(?:\/|$)/i.test(coordinate.pathname)
  ) {
    throw new ArtifactVerificationError(
      `artifact '${uri}' contains a mutable or credential-bearing HTTPS coordinate`,
    );
  }
  if (coordinate.hostname === "github.com") {
    const release = parseGitHubReleaseCoordinate(uri);
    if (release === undefined || /^latest$/i.test(release.tag)) {
      throw new ArtifactVerificationError(
        `GitHub artifact '${uri}' must name an exact release tag and asset`,
      );
    }
  }
  if (
    coordinate.hostname === "raw.githubusercontent.com" &&
    parseGitHubRawCoordinate(uri) === undefined
  ) {
    throw new ArtifactVerificationError(
      `GitHub source artifact '${uri}' must pin an exact commit and path`,
    );
  }
}

function parseGitHubRawCoordinate(
  uri: string,
): GitHubRawCoordinate | undefined {
  const coordinate = new URL(uri);
  const match = coordinate.pathname.match(
    /^\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(.+)$/,
  );
  if (
    coordinate.hostname !== "raw.githubusercontent.com" ||
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return undefined;
  }
  return {
    owner: match[1],
    repository: match[2],
    commit: match[3],
    path: match[4],
  };
}

function parseGitHubReleaseCoordinate(
  uri: string,
): GitHubReleaseCoordinate | undefined {
  const coordinate = new URL(uri);
  const match = coordinate.pathname.match(
    /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/,
  );
  if (
    coordinate.hostname !== "github.com" ||
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return undefined;
  }
  return {
    owner: match[1],
    repository: match[2],
    tag: decodeURIComponent(match[3]),
    assetName: decodeURIComponent(match[4]),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOciCoordinate(uri: string): OciCoordinate {
  const match = uri.match(/^oci:\/\/([^/]+)\/(.+)@(sha256:[0-9a-f]{64})$/);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[2].includes("@")
  ) {
    throw new ArtifactVerificationError(
      `OCI artifact '${uri}' must pin an exact sha256 manifest digest`,
    );
  }
  return {
    registry: match[1],
    repository: match[2],
    manifestDigest: match[3] as Sha256Digest,
  };
}

function isOciDescriptor(value: unknown): value is OciDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Record<string, unknown>;
  return (
    typeof descriptor.digest === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(descriptor.digest) &&
    typeof descriptor.mediaType === "string"
  );
}

function isOciManifest(value: unknown): value is OciManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  return (
    Array.isArray(manifest.layers) && manifest.layers.every(isOciDescriptor)
  );
}

function environmentCredentials(): ArtifactCredentials {
  return {
    githubToken: firstCredential(
      process.env.JUNTAI_GITHUB_ARTIFACT_TOKEN,
      process.env.GH_TOKEN,
    ),
    ociToken: firstCredential(
      process.env.JUNTAI_OCI_ARTIFACT_TOKEN,
      process.env.JUNTAI_GITHUB_ARTIFACT_TOKEN,
      process.env.GH_TOKEN,
    ),
  };
}

function firstCredential(...values: readonly (string | undefined)[]) {
  return values.find(
    (value): value is string => value !== undefined && value.trim().length > 0,
  );
}

function bearerHeaders(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}

function verifyDigest(
  artifact: VerifiedArtifact,
  bytes: Uint8Array,
): Uint8Array {
  const actual = sha256(bytes);
  if (actual !== artifact.digest) {
    throw new ArtifactVerificationError(
      `artifact '${artifact.uri}' digest mismatch: expected ${artifact.digest}, got ${actual}`,
    );
  }
  return bytes;
}

async function responseBytes(
  response: Response,
  uri: string,
): Promise<Uint8Array> {
  if (!response.ok) {
    throw new ArtifactVerificationError(
      `failed to fetch '${uri}': HTTP ${response.status}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export class ArtifactResolver {
  readonly #credentials: ArtifactCredentials;
  readonly #fetch: typeof fetch;

  public constructor(options: ArtifactResolverOptions = {}) {
    const credentials = options.credentials ?? environmentCredentials();
    this.#credentials = {
      githubToken: firstCredential(credentials.githubToken),
      ociToken: firstCredential(credentials.ociToken),
    };
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async resolve(artifact: VerifiedArtifact): Promise<Uint8Array> {
    validateArtifactDeclaration(artifact);
    return artifact.uri.startsWith("oci://")
      ? this.#resolveOci(artifact)
      : this.#resolveHttps(artifact);
  }

  async #resolveHttps(artifact: VerifiedArtifact): Promise<Uint8Array> {
    const coordinate = new URL(artifact.uri);
    const github = parseGitHubReleaseCoordinate(artifact.uri);
    const githubRaw = parseGitHubRawCoordinate(artifact.uri);
    const githubToken = this.#credentials.githubToken;
    if (githubRaw !== undefined && githubToken !== undefined) {
      return verifyDigest(
        artifact,
        await this.#fetchPrivateGitHubSource(artifact, githubRaw, githubToken),
      );
    }
    const response =
      github === undefined || githubToken === undefined
        ? await this.#fetch(artifact.uri, {
            headers: {
              Accept: artifact.mediaType ?? "application/octet-stream",
              ...(coordinate.hostname === "github.com"
                ? bearerHeaders(githubToken)
                : {}),
            },
            redirect: "follow",
          })
        : await this.#fetchPrivateGitHubAsset(artifact, github, githubToken);
    if (
      github !== undefined &&
      githubToken === undefined &&
      response.status === 404
    ) {
      throw new ArtifactVerificationError(
        `GitHub release artifact '${artifact.uri}' is inaccessible; configure JUNTAI_GITHUB_ARTIFACT_TOKEN for private assets`,
      );
    }
    return verifyDigest(artifact, await responseBytes(response, artifact.uri));
  }

  async #fetchPrivateGitHubSource(
    artifact: VerifiedArtifact,
    coordinate: GitHubRawCoordinate,
    token: string,
  ): Promise<Uint8Array> {
    const encodedPath = coordinate.path
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const sourceUri = `https://api.github.com/repos/${encodeURIComponent(coordinate.owner)}/${encodeURIComponent(coordinate.repository)}/contents/${encodedPath}?ref=${coordinate.commit}`;
    const response = await this.#fetch(sourceUri, {
      headers: {
        Accept: "application/vnd.github+json",
        ...bearerHeaders(token),
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
    });
    const metadataBytes = await responseBytes(response, sourceUri);
    let metadata: unknown;
    try {
      metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as unknown;
    } catch (error) {
      throw new ArtifactVerificationError(
        `GitHub source '${artifact.uri}' returned invalid metadata: ${String(error)}`,
      );
    }
    if (
      !isObjectRecord(metadata) ||
      metadata.type !== "file" ||
      metadata.encoding !== "base64" ||
      typeof metadata.content !== "string" ||
      metadata.path !== coordinate.path ||
      metadata.html_url !==
        `https://github.com/${coordinate.owner}/${coordinate.repository}/blob/${coordinate.commit}/${coordinate.path}`
    ) {
      throw new ArtifactVerificationError(
        `GitHub source '${artifact.uri}' returned invalid file metadata`,
      );
    }
    return new Uint8Array(
      Buffer.from(metadata.content.replaceAll("\n", ""), "base64"),
    );
  }

  async #fetchPrivateGitHubAsset(
    artifact: VerifiedArtifact,
    coordinate: GitHubReleaseCoordinate,
    token: string,
  ): Promise<Response> {
    const headers = {
      ...bearerHeaders(token),
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const releaseUri = `https://api.github.com/repos/${encodeURIComponent(coordinate.owner)}/${encodeURIComponent(coordinate.repository)}/releases/tags/${encodeURIComponent(coordinate.tag)}`;
    const releaseResponse = await this.#fetch(releaseUri, {
      headers: { Accept: "application/vnd.github+json", ...headers },
      redirect: "follow",
    });
    const releaseBytes = await responseBytes(releaseResponse, releaseUri);
    let release: unknown;
    try {
      release = JSON.parse(new TextDecoder().decode(releaseBytes)) as unknown;
    } catch (error) {
      throw new ArtifactVerificationError(
        `GitHub release '${artifact.uri}' returned invalid metadata: ${String(error)}`,
      );
    }
    if (!isObjectRecord(release) || !Array.isArray(release.assets)) {
      throw new ArtifactVerificationError(
        `GitHub release '${artifact.uri}' returned invalid asset metadata`,
      );
    }
    const assets = release.assets.filter(
      (value): value is Record<string, unknown> =>
        isObjectRecord(value) &&
        value.name === coordinate.assetName &&
        value.browser_download_url === artifact.uri &&
        typeof value.url === "string",
    );
    if (assets.length !== 1 || typeof assets[0]?.url !== "string") {
      throw new ArtifactVerificationError(
        `GitHub release '${artifact.uri}' does not contain exactly one matching asset`,
      );
    }
    return this.#fetch(assets[0].url, {
      headers: { Accept: "application/octet-stream", ...headers },
      redirect: "follow",
    });
  }

  async #resolveOci(artifact: VerifiedArtifact): Promise<Uint8Array> {
    const coordinate = parseOciCoordinate(artifact.uri);
    const auth = bearerHeaders(this.#credentials.ociToken);
    const manifestUri = `https://${coordinate.registry}/v2/${coordinate.repository}/manifests/${coordinate.manifestDigest}`;
    const manifestResponse = await this.#fetch(manifestUri, {
      headers: {
        Accept:
          "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
        ...auth,
      },
      redirect: "follow",
    });
    const manifestBytes = await responseBytes(manifestResponse, manifestUri);
    const manifestActual = sha256(manifestBytes);
    const headerDigest = manifestResponse.headers.get("docker-content-digest");
    if (
      manifestActual !== coordinate.manifestDigest ||
      headerDigest !== coordinate.manifestDigest
    ) {
      throw new ArtifactVerificationError(
        `OCI manifest '${artifact.uri}' digest mismatch: expected ${coordinate.manifestDigest}, got bytes ${manifestActual} and header ${headerDigest ?? "missing"}`,
      );
    }
    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
      ) as unknown;
    } catch (error) {
      throw new ArtifactVerificationError(
        `OCI manifest '${artifact.uri}' is not valid UTF-8 JSON: ${String(error)}`,
      );
    }
    if (!isOciManifest(manifestValue)) {
      throw new ArtifactVerificationError(
        `OCI manifest '${artifact.uri}' has no valid layer descriptor set`,
      );
    }
    const mediaType = artifact.mediaType;
    if (mediaType === undefined) {
      throw new ArtifactVerificationError(
        `OCI artifact '${artifact.uri}' must declare an exact layer media type`,
      );
    }
    const matches = manifestValue.layers.filter(
      (layer) =>
        layer.digest === artifact.digest && layer.mediaType === mediaType,
    );
    if (matches.length !== 1) {
      throw new ArtifactVerificationError(
        `OCI manifest '${artifact.uri}' must contain exactly one '${mediaType}' layer at ${artifact.digest}`,
      );
    }
    const blobUri = `https://${coordinate.registry}/v2/${coordinate.repository}/blobs/${artifact.digest}`;
    const blobResponse = await this.#fetch(blobUri, {
      headers: { Accept: mediaType, ...auth },
      redirect: "follow",
    });
    const blobBytes = await responseBytes(blobResponse, blobUri);
    const blobHeader = blobResponse.headers.get("docker-content-digest");
    if (blobHeader !== null && blobHeader !== artifact.digest) {
      throw new ArtifactVerificationError(
        `OCI blob '${artifact.uri}' returned conflicting Docker-Content-Digest '${blobHeader}'`,
      );
    }
    return verifyDigest(artifact, blobBytes);
  }
}

export const fetchVerifiedArtifact: ArtifactFetcher = (artifact) =>
  new ArtifactResolver().resolve(artifact);

export async function resolveVerifiedBytes(
  artifact: VerifiedArtifact,
  fetcher: ArtifactFetcher = fetchVerifiedArtifact,
): Promise<Uint8Array> {
  validateArtifactDeclaration(artifact);
  return verifyDigest(artifact, await fetcher(artifact));
}

export async function fetchVerifiedText(
  artifact: VerifiedArtifact,
  fetcher: ArtifactFetcher = fetchVerifiedArtifact,
): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await resolveVerifiedBytes(artifact, fetcher),
    );
  } catch (error) {
    if (error instanceof ArtifactVerificationError) throw error;
    throw new ArtifactVerificationError(
      `artifact '${artifact.uri}' is not valid UTF-8: ${String(error)}`,
    );
  }
}
