import * as k8s from "@pulumi/kubernetes";
import { deployFoundations } from "../src/package.js";

const fingerprint = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

// Preview and update execute the same package-owned resolver against the same
// immutable coordinates. Only optional environment credentials may differ.
const provider = new k8s.Provider("cluster", {
  renderYamlToDirectory: "rendered",
});
const published = new Map<string, unknown>();
const result = await deployFoundations({
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
    account: {
      composition: {
        name: "account-composition",
        mountPath: "/opt/juntai/composition",
        items: { "composition.py": "composition.py" },
      },
      compositionFactory: "composition:create_app",
    },
    applicationMetadata: {
      casdoorIssuer: "https://iam.preview.invalid",
      casdoorAudience: "juntai-platform",
      casdoorPolicyEnforcerId: "admin/juntai-domain-authorization",
      casdoorServiceClientId: "application-metadata",
      cursorHmac: {
        name: "application-metadata-cursor-hmac",
        mountPath: "/var/run/application-metadata/secrets/cursor",
        items: { "hmac-key": "cursor-hmac-key" },
      },
      policyReaderClientSecret: {
        name: "application-metadata-policy-reader",
        mountPath: "/var/run/application-metadata/secrets/policy-reader",
        items: { "client-secret": "casdoor-policy-client-secret" },
      },
      kubernetesApiCidr: "192.0.2.10/32",
      kubernetesWorkloadAudience: "juntai-platform",
      kubernetesWorkloadIssuer: "https://kubernetes.default.svc",
      workloadBindings: [],
    },
    meridian: {
      runtimeReferences: [
        {
          kind: "secret",
          name: "meridian-runtime-credentials",
          mountPath: "/var/run/juntai/runtime",
          items: {
            "runtime-identity": "identity/hmac-key",
            "runtime-credential": "credential/client-secret",
          },
        },
      ],
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
        {
          bindingId: "object",
          profileId: "s3-compatible",
          requiredCapabilityFingerprint: fingerprint("e"),
          requiredPhysicalFingerprint: fingerprint("f"),
          physicalNamespace: "juntai-preview/objects",
          identityRef: {
            provider: "file",
            reference: "/var/run/juntai/runtime/identity/hmac-key",
          },
          secretRef: {
            provider: "file",
            reference: "/var/run/juntai/runtime/credential/client-secret",
          },
          tls: {
            mode: "disabled",
            serverName: null,
            caRef: null,
            clientCertificateRef: null,
          },
          endpoint: "https://object.preview.invalid",
          acl: {
            provider: "platform-policy",
            reference: "acl/object",
          },
          migration: {
            contract: "meridian.migration.apply",
            version: "1.0.0",
            appliedFingerprint: fingerprint("1"),
          },
          observability: {
            enabled: true,
            labels: { owner: "juntai-platform-foundations-iac" },
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
      casdoorIssuer: "https://iam.preview.invalid",
      casdoorAudience: "juntai-platform",
      casdoorPolicyEnforcerId: "admin/juntai-domain-authorization",
      casdoorPolicyClientId: "blueprint",
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
});

export const foundations = result.outputs;
export const capabilityCount = published.size;
