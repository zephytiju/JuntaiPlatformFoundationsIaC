import { createHash } from "node:crypto";

export interface VerifiedArtifact {
  readonly uri: string;
  readonly digest: `sha256:${string}`;
}

export type ArtifactFetcher = (
  artifact: VerifiedArtifact,
) => Promise<Uint8Array>;

export class ArtifactVerificationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArtifactVerificationError";
  }
}

export function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function authorizationHeaders(uri: string): Record<string, string> {
  const token =
    process.env.JUNTAI_GITHUB_ARTIFACT_TOKEN ?? process.env.GH_TOKEN;
  return token !== undefined && new URL(uri).hostname === "github.com"
    ? { Authorization: `Bearer ${token}` }
    : {};
}

export const fetchVerifiedArtifact: ArtifactFetcher = async (artifact) => {
  if (!artifact.uri.startsWith("https://")) {
    throw new ArtifactVerificationError(
      `artifact '${artifact.uri}' must use an immutable HTTPS release coordinate`,
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(artifact.digest)) {
    throw new ArtifactVerificationError(
      `artifact '${artifact.uri}' has an invalid SHA-256 digest`,
    );
  }
  const response = await fetch(artifact.uri, {
    headers: {
      Accept: "application/octet-stream",
      ...authorizationHeaders(artifact.uri),
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new ArtifactVerificationError(
      `failed to fetch '${artifact.uri}': HTTP ${response.status}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== artifact.digest) {
    throw new ArtifactVerificationError(
      `artifact '${artifact.uri}' digest mismatch: expected ${artifact.digest}, got ${actual}`,
    );
  }
  return bytes;
};

export async function fetchVerifiedText(
  artifact: VerifiedArtifact,
  fetcher: ArtifactFetcher = fetchVerifiedArtifact,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await fetcher(artifact),
  );
}

export async function verifyBlueprintOpenApi(
  artifact: VerifiedArtifact,
  fetcher: ArtifactFetcher = fetchVerifiedArtifact,
): Promise<void> {
  const parsed = JSON.parse(await fetchVerifiedText(artifact, fetcher)) as {
    readonly openapi?: unknown;
    readonly info?: { readonly title?: unknown; readonly version?: unknown };
    readonly paths?: Readonly<Record<string, unknown>>;
  };
  if (
    typeof parsed.openapi !== "string" ||
    !parsed.openapi.startsWith("3.") ||
    parsed.info?.title !== "Juntai Blueprint Service" ||
    parsed.info.version !== "3.0.0" ||
    parsed.paths?.["/api/blueprints/v1/assets"] === undefined
  ) {
    throw new ArtifactVerificationError(
      "verified Blueprint release does not expose the approved OpenAPI contract",
    );
  }
}
