import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { CASDOOR_IMAGE } from "./release.js";

export const NATIVE_VERIFICATION_IMAGES = Object.freeze({
  postgres:
    "docker.io/postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5",
  objects:
    "quay.io/minio/minio@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e",
  casdoor: CASDOOR_IMAGE,
});

/** Disposable substrate only. References are not live readiness receipts.
 * The invoking owner must establish that this namespace is absent before create.
 * Existing namespaces/resources must never be imported or adopted by this path.
 */
export function deployNativeVerificationSubstrate(args: {
  readonly provider: k8s.Provider;
  readonly stage: "development-local";
  readonly namespace: string;
  readonly privateFiles: pulumi.Input<
    Readonly<
      Record<
        | "casdoor-password"
        | "database-password"
        | "object-password"
        | "app.conf"
        | "init.json"
        | "tls.pem"
        | "tls-key.pem",
        string
      >
    >
  >;
}) {
  if (args.stage !== "development-local")
    throw new Error("native verification requires development-local");
  if (!/^nous-r2-t[0-9]+$/.test(args.namespace))
    throw new Error("native verification requires its own task namespace");
  const databaseName = args.namespace.replaceAll("-", "_");
  const labels = {
    "juntai.task": args.namespace.slice("nous-r2-".length),
    "juntai.owner": "nous-native-verification",
  };
  const namespace = new k8s.core.v1.Namespace(
    "nous-native-verification",
    {
      metadata: { name: args.namespace, labels },
    },
    { provider: args.provider, protect: false },
  );
  const metadata = { namespace: namespace.metadata.name, labels };
  const secret = new k8s.core.v1.Secret(
    "nous-native-private",
    {
      metadata: { ...metadata, name: "nous-native-private" },
      type: "Opaque",
      stringData: pulumi.secret(args.privateFiles),
    },
    {
      provider: args.provider,
      protect: false,
      additionalSecretOutputs: ["data", "stringData"],
    },
  );
  const quota = new k8s.core.v1.ResourceQuota(
    "nous-native-quota",
    {
      metadata: { ...metadata, name: "nous-native-quota" },
      spec: {
        hard: {
          pods: "12",
          "count/jobs.batch": "8",
          "requests.cpu": "3",
          "requests.memory": "3Gi",
          "limits.cpu": "8",
          "limits.memory": "8Gi",
        },
      },
    },
    { provider: args.provider, protect: false },
  );
  const secretEnv = (name: string, key: string) => ({
    name,
    valueFrom: { secretKeyRef: { name: secret.metadata.name, key } },
  });
  const definitions = [
    {
      name: "r2-casdoor-db",
      image: NATIVE_VERIFICATION_IMAGES.postgres,
      port: 5432,
      env: [
        { name: "POSTGRES_DB", value: "casdoor" },
        { name: "POSTGRES_USER", value: "casdoor" },
        secretEnv("POSTGRES_PASSWORD", "casdoor-password"),
      ],
      command: undefined,
      args: undefined,
      memory: "512Mi",
      data: "/var/lib/postgresql/data",
    },
    {
      name: "r2-data",
      image: NATIVE_VERIFICATION_IMAGES.postgres,
      port: 5432,
      env: [
        { name: "POSTGRES_DB", value: databaseName },
        { name: "POSTGRES_USER", value: databaseName },
        secretEnv("POSTGRES_PASSWORD", "database-password"),
      ],
      command: undefined,
      args: undefined,
      memory: "512Mi",
      data: "/var/lib/postgresql/data",
    },
    {
      name: "r2-objects",
      image: NATIVE_VERIFICATION_IMAGES.objects,
      port: 9000,
      env: [
        { name: "MINIO_ROOT_USER", value: args.namespace },
        secretEnv("MINIO_ROOT_PASSWORD", "object-password"),
      ],
      command: undefined,
      args: ["server", "/data"],
      memory: "512Mi",
      data: "/data",
    },
    {
      name: "r2-casdoor",
      image: NATIVE_VERIFICATION_IMAGES.casdoor,
      port: 8443,
      env: [],
      command: undefined,
      args: ["--config=/conf/app.conf"],
      memory: "512Mi",
      data: undefined,
    },
  ];
  const workloads = definitions.map((definition) => {
    const selector = { ...labels, "juntai.native-service": definition.name };
    const tls = definition.name === "r2-casdoor";
    const job = new k8s.batch.v1.Job(
      definition.name,
      {
        metadata: {
          ...metadata,
          name: definition.name,
          annotations: { "pulumi.com/skipAwait": "true" },
        },
        spec: {
          backoffLimit: 0,
          activeDeadlineSeconds: 7200,
          ttlSecondsAfterFinished: 600,
          template: {
            metadata: { labels: selector },
            spec: {
              automountServiceAccountToken: false,
              restartPolicy: "Never",
              // The released Casdoor image runs without root. Kubernetes assigns
              // this supplemental group to the process and Secret volume files.
              securityContext: tls ? { fsGroup: 65532 } : undefined,
              initContainers: tls
                ? [
                    {
                      name: "wait-for-own-database",
                      image: NATIVE_VERIFICATION_IMAGES.postgres,
                      command: [
                        "sh",
                        "-c",
                        "i=0; until pg_isready -h r2-casdoor-db -U casdoor -d casdoor; do i=$((i+1)); [ $i -lt 180 ] || exit 1; sleep 1; done",
                      ],
                      resources: {
                        requests: { cpu: "10m", memory: "16Mi" },
                        limits: { cpu: "100m", memory: "32Mi" },
                      },
                      securityContext: {
                        allowPrivilegeEscalation: false,
                        readOnlyRootFilesystem: true,
                      },
                    },
                  ]
                : undefined,
              containers: [
                {
                  name: definition.name,
                  image: definition.image,
                  imagePullPolicy: "IfNotPresent",
                  command: definition.command,
                  args: definition.args,
                  env: definition.env,
                  ports: [{ name: "service", containerPort: definition.port }],
                  resources: {
                    requests: { cpu: "100m", memory: "128Mi" },
                    limits: { cpu: "1", memory: definition.memory },
                  },
                  securityContext: { allowPrivilegeEscalation: false },
                  readinessProbe: {
                    tcpSocket: { port: definition.port },
                    periodSeconds: 2,
                    failureThreshold: 60,
                  },
                  volumeMounts: tls
                    ? [{ name: "config", mountPath: "/conf", readOnly: true }]
                    : [{ name: "data", mountPath: definition.data! }],
                },
              ],
              volumes: tls
                ? [
                    {
                      name: "config",
                      secret: {
                        secretName: secret.metadata.name,
                        defaultMode: 0o440,
                        items: [
                          "app.conf",
                          "init.json",
                          "tls.pem",
                          "tls-key.pem",
                        ].map((key) => ({ key, path: key })),
                      },
                    },
                  ]
                : [{ name: "data", emptyDir: { sizeLimit: "2Gi" } }],
            },
          },
        },
      },
      { provider: args.provider, protect: false, dependsOn: [secret, quota] },
    );
    const service = new k8s.core.v1.Service(
      `${definition.name}-endpoint`,
      {
        metadata: { ...metadata, name: definition.name },
        spec: {
          type: "ClusterIP",
          selector,
          ports: [
            {
              name: "service",
              port: definition.port,
              targetPort: definition.port,
            },
          ],
        },
      },
      { provider: args.provider, protect: false },
    );
    return { name: definition.name, job, service, port: definition.port };
  });
  return {
    namespace,
    secret,
    quota,
    workloads,
    allocation: "declared" as const,
  };
}
