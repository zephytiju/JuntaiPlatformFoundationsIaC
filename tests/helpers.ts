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

export function foundationsInputs(): FoundationsInputs {
  return {
    gateway: { serviceType: "ClusterIP" },
    observability: { exportEndpoint: "https://otel.example.test:4317" },
    meridian: { engines: [structuredEngine()] },
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
