import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {
  JuntaiWorkload,
  RuntimeReferences,
  WorkloadIdentity,
  literalValue,
  secretValue,
} from "@zephytiju/juntai-platform-constructs";
import { stringify } from "yaml";
import { adoptionOptions, childMigration } from "./adoption.js";
import { OTEL_COLLECTOR_IMAGE } from "./release.js";
import type {
  AdoptionMap,
  ObservabilityGatewayOutput,
  ObservabilityInputs,
} from "./types.js";

export function collectorConfiguration(inputs: ObservabilityInputs): string {
  const endpoint = new URL(inputs.exportEndpoint);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0
  ) {
    throw new Error(
      "OpenTelemetry export endpoint must be HTTP(S) without credentials",
    );
  }
  return stringify({
    extensions: {
      health_check: { endpoint: "0.0.0.0:13133" },
      file_storage: {
        directory: "/var/lib/otelcol/file_storage",
        create_directory: true,
        fsync: true,
      },
    },
    receivers: {
      otlp: {
        protocols: {
          grpc: {
            endpoint: "0.0.0.0:4317",
            ...(inputs.receiverTls === undefined
              ? {}
              : {
                  tls: {
                    cert_file: `${inputs.receiverTls.mountPath}/tls.crt`,
                    key_file: `${inputs.receiverTls.mountPath}/tls.key`,
                  },
                }),
          },
          http: {
            endpoint: "0.0.0.0:4318",
            ...(inputs.receiverTls === undefined
              ? {}
              : {
                  tls: {
                    cert_file: `${inputs.receiverTls.mountPath}/tls.crt`,
                    key_file: `${inputs.receiverTls.mountPath}/tls.key`,
                  },
                }),
          },
        },
      },
    },
    processors: {
      memory_limiter: {
        check_interval: "1s",
        limit_mib: 384,
        spike_limit_mib: 96,
      },
      batch: { timeout: "5s", send_batch_size: 512 },
    },
    exporters: {
      "otlp/downstream": {
        endpoint: inputs.exportEndpoint,
        ...(inputs.authorization === undefined
          ? {}
          : {
              headers: { authorization: "${env:OTEL_EXPORTER_AUTHORIZATION}" },
            }),
        tls:
          inputs.certificateAuthority === undefined
            ? { insecure: endpoint.protocol === "http:" }
            : {
                insecure: false,
                insecure_skip_verify: false,
                ca_file: `${inputs.certificateAuthority.mountPath}/ca.crt`,
              },
        sending_queue: {
          enabled: true,
          storage: "file_storage",
          queue_size: 4096,
          block_on_overflow: true,
        },
        retry_on_failure: {
          enabled: true,
          initial_interval: "1s",
          max_interval: "30s",
          max_elapsed_time: "0s",
        },
      },
    },
    service: {
      extensions: ["health_check", "file_storage"],
      pipelines: Object.fromEntries(
        ["traces", "metrics", "logs"].map((signal) => [
          signal,
          {
            receivers: ["otlp"],
            processors: ["memory_limiter", "batch"],
            exporters: ["otlp/downstream"],
          },
        ]),
      ),
    },
  });
}

function fileReference(
  reference: NonNullable<ObservabilityInputs["receiverTls"]>,
): {
  readonly kind: "secret";
  readonly name: string;
  readonly mountPath: string;
  readonly items: Readonly<Record<string, string>>;
  readonly readOnly: true;
} {
  return { kind: "secret", ...reference, readOnly: true };
}

export function createObservabilityGateway(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly inputs: ObservabilityInputs;
  readonly adoption?: AdoptionMap;
  readonly dependsOn?: readonly pulumi.Resource[];
}): ObservabilityGatewayOutput {
  const configMap = new k8s.core.v1.ConfigMap(
    "otel-gateway-config",
    {
      metadata: {
        namespace: args.namespace,
        name: "otel-gateway-config-v1",
        labels: {
          "app.kubernetes.io/managed-by": "juntai-platform-foundations-iac",
        },
      },
      immutable: true,
      data: { "collector.yaml": collectorConfiguration(args.inputs) },
    },
    {
      provider: args.provider,
      dependsOn: args.dependsOn === undefined ? undefined : [...args.dependsOn],
      ...adoptionOptions(args.adoption, "observability/config"),
    },
  );
  const identity = new WorkloadIdentity("otel-gateway", {
    namespace: args.namespace,
    provider: args.provider,
    resourceMigration: {
      serviceAccount: childMigration(
        args.adoption,
        "observability/identity/service-account",
      ),
    },
  });
  const references = new RuntimeReferences("otel-gateway", {
    environment: [
      literalValue("GOMEMLIMIT", "400MiB"),
      ...(args.inputs.authorization === undefined
        ? []
        : [
            secretValue(
              "OTEL_EXPORTER_AUTHORIZATION",
              args.inputs.authorization,
            ),
          ]),
    ],
    files: [
      {
        kind: "configMap",
        name: configMap.metadata.name,
        mountPath: "/etc/otelcol",
        items: { "collector.yaml": "collector.yaml" },
        readOnly: true,
      },
      ...(args.inputs.receiverTls === undefined
        ? []
        : [fileReference(args.inputs.receiverTls)]),
      ...(args.inputs.certificateAuthority === undefined
        ? []
        : [fileReference(args.inputs.certificateAuthority)]),
    ],
  });
  const workload = new JuntaiWorkload("otel-gateway", {
    namespace: args.namespace,
    provider: args.provider,
    identity: identity.reference,
    image: OTEL_COLLECTOR_IMAGE,
    args: ["--config=/etc/otelcol/collector.yaml"],
    replicas: args.inputs.replicas ?? 2,
    containerPort: 4317,
    references,
    resources: {
      requests: { cpu: "100m", memory: "256Mi" },
      limits: { cpu: "1", memory: "512Mi" },
    },
    probes: {
      startup: {
        path: "/",
        port: 13133,
        periodSeconds: 2,
        failureThreshold: 60,
      },
      readiness: { path: "/", port: 13133, periodSeconds: 10 },
      liveness: { path: "/", port: 13133, periodSeconds: 20 },
    },
    resourceMigration: {
      deployment: childMigration(
        args.adoption,
        "observability/workload/deployment",
      ),
      disruptionBudget: childMigration(
        args.adoption,
        "observability/workload/pdb",
      ),
    },
  });
  const service = new k8s.core.v1.Service(
    "otel-gateway",
    {
      metadata: {
        namespace: args.namespace,
        name: "otel-gateway",
        labels: workload.podLabels,
      },
      spec: {
        type: "ClusterIP",
        selector: workload.podLabels,
        ports: [
          { name: "otlp-grpc", protocol: "TCP", port: 4317, targetPort: 4317 },
          { name: "otlp-http", protocol: "TCP", port: 4318, targetPort: 4318 },
        ],
      },
    },
    {
      provider: args.provider,
      dependsOn: [workload],
      ...adoptionOptions(args.adoption, "observability/service"),
    },
  );
  return Object.freeze({
    endpoint: pulumi.interpolate`http://${service.metadata.name}.${service.metadata.namespace}.svc.cluster.local:4317`,
    namespace: service.metadata.namespace,
  });
}
