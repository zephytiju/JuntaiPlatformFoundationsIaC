import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactResolver,
  ArtifactVerificationError,
  fetchVerifiedText,
  fetchVerifiedArtifact,
  resolveVerifiedBytes,
  sha256,
  validateArtifactDeclaration,
} from "../src/artifacts.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GH_TOKEN;
  delete process.env.JUNTAI_GITHUB_ARTIFACT_TOKEN;
  delete process.env.JUNTAI_OCI_ARTIFACT_TOKEN;
});

describe("immutable artifact verification", () => {
  it("returns HTTPS release bytes only after exact SHA-256 verification", async () => {
    const bytes = new TextEncoder().encode("approved");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200 })),
    );
    await expect(
      fetchVerifiedArtifact({
        uri: "https://example.test/releases/download/v1.0.0/release.json",
        digest: sha256(bytes),
      }),
    ).resolves.toEqual(bytes);
  });

  it("uses execution credentials without changing resolved bytes", async () => {
    const bytes = new TextEncoder().encode("approved");
    const artifact = {
      uri: "https://github.com/example/project/releases/download/v1.0.0/a.json",
      digest: sha256(bytes),
    } as const;
    const requests: RequestInit[] = [];
    const resolverFetch = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        requests.push(init ?? {});
        const uri =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return uri.includes("/releases/tags/")
          ? new Response(
              JSON.stringify({
                assets: [
                  {
                    name: "a.json",
                    browser_download_url: artifact.uri,
                    url: "https://api.github.com/releases/assets/1",
                  },
                ],
              }),
              { status: 200 },
            )
          : new Response(bytes, { status: 200 });
      },
    );
    const local = new ArtifactResolver({
      credentials: { githubToken: "local-token" },
      fetch: resolverFetch,
    });
    const ci = new ArtifactResolver({
      credentials: { githubToken: "ci-token" },
      fetch: resolverFetch,
    });
    await expect(local.resolve(artifact)).resolves.toEqual(bytes);
    await expect(ci.resolve(artifact)).resolves.toEqual(bytes);
    expect(requests.map(({ headers }) => headers)).toEqual([
      expect.objectContaining({ Authorization: "Bearer local-token" }),
      expect.objectContaining({ Authorization: "Bearer local-token" }),
      expect.objectContaining({ Authorization: "Bearer ci-token" }),
      expect.objectContaining({ Authorization: "Bearer ci-token" }),
    ]);
  });

  it("resolves private source files through an exact GitHub commit", async () => {
    const bytes = new TextEncoder().encode("immutable migration");
    const commit = "a".repeat(40);
    const artifact = {
      uri: `https://raw.githubusercontent.com/example/private/${commit}/migrations/v2.json`,
      digest: sha256(bytes),
    } as const;
    const resolverFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const uri =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(uri).toContain(`/contents/migrations/v2.json?ref=${commit}`);
      return new Response(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          content: Buffer.from(bytes).toString("base64"),
          path: "migrations/v2.json",
          html_url: `https://github.com/example/private/blob/${commit}/migrations/v2.json`,
        }),
        { status: 200 },
      );
    });
    const resolver = new ArtifactResolver({
      credentials: { githubToken: "read-token" },
      fetch: resolverFetch,
    });
    await expect(resolver.resolve(artifact)).resolves.toEqual(bytes);
    expect(resolverFetch).toHaveBeenCalledOnce();
  });

  it("ignores empty CI secrets and reports inaccessible private assets", async () => {
    process.env.JUNTAI_GITHUB_ARTIFACT_TOKEN = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    await expect(
      fetchVerifiedArtifact({
        uri: "https://github.com/example/private/releases/download/v1.0.0/a.json",
        digest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow(/configure JUNTAI_GITHUB_ARTIFACT_TOKEN/);
  });

  it("resolves one exact OCI manifest layer and verifies both digests", async () => {
    const blob = new TextEncoder().encode("descriptor-set");
    const blobDigest = sha256(blob);
    const manifestBody = JSON.stringify({
      schemaVersion: 2,
      layers: [
        {
          mediaType: "application/vnd.juntai.protobuf.descriptor.v1",
          digest: blobDigest,
          size: blob.length,
        },
      ],
    });
    const manifestDigest = sha256(manifestBody);
    const resolverFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const uri =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return uri.includes("/manifests/")
        ? new Response(manifestBody, {
            status: 200,
            headers: { "Docker-Content-Digest": manifestDigest },
          })
        : new Response(blob, {
            status: 200,
            headers: { "Docker-Content-Digest": blobDigest },
          });
    });
    const resolver = new ArtifactResolver({
      credentials: { ociToken: "oci-token" },
      fetch: resolverFetch,
    });
    await expect(
      resolver.resolve({
        uri: `oci://registry.example.test/contracts/blueprint@${manifestDigest}`,
        digest: blobDigest,
        mediaType: "application/vnd.juntai.protobuf.descriptor.v1",
      }),
    ).resolves.toEqual(blob);
    expect(resolverFetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed on mutable coordinates, invalid pins, and fetch failures", async () => {
    for (const artifact of [
      {
        uri: "http://example.test/release.json",
        digest: `sha256:${"0".repeat(64)}` as const,
      },
      {
        uri: "https://github.com/example/project/releases/latest/a.json",
        digest: `sha256:${"0".repeat(64)}` as const,
      },
      {
        uri: "https://example.test/release.json?version=latest",
        digest: `sha256:${"0".repeat(64)}` as const,
      },
      {
        uri: "https://raw.githubusercontent.com/example/project/main/a.json",
        digest: `sha256:${"0".repeat(64)}` as const,
      },
      {
        uri: "oci://example.test/release:latest",
        digest: `sha256:${"0".repeat(64)}` as const,
        mediaType: "application/json",
      },
      {
        uri: `oci://example.test/release@sha256:${"0".repeat(64)}`,
        digest: `sha256:${"1".repeat(64)}` as const,
      },
    ]) {
      expect(() => validateArtifactDeclaration(artifact)).toThrow(
        ArtifactVerificationError,
      );
    }
    expect(() =>
      validateArtifactDeclaration({
        uri: "https://example.test/release",
        digest: "sha256:short",
      }),
    ).toThrow(/invalid SHA-256/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    await expect(
      fetchVerifiedArtifact({
        uri: "https://example.test/releases/download/v1.0.0/missing",
        digest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("re-verifies custom fetchers and rejects changed bytes", async () => {
    const expected = new TextEncoder().encode("expected");
    await expect(
      resolveVerifiedBytes(
        {
          uri: "https://example.test/releases/download/v1.0.0/a.json",
          digest: sha256(expected),
        },
        async () => new TextEncoder().encode("changed"),
      ),
    ).rejects.toThrow(/digest mismatch/);
  });

  it("rejects malformed OCI manifests and conflicting registry headers", async () => {
    const blob = new TextEncoder().encode("blob");
    const blobDigest = sha256(blob);

    const invalidJson = new TextEncoder().encode("not-json");
    const invalidJsonDigest = sha256(invalidJson);
    const invalidJsonResolver = new ArtifactResolver({
      fetch: async () =>
        new Response(invalidJson, {
          status: 200,
          headers: { "Docker-Content-Digest": invalidJsonDigest },
        }),
    });
    await expect(
      invalidJsonResolver.resolve({
        uri: `oci://registry.example.test/contracts/a@${invalidJsonDigest}`,
        digest: blobDigest,
        mediaType: "application/test",
      }),
    ).rejects.toThrow(/not valid UTF-8 JSON/);

    const emptyManifest = JSON.stringify({ schemaVersion: 2, layers: [] });
    const emptyDigest = sha256(emptyManifest);
    const emptyResolver = new ArtifactResolver({
      fetch: async () =>
        new Response(emptyManifest, {
          status: 200,
          headers: { "Docker-Content-Digest": emptyDigest },
        }),
    });
    await expect(
      emptyResolver.resolve({
        uri: `oci://registry.example.test/contracts/a@${emptyDigest}`,
        digest: blobDigest,
        mediaType: "application/test",
      }),
    ).rejects.toThrow(/exactly one/);

    const manifest = JSON.stringify({
      schemaVersion: 2,
      layers: [{ mediaType: "application/test", digest: blobDigest }],
    });
    const manifestDigest = sha256(manifest);
    const conflictingBlobResolver = new ArtifactResolver({
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const uri =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return uri.includes("/manifests/")
          ? new Response(manifest, {
              status: 200,
              headers: { "Docker-Content-Digest": manifestDigest },
            })
          : new Response(blob, {
              status: 200,
              headers: {
                "Docker-Content-Digest": `sha256:${"f".repeat(64)}`,
              },
            });
      },
    });
    await expect(
      conflictingBlobResolver.resolve({
        uri: `oci://registry.example.test/contracts/a@${manifestDigest}`,
        digest: blobDigest,
        mediaType: "application/test",
      }),
    ).rejects.toThrow(/conflicting Docker-Content-Digest/);
  });

  it("rejects non-UTF-8 text after digest verification", async () => {
    const bytes = Uint8Array.from([0xff]);
    await expect(
      fetchVerifiedText(
        {
          uri: "https://example.test/releases/download/v1.0.0/a.txt",
          digest: sha256(bytes),
        },
        async () => bytes,
      ),
    ).rejects.toThrow(/not valid UTF-8/);
  });
});
