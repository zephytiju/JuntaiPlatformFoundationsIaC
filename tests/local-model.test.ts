import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { beforeAll, expect, it } from "vitest";
import {
  deployModelProvider,
  deployModelVerificationClient,
  LOCAL_MODEL_DEFAULTS,
} from "../src/local-model.js";

const registered: { type: string; inputs: Record<string, unknown> }[] = [];
beforeAll(() => {
  pulumi.runtime.setMocks(
    {
      newResource(args) {
        registered.push({ type: args.type, inputs: args.inputs });
        return {
          id: args.name,
          state: {
            ...args.inputs,
            ...(args.type === "random:index/randomPassword:RandomPassword"
              ? { result: "r".repeat(48) }
              : {}),
            ...(args.type === "tls:index/privateKey:PrivateKey"
              ? { privateKeyPem: "PRIVATE KEY" }
              : {}),
            ...(args.type.includes("SignedCert")
              ? { certPem: "BEGIN CERTIFICATE" }
              : {}),
            ...(args.type === "tls:index/certRequest:CertRequest"
              ? { certRequestPem: "REQUEST" }
              : {}),
          },
        };
      },
      call: (args) => args.inputs,
    },
    "model-test",
    "development-local",
    false,
  );
});

it("generates scoped credentials in IaC and projects only client material to a separate pod", async () => {
  const provider = new k8s.Provider("generated-model-provider");
  const result = deployModelProvider({
    stage: "development-local",
    provider,
    namespace: "generated-model",
  });
  const client = deployModelVerificationClient({
    stage: "development-local",
    provider,
    namespace: "generated-model",
    binding: result.binding,
    dependsOn: result.resources,
  });
  await Promise.all(
    [...result.resources, client].map(
      (r) => new Promise((resolve) => r.urn.apply(resolve)),
    ),
  );
  expect(result.resources).toHaveLength(11);
  expect(
    registered.find(
      (r) => r.type === "tls:index/selfSignedCert:SelfSignedCert",
    )!.inputs,
  ).toMatchObject({
    isCaCertificate: true,
    allowedUses: ["cert_signing", "crl_signing"],
  });
  expect(
    registered.find(
      (r) => r.type === "tls:index/locallySignedCert:LocallySignedCert",
    )!.inputs,
  ).toMatchObject({
    allowedUses: ["server_auth", "digital_signature", "key_encipherment"],
  });
  expect(
    registered.find((r) => r.type === "kubernetes:core/v1:Pod")!.inputs,
  ).toMatchObject({
    spec: {
      activeDeadlineSeconds: 3600,
      volumes: [
        {
          secret: {
            items: [
              { key: "api-key", path: "api-key" },
              { key: "ca.pem", path: "ca.pem" },
            ],
          },
        },
      ],
    },
  });
});

it("passes through an external binding without allocating local resources", () => {
  const external = {
    origin: "https://model.example.test",
    model: "test",
    secretName: "existing-model",
    credentialKey: "key",
    caKey: "ca",
  };
  for (const stage of ["production", "staging", "development"] as const) {
    const result = deployModelProvider({ stage, external });
    expect(result.binding).toBe(external);
    expect(result.resources).toEqual([]);
  }
  expect(() => deployModelProvider({ stage: "production" } as never)).toThrow(
    "external model binding",
  );
});

it("deploys authenticated TLS with a checked model cache and bounded non-root process", async () => {
  const result = deployModelProvider({
    stage: "development-local",
    provider: new k8s.Provider("model-test-provider"),
    namespace: "model-test",
    // Rendering-only values; no real credentials in the test suite.
    credentials: {
      "api-key": "a".repeat(40),
      "ca.pem": "BEGIN CERTIFICATE",
      "tls.pem": "BEGIN CERTIFICATE",
      "tls-key.pem": "PRIVATE KEY",
    },
  });
  await Promise.all(
    result.resources.map((r) => new Promise((resolve) => r.urn.apply(resolve))),
  );
  expect(result.resources).toHaveLength(5);
  const deployed = result.resources.find(
    (r) => r instanceof k8s.apps.v1.Deployment,
  ) as k8s.apps.v1.Deployment;
  const deployment = {
    spec: await new Promise((resolve) => deployed.spec.apply(resolve)),
  };
  expect(deployment).toMatchObject({
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      template: {
        spec: {
          automountServiceAccountToken: false,
          securityContext: { runAsNonRoot: true },
          initContainers: [
            {
              image: LOCAL_MODEL_DEFAULTS.image,
              env: [
                { name: "MODEL_URL", value: LOCAL_MODEL_DEFAULTS.url },
                { name: "MODEL_SHA256", value: LOCAL_MODEL_DEFAULTS.sha256 },
              ],
            },
          ],
          containers: [
            {
              image: LOCAL_MODEL_DEFAULTS.image,
              securityContext: {
                readOnlyRootFilesystem: true,
                allowPrivilegeEscalation: false,
              },
            },
          ],
        },
      },
    },
  });
  const spec = deployment as {
    spec: {
      template: {
        spec: {
          containers: { args: string[] }[];
          initContainers: { args: string[] }[];
        };
      };
    };
  };
  const args = spec.spec.template.spec.containers[0]!.args;
  for (const flag of [
    "--ssl-cert-file",
    "--ssl-key-file",
    "--api-key-file",
    "--offline",
    "--no-webui",
    "--parallel",
  ])
    expect(args).toContain(flag);
  expect(spec.spec.template.spec.initContainers[0]!.args.join(" ")).toContain(
    "sha256sum -c",
  );
  expect(
    registered.find((r) => r.type === "kubernetes:core/v1:Service")!.inputs,
  ).toMatchObject({ spec: { type: "ClusterIP" } });
  const secret = result.resources.find(
    (r) => r instanceof k8s.core.v1.Secret,
  ) as k8s.core.v1.Secret;
  expect(await pulumi.isSecret(secret.stringData)).toBe(true);
});

it("rejects mutable or insecure model references before resource registration", () => {
  const base = {
    stage: "development-local" as const,
    provider: new k8s.Provider("invalid-model-provider"),
    namespace: "model-test",
    credentials: {} as never,
  };
  expect(() => deployModelProvider({ ...base, namespace: "BAD" })).toThrow(
    "namespace",
  );
  expect(() =>
    deployModelProvider({
      ...base,
      artifact: { ...LOCAL_MODEL_DEFAULTS, image: "model:latest" },
    }),
  ).toThrow("immutable");
  expect(() =>
    deployModelProvider({
      ...base,
      artifact: {
        ...LOCAL_MODEL_DEFAULTS,
        url: "http://example.test/model",
      },
    }),
  ).toThrow("artifact reference");
});
