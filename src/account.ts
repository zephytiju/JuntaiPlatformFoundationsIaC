import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import {
  GatewayBinding,
  JuntaiService,
  ObservabilityBinding,
  RuntimeReferences,
  WorkloadIdentity,
  literalValue,
} from "@zephytiju/juntai-platform-constructs";
import type { MeridianRuntimeConfig } from "@zephytiju/juntai-platform-constructs";
import { childMigration } from "./adoption.js";
import type { ContractRouteInput } from "./contract-composition.js";
import { pinRuntimeIdentity } from "./resource-transformations.js";
import { ACCOUNT_IMAGE } from "./release.js";
import { serviceDeclaration } from "./service-contracts.js";
import type {
  AccountInputs,
  AdoptionMap,
  FoundationsServiceOutput,
  GatewaySetOutput,
  ObservabilityGatewayOutput,
} from "./types.js";

const declaration = serviceDeclaration("platform.account");

export function createAccount(args: {
  readonly provider: k8s.Provider;
  readonly namespace: pulumi.Input<string>;
  readonly stage: string;
  readonly inputs: AccountInputs;
  readonly gatewaySet: GatewaySetOutput;
  readonly meridianRuntime: MeridianRuntimeConfig;
  readonly observability: ObservabilityGatewayOutput;
  readonly adoption?: AdoptionMap;
  readonly route?: ContractRouteInput;
}): FoundationsServiceOutput | undefined {
  if (args.inputs.enabled === false) return undefined;
  if (args.route === undefined) {
    throw new Error("Account deployment requires a verified contract route");
  }
  const identity = new WorkloadIdentity("account", {
    namespace: args.namespace,
    provider: args.provider,
    resourceMigration: {
      serviceAccount: childMigration(args.adoption, "account/identity"),
    },
  });
  const observability = new ObservabilityBinding("account", {
    serviceName: "platform-account",
    endpoint: args.observability.endpoint,
    protocol: "grpc",
    resourceAttributes: {
      "deployment.environment": args.stage,
      "service.namespace": "platform",
    },
  });
  const references = new RuntimeReferences("account", {
    environment: [
      literalValue(
        "MERIDIAN_CONFIG",
        "/etc/juntai/meridian/meridian-config.v1.json",
      ),
      literalValue(
        "ACCOUNT_COMPOSITION_FACTORY",
        args.inputs.compositionFactory,
      ),
      literalValue("ACCOUNT_HOST", "0.0.0.0"),
      literalValue("ACCOUNT_PORT", "8080"),
      literalValue("PYTHONPATH", args.inputs.composition.mountPath),
      literalValue("JUNTAI_ENVIRONMENT", args.stage),
      literalValue(
        "JUNTAI_CAPABILITY_IAM_ENDPOINT",
        "http://casdoor.juntai-iam.svc.cluster.local:8000",
      ),
      literalValue(
        "JUNTAI_CAPABILITY_OBSERVABILITY_ENDPOINT",
        args.observability.endpoint,
      ),
    ],
    files: [
      {
        kind: "configMap",
        name: args.meridianRuntime.configMap.metadata.name,
        mountPath: "/etc/juntai/meridian",
        items: {
          "meridian-config.v1.json": "meridian-config.v1.json",
        },
        readOnly: true,
      },
      {
        kind: "configMap",
        ...args.inputs.composition,
        readOnly: true,
      },
      ...(args.inputs.runtimeReferences ?? []).map((reference) => ({
        ...reference,
        readOnly: true as const,
      })),
    ],
  });
  const service = new JuntaiService(
    "account",
    {
      namespace: args.namespace,
      provider: args.provider,
      identity: identity.reference,
      image: ACCOUNT_IMAGE,
      port: 8080,
      replicas: args.inputs.replicas ?? 2,
      autoscaling: {
        minReplicas: args.inputs.replicas ?? 2,
        maxReplicas: 8,
        targetCpuUtilizationPercentage: 70,
      },
      references,
      observability,
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "1", memory: "512Mi" },
      },
      probes: {
        startup: {
          path: "/healthz",
          port: 8080,
          periodSeconds: 2,
          failureThreshold: 60,
        },
        readiness: { path: "/readyz", port: 8080 },
        liveness: { path: "/healthz", port: 8080 },
      },
      networkPolicy: {
        allowClusterDns: true,
        ingress: [
          {
            peers: [
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-gateway",
                },
              },
            ],
            ports: [{ port: 8080 }],
          },
        ],
        egress: [
          {
            peers: [
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-capabilities",
                },
              },
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-iam",
                },
              },
              {
                namespaceLabels: {
                  "kubernetes.io/metadata.name": "juntai-observability",
                },
              },
            ],
          },
        ],
      },
      resourceMigration: {
        workload: {
          deployment: childMigration(args.adoption, "account/deployment"),
          disruptionBudget: childMigration(args.adoption, "account/pdb"),
          autoscaler: childMigration(args.adoption, "account/hpa"),
        },
        service: childMigration(args.adoption, "account/service"),
        networkPolicy: {
          defaultDeny: childMigration(
            args.adoption,
            "account/network/default-deny",
          ),
          allowedTraffic: childMigration(
            args.adoption,
            "account/network/allowed",
          ),
        },
      },
    },
    { transformations: [pinRuntimeIdentity({ uid: 65532, gid: 65532 })] },
  );
  new GatewayBinding("account", {
    namespace: args.namespace,
    provider: args.provider,
    gateway: {
      namespace: args.gatewaySet.namespace,
      name: args.gatewaySet.gateways.platform,
    },
    service: { name: service.service.metadata.name, port: 8080 },
    pathPrefix: args.route.pathPrefix,
    resourceMigration: childMigration(args.adoption, "account/route"),
  });
  return Object.freeze({
    endpoint: service.internalEndpoint,
    gatewaySurface: "platform",
    imageDigest: declaration.release.imageDigest,
    namespace: service.service.metadata.namespace,
    observabilityServiceName: "platform-account",
    readinessPath: "/readyz",
    recovery: declaration.deployment.recovery,
    releaseVersion: declaration.release.version,
    routePrefix: args.route.pathPrefix,
    serviceId: declaration.id,
    serviceName: service.service.metadata.name,
  });
}
