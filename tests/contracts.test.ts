import { describe, expect, it } from "vitest";
import foundationsPackage from "../src/package.js";
import { casdoorDesiredState } from "../src/casdoor.js";
import { collectorConfiguration } from "../src/observability.js";
import {
  BLUEPRINT_IMAGE,
  BLUEPRINT_OPENAPI,
  CASDOOR_IMAGE,
  releaseInputs,
} from "../src/release.js";
import {
  FOUNDATION_SERVICE_CATALOG,
  serviceDeclaration,
} from "../src/service-contracts.js";
import { validateFoundationsInputs } from "../src/validation.js";
import { foundationsInputs } from "./helpers.js";

describe("package boundary", () => {
  it("implements the released thin-Core contract", () => {
    expect(foundationsPackage).toMatchObject({
      id: "juntai.platform.substrate",
      version: "1.1.0",
      compatibility: {
        coreContract: "^1.1.0",
        capabilityContracts: "^1.0.0",
      },
    });
    expect(foundationsPackage.provides.map((value) => value.id)).toEqual([
      "juntai.platform.gateway-set",
      "juntai.platform.meridian-runtime",
      "juntai.platform.observability-gateway",
      "juntai.platform.foundation-services",
    ]);
    expect(
      releaseInputs.every((input) =>
        /^sha256:[0-9a-f]{64}$/.test(input.digest),
      ),
    ).toBe(true);
    expect(JSON.stringify(releaseInputs)).not.toMatch(/\b(?:kes|kingbase)\b/i);
  });

  it("pins official Casdoor and Meridian-native Blueprint releases", () => {
    expect(CASDOOR_IMAGE).toMatch(
      /^docker\.io\/casbin\/casdoor@sha256:[0-9a-f]{64}$/,
    );
    expect(BLUEPRINT_IMAGE).toContain("@sha256:");
    expect(BLUEPRINT_OPENAPI.uri).toContain("/v3.0.0/");
    expect(serviceDeclaration("platform.blueprint")).toMatchObject({
      release: { version: "3.0.0", image: BLUEPRINT_IMAGE },
      deployment: {
        namespace: "juntai-platform",
        routePrefix: "/api/blueprints/v1",
      },
      artifacts: [
        {
          id: "blueprint-openapi",
          uri: BLUEPRINT_OPENAPI.uri,
          digest: BLUEPRINT_OPENAPI.digest,
        },
      ],
    });
    expect(FOUNDATION_SERVICE_CATALOG.contractResolution).toContain(
      "never-vendor",
    );
    expect(() => serviceDeclaration("missing")).toThrow(/unknown/);
  });

  it("omits the gated client_credentials application from Casdoor bootstrap", () => {
    const state = casdoorDesiredState(
      "staging",
      "https://console.example.test/auth/callback",
    );
    expect(state.objects).toHaveLength(5);
    expect(JSON.stringify(state)).not.toContain("client_credentials");
    expect(state.objects.map((entry) => entry.kind)).toEqual([
      "organization",
      "application",
      "model",
      "adapter",
      "enforcer",
    ]);
  });

  it("rejects secret material and KES while accepting opaque references", () => {
    const valid = foundationsInputs();
    expect(() => validateFoundationsInputs(valid)).not.toThrow();
    expect(() =>
      validateFoundationsInputs({ ...valid, password: "not-allowed" }),
    ).toThrow(/secret material/);
    expect(() =>
      validateFoundationsInputs({
        ...valid,
        meridian: {
          engines: [
            {
              ...valid.meridian.engines[0]!,
              physicalNamespace: "kes/legacy",
            },
          ],
        },
      }),
    ).toThrow(/must not expose KES/);
  });

  it("renders bounded durable Collector configuration", () => {
    const config = collectorConfiguration({
      exportEndpoint: "https://otel.example.test:4317",
      authorization: { name: "otel-auth", key: "authorization" },
      certificateAuthority: {
        name: "otel-ca",
        mountPath: "/var/run/otel/ca",
        items: { "ca.crt": "ca.crt" },
      },
    });
    expect(config).toContain("file_storage");
    expect(config).toContain("retry_on_failure");
    expect(config).toContain("OTEL_EXPORTER_AUTHORIZATION");
    expect(config).not.toContain("password");
    expect(() =>
      collectorConfiguration({ exportEndpoint: "https://u:p@example.test" }),
    ).toThrow(/without credentials/);
    const receiverTls = collectorConfiguration({
      exportEndpoint: "http://otel.example.test:4317",
      receiverTls: {
        name: "otel-receiver",
        mountPath: "/var/run/otel/receiver",
        items: { "tls.crt": "tls.crt", "tls.key": "tls.key" },
      },
    });
    expect(receiverTls).toContain("cert_file");
    expect(receiverTls).toContain("insecure: true");
  });
});
