import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactVerificationError,
  fetchVerifiedArtifact,
  sha256,
  verifyBlueprintOpenApi,
} from "../src/artifacts.js";

afterEach(() => vi.unstubAllGlobals());

describe("immutable artifact verification", () => {
  it("returns bytes only after exact SHA-256 verification", async () => {
    const bytes = new TextEncoder().encode("approved");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200 })),
    );
    await expect(
      fetchVerifiedArtifact({
        uri: "https://example.test/release.json",
        digest: sha256(bytes),
      }),
    ).resolves.toEqual(bytes);
  });

  it("uses the execution credential only for GitHub artifact resolution", async () => {
    process.env.GH_TOKEN = "test-token";
    const bytes = new TextEncoder().encode("approved");
    const mocked = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", mocked);
    await fetchVerifiedArtifact({
      uri: "https://github.com/example/project/releases/download/v1/a.json",
      digest: sha256(bytes),
    });
    expect(mocked).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    delete process.env.GH_TOKEN;
  });

  it("fails closed on digest mismatch, fetch failure, and mutable schemes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("changed", { status: 200 })),
    );
    await expect(
      fetchVerifiedArtifact({
        uri: "https://example.test/release.json",
        digest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow(/digest mismatch/);
    await expect(
      fetchVerifiedArtifact({
        uri: "oci://example.test/release",
        digest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toBeInstanceOf(ArtifactVerificationError);
    await expect(
      fetchVerifiedArtifact({
        uri: "https://example.test/release",
        digest: "sha256:short",
      }),
    ).rejects.toThrow(/invalid SHA-256/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    await expect(
      fetchVerifiedArtifact({
        uri: "https://example.test/missing",
        digest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("validates the Blueprint v3 API identity without storing the contract", async () => {
    const body = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Juntai Blueprint Service", version: "3.0.0" },
      paths: { "/api/blueprints/v1/assets": {} },
    });
    await expect(
      verifyBlueprintOpenApi(
        {
          uri: "https://example.test/blueprint.json",
          digest: sha256(body),
        },
        async () => new TextEncoder().encode(body),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyBlueprintOpenApi(
        {
          uri: "https://example.test/blueprint.json",
          digest: sha256("{}"),
        },
        async () => new TextEncoder().encode("{}"),
      ),
    ).rejects.toThrow(/approved OpenAPI contract/);
  });
});
