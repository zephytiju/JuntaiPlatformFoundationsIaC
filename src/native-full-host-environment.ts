import { readFileSync } from "node:fs";
import { createClickHouseTelemetryPlan } from "@zephytiju/meridian-storage-constructs";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import {
  FULL_HOST_UIDS,
  compileNativeFullHostNetwork,
} from "./native-full-host-network.js";
import {
  LOCAL_MODEL_DEFAULTS,
  localModelServerArguments,
} from "./local-model.js";
import {
  PROXY_IMAGE,
  M4_CASDOOR_IMAGE,
  type compile_reader_exposures,
} from "./m4-native-reader.js";
import { NATIVE_VERIFICATION_IMAGES } from "./native-verification-substrate.js";
import { compileNativeFullHostServiceExposures } from "./native-full-host-exposure.js";

export const FULL_HOST_SEALER_IMAGE =
  "docker.io/nicolaka/netshoot@sha256:7f08c4aff13ff61a35d30e30c5c1ea8396eac6ab4ce19fd02d5a4b3b5d0d09a2";

/** Exact public binaries match the previously pinned official OCI image. */
export const FULL_HOST_MINIO_ARTIFACT = JSON.parse(
  readFileSync(
    new URL("../release/minio-official-artifact.v1.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly release: string;
  readonly originalImage: string;
  readonly baseImage: string;
  readonly architectures: Readonly<
    Record<
      "amd64" | "arm64",
      { readonly url: string; readonly sha256: string; readonly bytes: number }
    >
  >;
};

type Role = keyof typeof FULL_HOST_UIDS;
export interface NativeFullHostWorkload {
  readonly image: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly privateEnvironment?: Readonly<Record<string, string>>;
  readonly publicFiles?: Readonly<Record<string, string>>;
  readonly privateFiles?: pulumi.Input<Readonly<Record<string, string>>>;
}

const name = (role: Role) =>
  role.replace(/[A-Z]/g, (v) => "-" + v.toLowerCase());
const imagePin = /^[a-z0-9][a-z0-9./_:-]*@sha256:[a-f0-9]{64}$/;
export const FULL_HOST_FOUNDATION_IMAGES = Object.freeze({
  nousReader: PROXY_IMAGE,
  latticeReader: PROXY_IMAGE,
  issuerProxy: PROXY_IMAGE,
  nousProxy: PROXY_IMAGE,
  latticeProxy: PROXY_IMAGE,
  consoleProxy: PROXY_IMAGE,
  casdoor: M4_CASDOOR_IMAGE,
  domainDatabase: NATIVE_VERIFICATION_IMAGES.postgres,
  casdoorDatabase: NATIVE_VERIFICATION_IMAGES.postgres,
  objects: FULL_HOST_MINIO_ARTIFACT.baseImage,
  collector:
    "ghcr.io/open-telemetry/opentelemetry-collector-releases/opentelemetry-collector-contrib@sha256:f2f01157055a9b2aab9df7118e1f1c9abf345e99b23bc7a2bc791db374a7d0f6",
  telemetryDatabase:
    "clickhouse/clickhouse-server@sha256:0152dd511befe6a2c2ef53e930726179669b08116da78500b37c51c96ff5ee77",
});
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const security = {
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  capabilities: { drop: ["ALL"] },
};

/** Physical deployment owner for the explicit full-host contract.
 * This creates one fresh disposable namespace and one expiring pod. Staging
 * downloads the model, then seals its network before staging private files. There is no
 * Service, host port, network bridge, service-account token or host mount.
 * Control and evidence collection use the caller's Kubernetes exec authority.
 * Domain packages provide their immutable image/config inputs; Foundation does
 * not implement the services or mark their native/storage gates READY.
 */
export function deployNativeFullHostEnvironment(args: {
  readonly provider: k8s.Provider;
  readonly stage: "development-local";
  readonly namespace: string;
  readonly readerExposures: ReturnType<typeof compile_reader_exposures>;
  readonly workloads: Readonly<
    Record<Exclude<Role, "model">, NativeFullHostWorkload>
  >;
  readonly telemetry: Parameters<typeof createClickHouseTelemetryPlan>[0];
  readonly modelCredentials: pulumi.Input<
    Readonly<Record<"api-key" | "tls.pem" | "tls-key.pem" | "ca.pem", string>>
  >;
}) {
  if (
    args.stage !== "development-local" ||
    !/^nous-full-host-t[0-9]+$/.test(args.namespace)
  )
    throw new Error("fresh disposable local full-host namespace required");
  const roles = Object.keys(FULL_HOST_UIDS) as Role[];
  const expected = roles.filter((role) => role !== "model").sort();
  if (
    JSON.stringify(Object.keys(args.workloads).sort()) !==
    JSON.stringify(expected)
  )
    throw new Error("exact full-host service inventory required");
  const network = compileNativeFullHostNetwork(args.readerExposures);
  const serviceExposure = compileNativeFullHostServiceExposures(
    args.readerExposures,
  );
  const proxyConfigs = Object.fromEntries(
    [...serviceExposure.readers, ...serviceExposure.publicServices].map(
      (item) => [item.role, JSON.stringify(item.envoy)],
    ),
  );
  for (const [role, workload] of Object.entries(args.workloads)) {
    if (!imagePin.test(workload.image))
      throw new Error("immutable workload images required");
    const owned =
      FULL_HOST_FOUNDATION_IMAGES[
        role as keyof typeof FULL_HOST_FOUNDATION_IMAGES
      ];
    if (owned && workload.image !== owned)
      throw new Error("Foundation-owned service image differs");
    if (
      role in proxyConfigs &&
      (workload.command ||
        workload.args ||
        "envoy.json" in (workload.publicFiles ?? {}))
    )
      throw new Error(
        "Foundation-owned proxy execution and routing cannot be overridden",
      );
    if (role === "objects" && workload.command)
      throw new Error(
        "Foundation-owned Object executable cannot be overridden",
      );
    const publicFiles = workload.publicFiles ?? {};
    if (
      Object.keys(publicFiles).some((key) => !keyPattern.test(key)) ||
      Buffer.byteLength(JSON.stringify(publicFiles)) > 800_000
    )
      throw new Error("bounded flat public configuration files required");
    if (
      Object.keys(workload.environment ?? {}).some(
        (key) => !/^[A-Z][A-Z0-9_]*$/.test(key),
      )
    )
      throw new Error("invalid environment variable name");
  }
  const telemetry = args.telemetry;
  if (
    telemetry.image !== FULL_HOST_FOUNDATION_IMAGES.collector ||
    telemetry.mode !== "sidecar" ||
    (telemetry.replicas ?? 1) !== 1 ||
    telemetry.backendEndpoint !== "https://telemetry-db.m4.invalid:8443" ||
    telemetry.receiverTls.serverName !== "collector.m4.invalid" ||
    telemetry.queueDirectory !== "/var/lib/collector/queue" ||
    Object.values(telemetry.tlsFiles).some(
      (path) => !/^\/run\/m4\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(path),
    )
  )
    throw new Error(
      "telemetry must use the isolated owned endpoints and mounted files",
    );
  const collector = args.workloads.collector;
  if (
    collector.command ||
    collector.args ||
    "collector.json" in (collector.publicFiles ?? {})
  )
    throw new Error(
      "Foundation-owned Collector execution cannot be overridden",
    );
  for (const variable of [
    telemetry.backendIdentityEnvironment,
    telemetry.backendCredentialEnvironment,
    telemetry.relayCredentialEnvironment,
  ])
    if (
      !(variable in (collector.privateEnvironment ?? {})) ||
      variable in (collector.environment ?? {})
    )
      throw new Error(
        "telemetry credentials require separate private environment references",
      );
  const telemetryPlan = createClickHouseTelemetryPlan(telemetry);
  const labels = {
    "juntai.owner": "nous-full-host-verification",
    "juntai.task": args.namespace.slice("nous-full-host-".length),
  };
  const opts = { provider: args.provider, protect: false };
  const namespace = new k8s.core.v1.Namespace(
    "nous-full-host",
    { metadata: { name: args.namespace, labels } },
    opts,
  );
  const metadata = { namespace: namespace.metadata.name, labels };
  const control = new k8s.core.v1.ConfigMap(
    "nous-full-host-control",
    {
      metadata: { ...metadata, name: "nous-full-host-control" },
      immutable: true,
      data: {
        "network.json": JSON.stringify(network),
        "objects-artifact.json": JSON.stringify(FULL_HOST_MINIO_ARTIFACT),
        "stage-objects.py": readFileSync(
          new URL("../release/stage-official-minio.py", import.meta.url),
          "utf8",
        ),
        "seal.py": readFileSync(
          new URL("../release/seal-full-host-network.py", import.meta.url),
          "utf8",
        ),
        "stage.py": readFileSync(
          new URL("../release/stage-full-host-files.py", import.meta.url),
          "utf8",
        ),
      },
    },
    opts,
  );
  const quota = new k8s.core.v1.ResourceQuota(
    "nous-full-host-quota",
    {
      metadata: { ...metadata, name: "nous-full-host-quota" },
      spec: {
        hard: {
          pods: "1",
          "count/jobs.batch": "1",
          "requests.cpu": "3",
          "requests.memory": "4Gi",
          "limits.cpu": "24",
          "limits.memory": "16Gi",
        },
      },
    },
    opts,
  );
  const model: NativeFullHostWorkload = {
    image: LOCAL_MODEL_DEFAULTS.image,
    args: localModelServerArguments(
      LOCAL_MODEL_DEFAULTS,
      "127.0.0.1",
      network.listeners.model,
    ),
    privateFiles: args.modelCredentials,
  };
  const workloads: Readonly<Record<Role, NativeFullHostWorkload>> = {
    ...args.workloads,
    collector: {
      ...collector,
      publicFiles: {
        ...collector.publicFiles,
        "collector.json": JSON.stringify(telemetryPlan.collector.config),
      },
      args: [
        ...telemetryPlan.commandArguments,
        "--config=/run/m4/collector.json",
      ],
      privateFiles: pulumi
        .output(collector.privateFiles ?? {})
        .apply((files) => {
          if (
            Object.values(telemetry.tlsFiles).some(
              (path) => !(path.slice("/run/m4/".length) in files),
            )
          )
            throw new Error(
              "telemetry TLS files must be present in private custody",
            );
          return files;
        }),
    },
    objects: {
      ...args.workloads.objects,
      command: ["/objects-binary/verified/minio"],
      args: args.workloads.objects.args ?? [
        "server",
        "/data",
        "--address",
        "127.0.0.1:19000",
      ],
    },
    model,
  };
  const resources: pulumi.Resource[] = [namespace, control, quota];
  const volumes: k8s.types.input.core.v1.Volume[] = [
    { name: "control", configMap: { name: control.metadata.name } },
    { name: "network-state", emptyDir: { sizeLimit: "1Mi" } },
    { name: "models", emptyDir: { sizeLimit: "1Gi" } },
    { name: "objects-binary", emptyDir: { sizeLimit: "128Mi" } },
  ];
  const dataDirectories: Partial<Record<Role, string>> = {
    domainDatabase: "/var/lib/postgresql/data",
    casdoorDatabase: "/var/lib/postgresql/data",
    objects: "/data",
    collector: "/var/lib/collector",
    telemetryDatabase: "/var/lib/clickhouse",
  };
  const containers = roles.map((role): k8s.types.input.core.v1.Container => {
    const original = workloads[role];
    const workload: NativeFullHostWorkload =
      role in proxyConfigs
        ? {
            ...original,
            publicFiles: {
              ...original.publicFiles,
              "envoy.json": proxyConfigs[role]!,
            },
            command: ["/usr/local/bin/envoy"],
            args: [
              "-c",
              "/run/m4/envoy.json",
              "--disable-hot-restart",
              "--concurrency",
              "1",
              "--log-level",
              "warning",
            ],
          }
        : original;
    const roleName = name(role),
      uid = FULL_HOST_UIDS[role];
    const config = new k8s.core.v1.ConfigMap(
      "full-host-" + roleName + "-config",
      {
        metadata: { ...metadata, name: "full-host-" + roleName + "-config" },
        immutable: true,
        data: workload.publicFiles ?? {},
      },
      opts,
    );
    resources.push(config);
    const secret = new k8s.core.v1.Secret(
      "full-host-" + roleName + "-private",
      {
        metadata: { ...metadata, name: "full-host-" + roleName + "-private" },
        immutable: true,
        stringData: pulumi.secret(
          pulumi.output(workload.privateFiles ?? {}).apply((files) => {
            if (
              Object.keys(files).some(
                (key) =>
                  !keyPattern.test(key) || key in (workload.publicFiles ?? {}),
              )
            )
              throw new Error(
                "invalid or overlapping private configuration key",
              );
            if (Buffer.byteLength(JSON.stringify(files)) > 800_000)
              throw new Error("private configuration too large");
            for (const [variable, key] of Object.entries(
              workload.privateEnvironment ?? {},
            ))
              if (!/^[A-Z][A-Z0-9_]*$/.test(variable) || !(key in files))
                throw new Error("private environment reference is absent");
            return files;
          }),
        ),
      },
      { ...opts, additionalSecretOutputs: ["data", "stringData"] },
    );
    resources.push(secret);
    volumes.push(
      {
        name: roleName + "-config",
        projected: {
          defaultMode: 0o440,
          sources: [
            { configMap: { name: config.metadata.name } },
            { secret: { name: secret.metadata.name } },
          ],
        },
      },
      {
        name: roleName + "-material",
        emptyDir: { medium: "Memory", sizeLimit: "2Mi" },
      },
      {
        name: roleName + "-tmp",
        emptyDir: { sizeLimit: role === "browser" ? "256Mi" : "64Mi" },
      },
    );
    const mounts: k8s.types.input.core.v1.VolumeMount[] = [
      {
        name: roleName + "-material",
        mountPath: role === "model" ? "/credentials" : "/run/m4",
        readOnly: true,
      },
      { name: roleName + "-tmp", mountPath: "/tmp" },
      {
        name: "network-state",
        mountPath: "/run/network-admission",
        readOnly: true,
      },
    ];
    if (role === "model")
      mounts.push({ name: "models", mountPath: "/models", readOnly: true });
    if (role === "objects")
      mounts.push({
        name: "objects-binary",
        mountPath: "/objects-binary",
        readOnly: true,
      });
    const dataPath = dataDirectories[role];
    if (dataPath) {
      volumes.push({
        name: roleName + "-data",
        emptyDir: { sizeLimit: "2Gi" },
      });
      mounts.push({ name: roleName + "-data", mountPath: dataPath });
    }
    return {
      name: roleName,
      image: workload.image,
      imagePullPolicy: "IfNotPresent",
      command: workload.command ? [...workload.command] : undefined,
      args: workload.args ? [...workload.args] : undefined,
      env: [
        ...Object.entries(workload.environment ?? {}).map(([key, value]) => ({
          name: key,
          value,
        })),
        ...Object.entries(workload.privateEnvironment ?? {}).map(
          ([key, value]) => ({
            name: key,
            valueFrom: {
              secretKeyRef: { name: secret.metadata.name, key: value },
            },
          }),
        ),
      ],
      securityContext: {
        ...security,
        runAsNonRoot: true,
        runAsUser: uid,
        runAsGroup: uid,
      },
      resources:
        role === "model"
          ? {
              requests: { cpu: "500m", memory: "768Mi" },
              limits: { cpu: "4", memory: "2Gi" },
            }
          : role === "telemetryDatabase"
            ? {
                requests: { cpu: "100m", memory: "512Mi" },
                limits: { cpu: "2", memory: "2Gi" },
              }
            : {
                requests: { cpu: "50m", memory: "128Mi" },
                limits: { cpu: "1", memory: "512Mi" },
              },
      volumeMounts: mounts,
    };
  });
  const job = new k8s.batch.v1.Job(
    "nous-full-host",
    {
      metadata: {
        ...metadata,
        name: "nous-full-host",
        annotations: { "pulumi.com/skipAwait": "true" },
      },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: 7200,
        ttlSecondsAfterFinished: 600,
        template: {
          metadata: { labels },
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: "Never",
            hostNetwork: false,
            hostPID: false,
            hostIPC: false,
            shareProcessNamespace: false,
            securityContext: {
              fsGroup: 65532,
              seccompProfile: { type: "RuntimeDefault" },
            },
            hostAliases: [
              {
                ip: "127.0.0.1",
                hostnames: [
                  "iam",
                  "nous",
                  "lattice",
                  "nous-reader",
                  "lattice-reader",
                  "console",
                  "model",
                  "collector",
                  "telemetry-db",
                ].map((v) => v + ".m4.invalid"),
              },
            ],
            initContainers: [
              {
                name: "stage-model",
                image: LOCAL_MODEL_DEFAULTS.image,
                command: ["/bin/sh", "-ec"],
                args: [
                  'curl --fail --location --proto "=https" --proto-redir "=https" --connect-timeout 15 --max-time 600 --output /models/model.part "$MODEL_URL"; printf "%s  /models/model.part\\n" "$MODEL_SHA256" | sha256sum -c -; mv /models/model.part /models/model.gguf',
                ],
                env: [
                  { name: "MODEL_URL", value: LOCAL_MODEL_DEFAULTS.url },
                  { name: "MODEL_SHA256", value: LOCAL_MODEL_DEFAULTS.sha256 },
                ],
                securityContext: {
                  ...security,
                  runAsNonRoot: true,
                  runAsUser: FULL_HOST_UIDS.model,
                  runAsGroup: FULL_HOST_UIDS.model,
                },
                resources: {
                  requests: { cpu: "100m", memory: "64Mi" },
                  limits: { cpu: "1", memory: "256Mi" },
                },
                volumeMounts: [{ name: "models", mountPath: "/models" }],
              },
              {
                name: "stage-objects",
                image: FULL_HOST_MINIO_ARTIFACT.baseImage,
                command: ["python3", "-B", "/control/stage-objects.py"],
                args: [
                  "--manifest",
                  "/control/objects-artifact.json",
                  "--destination",
                  "/objects-binary/verified",
                ],
                securityContext: {
                  ...security,
                  runAsNonRoot: true,
                  runAsUser: FULL_HOST_UIDS.objects,
                  runAsGroup: FULL_HOST_UIDS.objects,
                },
                resources: {
                  requests: { cpu: "100m", memory: "64Mi" },
                  limits: { cpu: "1", memory: "128Mi" },
                },
                volumeMounts: [
                  { name: "control", mountPath: "/control", readOnly: true },
                  { name: "objects-binary", mountPath: "/objects-binary" },
                ],
              },
              {
                name: "seal-network",
                image: FULL_HOST_SEALER_IMAGE,
                command: ["python3", "/control/seal.py"],
                args: [
                  "--apply-to-disposable-pod",
                  "--plan",
                  "/control/network.json",
                  "--policy-sha256",
                  network.policySha256,
                  "--receipt",
                  "/state/receipt.json",
                ],
                env: [
                  {
                    name: "POD_NAMESPACE",
                    valueFrom: {
                      fieldRef: { fieldPath: "metadata.namespace" },
                    },
                  },
                  {
                    name: "POD_UID",
                    valueFrom: { fieldRef: { fieldPath: "metadata.uid" } },
                  },
                ],
                securityContext: {
                  ...security,
                  runAsUser: 0,
                  runAsGroup: 0,
                  capabilities: { drop: ["ALL"], add: ["NET_ADMIN"] },
                },
                resources: {
                  requests: { cpu: "10m", memory: "32Mi" },
                  limits: { cpu: "100m", memory: "64Mi" },
                },
                volumeMounts: [
                  { name: "control", mountPath: "/control", readOnly: true },
                  { name: "network-state", mountPath: "/state" },
                ],
              },
              {
                name: "stage-private-files",
                image: FULL_HOST_SEALER_IMAGE,
                command: ["python3", "/control/stage.py"],
                args: [
                  "--source",
                  "/source",
                  "--destination",
                  "/material",
                  "--data",
                  "/data",
                  "--roles",
                  JSON.stringify(
                    Object.fromEntries(
                      roles.map((role) => [name(role), FULL_HOST_UIDS[role]]),
                    ),
                  ),
                ],
                env: [
                  {
                    name: "POD_NAMESPACE",
                    valueFrom: {
                      fieldRef: { fieldPath: "metadata.namespace" },
                    },
                  },
                ],
                securityContext: {
                  ...security,
                  runAsUser: 0,
                  runAsGroup: 0,
                  capabilities: { drop: ["ALL"], add: ["CHOWN"] },
                },
                resources: {
                  requests: { cpu: "10m", memory: "32Mi" },
                  limits: { cpu: "100m", memory: "64Mi" },
                },
                volumeMounts: [
                  { name: "control", mountPath: "/control", readOnly: true },
                  ...Object.keys(dataDirectories).map((role) => ({
                    name: name(role as Role) + "-data",
                    mountPath: "/data/" + name(role as Role),
                  })),
                  ...roles.flatMap((role) => [
                    {
                      name: name(role) + "-config",
                      mountPath: "/source/" + name(role),
                      readOnly: true,
                    },
                    {
                      name: name(role) + "-material",
                      mountPath: "/material/" + name(role),
                    },
                  ]),
                ],
              },
            ],
            containers,
            volumes,
          },
        },
      },
    },
    { ...opts, dependsOn: resources },
  );
  return {
    namespace: namespace.metadata.name,
    job: job.metadata.name,
    resources: [...resources, job],
    networkPolicySha256: network.policySha256,
    allocation: "declared" as const,
    nativeAdmission: false as const,
    telemetryMigration: telemetryPlan.migration,
    telemetryCollector: telemetryPlan.collector,
    model: {
      origin: "https://model.m4.invalid:9843",
      model: LOCAL_MODEL_DEFAULTS.model,
    },
  };
}
