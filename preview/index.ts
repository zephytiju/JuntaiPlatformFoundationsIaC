import * as k8s from "@pulumi/kubernetes";
import { deployFoundations } from "../src/package.js";
import type { ArtifactFetcher } from "../src/artifacts.js";

const fingerprint = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

// The preview exercises package resource ownership without persisting upstream
// documents. Release-byte verification has separate fail-closed unit coverage;
// production execution uses the package's authenticated HTTPS resolver.
const previewFetcher: ArtifactFetcher = (artifact) =>
  Promise.resolve(
    new TextEncoder().encode(
      artifact.uri.endsWith(".json")
        ? JSON.stringify({
            openapi: "3.1.0",
            info: { title: "Juntai Blueprint Service", version: "3.0.0" },
            paths: { "/api/blueprints/v1/assets": {} },
          })
        : `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: preview-${
            artifact.uri.includes("gateway-api")
              ? "gateway-api"
              : "envoy-gateway"
          }\n  namespace: default\n`,
    ),
  );

const provider = new k8s.Provider("cluster", {
  renderYamlToDirectory: "rendered",
});
const published = new Map<string, unknown>();
const result = await deployFoundations(
  {
    target: {
      organization: "juntai",
      project: "platform",
      stack: "ci-preview",
      environment: "development-local",
      configuration: {},
    },
    providers: { kubernetes: provider },
    capabilities: {
      require() {
        throw new Error("Foundations has no required capabilities");
      },
      requireAll() {
        return [];
      },
      provide(capability, value) {
        published.set(capability.id, value);
        return { capability, value };
      },
    },
    secrets: {
      require() {
        throw new Error("preview must not resolve secret bytes");
      },
    },
    inputs: {
      gateway: { serviceType: "ClusterIP" },
      observability: { exportEndpoint: "https://otel.preview.invalid:4317" },
      meridian: {
        engines: [
          {
            bindingId: "structured",
            profileId: "postgresql-postgis-local-single-primary",
            requiredCapabilityFingerprint: fingerprint("a"),
            requiredPhysicalFingerprint: fingerprint("b"),
            physicalNamespace: "postgresql/platform/blueprints",
            identityRef: {
              provider: "workload-identity",
              reference: "platform/blueprint",
            },
            secretRef: {
              provider: "vault",
              reference: "platform/meridian/structured",
            },
            tls: {
              mode: "disabled",
              serverName: null,
              caRef: null,
              clientCertificateRef: null,
            },
            endpoint: "postgresql://structured.preview.invalid:5432/juntai",
            acl: {
              provider: "platform-policy",
              reference: "acl/structured",
            },
            migration: {
              contract: "meridian.migration.apply",
              version: "1.0.0",
              appliedFingerprint: fingerprint("c"),
            },
            observability: {
              enabled: true,
              labels: { owner: "juntai-platform-foundations-iac" },
            },
            recovery: {
              method: "backup-restore",
              owner: "juntai-platform-foundations-iac",
              policyRef: "recovery/structured",
              rpoSeconds: 300,
              rtoSeconds: 900,
              validationFingerprint: fingerprint("d"),
            },
          },
        ],
      },
      casdoor: {
        configuration: {
          name: "casdoor-configuration",
          mountPath: "/conf",
          items: { "app.conf": "app.conf" },
        },
        bootstrapCredential: {
          name: "casdoor-bootstrap-credentials",
          key: "CASDOOR_BOOTSTRAP_TOKEN",
        },
        consoleRedirectUri: "https://console.preview.invalid/auth/callback",
      },
      blueprint: {
        cursorHmac: {
          name: "blueprint-cursor-hmac",
          mountPath: "/var/run/juntai/blueprint/cursor",
          items: { "hmac-key": "hmac-key" },
        },
        policyReaderClientSecret: {
          name: "blueprint-policy-reader",
          mountPath: "/var/run/juntai/blueprint/policy-reader",
          items: { "client-secret": "client-secret" },
        },
      },
    },
  },
  { fetcher: previewFetcher },
);

export const foundations = result.outputs;
export const capabilityCount = published.size;
