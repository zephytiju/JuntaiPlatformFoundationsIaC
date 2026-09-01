import type * as pulumi from "@pulumi/pulumi";
import type {
  FoundationsInputs,
  MeridianEngineSelection,
} from "../src/types.js";

const fingerprint = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

export function structuredEngine(): MeridianEngineSelection {
  return {
    bindingId: "structured",
    profileId: "postgresql-postgis-local-single-primary",
    requiredCapabilityFingerprint: fingerprint("a"),
    requiredPhysicalFingerprint: fingerprint("b"),
    settings: {
      formatVersion: "meridian.postgresql.settings.v1",
      resources: [
        {
          ref: "structured:application-metadata.applications",
          table: "application_metadata_applications",
        },
      ],
    },
    physicalNamespace: "juntai_runtime",
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
    endpoint: "postgresql://structured.platform.internal:5432/juntai",
    acl: { provider: "platform-policy", reference: "acl/structured" },
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
  };
}

export function objectEngine(): MeridianEngineSelection {
  return {
    bindingId: "object",
    profileId: "s3-compatible",
    requiredCapabilityFingerprint: fingerprint("e"),
    requiredPhysicalFingerprint: fingerprint("f"),
    settings: {
      region: "us-east-1",
      addressingStyle: "path",
      allowInsecureHttp: true,
      verifyAfterWrite: true,
      requireVersioning: false,
    },
    physicalNamespace: "juntai-artifacts/runtime",
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
    endpoint: "http://s3.platform.internal:9000",
    acl: { provider: "platform-policy", reference: "acl/object" },
    migration: {
      contract: "meridian.migration.apply",
      version: "1.0.0",
      appliedFingerprint: fingerprint("1"),
    },
    observability: {
      enabled: true,
      labels: { owner: "juntai-platform-foundations-iac" },
    },
    recovery: {
      method: "backup-restore",
      owner: "juntai-platform-foundations-iac",
      policyRef: "recovery/object",
      rpoSeconds: 300,
      rtoSeconds: 900,
      validationFingerprint: fingerprint("2"),
    },
  };
}

export function foundationsInputs(): FoundationsInputs {
  return {
    gateway: { serviceType: "ClusterIP" },
    observability: { exportEndpoint: "https://otel.example.test:4317" },
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
      engines: [structuredEngine(), objectEngine()],
    },
    account: {
      composition: {
        name: "account-composition",
        mountPath: "/opt/juntai/composition",
        items: { "composition.py": "composition.py" },
      },
      compositionFactory: "composition:create_app",
    },
    applicationMetadata: {
      casdoorIssuer: "https://iam.example.test",
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
      consoleRedirectUri: "https://console.example.test/auth/callback",
    },
    blueprint: {
      casdoorIssuer: "https://iam.example.test",
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
  };
}

export function capabilities(): {
  readonly published: Map<string, unknown>;
  readonly consumer: {
    require<T>(_capability: unknown): T;
    requireAll<T>(_capability: unknown): readonly T[];
    provide<T>(capability: { id: string }, value: T): unknown;
  };
} {
  const published = new Map<string, unknown>();
  return {
    published,
    consumer: {
      require<T>(_capability: unknown): T {
        throw new Error("no required capabilities");
      },
      requireAll<T>(_capability: unknown): readonly T[] {
        return [];
      },
      provide<T>(capability: { id: string }, value: T): unknown {
        published.set(capability.id, value);
        return { capability, value };
      },
    },
  };
}

export function secrets(): {
  require(
    _id: string,
    key: string,
  ): {
    id: string;
    key: string;
    value: pulumi.Output<string>;
  };
} {
  return {
    require(_id: string, _key: string): never {
      throw new Error("Foundations must use only opaque Kubernetes references");
    },
  };
}
