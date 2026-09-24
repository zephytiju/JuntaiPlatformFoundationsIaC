import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { createHash } from "node:crypto";
import * as random from "@pulumi/random";
import * as tls from "@pulumi/tls";
import type { PlatformStage } from "./contract.js";

/** Public, immutable CPU server and Apache-2.0 model; qualified by the consumer. */
export interface LocalModelArtifact {
  readonly image: string;
  readonly model: string;
  readonly url: string;
  readonly sha256: string;
  readonly license: string;
}
export const LOCAL_MODEL_DEFAULTS: LocalModelArtifact = Object.freeze({
  image:
    "ghcr.io/ggml-org/llama.cpp@sha256:fb8f521cdfee1b763a6ef0d6633922e780c1393c03b49945526550cf55010343",
  model: "qwen2.5-0.5b-instruct-q4_k_m",
  url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf",
  sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
  license: "Apache-2.0",
});

/** Shared server arguments for ordinary local and isolated full-host deployments. */
export function localModelServerArguments(
  artifact: LocalModelArtifact,
  host: "127.0.0.1" | "0.0.0.0",
  port: number,
): string[] {
  return [
    "--model",
    "/models/model.gguf",
    "--alias",
    artifact.model,
    "--host",
    host,
    "--port",
    String(port),
    "--ssl-cert-file",
    "/credentials/tls.pem",
    "--ssl-key-file",
    "/credentials/tls-key.pem",
    "--api-key-file",
    "/credentials/api-key",
    "--ctx-size",
    "4096",
    "--parallel",
    "1",
    "--threads",
    "4",
    "--temp",
    "0",
    "--seed",
    "42",
    "--n-predict",
    "512",
    "--timeout",
    "30",
    "--offline",
    "--no-webui",
    "--no-slots",
    "--log-disable",
  ];
}

export interface ModelProviderBinding {
  readonly origin: pulumi.Input<string>;
  readonly model: string;
  readonly secretName: pulumi.Input<string>;
  readonly credentialKey: string;
  readonly caKey: string;
}

export type ModelProviderDeployment =
  | {
      readonly stage: Exclude<PlatformStage, "development-local">;
      readonly external: ModelProviderBinding;
    }
  | {
      readonly stage: "development-local";
      readonly provider: k8s.Provider;
      readonly namespace: string;
      readonly credentials?: pulumi.Input<{
        readonly "api-key": string;
        readonly "ca.pem": string;
        readonly "tls.pem": string;
        readonly "tls-key.pem": string;
      }>;
      readonly artifact?: LocalModelArtifact;
    };

/** Environment selection is explicit. Nonlocal stages allocate no model resources. */
export function deployModelProvider(args: ModelProviderDeployment): {
  readonly binding: ModelProviderBinding;
  readonly resources: readonly pulumi.Resource[];
} {
  if (args.stage !== "development-local") {
    if (
      !["development", "staging", "production"].includes(args.stage) ||
      !("external" in args) ||
      !args.external
    )
      throw new Error(
        "explicit external model binding required outside development-local",
      );
    return { binding: args.external, resources: [] };
  }
  if (!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(args.namespace))
    throw new Error("invalid model namespace");
  const artifact = args.artifact ?? LOCAL_MODEL_DEFAULTS;
  if (
    !/@sha256:[a-f0-9]{64}$/.test(artifact.image) ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  )
    throw new Error("immutable model and image digests required");
  const url = new URL(artifact.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !/^[a-zA-Z0-9._-]+$/.test(artifact.model)
  )
    throw new Error("invalid model artifact reference");
  const labels = {
    "app.kubernetes.io/name": "local-model",
    "app.kubernetes.io/managed-by": "pulumi",
  };
  const opts = { provider: args.provider, protect: false };
  const namespace = new k8s.core.v1.Namespace(
    "local-model-namespace",
    { metadata: { name: args.namespace, labels } },
    opts,
  );
  const metadata = { namespace: namespace.metadata.name, labels };
  const generated: pulumi.Resource[] = [];
  let material = args.credentials;
  if (!material) {
    const key = new random.RandomPassword("local-model-api-key", {
      length: 48,
      special: false,
    });
    const caKey = new tls.PrivateKey("local-model-ca-key", {
      algorithm: "RSA",
      rsaBits: 2048,
    });
    const ca = new tls.SelfSignedCert("local-model-ca", {
      privateKeyPem: caKey.privateKeyPem,
      isCaCertificate: true,
      allowedUses: ["cert_signing", "crl_signing"],
      validityPeriodHours: 48,
      earlyRenewalHours: 4,
      setSubjectKeyId: true,
      setAuthorityKeyId: true,
      subject: { commonName: "Local model verification CA" },
    });
    const serverKey = new tls.PrivateKey("local-model-tls-key", {
      algorithm: "RSA",
      rsaBits: 2048,
    });
    const csr = new tls.CertRequest("local-model-csr", {
      privateKeyPem: serverKey.privateKeyPem,
      subject: {
        commonName: `local-model.${args.namespace}.svc.cluster.local`,
      },
      dnsNames: [
        "local-model",
        `local-model.${args.namespace}`,
        `local-model.${args.namespace}.svc`,
        `local-model.${args.namespace}.svc.cluster.local`,
      ],
      ipAddresses: ["127.0.0.1"],
    });
    const serverCert = new tls.LocallySignedCert("local-model-certificate", {
      certRequestPem: csr.certRequestPem,
      caPrivateKeyPem: caKey.privateKeyPem,
      caCertPem: ca.certPem,
      validityPeriodHours: 24,
      earlyRenewalHours: 2,
      allowedUses: ["server_auth", "digital_signature", "key_encipherment"],
      setSubjectKeyId: true,
    });
    generated.push(key, caKey, ca, serverKey, csr, serverCert);
    material = pulumi
      .all([
        key.result,
        ca.certPem,
        serverCert.certPem,
        serverKey.privateKeyPem,
      ])
      .apply(([apiKey, caPem, certPem, keyPem]) => ({
        "api-key": apiKey,
        "ca.pem": caPem,
        "tls.pem": certPem,
        "tls-key.pem": keyPem,
      }));
  }
  const credentials = pulumi.output(material).apply((values) => {
    if (
      !/^[A-Za-z0-9_-]{32,}$/.test(values["api-key"]) ||
      !values["ca.pem"].includes("BEGIN CERTIFICATE") ||
      !values["tls.pem"].includes("BEGIN CERTIFICATE") ||
      !values["tls-key.pem"].includes("PRIVATE KEY")
    )
      throw new Error("generated model credentials and TLS material required");
    return values;
  });
  const secret = new k8s.core.v1.Secret(
    "local-model-credentials",
    {
      metadata: { ...metadata, name: "local-model-credentials" },
      stringData: pulumi.secret(credentials),
    },
    { ...opts, additionalSecretOutputs: ["data", "stringData"] },
  );
  const cache = new k8s.core.v1.PersistentVolumeClaim(
    "local-model-cache",
    {
      metadata: { ...metadata, name: "local-model-cache" },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: "2Gi" } },
      },
    },
    opts,
  );
  const securityContext = {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    capabilities: { drop: ["ALL"] },
  };
  const deployment = new k8s.apps.v1.Deployment(
    "local-model",
    {
      metadata: { ...metadata, name: "local-model" },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: labels },
        template: {
          metadata: {
            labels,
            annotations: {
              "juntai.io/credentials-revision": pulumi.secret(
                credentials.apply((v) =>
                  createHash("sha256").update(JSON.stringify(v)).digest("hex"),
                ),
              ),
            },
          },
          spec: {
            automountServiceAccountToken: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 10001,
              runAsGroup: 10001,
              fsGroup: 10001,
            },
            initContainers: [
              {
                name: "verify-model",
                image: artifact.image,
                command: ["/bin/sh", "-ec"],
                args: [
                  'if ! printf "%s  /models/model.gguf\\n" "$MODEL_SHA256" | sha256sum -c - >/dev/null 2>&1; then curl --fail --location --proto "=https" --proto-redir "=https" --connect-timeout 15 --max-time 600 --output /models/model.part "$MODEL_URL"; printf "%s  /models/model.part\\n" "$MODEL_SHA256" | sha256sum -c -; mv /models/model.part /models/model.gguf; fi',
                ],
                env: [
                  { name: "MODEL_URL", value: artifact.url },
                  { name: "MODEL_SHA256", value: artifact.sha256 },
                ],
                resources: {
                  requests: { cpu: "100m", memory: "64Mi" },
                  limits: { cpu: "1", memory: "256Mi" },
                },
                securityContext,
                volumeMounts: [{ name: "models", mountPath: "/models" }],
              },
            ],
            containers: [
              {
                name: "model",
                image: artifact.image,
                args: localModelServerArguments(artifact, "0.0.0.0", 8443),
                ports: [{ name: "https", containerPort: 8443 }],
                securityContext,
                resources: {
                  requests: { cpu: "500m", memory: "768Mi" },
                  limits: { cpu: "4", memory: "2Gi" },
                },
                startupProbe: {
                  httpGet: { path: "/health", port: "https", scheme: "HTTPS" },
                  periodSeconds: 2,
                  failureThreshold: 120,
                },
                readinessProbe: {
                  httpGet: { path: "/health", port: "https", scheme: "HTTPS" },
                  periodSeconds: 3,
                },
                livenessProbe: {
                  httpGet: { path: "/health", port: "https", scheme: "HTTPS" },
                  periodSeconds: 10,
                  failureThreshold: 6,
                },
                volumeMounts: [
                  { name: "models", mountPath: "/models", readOnly: true },
                  {
                    name: "credentials",
                    mountPath: "/credentials",
                    readOnly: true,
                  },
                  { name: "tmp", mountPath: "/tmp" },
                ],
              },
            ],
            volumes: [
              {
                name: "models",
                persistentVolumeClaim: { claimName: cache.metadata.name },
              },
              {
                name: "credentials",
                secret: {
                  secretName: secret.metadata.name,
                  defaultMode: 0o440,
                },
              },
              { name: "tmp", emptyDir: { sizeLimit: "64Mi" } },
            ],
          },
        },
      },
    },
    opts,
  );
  const service = new k8s.core.v1.Service(
    "local-model-endpoint",
    {
      metadata: { ...metadata, name: "local-model" },
      spec: {
        type: "ClusterIP",
        selector: labels,
        ports: [{ name: "https", port: 8443, targetPort: "https" }],
      },
    },
    opts,
  );
  return {
    binding: {
      origin: pulumi.interpolate`https://local-model.${namespace.metadata.name}.svc.cluster.local:8443`,
      model: artifact.model,
      secretName: secret.metadata.name,
      credentialKey: "api-key",
      caKey: "ca.pem",
    },
    resources: [...generated, namespace, secret, cache, deployment, service],
  };
}

/** A separate, bounded client pod for local provider acceptance, never production. */
export function deployModelVerificationClient(args: {
  readonly stage: "development-local";
  readonly provider: k8s.Provider;
  readonly namespace: string;
  readonly binding: ModelProviderBinding;
  readonly dependsOn: readonly pulumi.Resource[];
}) {
  if (args.stage !== "development-local")
    throw new Error("verification client is local only");
  return new k8s.core.v1.Pod(
    "local-model-client",
    {
      metadata: { namespace: args.namespace, name: "local-model-client" },
      spec: {
        automountServiceAccountToken: false,
        restartPolicy: "Never",
        activeDeadlineSeconds: 3600,
        securityContext: {
          runAsUser: 10001,
          runAsGroup: 10001,
          fsGroup: 10001,
          runAsNonRoot: true,
        },
        containers: [
          {
            name: "client",
            image: LOCAL_MODEL_DEFAULTS.image,
            command: ["/bin/sleep", "3600"],
            resources: {
              requests: { cpu: "10m", memory: "16Mi" },
              limits: { cpu: "100m", memory: "128Mi" },
            },
            securityContext: {
              readOnlyRootFilesystem: true,
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"] },
            },
            env: [
              { name: "MODEL_ORIGIN", value: args.binding.origin },
              { name: "MODEL_ID", value: args.binding.model },
            ],
            volumeMounts: [
              {
                name: "credentials",
                mountPath: "/credentials",
                readOnly: true,
              },
            ],
          },
        ],
        volumes: [
          {
            name: "credentials",
            secret: {
              secretName: args.binding.secretName,
              defaultMode: 0o440,
              items: [
                { key: args.binding.credentialKey, path: "api-key" },
                { key: args.binding.caKey, path: "ca.pem" },
              ],
            },
          },
        ],
      },
    },
    { provider: args.provider, protect: false, dependsOn: [...args.dependsOn] },
  );
}
